<?php

namespace Tests\Feature\S3;

use App\Enums\TenantRole;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class SchedulingPolicyTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_owner_can_resolve_weekly_and_exception_schedules_with_effective_policy_overrides(): void
    {
        [$user, , $owner] = $this->tenantWithOwner('Schedule tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Central');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Rani');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $workDate = CarbonImmutable::today('UTC')->addDay();
        $shift = app(ShiftTemplateService::class)->create(
            $owner, 'Pagi', '09:00:00', '17:00:00', false, $workDate->toDateString(), 'Shift awal',
        )->versions->first();
        $this->loginAs($user);

        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outlet->getKey(),
            'weekday' => $workDate->isoWeekday(),
            'shift_template_version_id' => $shift->getKey(),
            'effective_from' => $workDate->toDateString(),
            'effective_until' => null,
            'reason' => 'Pola kerja mingguan dimulai.',
        ])->assertCreated()->assertJsonPath('schedule_rule.employee_id', $employee->getKey());

        $futurePolicyDate = $workDate->addDay()->toDateString();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/policies/tenant', [
            'effective_from' => $workDate->toDateString(),
            'reason' => 'Pembaruan toleransi tenant.',
            'configuration' => [
                'late_tolerance_minutes' => 9,
                'check_in_window' => ['early_minutes' => 60, 'late_minutes' => 60],
                'attendance_mode' => 'kiosk',
                'personal_location_validation' => ['required' => true, 'radius_meters' => 100],
                'retroactive_request_limit_days' => 7,
                'operational_review' => ['schedule_change_reason_required' => true, 'minimum_notice_hours' => 24],
            ],
        ])->assertCreated();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/outlets/'.$outlet->getKey().'/policy', [
            'effective_from' => $futurePolicyDate,
            'reason' => 'Toleransi outlet khusus.',
            'overrides' => ['late_tolerance_minutes' => 12],
        ])->assertCreated();

        $this->browserRequest()->getJson('/api/v1/management/scheduling/policies?outlet_id='.$outlet->getKey().'&effective_date='.$workDate->toDateString())
            ->assertOk()->assertJsonPath('effective.configuration.late_tolerance_minutes', 9)
            ->assertJsonPath('effective.configuration.check_in_window.early_minutes', 60)
            ->assertJsonPath('effective.outlet_version_id', null);
        $this->browserRequest()->getJson('/api/v1/management/scheduling/policies?outlet_id='.$outlet->getKey().'&effective_date='.$futurePolicyDate)
            ->assertOk()->assertJsonPath('effective.configuration.late_tolerance_minutes', 12)
            ->assertJsonPath('effective.configuration.check_in_window.early_minutes', 60);

        $resolved = $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(), 'work_date' => $workDate->toDateString(),
        ])->assertOk()->assertJsonPath('schedule.status', 'scheduled')
            ->assertJsonPath('schedule.shift.name', 'Pagi')
            ->assertJsonPath('schedule.timezone', 'Asia/Jakarta')
            ->assertJsonPath('schedule.policy.effective.late_tolerance_minutes', 9)
            ->assertJsonPath('schedule.conflicts', []);
        $this->assertStringContainsString('+07:00', (string) $resolved->json('schedule.scheduled_start'));

        $exceptionDate = $workDate->addDays(7);
        $this->browserRequest()->postJson('/api/v1/management/scheduling/exceptions', [
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outlet->getKey(),
            'work_date' => $exceptionDate->toDateString(),
            'status' => 'rest',
            'reason' => 'Kebutuhan operasional satu hari.',
        ])->assertCreated()->assertJsonPath('exception.revision', 1);
        $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(), 'work_date' => $exceptionDate->toDateString(),
        ])->assertOk()->assertJsonPath('schedule.status', 'rest')
            ->assertJsonPath('schedule.provenance.source', 'date_exception')
            ->assertJsonPath('schedule.conflicts', []);

        $this->assertDatabaseCount('scheduling_change_events', 5);
    }

    public function test_tenant_isolation_supervisor_outlet_scopes_and_employee_read_only_access_are_enforced(): void
    {
        [, , $ownerA] = $this->tenantWithOwner('Tenant A');
        [, $outletA] = $this->unitWithOutlet($ownerA, 'Unit A', 'Outlet A');
        [, $outletB] = $this->unitWithOutlet($ownerA, 'Unit B', 'Outlet B');
        $employee = app(OrganizationService::class)->registerEmployee($ownerA, 'Employee A');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($ownerA, $employee, $outletA, now()->subDay());
        [, , $ownerB] = $this->tenantWithOwner('Tenant B');
        [, $foreignOutlet] = $this->unitWithOutlet($ownerB, 'Unit B', 'Outlet B');
        $date = CarbonImmutable::today('UTC')->addDays(2);
        $foreignShift = app(ShiftTemplateService::class)->create(
            $ownerB, 'Shift sama', '09:00:00', '17:00:00', false, $date->toDateString(), 'Shift tenant B',
        )->versions->first();
        $localShift = app(ShiftTemplateService::class)->create(
            $ownerA, 'Shift sama', '09:00:00', '17:00:00', false, $date->toDateString(), 'Shift tenant A',
        )->versions->first();
        $this->assertNotSame($foreignShift->getKey(), $localShift->getKey());

        [$supervisorUser, $supervisor] = $this->membershipFor($ownerA, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($ownerA, $supervisor, $outletA);
        $this->loginAs($supervisorUser);
        $this->browserRequest()->getJson('/api/v1/management/scheduling/context')->assertOk()
            ->assertJsonCount(1, 'outlets')->assertJsonPath('outlets.0.id', $outletA->getKey());
        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outletB->getKey(),
            'weekday' => $date->isoWeekday(), 'shift_template_version_id' => $localShift->getKey(),
            'effective_from' => $date->toDateString(), 'reason' => 'Tidak berwenang.',
        ])->assertForbidden();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/policies/tenant', [
            'effective_from' => $date->toDateString(), 'reason' => 'Tidak berwenang.',
            'configuration' => [],
        ])->assertForbidden();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/outlets/'.$foreignOutlet->getKey().'/policy', [
            'effective_from' => $date->toDateString(), 'reason' => 'Tenant asing.', 'overrides' => ['late_tolerance_minutes' => 10],
        ])->assertForbidden();

        [$employeeUser, $employeeMembership] = $this->membershipFor($ownerA, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($ownerA, $employeeMembership, $employee);
        $this->loginAs($employeeUser);
        $this->browserRequest()->getJson('/api/v1/management/scheduling/me/week?week_start='.$date->startOfWeek()->toDateString())
            ->assertOk()->assertJsonPath('days.0.employee_id', $employee->getKey());
        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outletA->getKey(),
            'weekday' => $date->isoWeekday(), 'shift_template_version_id' => $localShift->getKey(),
            'effective_from' => $date->toDateString(), 'reason' => 'Karyawan tidak dapat mengubah jadwal.',
        ])->assertForbidden();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => $employee->getKey(), 'work_date' => $date->toDateString(),
        ])->assertOk();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => 999999, 'work_date' => $date->toDateString(),
        ])->assertNotFound();
    }

    public function test_holiday_reference_does_not_close_outlet_and_closure_conflict_is_reported(): void
    {
        [$user, , $owner] = $this->tenantWithOwner('Calendar tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Calendar employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $workDate = CarbonImmutable::today('UTC')->addDays(2);
        $shift = app(ShiftTemplateService::class)->create(
            $owner, 'Siang', '10:00:00', '18:00:00', false, $workDate->toDateString(), 'Shift kalender',
        )->versions->first();
        $this->loginAs($user);
        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(),
            'weekday' => $workDate->isoWeekday(), 'shift_template_version_id' => $shift->getKey(),
            'effective_from' => $workDate->toDateString(), 'reason' => 'Jadwal outlet.',
        ])->assertCreated();
        $holiday = $this->browserRequest()->postJson('/api/v1/management/scheduling/holidays', [
            'holiday_date' => $workDate->toDateString(), 'name' => 'Hari Referensi', 'region' => 'Nasional',
        ])->assertCreated()->json('holiday_reference');

        $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(), 'work_date' => $workDate->toDateString(),
        ])->assertOk()->assertJsonPath('schedule.outlet_operating', true)
            ->assertJsonPath('schedule.holiday_references.0.name', 'Hari Referensi')
            ->assertJsonPath('schedule.conflicts', []);

        $this->browserRequest()->postJson('/api/v1/management/scheduling/calendar/exceptions', [
            'outlet_id' => $outlet->getKey(), 'calendar_date' => $workDate->toDateString(),
            'status' => 'closed', 'holiday_reference_id' => $holiday['id'], 'reason' => 'Outlet tutup pada tanggal ini.',
        ])->assertCreated();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/resolve', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(), 'work_date' => $workDate->toDateString(),
        ])->assertOk()->assertJsonPath('schedule.outlet_operating', false)
            ->assertJsonPath('schedule.conflicts.0', 'outlet_closed');
    }

    public function test_overnight_shift_cannot_overlap_the_next_workday_and_invalid_durations_are_rejected(): void
    {
        [$user, , $owner] = $this->tenantWithOwner('Overnight tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Night employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $sunday = CarbonImmutable::today('UTC')->addDay();
        while ((int) $sunday->isoWeekday() !== 7) {
            $sunday = $sunday->addDay();
        }
        $nightShift = app(ShiftTemplateService::class)->create(
            $owner, 'Malam', '20:00:00', '04:00:00', true, $sunday->toDateString(), 'Shift lintas hari',
        )->versions->first();
        $morningShift = app(ShiftTemplateService::class)->create(
            $owner, 'Dini hari', '03:30:00', '09:00:00', false, $sunday->toDateString(), 'Shift pagi',
        )->versions->first();
        $this->loginAs($user);
        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(),
            'weekday' => 7, 'shift_template_version_id' => $nightShift->getKey(),
            'effective_from' => $sunday->toDateString(), 'reason' => 'Shift Minggu malam.',
        ])->assertCreated();
        $this->browserRequest()->postJson('/api/v1/management/scheduling/weekly-rules', [
            'employee_id' => $employee->getKey(), 'outlet_id' => $outlet->getKey(),
            'weekday' => 1, 'shift_template_version_id' => $morningShift->getKey(),
            'effective_from' => $sunday->toDateString(), 'reason' => 'Shift Senin dini hari.',
        ])->assertUnprocessable()->assertJsonValidationErrors('shift_template_version_id');
        $this->browserRequest()->postJson('/api/v1/management/scheduling/shifts', [
            'name' => 'Durasi nol', 'start_time' => '09:00', 'end_time' => '09:00',
            'crosses_midnight' => false, 'effective_from' => $sunday->toDateString(), 'reason' => 'Uji batas durasi.',
        ])->assertUnprocessable()->assertJsonValidationErrors('end_time');
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email, 'password' => 'password',
        ])->assertOk();
        $this->captureSessionCookie($login);
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }

    private function captureSessionCookie(TestResponse $response): void
    {
        $sessionCookie = $response->getCookie(config('session.cookie'));
        if ($sessionCookie !== null) {
            $this->withCookie(config('session.cookie'), $sessionCookie->getValue());
        }
        Auth::forgetGuards();
    }
}
