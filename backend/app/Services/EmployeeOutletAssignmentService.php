<?php

namespace App\Services;

use App\Enums\EmployeeOutletAssignmentType;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\TenantMembership;
use DateTimeInterface;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

final class EmployeeOutletAssignmentService
{
    private const OPEN_ENDED_AT = '9999-12-31 23:59:59';

    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function assignPrimaryOutlet(
        TenantMembership $actor,
        Employee $employee,
        Outlet $outlet,
        DateTimeInterface $effectiveFrom,
    ): EmployeeOutletAssignment {
        $effectiveFrom = Carbon::instance($effectiveFrom);

        return DB::transaction(function () use ($actor, $employee, $outlet, $effectiveFrom): EmployeeOutletAssignment {
            $employee = $this->lockEmployee($employee);
            $outlet = $this->tenantOutlet($employee, $outlet);
            $this->authorizeAssignment($actor, $employee, $outlet);

            $future = EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
                ->where('employee_id', $employee->getKey())
                ->where('assignment_type', EmployeeOutletAssignmentType::Primary->value)
                ->where('effective_from', '>=', $effectiveFrom)
                ->lockForUpdate()->exists();

            if ($future) {
                throw ValidationException::withMessages([
                    'effective_from' => 'A primary assignment already starts at or after this time.',
                ]);
            }

            $overlapping = EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
                ->where('employee_id', $employee->getKey())
                ->where('assignment_type', EmployeeOutletAssignmentType::Primary->value)
                ->where('effective_from', '<', $effectiveFrom)
                ->where('effective_until', '>', $effectiveFrom)
                ->orderByDesc('effective_from')
                ->lockForUpdate()->get();

            if ($overlapping->count() > 1) {
                throw ValidationException::withMessages([
                    'employee' => 'Existing primary assignment history overlaps and must be reconciled first.',
                ]);
            }

            $replacedAssignment = $overlapping->first();
            $this->assertNoCrossOutletOverlap(
                $employee,
                $outlet,
                $effectiveFrom,
                self::OPEN_ENDED_AT,
                $replacedAssignment?->getKey(),
            );
            $this->assertNoActiveSessionTransfer($employee, $outlet);

            if ($replacedAssignment) {
                $replacedAssignment->forceFill(['effective_until' => $effectiveFrom])->save();
            }

            $assignment = EmployeeOutletAssignment::query()->create([
                'tenant_id' => $employee->tenant_id,
                'employee_id' => $employee->getKey(),
                'outlet_id' => $outlet->getKey(),
                'assignment_type' => EmployeeOutletAssignmentType::Primary->value,
                'effective_from' => $effectiveFrom,
                'effective_until' => self::OPEN_ENDED_AT,
                'created_by_membership_id' => $actor->getKey(),
            ]);

            return $assignment;
        });
    }

    public function assignTemporaryOutlet(
        TenantMembership $actor,
        Employee $employee,
        Outlet $outlet,
        DateTimeInterface $effectiveFrom,
        DateTimeInterface $effectiveUntil,
    ): EmployeeOutletAssignment {
        $effectiveFrom = Carbon::instance($effectiveFrom);
        $effectiveUntil = Carbon::instance($effectiveUntil);

        if ($effectiveUntil->lessThanOrEqualTo($effectiveFrom)) {
            throw ValidationException::withMessages(['effective_until' => 'The temporary assignment end must be after its start.']);
        }

        return DB::transaction(function () use ($actor, $employee, $outlet, $effectiveFrom, $effectiveUntil): EmployeeOutletAssignment {
            $employee = $this->lockEmployee($employee);
            $outlet = $this->tenantOutlet($employee, $outlet);
            $this->authorizeAssignment($actor, $employee, $outlet);
            $this->assertNoCrossOutletOverlap($employee, $outlet, $effectiveFrom, $effectiveUntil);
            $this->assertNoActiveSessionTransfer($employee, $outlet);

            return EmployeeOutletAssignment::query()->create([
                'tenant_id' => $employee->tenant_id,
                'employee_id' => $employee->getKey(),
                'outlet_id' => $outlet->getKey(),
                'assignment_type' => EmployeeOutletAssignmentType::Temporary->value,
                'effective_from' => $effectiveFrom,
                'effective_until' => $effectiveUntil,
                'created_by_membership_id' => $actor->getKey(),
            ]);
        });
    }

    private function lockEmployee(Employee $employee): Employee
    {
        $lockedEmployee = Employee::query()->forTenant((int) $employee->tenant_id)
            ->whereKey($employee->getKey())->lockForUpdate()->first();

        if (! $lockedEmployee) {
            throw ValidationException::withMessages(['employee' => 'The Employee no longer exists in this tenant.']);
        }

        return $lockedEmployee;
    }

    private function tenantOutlet(Employee $employee, Outlet $outlet): Outlet
    {
        $tenantOutlet = Outlet::query()->forTenant((int) $employee->tenant_id)
            ->whereKey($outlet->getKey())->first();

        if (! $tenantOutlet) {
            throw ValidationException::withMessages(['outlet' => 'The outlet must belong to the Employee tenant.']);
        }

        return $tenantOutlet;
    }

    private function authorizeAssignment(TenantMembership $actor, Employee $employee, Outlet $outlet): void
    {
        if ((int) $actor->tenant_id !== (int) $employee->tenant_id) {
            throw new AuthorizationException('The actor must be an active member of the Employee tenant.');
        }

        if (! $this->authorization->canManageOutlet($actor, $outlet)
            || ! $this->authorization->canManageEmployee($actor, $employee)) {
            throw new AuthorizationException('The actor cannot manage this Employee and outlet.');
        }
    }

    private function assertNoCrossOutletOverlap(
        Employee $employee,
        Outlet $outlet,
        DateTimeInterface $effectiveFrom,
        DateTimeInterface|string $effectiveUntil,
        ?int $replacedAssignmentId = null,
    ): void {
        $conflict = EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())
            ->where('outlet_id', '<>', $outlet->getKey())
            ->where('effective_from', '<', $effectiveUntil)
            ->where('effective_until', '>', $effectiveFrom)
            ->when($replacedAssignmentId !== null, fn ($query) => $query->whereKeyNot($replacedAssignmentId))
            ->lockForUpdate()
            ->exists();

        if ($conflict) {
            throw ValidationException::withMessages([
                'effective_from' => 'An Employee cannot have overlapping assignments at different Outlets.',
            ]);
        }
    }

    private function assertNoActiveSessionTransfer(Employee $employee, Outlet $outlet): void
    {
        $owner = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $employee->tenant_id)
            ->where('employee_id', $employee->getKey())
            ->lockForUpdate()
            ->first();

        if (! $owner) {
            return;
        }

        $session = AttendanceSession::query()->forTenant((int) $employee->tenant_id)
            ->whereKey($owner->attendance_session_id)
            ->lockForUpdate()
            ->first();

        if (! $session || $session->status !== 'active' || (int) $session->employee_id !== (int) $employee->getKey()) {
            throw new LogicException('The active-session ownership row is inconsistent.');
        }

        if ((int) $session->outlet_id !== (int) $outlet->getKey()) {
            throw ValidationException::withMessages([
                'outlet' => 'An Employee cannot transfer Outlets while an attendance session is active.',
            ]);
        }
    }
}
