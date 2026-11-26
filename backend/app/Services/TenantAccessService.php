<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\Employee;
use App\Models\EmployeeUserLink;
use App\Models\ManagementChangeEvent;
use App\Models\Outlet;
use App\Models\SupervisorOutletScope;
use App\Models\Tenant;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class TenantAccessService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly TenantMembershipService $memberships,
    ) {}

    /** @param list<int> $outletIds @return array{invitation: TenantAccessInvitation, token: string} */
    public function createInvitation(TenantMembership $actor, string $email, TenantRole $role, ?int $employeeId, array $outletIds): array
    {
        if (! in_array($role, [TenantRole::Employee, TenantRole::Supervisor], true)) {
            throw ValidationException::withMessages(['role' => 'Only Employee or Supervisor access can be invited.']);
        }

        $email = Str::lower(trim($email));
        $outletIds = collect($outletIds)->map(static fn ($id): int => (int) $id)->unique()->sort()->values()->all();
        $token = Str::random(64);
        $tenantId = (int) $actor->tenant_id;

        $invitation = DB::transaction(function () use ($actor, $email, $role, $employeeId, $outletIds, $token, $tenantId): TenantAccessInvitation {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $employee = null;

            if ($role === TenantRole::Employee) {
                $employee = $employeeId === null
                    ? null
                    : Employee::query()->forTenant($tenantId)->whereKey($employeeId)->first();

                if (! $employee || $outletIds !== []) {
                    throw ValidationException::withMessages(['employee_id' => 'Employee access requires one Employee in this tenant and no Outlet scope.']);
                }

                if (EmployeeUserLink::query()->forTenant($tenantId)->where('employee_id', $employee->getKey())->exists()) {
                    throw ValidationException::withMessages(['employee_id' => 'This Employee is already linked to a login account.']);
                }

                if (TenantAccessInvitation::query()->forTenant($tenantId)
                    ->where('employee_id', $employee->getKey())
                    ->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())->exists()) {
                    throw ValidationException::withMessages(['employee_id' => 'This Employee already has a pending invitation. Update or regenerate that invitation instead.']);
                }
            } elseif ($employeeId !== null || $outletIds === []) {
                throw ValidationException::withMessages(['outlet_ids' => 'Supervisor access requires one or more explicitly selected Outlets.']);
            }

            if ($role === TenantRole::Supervisor) {
                $validOutlets = Outlet::query()->forTenant($tenantId)->whereIn('id', $outletIds)->count();
                if ($validOutlets !== count($outletIds)) {
                    throw ValidationException::withMessages(['outlet_ids' => 'Every selected Outlet must belong to this tenant.']);
                }
            }

            $user = User::query()->where('email', $email)->first();
            if ($user) {
                $membership = TenantMembership::query()->forTenant($tenantId)->where('user_id', $user->getKey())->first();
                if ($membership && ($membership->is_active || $membership->revoked_at === null)) {
                    throw ValidationException::withMessages(['email' => 'This identity already has tenant access or must be reactivated directly.']);
                }
            }

            $pendingExists = TenantAccessInvitation::query()->forTenant($tenantId)
                ->where('invitee_email', $email)
                ->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())
                ->exists();
            if ($pendingExists) {
                throw ValidationException::withMessages(['email' => 'An invitation for this identity and role is already pending.']);
            }

            $invitation = TenantAccessInvitation::query()->create([
                'tenant_id' => $tenantId,
                'created_by_membership_id' => $owner->getKey(),
                'intended_user_id' => $user?->getKey(),
                'employee_id' => $employee?->getKey(),
                'invitee_email' => $email,
                'role' => $role,
                'token_digest' => hash('sha256', $token),
                'expires_at' => now()->addHours((int) config('access.invitation_expiration_hours', 24)),
            ]);

            if ($role === TenantRole::Supervisor) {
                foreach ($outletIds as $outletId) {
                    DB::table('tenant_access_invitation_outlet_scopes')->insert([
                        'tenant_id' => $tenantId,
                        'invitation_id' => $invitation->getKey(),
                        'outlet_id' => $outletId,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }

            $this->recordChange($owner, 'access_invitation', (int) $invitation->getKey(), 'created',
                $role === TenantRole::Employee ? ['role', 'employee_link'] : ['role', 'outlet_scope'],
                $employee?->getKey());

            return $invitation;
        });

        return ['invitation' => $invitation, 'token' => $token];
    }

    /** @return array{invitation: TenantAccessInvitation, state: string} */
    public function inspectInvitation(string $token): array
    {
        $invitation = $this->findInvitation($token);

        return ['invitation' => $invitation, 'state' => $invitation->state()];
    }

    public function matchesAuthenticatedRecipient(string $token, User $user): bool
    {
        try {
            $invitation = $this->findInvitation($token);
            $this->assertPending($invitation);
        } catch (HttpException) {
            return false;
        }

        return ($invitation->intended_user_id === null || (int) $invitation->intended_user_id === (int) $user->getKey())
            && Str::lower((string) $user->email) === $invitation->invitee_email;
    }

    public function acceptAsNewUser(string $token, string $name, string $password): TenantMembership
    {
        return DB::transaction(function () use ($token, $name, $password): TenantMembership {
            $invitation = $this->lockPendingInvitation($token);

            if ($invitation->intended_user_id !== null || User::query()->where('email', $invitation->invitee_email)->exists()) {
                throw new HttpException(409, 'Masuk dengan akun yang sesuai untuk menerima undangan ini.');
            }

            $user = User::query()->create([
                'name' => trim($name),
                'email' => $invitation->invitee_email,
                'password' => $password,
            ]);

            return $this->completeAcceptance($invitation, $user);
        });
    }

    public function acceptAsAuthenticatedUser(string $token, User $user): TenantMembership
    {
        return DB::transaction(function () use ($token, $user): TenantMembership {
            $invitation = $this->lockPendingInvitation($token);

            if (($invitation->intended_user_id !== null && (int) $invitation->intended_user_id !== (int) $user->getKey())
                || Str::lower((string) $user->email) !== $invitation->invitee_email) {
                throw new AuthorizationException('Undangan ini ditujukan kepada akun lain.');
            }

            return $this->completeAcceptance($invitation, $user);
        });
    }

    public function cancelInvitation(TenantMembership $actor, int $invitationId): void
    {
        DB::transaction(function () use ($actor, $invitationId): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $invitation = TenantAccessInvitation::query()->forTenant($tenantId)->whereKey($invitationId)->lockForUpdate()->firstOrFail();
            $this->assertPending($invitation);
            $invitation->forceFill(['revoked_at' => now()])->save();
            $this->recordChange($owner, 'access_invitation', $invitationId, 'canceled', ['invitation_status'], $invitation->employee_id);
        });
    }

    /** @return array{invitation: TenantAccessInvitation, token: string} */
    public function reissueInvitation(TenantMembership $actor, int $invitationId, ?string $email = null): array
    {
        $token = Str::random(64);

        return DB::transaction(function () use ($actor, $invitationId, $token, $email): array {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $invitation = TenantAccessInvitation::query()->forTenant($tenantId)->whereKey($invitationId)->lockForUpdate()->firstOrFail();

            if ($invitation->accepted_at !== null || $invitation->revoked_at !== null) {
                throw ValidationException::withMessages(['invitation' => 'Only a pending or expired, unused invitation can be regenerated.']);
            }

            $recipient = $email === null ? $invitation->invitee_email : Str::lower(trim($email));
            if ($recipient !== $invitation->invitee_email) {
                if ($invitation->role !== TenantRole::Employee) {
                    throw ValidationException::withMessages(['email' => 'Only an unactivated Employee invitation can change its login email.']);
                }

                // Preserve the original recipient in history; failure rolls back both actions.
                $invitation->forceFill(['revoked_at' => now()])->save();
                $this->recordChange($owner, 'access_invitation', $invitationId, 'recipient_replaced', ['invitation_status', 'invitee_email'], $invitation->employee_id);

                return $this->createInvitation($owner, $recipient, $invitation->role, (int) $invitation->employee_id, []);
            }

            if ($invitation->employee_id !== null && EmployeeUserLink::query()->forTenant($tenantId)
                ->where('employee_id', $invitation->employee_id)->exists()) {
                throw ValidationException::withMessages(['employee_id' => 'This Employee is already linked to a login account.']);
            }

            if (TenantAccessInvitation::query()->forTenant($tenantId)->where('id', '!=', $invitationId)
                ->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())
                ->where(function ($query) use ($invitation): void {
                    $query->where('invitee_email', $invitation->invitee_email);
                    if ($invitation->employee_id !== null) {
                        $query->orWhere('employee_id', $invitation->employee_id);
                    }
                })->exists()) {
                throw ValidationException::withMessages(['invitation' => 'Another invitation for this Employee or email is already pending.']);
            }

            $invitation->forceFill([
                'token_digest' => hash('sha256', $token),
                'expires_at' => now()->addHours((int) config('access.invitation_expiration_hours', 24)),
            ])->save();
            $this->recordChange($owner, 'access_invitation', $invitationId, 'reissued', ['invitation_token', 'expiration'], $invitation->employee_id);

            return ['invitation' => $invitation, 'token' => $token];
        });
    }

    /** @return array{invitation: TenantAccessInvitation, token: string} */
    public function reissueInvitationForEmailChange(
        TenantMembership $actor,
        int $invitationId,
        string $email,
        int $intendedUserId,
    ): array {
        $token = Str::random(64);
        $email = Str::lower(trim($email));

        return DB::transaction(function () use ($actor, $invitationId, $email, $intendedUserId, $token): array {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $invitation = TenantAccessInvitation::query()->forTenant($tenantId)
                ->whereKey($invitationId)->lockForUpdate()->firstOrFail();

            if ($invitation->accepted_at !== null || $invitation->revoked_at !== null) {
                throw ValidationException::withMessages(['invitation' => 'Hanya undangan yang belum digunakan yang dapat diterbitkan ulang.']);
            }
            if (User::query()->where('email', $email)->whereKeyNot($intendedUserId)->exists()) {
                throw ValidationException::withMessages(['email' => 'Email ini sudah digunakan akun lain.']);
            }

            $conflictingInvitation = TenantAccessInvitation::query()->forTenant($tenantId)
                ->whereKeyNot($invitationId)->whereNull('accepted_at')->whereNull('revoked_at')
                ->where('expires_at', '>', now())
                ->where(function ($query) use ($email, $invitation): void {
                    $query->where('invitee_email', $email);
                    if ($invitation->employee_id !== null) {
                        $query->orWhere('employee_id', $invitation->employee_id);
                    }
                })->exists();
            if ($conflictingInvitation) {
                throw ValidationException::withMessages(['email' => 'Undangan lain untuk email atau profil ini masih aktif.']);
            }

            $outletIds = DB::table('tenant_access_invitation_outlet_scopes')
                ->where('tenant_id', $tenantId)->where('invitation_id', $invitationId)
                ->orderBy('outlet_id')->pluck('outlet_id');
            $invitation->forceFill(['revoked_at' => now()])->save();
            $this->recordChange(
                $owner, 'access_invitation', $invitationId, 'recipient_replaced',
                ['invitation_status', 'invitee_email'], $invitation->employee_id,
            );

            $replacement = TenantAccessInvitation::query()->create([
                'tenant_id' => $tenantId,
                'created_by_membership_id' => $owner->getKey(),
                'intended_user_id' => $intendedUserId,
                'employee_id' => $invitation->employee_id,
                'invitee_email' => $email,
                'role' => $invitation->role,
                'token_digest' => hash('sha256', $token),
                'expires_at' => now()->addHours((int) config('access.invitation_expiration_hours', 24)),
            ]);

            foreach ($outletIds as $outletId) {
                DB::table('tenant_access_invitation_outlet_scopes')->insert([
                    'tenant_id' => $tenantId,
                    'invitation_id' => $replacement->getKey(),
                    'outlet_id' => $outletId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $this->recordChange(
                $owner, 'access_invitation', (int) $replacement->getKey(), 'created',
                ['role', $invitation->role->value === 'employee' ? 'employee_link' : 'outlet_scope'],
                $invitation->employee_id,
            );

            return ['invitation' => $replacement, 'token' => $token];
        });
    }

    public function setMemberActive(TenantMembership $actor, int $membershipId, bool $active): void
    {
        DB::transaction(function () use ($actor, $membershipId, $active): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $target = $this->targetMembership($tenantId, $membershipId, false);

            if ($target->revoked_at !== null) {
                throw ValidationException::withMessages(['membership' => 'Akses yang dicabut hanya dapat dipulihkan melalui undangan baru.']);
            }

            if ((int) $target->user_id === (int) $owner->user_id) {
                throw ValidationException::withMessages(['membership' => 'Owner tidak dapat menonaktifkan aksesnya sendiri.']);
            }

            if ($active && $target->revoked_at !== null) {
                throw ValidationException::withMessages(['membership' => 'Akses yang dicabut hanya dapat dipulihkan melalui undangan baru.']);
            }

            if (! $active && $target->is_active && $this->hasRole($target, TenantRole::Owner)) {
                $this->assertAnotherActiveOwner($tenantId);
            }

            if ((bool) $target->is_active !== $active) {
                $target->forceFill(['is_active' => $active])->save();
                $this->recordChange($owner, 'membership', $membershipId, $active ? 'reactivated' : 'deactivated', ['membership_status']);
            }
        });
    }

    public function revokeMember(TenantMembership $actor, int $membershipId): void
    {
        DB::transaction(function () use ($actor, $membershipId): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $target = $this->targetMembership($tenantId, $membershipId, false);

            if ((int) $target->user_id === (int) $owner->user_id) {
                throw ValidationException::withMessages(['membership' => 'Owner tidak dapat mencabut aksesnya sendiri.']);
            }

            if ($target->is_active && $this->hasRole($target, TenantRole::Owner)) {
                $this->assertAnotherActiveOwner($tenantId);
            }

            if ($target->revoked_at === null) {
                $employeeId = EmployeeUserLink::query()->forTenant($tenantId)
                    ->where('tenant_membership_id', $target->getKey())->value('employee_id');
                TenantRoleAssignment::query()->forTenant($tenantId)->where('tenant_membership_id', $target->getKey())->delete();
                SupervisorOutletScope::query()->forTenant($tenantId)->where('tenant_membership_id', $target->getKey())->delete();
                EmployeeUserLink::query()->forTenant($tenantId)->where('tenant_membership_id', $target->getKey())->delete();
                $target->forceFill(['is_active' => false, 'revoked_at' => now()])->save();
                $this->recordChange($owner, 'membership', $membershipId, 'revoked', ['roles', 'outlet_scope', 'employee_link', 'membership_status'], $employeeId === null ? null : (int) $employeeId);
            }
        });
    }

    /** @param list<int> $outletIds */
    public function replaceSupervisorScope(TenantMembership $actor, int $membershipId, array $outletIds): void
    {
        DB::transaction(function () use ($actor, $membershipId, $outletIds): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $target = $this->targetMembership($tenantId, $membershipId, false);
            if (! $this->hasRole($target, TenantRole::Supervisor)) {
                throw ValidationException::withMessages(['membership' => 'Hanya Supervisor yang memiliki cakupan Outlet.']);
            }

            $outletIds = collect($outletIds)->map(static fn ($id): int => (int) $id)->unique()->sort()->values()->all();
            if ($outletIds === [] || Outlet::query()->forTenant($tenantId)->whereIn('id', $outletIds)->count() !== count($outletIds)) {
                throw ValidationException::withMessages(['outlet_ids' => 'Pilih satu atau lebih Outlet yang valid di tenant ini.']);
            }

            $current = SupervisorOutletScope::query()->forTenant($tenantId)
                ->where('tenant_membership_id', $target->getKey())->orderBy('outlet_id')->pluck('outlet_id')
                ->map(static fn ($id): int => (int) $id)->all();
            if ($current === $outletIds) {
                return;
            }

            SupervisorOutletScope::query()->forTenant($tenantId)->where('tenant_membership_id', $target->getKey())->delete();
            foreach ($outletIds as $outletId) {
                SupervisorOutletScope::query()->create([
                    'tenant_id' => $tenantId,
                    'tenant_membership_id' => $target->getKey(),
                    'outlet_id' => $outletId,
                ]);
            }
            $this->recordChange($owner, 'membership', $membershipId, 'outlet_scope_updated', ['outlet_scope']);
        });
    }

    public function linkMemberToEmployee(TenantMembership $actor, int $membershipId, int $employeeId): void
    {
        DB::transaction(function () use ($actor, $membershipId, $employeeId): void {
            $target = TenantMembership::query()->forTenant((int) $actor->tenant_id)->whereKey($membershipId)->lockForUpdate()->firstOrFail();
            $employee = Employee::query()->forTenant((int) $actor->tenant_id)->whereKey($employeeId)->firstOrFail();
            $this->memberships->linkEmployee($actor, $target, $employee);
            $owner = $this->authorization->requireOwner($actor);
            $this->recordChange($owner, 'membership', $membershipId, 'employee_linked', ['employee_link', 'employee_role'], $employeeId);
        });
    }

    public function unlinkMemberEmployee(TenantMembership $actor, int $membershipId): void
    {
        DB::transaction(function () use ($actor, $membershipId): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $target = $this->targetMembership($tenantId, $membershipId, true);
            $link = EmployeeUserLink::query()->forTenant($tenantId)->where('tenant_membership_id', $target->getKey())->firstOrFail();
            $employeeId = (int) $link->employee_id;
            $this->memberships->unlinkEmployee($owner, $link);
            $this->recordChange($owner, 'membership', $membershipId, 'employee_unlinked', ['employee_link'], $employeeId);
        });
    }

    public function employeeAccessStatus(Employee $employee): string
    {
        $tenantId = (int) $employee->tenant_id;
        $link = EmployeeUserLink::query()->forTenant($tenantId)->with('membership')
            ->where('employee_id', $employee->getKey())->first();

        if ($link) {
            return $link->membership->is_active ? 'active' : 'deactivated';
        }

        $invitation = TenantAccessInvitation::query()->forTenant($tenantId)
            ->where('employee_id', $employee->getKey())->orderByDesc('id')->first();
        if ($invitation && $invitation->state() !== 'accepted') {
            return $invitation->state();
        }

        $latestChange = ManagementChangeEvent::query()->forTenant($tenantId)
            ->where('employee_id', $employee->getKey())
            ->whereIn('action', ['revoked', 'canceled'])
            ->orderByDesc('id')->first();

        return $latestChange ? 'revoked' : 'none';
    }

    private function completeAcceptance(TenantAccessInvitation $invitation, User $user): TenantMembership
    {
        if (Str::lower((string) $user->email) !== $invitation->invitee_email) {
            throw new AuthorizationException('Undangan ini ditujukan kepada akun lain.');
        }

        $membership = $this->memberships->provisionFromInvitation($invitation, $user);
        $invitation->forceFill([
            'accepted_at' => now(),
            'accepted_by_user_id' => $user->getKey(),
        ])->save();
        $this->recordChange(
            $membership,
            'access_invitation',
            (int) $invitation->getKey(),
            'accepted',
            $invitation->role === TenantRole::Employee ? ['role', 'employee_link'] : ['role', 'outlet_scope'],
            $invitation->employee_id,
        );

        return $membership;
    }

    private function findInvitation(string $token): TenantAccessInvitation
    {
        $invitation = strlen($token) === 64
            ? TenantAccessInvitation::query()->with(['tenant', 'creatorMembership.user', 'employee'])
                ->where('token_digest', hash('sha256', $token))->first()
            : null;

        if (! $invitation) {
            throw new HttpException(404, 'Undangan tidak tersedia.');
        }

        return $invitation;
    }

    private function pendingInvitation(string $token): TenantAccessInvitation
    {
        $invitation = strlen($token) === 64
            ? TenantAccessInvitation::query()->where('token_digest', hash('sha256', $token))->lockForUpdate()->first()
            : null;

        if (! $invitation) {
            throw new HttpException(404, 'Undangan tidak tersedia.');
        }
        $this->assertPending($invitation);

        return $invitation;
    }

    private function lockPendingInvitation(string $token): TenantAccessInvitation
    {
        $tenantId = strlen($token) === 64
            ? TenantAccessInvitation::query()->where('token_digest', hash('sha256', $token))->value('tenant_id')
            : null;
        if ($tenantId === null) {
            throw new HttpException(404, 'Undangan tidak tersedia.');
        }

        Tenant::query()->whereKey((int) $tenantId)->lockForUpdate()->firstOrFail();

        return $this->pendingInvitation($token);
    }

    private function assertPending(TenantAccessInvitation $invitation): void
    {
        if ($invitation->accepted_at !== null) {
            throw new HttpException(410, 'Undangan ini sudah digunakan.');
        }
        if ($invitation->revoked_at !== null) {
            throw new HttpException(410, 'Undangan ini sudah dibatalkan.');
        }
        if ($invitation->expires_at->lessThanOrEqualTo(now())) {
            throw new HttpException(410, 'Masa berlaku undangan telah berakhir.');
        }
    }

    private function targetMembership(int $tenantId, int $membershipId, bool $activeOnly): TenantMembership
    {
        $query = TenantMembership::query()->forTenant($tenantId)->whereKey($membershipId);
        if ($activeOnly) {
            $query->where('is_active', true);
        }

        return $query->lockForUpdate()->firstOrFail();
    }

    private function hasRole(TenantMembership $membership, TenantRole $role): bool
    {
        return TenantRoleAssignment::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->where('role', $role->value)->exists();
    }

    private function assertAnotherActiveOwner(int $tenantId): void
    {
        $activeOwners = TenantRoleAssignment::query()->forTenant($tenantId)
            ->where('role', TenantRole::Owner->value)
            ->whereHas('membership', fn ($query) => $query->where('is_active', true))
            ->count();
        if ($activeOwners <= 1) {
            throw ValidationException::withMessages(['membership' => 'Tenant harus mempertahankan setidaknya satu Owner aktif.']);
        }
    }

    /** @param list<string> $changedFields */
    private function recordChange(
        TenantMembership $actor,
        string $subjectType,
        int $subjectId,
        string $action,
        array $changedFields,
        ?int $employeeId = null,
        ?int $outletId = null,
    ): void {
        ManagementChangeEvent::query()->create([
            'tenant_id' => $actor->tenant_id,
            'actor_user_id' => $actor->user_id,
            'actor_membership_id' => $actor->getKey(),
            'employee_id' => $employeeId,
            'outlet_id' => $outletId,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'action' => $action,
            'changed_fields' => $changedFields,
            'occurred_at' => Carbon::now(),
        ]);
    }
}
