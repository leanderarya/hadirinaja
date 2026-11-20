<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Outlet;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use App\Services\TenantAccessService;
use App\Services\TenantAuthorization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

final class AccessManagementController extends Controller
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly TenantAccessService $access,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $owner = $this->authorization->requireOwner($this->activeMembership($request));
        $tenantId = (int) $owner->tenant_id;
        $members = TenantMembership::query()->forTenant($tenantId)
            ->with(['user', 'roles', 'employeeUserLink.employee', 'supervisorScopes.outlet'])
            ->orderBy('id')->get()->map(fn (TenantMembership $membership): array => $this->memberData($membership));
        $invitations = TenantAccessInvitation::query()->forTenant($tenantId)
            ->with(['tenant', 'creatorMembership.user', 'employee'])
            ->orderByDesc('id')->limit(100)->get()
            ->map(fn (TenantAccessInvitation $invitation): array => $this->invitationData($invitation));

        return response()->json([
            'members' => $members,
            'invitations' => $invitations,
            'employees' => Employee::query()->forTenant($tenantId)->orderBy('name')->get(['id', 'name', 'tenant_id'])
                ->map(fn (Employee $employee): array => [
                    'id' => (int) $employee->getKey(),
                    'name' => $employee->name,
                    'access_status' => $this->access->employeeAccessStatus($employee),
                ]),
            'outlets' => Outlet::query()->forTenant($tenantId)->with('businessUnit')->orderBy('id')->get()
                ->map(fn (Outlet $outlet): array => [
                    'id' => (int) $outlet->getKey(),
                    'name' => $outlet->name,
                    'business_unit_name' => $outlet->businessUnit?->name,
                ]),
        ]);
    }

    public function createInvitation(Request $request): JsonResponse
    {
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $tenantId = (int) $actor->tenant_id;
        $validated = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'role' => ['required', Rule::in([TenantRole::Employee->value, TenantRole::Supervisor->value])],
            'employee_id' => ['required_if:role,employee', 'nullable', 'integer', 'min:1', Rule::exists('employees', 'id')->where('tenant_id', $tenantId), 'prohibited_if:role,supervisor'],
            'outlet_ids' => ['required_if:role,supervisor', 'array', 'min:1', 'prohibited_if:role,employee'],
            'outlet_ids.*' => ['required', 'integer', 'min:1', 'distinct', Rule::exists('outlets', 'id')->where('tenant_id', $tenantId)],
        ]);

        $issued = $this->access->createInvitation(
            $actor,
            $validated['email'],
            TenantRole::from($validated['role']),
            isset($validated['employee_id']) ? (int) $validated['employee_id'] : null,
            array_map('intval', $validated['outlet_ids'] ?? []),
        );

        return response()->json([
            'invitation' => $this->invitationData($issued['invitation']->load(['tenant', 'creatorMembership.user', 'employee'])),
            'activation_token' => $issued['token'],
        ], 201);
    }

    public function cancelInvitation(Request $request, int $invitation): JsonResponse
    {
        $this->access->cancelInvitation($this->activeMembership($request), $invitation);

        return response()->json(['canceled' => true]);
    }

    public function reissueInvitation(Request $request, int $invitation): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate(['email' => ['sometimes', 'required', 'string', 'email', 'max:255']]);
        $issued = $this->access->reissueInvitation($this->activeMembership($request), $invitation, $validated['email'] ?? null);

        return response()->json([
            'invitation' => $this->invitationData($issued['invitation']->load(['tenant', 'creatorMembership.user', 'employee'])),
            'activation_token' => $issued['token'],
        ]);
    }

    public function setMemberActive(Request $request, int $membership): JsonResponse
    {
        $validated = $request->validate(['is_active' => ['required', 'boolean']]);
        $this->access->setMemberActive($this->activeMembership($request), $membership, (bool) $validated['is_active']);

        return response()->json(['updated' => true]);
    }

    public function revokeMember(Request $request, int $membership): JsonResponse
    {
        $this->access->revokeMember($this->activeMembership($request), $membership);

        return response()->json(['revoked' => true]);
    }

    public function replaceSupervisorScope(Request $request, int $membership): JsonResponse
    {
        $tenantId = (int) $this->activeMembership($request)->tenant_id;
        $validated = $request->validate([
            'outlet_ids' => ['required', 'array', 'min:1'],
            'outlet_ids.*' => ['required', 'integer', 'min:1', 'distinct', Rule::exists('outlets', 'id')->where('tenant_id', $tenantId)],
        ]);
        $this->access->replaceSupervisorScope($this->activeMembership($request), $membership, array_map('intval', $validated['outlet_ids']));

        return response()->json(['updated' => true]);
    }

    public function linkMemberToEmployee(Request $request, int $membership): JsonResponse
    {
        $tenantId = (int) $this->activeMembership($request)->tenant_id;
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1', Rule::exists('employees', 'id')->where('tenant_id', $tenantId)],
        ]);
        $this->access->linkMemberToEmployee($this->activeMembership($request), $membership, (int) $validated['employee_id']);

        return response()->json(['linked' => true]);
    }

    public function unlinkMemberEmployee(Request $request, int $membership): JsonResponse
    {
        $this->access->unlinkMemberEmployee($this->activeMembership($request), $membership);

        return response()->json(['unlinked' => true]);
    }

    public function inspectInvitation(Request $request): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'size:64']]);
        $inspected = $this->access->inspectInvitation($validated['token']);
        $invitation = $inspected['invitation'];

        return response()->json([
            'status' => $inspected['state'],
            'invitee_email' => $invitation->invitee_email,
            'tenant' => ['name' => $invitation->tenant->name],
            'inviter' => ['name' => $invitation->creatorMembership->user->name],
            'role' => $invitation->role->value,
            'employee' => $invitation->employee ? ['name' => $invitation->employee->name] : null,
            'outlets' => $this->invitationOutlets($invitation),
            'expires_at' => $invitation->expires_at->toIso8601String(),
        ]);
    }

    public function activateNewUser(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'name' => ['required', 'string', 'max:120'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);
        $membership = $this->access->acceptAsNewUser($validated['token'], $validated['name'], $validated['password']);

        return response()->json(['activated' => true, 'tenant_name' => $membership->tenant()->value('name')], 201);
    }

    public function acceptForExistingUser(Request $request): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'size:64']]);
        /** @var User $user */
        $user = $request->user();
        $membership = $this->access->acceptAsAuthenticatedUser($validated['token'], $user);

        return response()->json(['accepted' => true, 'tenant_name' => $membership->tenant()->value('name')]);
    }

    /** @return array<string, mixed> */
    private function memberData(TenantMembership $membership): array
    {
        $roles = $membership->roles->map(fn (TenantRoleAssignment $assignment): string => $assignment->role->value)->values()->all();
        $status = $membership->revoked_at !== null ? 'revoked' : ($membership->is_active ? 'active' : 'deactivated');

        return [
            'id' => (int) $membership->getKey(),
            'name' => $membership->user->name,
            'email' => $membership->user->email,
            'roles' => $roles,
            'status' => $status,
            'employee' => $membership->employeeUserLink?->employee ? [
                'id' => (int) $membership->employeeUserLink->employee->getKey(),
                'name' => $membership->employeeUserLink->employee->name,
            ] : null,
            'outlets' => $membership->supervisorScopes->map(fn ($scope): array => [
                'id' => (int) $scope->outlet->getKey(), 'name' => $scope->outlet->name,
            ])->values()->all(),
        ];
    }

    /** @return array<string, mixed> */
    private function invitationData(TenantAccessInvitation $invitation): array
    {
        return [
            'id' => (int) $invitation->getKey(),
            'email' => $invitation->invitee_email,
            'role' => $invitation->role->value,
            'status' => $invitation->state(),
            'employee' => $invitation->employee ? ['id' => (int) $invitation->employee->getKey(), 'name' => $invitation->employee->name] : null,
            'outlets' => $this->invitationOutlets($invitation),
            'invited_by' => $invitation->creatorMembership?->user?->name,
            'expires_at' => $invitation->expires_at->toIso8601String(),
        ];
    }

    /** @return list<array{id: int, name: string}> */
    private function invitationOutlets(TenantAccessInvitation $invitation): array
    {
        return DB::table('tenant_access_invitation_outlet_scopes as scopes')
            ->join('outlets', function ($join): void {
                $join->on('outlets.id', '=', 'scopes.outlet_id')->on('outlets.tenant_id', '=', 'scopes.tenant_id');
            })
            ->where('scopes.tenant_id', $invitation->tenant_id)
            ->where('scopes.invitation_id', $invitation->getKey())
            ->orderBy('outlets.id')
            ->get(['outlets.id', 'outlets.name'])
            ->map(fn ($outlet): array => ['id' => (int) $outlet->id, 'name' => $outlet->name])
            ->all();
    }

    private function activeMembership(Request $request): TenantMembership
    {
        $membership = $request->attributes->get('activeMembership');
        if (! $membership instanceof TenantMembership || (int) $membership->user_id !== (int) $request->user()?->getAuthIdentifier()) {
            throw new AuthorizationException('An active tenant membership is required.');
        }

        return $membership;
    }
}
