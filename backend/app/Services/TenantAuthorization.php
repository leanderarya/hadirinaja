<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

final class TenantAuthorization
{
    public function resolveMembership(User $user, int $tenantId): TenantMembership
    {
        $membership = TenantMembership::query()
            ->forTenant($tenantId)
            ->where('user_id', $user->getKey())
            ->where('is_active', true)
            ->first();

        if (! $membership) {
            throw new AuthorizationException('The user has no active membership in this tenant.');
        }

        return $membership;
    }

    public function isOwner(TenantMembership $membership): bool
    {
        return $this->hasRole($membership, TenantRole::Owner);
    }

    public function hasRole(TenantMembership $membership, TenantRole $role): bool
    {
        $current = $this->currentMembership($membership);

        return $current !== null && TenantRoleAssignment::query()
            ->forTenant($current->tenant_id)
            ->where('tenant_membership_id', $current->getKey())
            ->where('role', $role->value)
            ->exists();
    }

    public function requireOwner(TenantMembership $membership): TenantMembership
    {
        $current = $this->currentMembership($membership);

        if (! $current || ! TenantRoleAssignment::query()
            ->forTenant($current->tenant_id)
            ->where('tenant_membership_id', $current->getKey())
            ->where('role', TenantRole::Owner->value)
            ->exists()) {
            throw new AuthorizationException('An active tenant Owner membership is required.');
        }

        return $current;
    }

    public function canManageOutlet(TenantMembership $membership, Outlet $outlet): bool
    {
        $current = $this->currentMembership($membership);
        $tenantOutlet = $current
            ? Outlet::query()->forTenant((int) $current->tenant_id)->whereKey($outlet->getKey())->first()
            : null;

        if (! $current || ! $tenantOutlet) {
            return false;
        }

        if ($this->hasTenantRole($current, TenantRole::Owner)) {
            return true;
        }

        return $this->hasTenantRole($current, TenantRole::Supervisor)
            && $current->supervisorScopes()->where('tenant_id', $current->tenant_id)
                ->where('outlet_id', $tenantOutlet->getKey())->exists();
    }

    public function canManageEmployee(TenantMembership $membership, Employee $employee): bool
    {
        $current = $this->currentMembership($membership);
        $tenantEmployee = $current
            ? Employee::query()->forTenant((int) $current->tenant_id)->whereKey($employee->getKey())->first()
            : null;

        if (! $current || ! $tenantEmployee) {
            return false;
        }

        if ($this->hasTenantRole($current, TenantRole::Owner)) {
            return true;
        }

        if (! $this->hasTenantRole($current, TenantRole::Supervisor)) {
            return false;
        }

        $scopedOutletIds = $current->supervisorScopes()->where('tenant_id', $current->tenant_id)->pluck('outlet_id');

        return $scopedOutletIds->isNotEmpty() && $tenantEmployee->assignments()
            ->where('tenant_id', $tenantEmployee->tenant_id)
            ->whereIn('outlet_id', $scopedOutletIds)
            ->where('effective_from', '<=', now())
            ->where('effective_until', '>', now())
            ->exists();
    }

    /** @return Collection<int, Outlet> */
    public function outletsFor(User $user, int $tenantId): Collection
    {
        $membership = $this->resolveMembership($user, $tenantId);

        if ($this->hasTenantRole($membership, TenantRole::Owner)) {
            return Outlet::query()->forTenant($tenantId)->orderBy('id')->get();
        }

        $outletIds = collect();

        if ($this->hasTenantRole($membership, TenantRole::Supervisor)) {
            $outletIds = $outletIds->merge($membership->supervisorScopes()
                ->where('tenant_id', $tenantId)->pluck('outlet_id'));
        }

        if ($this->hasTenantRole($membership, TenantRole::Employee)) {
            $employeeId = EmployeeUserLink::query()
                ->forTenant($tenantId)
                ->where('tenant_membership_id', $membership->getKey())
                ->value('employee_id');

            if ($employeeId !== null) {
                $outletIds = $outletIds->merge($this->currentAssignments($tenantId, (int) $employeeId)->pluck('outlet_id'));
            }
        }

        return Outlet::query()->forTenant($tenantId)
            ->whereIn('id', $outletIds->unique()->values())
            ->orderBy('id')->get();
    }

    /** @return Collection<int, BusinessUnit> */
    public function businessUnitsFor(User $user, int $tenantId): Collection
    {
        $membership = $this->resolveMembership($user, $tenantId);

        if ($this->hasTenantRole($membership, TenantRole::Owner)) {
            return BusinessUnit::query()->forTenant($tenantId)->orderBy('id')->get();
        }

        $unitIds = $this->outletsFor($user, $tenantId)->pluck('business_unit_id')->unique()->values();

        return BusinessUnit::query()->forTenant($tenantId)
            ->whereIn('id', $unitIds)
            ->orderBy('id')->get();
    }

    /** @return Collection<int, Employee> */
    public function employeesFor(User $user, int $tenantId): Collection
    {
        $membership = $this->resolveMembership($user, $tenantId);

        if ($this->hasTenantRole($membership, TenantRole::Owner)) {
            return Employee::query()->forTenant($tenantId)->orderBy('id')->get();
        }

        $employees = collect();

        if ($this->hasTenantRole($membership, TenantRole::Supervisor)) {
            $outletIds = $membership->supervisorScopes()->where('tenant_id', $tenantId)->pluck('outlet_id');
            $assignedEmployeeIds = EmployeeOutletAssignment::query()
                ->forTenant($tenantId)
                ->whereIn('outlet_id', $outletIds)
                ->where('effective_from', '<=', now())
                ->where('effective_until', '>', now())
                ->distinct()
                ->pluck('employee_id');
            $employees = $employees->merge(Employee::query()->forTenant($tenantId)->whereIn('id', $assignedEmployeeIds)->get());
        }

        if ($this->hasTenantRole($membership, TenantRole::Employee)) {
            $employeeId = EmployeeUserLink::query()
                ->forTenant($tenantId)
                ->where('tenant_membership_id', $membership->getKey())
                ->value('employee_id');

            if ($employeeId !== null) {
                $employees = $employees->merge(Employee::query()->forTenant($tenantId)->whereKey($employeeId)->get());
            }
        }

        return $employees->unique('id')->sortBy('id')->values();
    }

    public function canAccessEmployee(User $user, int $tenantId, int $employeeId): bool
    {
        return $this->employeesFor($user, $tenantId)->contains('id', $employeeId);
    }

    private function currentMembership(TenantMembership $membership): ?TenantMembership
    {
        return TenantMembership::query()
            ->forTenant((int) $membership->tenant_id)
            ->whereKey($membership->getKey())
            ->where('is_active', true)
            ->first();
    }

    private function hasTenantRole(TenantMembership $membership, TenantRole $role): bool
    {
        return TenantRoleAssignment::query()
            ->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())
            ->where('role', $role->value)
            ->exists();
    }

    private function currentAssignments(int $tenantId, int $employeeId): Collection
    {
        $now = Carbon::now();

        return EmployeeOutletAssignment::query()
            ->forTenant($tenantId)
            ->where('employee_id', $employeeId)
            ->where('effective_from', '<=', $now)
            ->where('effective_until', '>', $now)
            ->get();
    }
}
