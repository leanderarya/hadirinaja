<?php

namespace Tests\Feature\S1;

use App\Enums\EmployeeOutletAssignmentType;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class EmployeeOutletAssignmentTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_primary_changes_preserve_history_when_outlet_intervals_are_sequential(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $primaryOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'South');
        [, $nextPrimaryOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'North');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $service = app(EmployeeOutletAssignmentService::class);
        $firstStart = Carbon::parse('2026-10-20 09:00:00');
        $temporaryStart = Carbon::parse('2026-10-21 09:00:00');
        $changeTime = Carbon::parse('2026-10-22 09:00:00');

        $firstPrimary = $service->assignPrimaryOutlet($owner, $employee, $primaryOutlet, $firstStart);
        $temporary = $service->assignTemporaryOutlet($owner, $employee, $primaryOutlet, $temporaryStart, $changeTime);
        $secondPrimary = $service->assignPrimaryOutlet($owner, $employee, $nextPrimaryOutlet, $changeTime);

        $this->assertSame(EmployeeOutletAssignmentType::Primary, $firstPrimary->assignment_type);
        $this->assertSame($changeTime->toDateTimeString(), $firstPrimary->fresh()->effective_until->toDateTimeString());
        $this->assertSame(EmployeeOutletAssignmentType::Temporary, $temporary->assignment_type);
        $this->assertSame($primaryOutlet->getKey(), $temporary->fresh()->outlet_id);
        $this->assertSame($changeTime->toDateTimeString(), $temporary->fresh()->effective_until->toDateTimeString());
        $this->assertSame($nextPrimaryOutlet->getKey(), $secondPrimary->outlet_id);
        $this->assertSame('9999-12-31 23:59:59', $secondPrimary->effective_until->toDateTimeString());
        $this->assertSame(2, $employee->assignments()->where('assignment_type', 'primary')->count());
        $this->assertSame(2, $employee->assignments()->distinct()->count('outlet_id'));
    }

    public function test_temporary_assignment_cannot_overlap_a_different_outlet(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner, 'Coffee', 'South');
        [, $otherOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'North');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $service = app(EmployeeOutletAssignmentService::class);
        $primary = $service->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());

        try {
            $service->assignTemporaryOutlet($owner, $employee, $otherOutlet, now(), now()->addDay());
            $this->fail('An overlapping cross-Outlet assignment must be rejected.');
        } catch (ValidationException) {
            $this->assertSame(1, $employee->assignments()->count());
            $this->assertSame('9999-12-31 23:59:59', $primary->fresh()->effective_until->toDateTimeString());
        }

        $sameOutletTemporary = $service->assignTemporaryOutlet($owner, $employee, $outlet, now(), now()->addDay());
        $this->assertSame($outlet->getKey(), $sameOutletTemporary->outlet_id);
        $this->assertSame(1, $employee->assignments()->distinct()->count('outlet_id'));
    }

    public function test_primary_transfer_rejects_overlap_without_truncating_existing_history(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner, 'Coffee', 'South');
        [, $otherOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'North');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $service = app(EmployeeOutletAssignmentService::class);
        $primary = $service->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $temporaryStart = now()->addDays(3);
        $temporaryEnd = now()->addDays(4);
        $service->assignTemporaryOutlet($owner, $employee, $outlet, $temporaryStart, $temporaryEnd);

        try {
            $service->assignPrimaryOutlet($owner, $employee, $otherOutlet, $temporaryStart->addHour());
            $this->fail('A primary transfer must not overlap a temporary assignment at another Outlet.');
        } catch (ValidationException) {
            $this->assertSame('9999-12-31 23:59:59', $primary->fresh()->effective_until->toDateTimeString());
            $this->assertSame(1, $employee->assignments()->where('assignment_type', 'primary')->count());
            $this->assertSame(1, $employee->assignments()->distinct()->count('outlet_id'));
        }
    }

    public function test_cross_tenant_and_conflicting_primary_assignments_are_rejected(): void
    {
        [, , $owner] = $this->tenantWithOwner('Tenant A');
        [, , $foreignOwner] = $this->tenantWithOwner('Tenant B');
        [, $outlet] = $this->unitWithOutlet($owner);
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $service = app(EmployeeOutletAssignmentService::class);
        $start = Carbon::parse('2026-10-21 09:00:00');

        try {
            $service->assignPrimaryOutlet($owner, $employee, $foreignOutlet, $start);
            $this->fail('Cross-tenant outlet assignment must be rejected.');
        } catch (ValidationException) {
            $this->assertTrue(true);
        }

        $service->assignPrimaryOutlet($owner, $employee, $outlet, $start);

        foreach ([
            fn () => $service->assignPrimaryOutlet($owner, $employee, $outlet, $start),
            fn () => $service->assignPrimaryOutlet($owner, $employee, $outlet, $start->copy()->subDay()),
            fn () => $service->assignTemporaryOutlet($owner, $employee, $outlet, $start, $start),
        ] as $conflictingAssignment) {
            try {
                $conflictingAssignment();
                $this->fail('Conflicting or invalid assignment times must be rejected.');
            } catch (ValidationException) {
                $this->assertTrue(true);
            }
        }
    }

    public function test_mysql_rejects_assignment_with_non_positive_effective_range(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $time = Carbon::parse('2026-10-21 09:00:00');

        $this->expectException(QueryException::class);
        DB::table('employee_outlet_assignments')->insert([
            'tenant_id' => $owner->tenant_id,
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outlet->getKey(),
            'assignment_type' => 'temporary',
            'effective_from' => $time,
            'effective_until' => $time,
        ]);
    }
}
