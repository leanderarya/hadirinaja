<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\Employee;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\SupervisorOutletScope;
use App\Models\Tenant;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class TenantMembershipService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function addMembership(TenantMembership $actor, User $user): TenantMembership
    {
        return $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($user): TenantMembership {
            if (! $user->exists) {
                throw ValidationException::withMessages(['user' => 'A saved User is required.']);
            }

            if (TenantMembership::query()->forTenant((int) $owner->tenant_id)->where('user_id', $user->getKey())->exists()) {
                throw ValidationException::withMessages(['user' => 'The User already has a membership in this tenant.']);
            }

            return TenantMembership::query()->create([
                'tenant_id' => $owner->tenant_id,
                'user_id' => $user->getKey(),
                'is_active' => true,
            ]);
        });
    }

    public function assignRole(TenantMembership $actor, TenantMembership $membership, TenantRole $role): TenantRoleAssignment
    {
        return $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($membership, $role): TenantRoleAssignment {
            $target = $this->tenantMembership($owner, $membership);

            if (TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('role', $role->value)->exists()) {
                throw ValidationException::withMessages(['role' => 'This role is already assigned to the membership.']);
            }

            return TenantRoleAssignment::query()->create([
                'tenant_id' => $owner->tenant_id,
                'tenant_membership_id' => $target->getKey(),
                'role' => $role->value,
            ]);
        });
    }

    public function revokeRole(TenantMembership $actor, TenantMembership $membership, TenantRole $role): void
    {
        $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($membership, $role): void {
            $target = $this->tenantMembership($owner, $membership);
            $assignment = TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('role', $role->value)->first();

            if (! $assignment) {
                throw ValidationException::withMessages(['role' => 'The membership does not have this role.']);
            }

            if ($role === TenantRole::Owner) {
                $activeOwners = TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                    ->where('role', TenantRole::Owner->value)
                    ->whereHas('membership', fn ($query) => $query->where('is_active', true))
                    ->count();

                if ($activeOwners <= 1) {
                    throw ValidationException::withMessages(['role' => 'A tenant must retain at least one active Owner.']);
                }
            }

            if ($role === TenantRole::Supervisor) {
                SupervisorOutletScope::query()->forTenant((int) $owner->tenant_id)
                    ->where('tenant_membership_id', $target->getKey())->delete();
            }

            $assignment->delete();
        });
    }

    public function assignSupervisorOutletScope(TenantMembership $actor, TenantMembership $membership, Outlet $outlet): SupervisorOutletScope
    {
        return $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($membership, $outlet): SupervisorOutletScope {
            $target = $this->tenantMembership($owner, $membership);
            $tenantOutlet = Outlet::query()->forTenant((int) $owner->tenant_id)->whereKey($outlet->getKey())->first();

            if (! $tenantOutlet) {
                throw ValidationException::withMessages(['outlet' => 'The outlet must belong to the actor tenant.']);
            }

            $isSupervisor = TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('role', TenantRole::Supervisor->value)->exists();

            if (! $isSupervisor) {
                throw ValidationException::withMessages(['membership' => 'The membership must have the Supervisor role.']);
            }

            if (SupervisorOutletScope::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('outlet_id', $tenantOutlet->getKey())->exists()) {
                throw ValidationException::withMessages(['outlet' => 'This outlet scope is already assigned.']);
            }

            return SupervisorOutletScope::query()->create([
                'tenant_id' => $owner->tenant_id,
                'tenant_membership_id' => $target->getKey(),
                'outlet_id' => $tenantOutlet->getKey(),
            ]);
        });
    }

    public function revokeSupervisorOutletScope(TenantMembership $actor, TenantMembership $membership, Outlet $outlet): void
    {
        $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($membership, $outlet): void {
            $target = $this->tenantMembership($owner, $membership);
            $deleted = SupervisorOutletScope::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('outlet_id', $outlet->getKey())->delete();

            if ($deleted === 0) {
                throw ValidationException::withMessages(['outlet' => 'The Supervisor outlet scope does not exist.']);
            }
        });
    }

    public function linkEmployee(TenantMembership $actor, TenantMembership $membership, Employee $employee): EmployeeUserLink
    {
        return $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($membership, $employee): EmployeeUserLink {
            $target = $this->tenantMembership($owner, $membership);
            $tenantEmployee = Employee::query()->forTenant((int) $owner->tenant_id)->whereKey($employee->getKey())->first();

            if (! $tenantEmployee) {
                throw ValidationException::withMessages(['employee' => 'The Employee must belong to the actor tenant.']);
            }

            $hasEligibleRole = TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->whereIn('role', [TenantRole::Owner->value, TenantRole::Supervisor->value, TenantRole::Employee->value])
                ->exists();

            if (! $hasEligibleRole) {
                throw ValidationException::withMessages(['membership' => 'The membership must have an active tenant role before linking.']);
            }

            if (EmployeeUserLink::query()->forTenant((int) $owner->tenant_id)
                ->where(fn ($query) => $query->where('tenant_membership_id', $target->getKey())->orWhere('employee_id', $tenantEmployee->getKey()))
                ->exists()) {
                throw ValidationException::withMessages(['employee' => 'The membership or Employee is already linked.']);
            }

            if (! TenantRoleAssignment::query()->forTenant((int) $owner->tenant_id)
                ->where('tenant_membership_id', $target->getKey())
                ->where('role', TenantRole::Employee->value)->exists()) {
                TenantRoleAssignment::query()->create([
                    'tenant_id' => $owner->tenant_id,
                    'tenant_membership_id' => $target->getKey(),
                    'role' => TenantRole::Employee->value,
                ]);
            }

            return EmployeeUserLink::query()->create([
                'tenant_id' => $owner->tenant_id,
                'tenant_membership_id' => $target->getKey(),
                'employee_id' => $tenantEmployee->getKey(),
            ]);
        });
    }

    public function provisionFromInvitation(TenantAccessInvitation $invitation, User $user): TenantMembership
    {
        return DB::transaction(function () use ($invitation, $user): TenantMembership {
            $tenantId = (int) $invitation->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();

            if (! in_array($invitation->role, [TenantRole::Employee, TenantRole::Supervisor], true)) {
                throw ValidationException::withMessages(['invitation' => 'This invitation role cannot be provisioned.']);
            }

            $membership = TenantMembership::query()->forTenant($tenantId)
                ->where('user_id', $user->getKey())->lockForUpdate()->first();

            if ($membership && ($membership->is_active || $membership->revoked_at === null || $membership->roles()->exists())) {
                throw ValidationException::withMessages(['invitation' => 'The invitation cannot create a conflicting membership.']);
            }

            if (! $membership) {
                $membership = TenantMembership::query()->create([
                    'tenant_id' => $tenantId,
                    'user_id' => $user->getKey(),
                    'is_active' => true,
                ]);
            } else {
                $membership->forceFill(['is_active' => true, 'revoked_at' => null])->save();
            }

            TenantRoleAssignment::query()->create([
                'tenant_id' => $tenantId,
                'tenant_membership_id' => $membership->getKey(),
                'role' => $invitation->role->value,
            ]);

            if ($invitation->role === TenantRole::Employee) {
                if ($invitation->employee_id === null) {
                    throw ValidationException::withMessages(['invitation' => 'The Employee invitation has no Employee identity.']);
                }

                EmployeeUserLink::query()->create([
                    'tenant_id' => $tenantId,
                    'tenant_membership_id' => $membership->getKey(),
                    'employee_id' => $invitation->employee_id,
                ]);
            } else {
                $outletIds = DB::table('tenant_access_invitation_outlet_scopes')
                    ->where('tenant_id', $tenantId)
                    ->where('invitation_id', $invitation->getKey())
                    ->orderBy('outlet_id')->pluck('outlet_id');

                if ($outletIds->isEmpty()) {
                    throw ValidationException::withMessages(['invitation' => 'The Supervisor invitation has no explicit Outlet scope.']);
                }

                foreach ($outletIds as $outletId) {
                    SupervisorOutletScope::query()->create([
                        'tenant_id' => $tenantId,
                        'tenant_membership_id' => $membership->getKey(),
                        'outlet_id' => $outletId,
                    ]);
                }
            }

            return $membership;
        });
    }

    public function unlinkEmployee(TenantMembership $actor, EmployeeUserLink $link): void
    {
        $this->withinOwnerTenant($actor, function (TenantMembership $owner) use ($link): void {
            $deleted = EmployeeUserLink::query()->forTenant((int) $owner->tenant_id)->whereKey($link->getKey())->delete();

            if ($deleted === 0) {
                throw ValidationException::withMessages(['link' => 'The Employee link must belong to the actor tenant.']);
            }
        });
    }

    private function withinOwnerTenant(TenantMembership $actor, callable $operation): mixed
    {
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $tenantId, $operation): mixed {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);

            return $operation($owner);
        });
    }

    private function tenantMembership(TenantMembership $owner, TenantMembership $membership): TenantMembership
    {
        $target = TenantMembership::query()->forTenant((int) $owner->tenant_id)
            ->whereKey($membership->getKey())->where('is_active', true)->first();

        if (! $target) {
            throw ValidationException::withMessages(['membership' => 'The membership must be active and belong to the actor tenant.']);
        }

        return $target;
    }
}
