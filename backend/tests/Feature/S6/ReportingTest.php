<?php

namespace Tests\Feature\S6;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\ApprovalRequest;
use App\Models\AttendanceEvent;
use App\Models\AttendanceSession;
use App\Models\User;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeeScheduleService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class ReportingTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_supervisor_and_tenant_scopes_are_enforced_before_reporting(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(1, 0));
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Tenant laporan A');
        [, $outletA] = $this->unitWithOutlet($owner, 'Unit A', 'Outlet A');
        [, $outletB] = $this->unitWithOutlet($owner, 'Unit B', 'Outlet B');
        $employeeA = $this->employeeAtOutlet($owner, $outletA, 'Karyawan A', $today->toDateString());
        $employeeB = $this->employeeAtOutlet($owner, $outletB, 'Karyawan B', $today->toDateString());
        [$supervisorUser, $supervisorMembership] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisorMembership, $outletA);
        [$employeeUser] = $this->membershipFor($owner, TenantRole::Employee);

        [, $tenantB, $ownerB] = $this->tenantWithOwner('Tenant laporan B');
        [, $outletC] = $this->unitWithOutlet($ownerB, 'Unit C', 'Outlet C');
        $employeeC = $this->employeeAtOutlet($ownerB, $outletC, 'Karyawan C', $today->toDateString());

        $this->loginAs($supervisorUser);
        $filters = $this->browserRequest()->getJson('/api/v1/management/reports/filters')->assertOk();
        $this->assertSame([(int) $outletA->getKey()], array_column($filters->json('outlets'), 'id'));
        $dashboard = $this->browserRequest()->getJson($this->reportUrl('dashboard', $today->toDateString()))->assertOk();
        $this->assertSame(1, $dashboard->json('metrics.employee_workdays'));
        $this->assertSame(1, $dashboard->json('metrics.unique_employees'));
        $this->assertSame((int) $employeeA->getKey(), $this->browserRequest()
            ->getJson($this->reportUrl('attendance', $today->toDateString()))->assertOk()->json('data.0.employee.id'));
        $scopedAudit = $this->browserRequest()->getJson('/api/v1/management/reports/audit?'.http_build_query([
            'from' => $today->toDateString(),
            'to' => $today->toDateString(),
            'source' => 'schedule_change',
        ]))->assertOk();
        $this->assertNotEmpty($scopedAudit->json('data'));
        foreach ($scopedAudit->json('data') as $event) {
            $this->assertSame((int) $outletA->getKey(), $event['outlet_id']);
        }

        $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString(), [
            'outlet_ids[0]' => (string) $outletB->getKey(),
        ]))->assertForbidden();
        $this->browserRequest()->get($this->reportUrl('attendance.csv', $today->toDateString(), [
            'outlet_ids[0]' => (string) $outletB->getKey(),
        ]))->assertForbidden();
        $this->browserRequest()->get($this->reportUrl('attendance.csv', $today->toDateString()))->assertForbidden();
        $foreignEmployeeRows = $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString(), [
            'employee_id' => (string) $employeeB->getKey(),
        ]))->assertOk();
        $this->assertSame(0, $foreignEmployeeRows->json('pagination.total'));
        $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString(), [
            'employee_id' => (string) $employeeC->getKey(),
        ]))->assertOk()->assertJsonPath('pagination.total', 0);

        $this->loginAs($employeeUser);
        $this->browserRequest()->getJson($this->reportUrl('dashboard', $today->toDateString()))->assertForbidden();
        $logout = $this->browserRequest()->postJson('/api/v1/auth/logout')->assertOk();
        $this->captureSessionCookie($logout);
        $this->withCookie('hadirinaja_kiosk', 'not-a-user-session')
            ->getJson($this->reportUrl('dashboard', $today->toDateString()))->assertUnauthorized();

        $this->loginAs($ownerUser);
        $ownerDashboard = $this->browserRequest()->getJson($this->reportUrl('dashboard', $today->toDateString()))->assertOk();
        $this->assertSame((int) $tenant->getKey(), $ownerDashboard->json('provenance.active_tenant.id'));
        $this->assertSame(2, $ownerDashboard->json('metrics.employee_workdays'));
        $this->assertSame(2, $ownerDashboard->json('metrics.unique_employees'));
        $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString(), [
            'outlet_ids[0]' => (string) $outletC->getKey(),
        ]))->assertForbidden();

        $this->loginAs($tenantB->memberships()->firstOrFail()->user);
        $tenantBFilters = $this->browserRequest()->getJson('/api/v1/management/reports/filters')->assertOk();
        $this->assertSame([(int) $outletC->getKey()], array_column($tenantBFilters->json('outlets'), 'id'));
        $this->assertNotContains((int) $outletA->getKey(), array_column($tenantBFilters->json('outlets'), 'id'));
        $this->assertSame(0, $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString(), [
            'employee_id' => (string) $employeeA->getKey(),
        ]))->assertOk()->json('pagination.total'));
    }

    public function test_attendance_reporting_batches_session_reads_across_employee_workdays(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(1, 0));
        [$ownerUser, , $owner] = $this->tenantWithOwner('Tenant efisiensi laporan');
        [, $outlet] = $this->unitWithOutlet($owner, 'Unit uji', 'Outlet uji');

        for ($index = 1; $index <= 8; $index++) {
            $this->employeeAtOutlet($owner, $outlet, 'Karyawan laporan '.$index, $today->toDateString());
        }

        $this->loginAs($ownerUser);
        DB::enableQueryLog();
        DB::flushQueryLog();

        $response = $this->browserRequest()->getJson($this->reportUrl('attendance', $today->toDateString()))->assertOk();
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $sessionReads = collect($queries)->filter(fn (array $query): bool => preg_match(
            '/\\bfrom\\s+`?attendance_sessions`?/i',
            $query['query'],
        ) === 1)->count();

        $this->assertSame(8, $response->json('pagination.total'));
        $this->assertLessThanOrEqual(3, $sessionReads, 'Employee-workday count must not add one attendance session read per employee.');
    }

    public function test_employee_assignment_audit_records_actor_and_keeps_unknown_history_unrecorded(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Tenant provenance penugasan');
        [, $outlet] = $this->unitWithOutlet($owner, 'Unit provenance', 'Outlet provenance');
        $assigned = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan dengan aktor');
        $assignment = app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $owner, $assigned, $outlet, $today->subDay(),
        );

        $legacyEmployee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan tanpa provenance');
        DB::table('employee_outlet_assignments')->insert([
            'tenant_id' => $tenant->getKey(),
            'employee_id' => $legacyEmployee->getKey(),
            'outlet_id' => $outlet->getKey(),
            'assignment_type' => 'primary',
            'effective_from' => $today->subDay()->format('Y-m-d H:i:s'),
            'effective_until' => '9999-12-31 23:59:59',
            'created_by_membership_id' => null,
            'created_at' => now('UTC'),
            'updated_at' => now('UTC'),
        ]);

        $this->loginAs($ownerUser);
        $entries = $this->browserRequest()->getJson('/api/v1/management/reports/audit?'.http_build_query([
            'from' => $today->toDateString(),
            'to' => $today->toDateString(),
            'source' => 'employee_assignment',
        ]))->assertOk()->json('data');

        $created = collect($entries)->firstWhere('source_id', $assignment->getKey());
        $legacy = collect($entries)->first(fn (array $entry): bool => $entry['employee_id'] === $legacyEmployee->getKey());
        $this->assertSame($ownerUser->getKey(), $created['actor_user_id']);
        $this->assertSame($ownerUser->name, $created['actor_name']);
        $this->assertNull($legacy['actor_user_id']);
        $this->assertNull($legacy['actor_name']);
    }

    public function test_csv_row_limit_applies_after_active_status_filter_and_never_truncates(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $from = $today;
        $to = $today->addDays(30);
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Tenant CSV row limit');
        [, $outlet] = $this->unitWithOutlet($owner, 'Unit batas', 'Outlet batas');
        $shift = app(ShiftTemplateService::class)->create(
            $owner, 'Shift CSV row limit', '08:00:00', '16:00:00', false, $from->toDateString(), 'Fixture batas CSV',
        )->versions->firstOrFail();

        for ($index = 1; $index <= 17; $index++) {
            $employee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan batas '.$index);
            app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, $from->subDay());
            for ($weekday = 1; $weekday <= 7; $weekday++) {
                app(EmployeeScheduleService::class)->createWeeklyRule(
                    $owner, (int) $employee->getKey(), (int) $outlet->getKey(), $weekday,
                    (int) $shift->getKey(), $from->toDateString(), null, 'Fixture batas CSV',
                );
            }
        }

        $this->loginAs($ownerUser);
        $this->browserRequest()->get($this->reportUrl('attendance.csv', $from->toDateString(), [
            'to' => $to->toDateString(),
        ]))->assertUnprocessable()->assertJsonValidationErrors('export');

        $filtered = $this->browserRequest()->get($this->reportUrl('attendance.csv', $from->toDateString(), [
            'to' => $to->toDateString(),
            'status' => 'present',
        ]))->assertOk()->streamedContent();
        $this->assertStringContainsString('Status hasil efektif', $filtered);
        $this->assertDatabaseHas('report_export_events', [
            'tenant_id' => $tenant->getKey(),
            'report_type' => 'attendance_detail_csv',
            'row_count' => 0,
        ]);
        $event = DB::table('report_export_events')->where('tenant_id', $tenant->getKey())->first();
        $this->assertSame('present', json_decode((string) $event->filters, true, flags: JSON_THROW_ON_ERROR)['status']);
    }

    public function test_corrected_projection_reconciles_dashboard_detail_csv_and_audit_without_changing_source_events(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(1, 0));
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Tenant laporan efektif');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operasional', 'Outlet, "Pagi"');
        $employee = $this->employeeAtOutlet($owner, $outlet, '=SUM(1,1)', $today->toDateString());
        [$employeeUser, $employeeMembership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $employeeMembership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion($owner, $outlet, $today->toDateString(), [
            'attendance_mode' => 'hybrid',
            'personal_location_validation' => [
                'required' => true,
                'radius_meters' => 100,
                'latitude' => -6.2,
                'longitude' => 106.816666,
            ],
        ], 'Fixture S6 reporting');
        $actor = AttendanceActor::personal($employeeMembership);
        $checkIn = app(AttendanceService::class)->checkIn(
            $actor, $employee, $outlet, (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $this->assertSame(201, $checkIn['status']);
        $session = AttendanceSession::query()->findOrFail($checkIn['body']['session']['id']);
        $originalCheckIn = $session->check_in_at->utc()->toIso8601String();
        Carbon::setTestNow($today->setTime(9, 0));
        $checkOut = app(AttendanceService::class)->checkOut(
            $actor, $employee, (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $this->assertSame(200, $checkOut['status']);
        $session->refresh();
        $originalEvents = AttendanceEvent::query()->where('attendance_session_id', $session->getKey())
            ->orderBy('id')->get()->map(fn (AttendanceEvent $event): array => [$event->getKey(), $event->recorded_at->utc()->toIso8601String()])->all();

        Carbon::setTestNow($today->addDay()->setTime(1, 0));
        $this->loginAs($employeeUser);
        $correction = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'attendance_correction',
                'attendance_session_id' => $session->getKey(),
                'effective_check_in_at' => $today->setTime(1, 5)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(9, 0)->toIso8601String(),
                'reason' => 'Koreksi waktu untuk pengujian laporan.',
            ])->assertCreated()->assertJsonPath('request.status', 'pending');
        $requestId = (int) $correction->json('request.id');

        $this->loginAs($ownerUser);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                'decision' => 'approved',
                'reason' => 'Catatan koreksi telah ditinjau.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');
        Carbon::setTestNow($today->addDay()->setTime(1, 0));
        $pendingReview = ApprovalRequest::query()->create([
            'tenant_id' => $tenant->getKey(),
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outlet->getKey(),
            'request_type' => 'attendance_review',
            'status' => 'pending',
            'work_date' => $today->toDateString(),
            'reason' => 'Review pemeriksaan S6.',
            'details' => ['case_type' => 'manual_review', 'attendance_session_id' => $session->getKey()],
            'review_key' => hash('sha256', 's6-manual-review-'.$tenant->getKey()),
        ]);
        $this->loginAs($employeeUser);
        $overtime = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'overtime',
                'work_date' => $today->toDateString(),
                'starts_at' => $today->toDateString().'T16:00',
                'ends_at' => $today->toDateString().'T17:00',
                'reason' => 'Permintaan lembur untuk rekonsiliasi laporan.',
            ])->assertCreated()->assertJsonPath('request.status', 'pending');
        $overtimeId = (int) $overtime->json('request.id');
        $this->loginAs($ownerUser);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$overtimeId.'/decision', [
                'decision' => 'approved',
                'reason' => 'Jam lembur disetujui.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');

        $url = $this->reportUrl('attendance', $today->toDateString());
        $detail = $this->browserRequest()->getJson($url)->assertOk();
        $dashboard = $this->browserRequest()->getJson($this->reportUrl('dashboard', $today->toDateString()))->assertOk();
        $row = $detail->json('data.0');
        $this->assertArrayNotHasKey('schedule_snapshot', $row['sessions'][0]);
        $this->assertArrayNotHasKey('policy_snapshot', $row['sessions'][0]);
        $reportPayload = json_encode($row, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('latitude', $reportPayload);
        $this->assertStringNotContainsString('longitude', $reportPayload);
        $this->assertSame(1, $detail->json('totals.employee_workdays'));
        $this->assertSame(1, $detail->json('totals.unique_employees'));
        $this->assertSame($detail->json('totals.employee_workdays'), $dashboard->json('metrics.employee_workdays'));
        $this->assertSame($detail->json('totals.unique_employees'), $dashboard->json('metrics.unique_employees'));
        $this->assertSame($pendingReview->getKey(), $row['review']['cases'][0]['id']);
        $this->assertSame('pending', $row['review']['status']);
        $this->assertSame($today->setTime(1, 5)->toIso8601String(), $row['sessions'][0]['effective']['check_in_at']);
        $this->assertSame($originalCheckIn, $row['sessions'][0]['original']['check_in_at']);
        $this->assertSame(8 * 60 * 60, $row['sessions'][0]['actual_duration_seconds']);
        $this->assertSame(8 * 60 * 60 - 5 * 60, $row['sessions'][0]['effective_duration_seconds']);
        $this->assertSame($requestId, $row['sessions'][0]['correction']['request_id']);
        $this->assertSame('approved', $row['overtime_requests'][0]['status']);
        $this->assertSame(60, $row['overtime_requests'][0]['approved_minutes']);
        $this->assertSame(8 * 60 * 60 - 5 * 60, $row['effective_duration_seconds']);
        $this->assertNotEmpty($row['source_attendance_event_ids']);
        $eventsAfter = AttendanceEvent::query()->where('attendance_session_id', $session->getKey())
            ->orderBy('id')->get()->map(fn (AttendanceEvent $event): array => [$event->getKey(), $event->recorded_at->utc()->toIso8601String()])->all();
        $this->assertSame($originalEvents, $eventsAfter);
        $this->assertSame($originalCheckIn, $session->fresh()->check_in_at->utc()->toIso8601String());

        $csvResponse = $this->browserRequest()->get($this->reportUrl('attendance.csv', $today->toDateString(), ['status' => 'present']))
            ->assertOk()->assertHeader('content-type', 'text/csv; charset=UTF-8');
        $csv = $csvResponse->streamedContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $this->assertStringContainsString("'=SUM(1,1)", $csv);
        $this->assertStringContainsString('"Outlet, ""Pagi"""', $csv);
        $this->assertStringContainsString($today->setTime(1, 5)->toIso8601String(), $csv);
        $this->assertStringNotContainsString('private', strtolower($csv));
        $this->assertDatabaseHas('report_export_events', [
            'tenant_id' => $tenant->getKey(),
            'actor_user_id' => $ownerUser->getKey(),
            'report_type' => 'attendance_detail_csv',
            'row_count' => 1,
        ]);

        $audit = $this->browserRequest()->getJson($this->auditUrl($today->toDateString(), $today->addDay()->toDateString()))->assertOk();
        $sources = array_column($audit->json('data'), 'source_type');
        $this->assertContains('approval_decision', $sources);
        $this->assertContains('report_export', $sources);
        $decisionEntry = collect($audit->json('data'))
            ->first(fn (array $entry): bool => $entry['source_type'] === 'approval_decision'
                && $entry['resource_type'] === 'approval_attendance_correction');
        $this->assertSame($ownerUser->getKey(), $decisionEntry['actor_user_id']);
        $this->assertSame('approval_attendance_correction', $decisionEntry['resource_type']);
        $auditDetail = $this->browserRequest()->getJson('/api/v1/management/reports/audit/approval_decision/'.$decisionEntry['source_id'].'?from='.$today->toDateString().'&to='.$today->addDay()->toDateString())
            ->assertOk()->json('entry');
        $this->assertContains('check_in_at', $auditDetail['details']['changed_fields']);
        $this->assertArrayNotHasKey('proposed_values', $auditDetail['details']);
    }

    private function employeeAtOutlet($owner, $outlet, string $name, string $workDate)
    {
        $employee = app(OrganizationService::class)->registerEmployee($owner, $name);
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, CarbonImmutable::parse($workDate, 'UTC')->subDay());
        $this->scheduleEmployee($owner, $employee, $outlet, $workDate);

        return $employee;
    }

    private function scheduleEmployee($owner, $employee, $outlet, string $workDate): void
    {
        $shift = app(ShiftTemplateService::class)->create(
            $owner, 'S6 '.$employee->getKey(), '08:00:00', '16:00:00', false, $workDate, 'Jadwal uji laporan',
        )->versions->firstOrFail();
        app(EmployeeScheduleService::class)->createWeeklyRule(
            $owner, (int) $employee->getKey(), (int) $outlet->getKey(),
            CarbonImmutable::parse($workDate, 'UTC')->isoWeekday(), (int) $shift->getKey(), $workDate, null, 'Jadwal uji laporan',
        );
    }

    private function reportUrl(string $resource, string $date, array $extra = []): string
    {
        $params = array_merge(['from' => $date, 'to' => $date], $extra);

        return '/api/v1/management/reports/'.$resource.'?'.http_build_query($params);
    }

    private function auditUrl(string $from, string $to): string
    {
        return '/api/v1/management/reports/audit?'.http_build_query(['from' => $from, 'to' => $to]);
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
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
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }
}
