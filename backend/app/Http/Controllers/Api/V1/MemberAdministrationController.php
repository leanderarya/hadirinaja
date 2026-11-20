<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\MemberAdministrationService;
use App\Services\TenantAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class MemberAdministrationController extends Controller
{
    public function __construct(private readonly MemberAdministrationService $members, private readonly TenantAuthorization $authorization) {}

    public function changeRole(Request $request, int $membership): JsonResponse
    {
        $actor = $this->owner($request);
        $data = $request->validate([
            'role' => ['required', Rule::in(['owner', 'supervisor', 'employee'])],
            'employee_id' => ['required_if:role,employee', 'prohibited_unless:role,employee', 'nullable', 'integer', 'min:1'],
            'outlet_ids' => ['required_if:role,supervisor', 'prohibited_unless:role,supervisor', 'array', 'min:1'],
            'outlet_ids.*' => ['integer', 'min:1', 'distinct'],
            'reactivate' => ['sometimes', 'boolean'],
            ...$this->confirmationRules(),
        ]);
        $this->members->changeRole($actor, $membership, $data);

        return response()->json(['updated' => true]);
    }

    public function preview(Request $request, int $membership): JsonResponse
    {
        $actor = $this->owner($request);
        $data = $request->validate(['employee_id' => ['nullable', 'integer', 'min:1']]);

        return response()->json($this->members->preview($actor, $membership, isset($data['employee_id']) ? (int) $data['employee_id'] : null));
    }

    public function delete(Request $request, int $membership): JsonResponse
    {
        $actor = $this->owner($request);
        $data = $request->validate([
            'confirmation_email' => ['required', 'email', 'max:255'],
            'employee_id' => ['nullable', 'integer', 'min:1'],
            ...$this->confirmationRules(),
        ]);
        $this->members->deletePermanently($actor, $membership, $data);

        return response()->json(['deleted' => true, 'global_login_preserved' => true]);
    }

    private function confirmationRules(): array
    {
        return ['password' => ['required', 'string', 'max:1024'], 'reason' => ['required', 'string', 'min:3', 'max:1000']];
    }

    private function owner(Request $request): TenantMembership
    {
        $actor = $request->attributes->get('activeMembership');
        abort_unless($actor instanceof TenantMembership && (int) $actor->user_id === (int) $request->user()?->getAuthIdentifier(), 403);

        return $this->authorization->requireOwner($actor);
    }
}
