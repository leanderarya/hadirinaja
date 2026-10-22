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

    public function test_primary_changes_preserve_history_and_temporary_assignments_can_cross_business_units(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $primaryOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'South');
        [, $nextPrimaryOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'North');
        [, $temporaryOutlet] = $this->unitWithOutlet($owner, 'Retail', 'Market');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        $service = app(EmployeeOutletAssignmentService::class);
        $firstStart = Carbon::parse('2026-10-20 09:00:00');
        $temporaryStart = Carbon::parse('2026-10-21 09:00:00');
        $changeTime = Carbon::parse('2026-10-22 09:00:00');

        $firstPrimary = $service->assignPrimaryOutlet($owner, $employee, $primaryOutlet, $firstStart);
        $temporary = $service->assignTemporaryOutlet($owner, $employee, $temporaryOutlet, $temporaryStart, $changeTime->copy()->addDays(3));
        $secondPrimary = $service->assignPrimaryOutlet($owner, $employee, $nextPrimaryOutlet, $changeTime);

        $this->assertSame(EmployeeOutletAssignmentType::Primary, $firstPrimary->assignment_type);
        $this->assertSame($changeTime->toDateTimeString(), $firstPrimary->fresh()->effective_until->toDateTimeString());
        $this->assertSame(EmployeeOutletAssignmentType::Temporary, $temporary->assignment_type);
        $this->assertSame($temporaryOutlet->getKey(), $temporary->fresh()->outlet_id);
        $this->assertSame(
            $changeTime->copy()->addDays(3)->toDateTimeString(),
            $temporary->fresh()->effective_until->toDateTimeString(),
        );
        $this->assertSame($nextPrimaryOutlet->getKey(), $secondPrimary->outlet_id);
        $this->assertSame('9999-12-31 23:59:59', $secondPrimary->effective_until->toDateTimeString());
        $this->assertSame(2, $employee->assignments()->where('assignment_type', 'primary')->count());
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
