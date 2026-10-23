<?php

namespace Tests\Feature\S5;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\ApprovalRequest;
use App\Models\AttendanceEvent;
use App\Models\AttendanceSession;
use App\Models\User;
use App\Services\ApprovalWorkflowService;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EffectiveAttendanceProjectionService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeeScheduleService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class ApprovalWorkflowTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_leave_categories_overtime_decisions_cancellation_and_overtime_projection_are_separate_from_worked_time(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $requests = [];

        $this->loginAs($fixture['employeeUser']);
        foreach ([
            ['category' => 'permission', 'date' => $today->addDay()],
            ['category' => 'sick', 'date' => $today->addDays(3)],
            ['category' => 'annual', 'date' => $today->addDays(5)],
        ] as $item) {
            $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->postJson('/api/v1/attendance/me/requests', [
                    'type' => 'leave',
                    'category' => $item['category'],
                    'starts_on' => $item['date']->toDateString(),
                    'ends_on' => $item['date']->toDateString(),
                    'reason' => 'Keperluan keluarga.',
                ])->assertCreated()->assertJsonPath('request.status', 'pending');
            $requests[$item['category']] = (int) $response->json('request.id');
        }

        $overtime = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'overtime',
                'work_date' => $today->toDateString(),
                'starts_at' => $today->toDateString().'T19:00',
                'ends_at' => $today->toDateString().'T20:00',
                'reason' => 'Penyelesaian inventaris.',
            ])->assertCreated()->assertJsonPath('request.status', 'pending');
        $requests['overtime'] = (int) $overtime->json('request.id');

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requests['permission'].'/decision', [
                'decision' => 'approved', 'reason' => 'Disetujui.',
            ])->assertForbidden();

        $this->loginAs($fixture['ownerUser']);
        foreach (array_values($requests) as $requestId) {
            $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                    'decision' => 'approved', 'reason' => 'Diperiksa dan disetujui.',
                ])->assertOk()->assertJsonPath('request.status', 'approved');
        }

        $projection = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame(0, $projection['actual_duration_seconds']);
        $this->assertSame(0, $projection['effective_duration_seconds']);
        $this->assertSame('approved', $projection['overtime_requests'][0]['status']);
        $this->assertSame(1, count($projection['overtime_requests']));
        $this->assertSame(60, $projection['overtime_requests'][0]['details']['requested_minutes']);

        $this->loginAs($fixture['employeeUser']);
        $overlap = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => $today->addDay()->toDateString(),
                'ends_on' => $today->addDay()->toDateString(),
                'reason' => 'Permintaan bertabrakan.',
            ])->assertUnprocessable();
        $this->assertArrayHasKey('starts_on', $overlap->json('errors'));

        $cancelled = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave', 'category' => 'permission',
                'starts_on' => $today->addDays(7)->toDateString(), 'ends_on' => $today->addDays(7)->toDateString(),
                'reason' => 'Rencana berubah.',
            ])->assertCreated();
        $cancelId = (int) $cancelled->json('request.id');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests/'.$cancelId.'/cancel')
            ->assertOk()->assertJsonPath('request.status', 'cancelled')
            ->assertJsonPath('request.decision_history.0.action', 'cancelled');

        $rejected = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave', 'category' => 'permission',
                'starts_on' => $today->addDays(9)->toDateString(), 'ends_on' => $today->addDays(9)->toDateString(),
                'reason' => 'Permohonan untuk uji penolakan.',
            ])->assertCreated();
        $rejectId = (int) $rejected->json('request.id');
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$rejectId.'/decision', [
                'decision' => 'rejected', 'reason' => 'Jadwal operasional tidak memungkinkan.',
            ])->assertOk()->assertJsonPath('request.status', 'rejected')
            ->assertJsonPath('request.decision_history.0.reason', 'Jadwal operasional tidak memungkinkan.');
    }

    public function test_independent_employee_correction_changes_only_effective_projection_and_preserves_s4_events(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        $eventsBefore = AttendanceEvent::query()->where('attendance_session_id', $session->getKey())
            ->orderBy('id')->get()->map(fn (AttendanceEvent $event): array => [$event->getKey(), $event->recorded_at->utc()->toIso8601String()])->all();
        Carbon::setTestNow($today->setTime(16, 5));

        $this->loginAs($fixture['employeeUser']);
        $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'attendance_correction',
                'attendance_session_id' => $session->getKey(),
                'effective_check_in_at' => $today->setTime(8, 5)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(16, 5)->toIso8601String(),
                'reason' => 'Jam check-in perlu disesuaikan dengan catatan operasional.',
            ])->assertCreated()->assertJsonPath('request.status', 'pending')
            ->assertJsonPath('request.classification', 'sensitive');
        $requestId = (int) $response->json('request.id');

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Catatan operasional diperiksa.',
            ])->assertForbidden();

        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Catatan operasional diperiksa.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');

        $session->refresh();
        $eventsAfter = AttendanceEvent::query()->where('attendance_session_id', $session->getKey())
            ->orderBy('id')->get()->map(fn (AttendanceEvent $event): array => [$event->getKey(), $event->recorded_at->utc()->toIso8601String()])->all();
        $projection = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());

        $this->assertSame('closed', $session->status);
        $this->assertSame($eventsBefore, $eventsAfter);
        $this->assertSame($today->setTime(8, 0)->toDateTimeString(), $session->check_in_at->utc()->toDateTimeString());
        $this->assertSame($today->setTime(8, 5)->toIso8601String(), $projection['sessions'][0]['effective']['check_in_at']);
        $this->assertSame(8 * 60 * 60, $projection['actual_duration_seconds']);
        $this->assertSame(8 * 60 * 60, $projection['effective_duration_seconds']);
        $this->assertSame($requestId, $projection['sessions'][0]['correction']['request_id']);

        $request = ApprovalRequest::query()->findOrFail($requestId);
        try {
            $request->forceFill(['details' => ['category' => 'rewritten']])->save();
            $this->fail('Submitted approval payload must be immutable.');
        } catch (\LogicException) {
            $this->assertSame('attendance_correction', $request->fresh()->request_type);
        }
    }

    public function test_approved_missing_checkout_resolution_reconciles_active_owner_without_fake_event(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, false);
        $originalCheckIn = $session->fresh()->check_in_at->utc()->toIso8601String();
        Carbon::setTestNow($today->setTime(12, 0));

        $this->loginAs($fixture['employeeUser']);
        $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'attendance_correction',
                'attendance_session_id' => $session->getKey(),
                'effective_check_out_at' => $today->setTime(11, 0)->toIso8601String(),
                'reason' => 'Lupa melakukan checkout setelah menyelesaikan tugas.',
            ])->assertCreated()->assertJsonPath('request.status', 'pending');
        $requestId = (int) $response->json('request.id');

        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Waktu akhir dikonfirmasi oleh catatan kerja.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');

        $session->refresh();
        $this->assertSame('administratively_resolved', $session->status);
        $this->assertSame($originalCheckIn, $session->check_in_at->utc()->toIso8601String());
        $this->assertNull($session->check_out_at);
        $this->assertSame(0, DB::table('attendance_active_session_owners')->where('employee_id', $fixture['employee']->getKey())->count());
        $this->assertSame(0, AttendanceEvent::query()->where('attendance_session_id', $session->getKey())->where('event_type', 'check_out')->count());

        $projection = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertNull($projection['actual_duration_seconds']);
        $this->assertSame(3 * 60 * 60, $projection['effective_duration_seconds']);
        $this->assertSame($today->setTime(11, 0)->toIso8601String(), $projection['sessions'][0]['effective']['check_out_at']);
        $this->assertNull($projection['sessions'][0]['original']['check_out_at']);

        $next = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], $fixture['outlet'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $this->assertSame(201, $next['status']);
        $this->assertSame(1, DB::table('attendance_active_session_owners')->where('employee_id', $fixture['employee']->getKey())->count());
    }

    public function test_supervisor_routine_correction_is_narrow_and_potential_absence_requires_human_review_before_finalization(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(9, 0));
        $fixture = $this->fixture();
        $weekday = $today->isoWeekday();
        $shift = app(ShiftTemplateService::class)->create(
            $fixture['owner'], 'Shift S5 rutin', '16:00:00', '20:00:00', false, $today->toDateString(), 'Jadwal uji koreksi rutin.',
        )->versions->firstOrFail();
        app(EmployeeScheduleService::class)->createWeeklyRule(
            $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
            $weekday, (int) $shift->getKey(), $today->toDateString(), null, 'Jadwal uji koreksi rutin.',
        );
        $session = $this->recordSession($fixture, true, 4);
        Carbon::setTestNow($today->setTime(13, 5));
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);

        $this->loginAs($supervisorUser);
        $routine = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/attendance/sessions/'.$session->getKey().'/corrections', [
                'effective_check_in_at' => $today->setTime(9, 5)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(12, 55)->toIso8601String(),
                'reason' => 'Penyesuaian terbatas dari catatan supervisor.',
            ])->assertOk()->assertJsonPath('applied', true)
            ->assertJsonPath('classification', 'routine')
            ->assertJsonPath('request.status', 'approved');
        $this->assertSame('routine_applied', $routine->json('request.decision_history.0.action'));

        $absenceDate = $today->addDay();
        $absenceShift = app(ShiftTemplateService::class)->create(
            $fixture['owner'], 'Shift S5 absence', '22:00:00', '06:00:00', true, $absenceDate->toDateString(), 'Jadwal uji potensi absen lintas tengah malam.',
        )->versions->firstOrFail();
        app(EmployeeScheduleService::class)->createWeeklyRule(
            $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
            $absenceDate->isoWeekday(), (int) $absenceShift->getKey(), $absenceDate->toDateString(), null, 'Jadwal uji potensi absen.',
        );
        Carbon::setTestNow($absenceDate->setTime(22, 30));
        $this->loginAs($fixture['ownerUser']);
        $discoverPayload = ['from' => $absenceDate->toDateString(), 'to' => $absenceDate->toDateString()];
        $this->browserRequest()->postJson('/api/v1/management/attendance/reviews/discover', $discoverPayload)
            ->assertOk()->assertJsonPath('created', 0);
        $beforeShiftEnd = app(EffectiveAttendanceProjectionService::class)->project(
            (int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $absenceDate->toDateString(),
        );
        $this->assertSame('no_recorded_outcome', $beforeShiftEnd['outcome']);
        $this->assertNotContains('potential_absence', $beforeShiftEnd['unresolved_conflicts']);

        Carbon::setTestNow($absenceDate->setTime(23, 5));
        $this->browserRequest()->postJson('/api/v1/management/attendance/reviews/discover', $discoverPayload)
            ->assertOk()->assertJsonPath('created', 1);
        $this->browserRequest()->postJson('/api/v1/management/attendance/reviews/discover', $discoverPayload)
            ->assertOk()->assertJsonPath('created', 0)->assertJsonPath('existing', 1);
        $case = ApprovalRequest::query()->where('request_type', 'attendance_review')->where('work_date', $absenceDate->toDateString())->firstOrFail();
        $pending = app(EffectiveAttendanceProjectionService::class)->project(
            (int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $absenceDate->toDateString(),
        );
        $this->assertSame('potential_absence', $pending['outcome']);
        $this->assertContains('potential_absence', $pending['unresolved_conflicts']);
        $this->assertSame([], $pending['sessions']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/finalizations', [
            'employee_id' => $fixture['employee']->getKey(), 'work_date' => $absenceDate->toDateString(),
            'outcome' => 'absence', 'reason' => 'Belum ada keputusan review.',
        ])->assertUnprocessable();

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$case->getKey().'/decision', [
                'decision' => 'approved', 'reason' => 'Review mengonfirmasi ketidakhadiran.',
            ])->assertOk();
        $confirmed = app(EffectiveAttendanceProjectionService::class)->project(
            (int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $absenceDate->toDateString(),
        );
        $this->assertSame('confirmed_absence_pending_finalization', $confirmed['outcome']);
        $this->assertSame([], $confirmed['sessions']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/finalizations', [
            'employee_id' => $fixture['employee']->getKey(), 'work_date' => $absenceDate->toDateString(),
            'outcome' => 'absence', 'reason' => 'Hasil akhir telah ditinjau.',
        ])->assertCreated()->assertJsonPath('finalization.outcome', 'absence');
    }

    public function test_multiple_roles_and_explicit_employee_links_cannot_bypass_self_approval_or_outlet_scope(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $memberships = app(TenantMembershipService::class);
        $memberships->assignRole($fixture['owner'], $fixture['membership'], TenantRole::Supervisor);
        $memberships->assignSupervisorOutletScope($fixture['owner'], $fixture['membership'], $fixture['outlet']);

        $this->loginAs($fixture['employeeUser']);
        $employeeRequest = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave', 'category' => 'permission', 'starts_on' => $today->addDay()->toDateString(),
                'ends_on' => $today->addDay()->toDateString(), 'reason' => 'Permintaan pribadi.',
            ])->assertCreated();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$employeeRequest->json('request.id').'/decision', [
                'decision' => 'approved', 'reason' => 'Percobaan sendiri.',
            ])->assertForbidden();

        $ownerEmployee = app(OrganizationService::class)->registerEmployee($fixture['owner'], 'Identitas Employee milik Owner');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($fixture['owner'], $ownerEmployee, $fixture['outlet'], now()->subDay());
        $memberships->assignRole($fixture['owner'], $fixture['owner'], TenantRole::Employee);
        $memberships->linkEmployee($fixture['owner'], $fixture['owner'], $ownerEmployee);

        $this->loginAs($fixture['ownerUser']);
        $ownerRequest = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave', 'category' => 'sick', 'starts_on' => $today->addDays(3)->toDateString(),
                'ends_on' => $today->addDays(3)->toDateString(), 'reason' => 'Permintaan Owner terkait identitas karyawan.',
            ])->assertCreated();
        $ownerRequestId = (int) $ownerRequest->json('request.id');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$ownerRequestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Percobaan Owner terhadap permintaan sendiri.',
            ])->assertForbidden();

        [$independentOwnerUser, $independentOwner] = $this->membershipFor($fixture['owner'], TenantRole::Owner);
        $this->loginAs($independentOwnerUser);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$ownerRequestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Diputus oleh Owner independen.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');

        $secondOutlet = app(OrganizationService::class)->createOutlet($fixture['owner'], $fixture['unit'], 'Outlet di luar cakupan');
        $otherEmployee = app(OrganizationService::class)->registerEmployee($fixture['owner'], 'Karyawan Outlet lain');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($fixture['owner'], $otherEmployee, $secondOutlet, now()->subDay());
        [$otherUser, $otherMembership] = $this->membershipFor($fixture['owner'], TenantRole::Employee);
        $memberships->linkEmployee($fixture['owner'], $otherMembership, $otherEmployee);
        $scopedSupervisor = app(ApprovalWorkflowService::class)->submitEmployeeRequest(
            $otherMembership, $otherUser,
            ['type' => 'leave', 'category' => 'permission', 'starts_on' => $today->addDays(5)->toDateString(),
                'ends_on' => $today->addDays(5)->toDateString(), 'reason' => 'Kasus outlet kedua.'],
            (string) Str::uuid(),
        );
        $queue = app(ApprovalWorkflowService::class)->queue($fixture['membership'], $fixture['employeeUser'], ['status' => 'pending']);
        $this->assertNotContains((int) $scopedSupervisor->getKey(), array_column($queue['requests'], 'id'));
        try {
            app(ApprovalWorkflowService::class)->decide(
                $fixture['membership'], $fixture['employeeUser'], (int) $scopedSupervisor->getKey(), 'approved', 'Di luar cakupan.', (string) Str::uuid(),
            );
            $this->fail('A Supervisor cannot decide an approval outside its explicit outlet scope.');
        } catch (AuthorizationException) {
            $this->assertSame('pending', $scopedSupervisor->fresh()->status);
        }
    }

    public function test_foreign_tenant_revoked_membership_and_kiosk_credentials_cannot_access_approvals(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $localRequest = $this->leaveRequestForTest($fixture, $today->addDay()->toDateString());

        [, , $foreignOwner] = $this->tenantWithOwner('S5 foreign tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner, 'Foreign operations', 'Foreign approval outlet');
        $foreignEmployee = app(OrganizationService::class)->registerEmployee($foreignOwner, 'Foreign employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($foreignOwner, $foreignEmployee, $foreignOutlet, now()->subDay());
        [$foreignUser, $foreignMembership] = $this->membershipFor($foreignOwner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($foreignOwner, $foreignMembership, $foreignEmployee);
        $foreignRequest = app(ApprovalWorkflowService::class)->submitEmployeeRequest(
            $foreignMembership, $foreignUser,
            ['type' => 'leave', 'category' => 'permission', 'starts_on' => $today->addDays(3)->toDateString(),
                'ends_on' => $today->addDays(3)->toDateString(), 'reason' => 'Kasus tenant lain.'],
            (string) Str::uuid(),
        );

        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->getJson('/api/v1/management/approvals/'.$foreignRequest->getKey())->assertForbidden();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$foreignRequest->getKey().'/decision', [
                'decision' => 'approved', 'reason' => 'Percobaan lintas tenant.',
            ])->assertForbidden();

        $revokedReviewer = $this->membershipFor($fixture['owner'], TenantRole::Owner);
        [$revokedUser, $revokedMembership] = $revokedReviewer;
        $revokedMembership->forceFill(['is_active' => false])->save();
        try {
            app(ApprovalWorkflowService::class)->decide(
                $revokedMembership, $revokedUser, (int) $localRequest->getKey(), 'approved', 'Menguji membership dicabut.', (string) Str::uuid(),
            );
            $this->fail('A revoked membership cannot decide a pending request.');
        } catch (AuthorizationException) {
            $this->assertSame('pending', $localRequest->fresh()->status);
        }

        $this->browserRequest()->postJson('/api/v1/auth/logout')->assertOk();
        Auth::forgetGuards();
        $pairings = app(KioskPairingService::class);
        $issued = $pairings->issuePairingCode($fixture['owner'], $fixture['outlet'], 'Kiosk S5 test');
        $paired = $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $issued['code']])->assertOk();
        $kioskCookie = $paired->getCookie('hadirinaja_kiosk');
        $this->assertNotNull($kioskCookie);
        $this->withCookie('hadirinaja_kiosk', $kioskCookie->getValue())->getJson('/api/v1/management/approvals')->assertUnauthorized();
    }

    private function fixture(): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('S5 approval tenant');
        [$unit, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'S5 outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan S5');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion(
            $owner, $outlet, CarbonImmutable::today('UTC')->toDateString(), [
                'attendance_mode' => 'hybrid',
                'personal_location_validation' => [
                    'required' => true, 'radius_meters' => 100, 'latitude' => -6.2, 'longitude' => 106.816666,
                ],
            ], 'S5 workflow fixture',
        );

        return compact('ownerUser', 'tenant', 'owner', 'unit', 'outlet', 'employeeUser', 'membership', 'employee');
    }

    private function leaveRequestForTest(array $fixture, string $date): ApprovalRequest
    {
        return app(ApprovalWorkflowService::class)->submitEmployeeRequest(
            $fixture['membership'], $fixture['employeeUser'], [
                'type' => 'leave', 'category' => 'permission', 'starts_on' => $date,
                'ends_on' => $date, 'reason' => 'Permintaan untuk uji keamanan.',
            ], (string) Str::uuid(),
        );
    }

    private function recordSession(array $fixture, bool $closed, int $durationHours = 8): AttendanceSession
    {
        $actor = AttendanceActor::personal($fixture['membership']);
        $checkIn = app(AttendanceService::class)->checkIn(
            $actor, $fixture['employee'], $fixture['outlet'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $this->assertSame(201, $checkIn['status']);
        $session = AttendanceSession::query()->findOrFail($checkIn['body']['session']['id']);

        if ($closed) {
            Carbon::setTestNow($session->check_in_at->utc()->addHours($durationHours));
            $checkOut = app(AttendanceService::class)->checkOut(
                $actor, $fixture['employee'], (string) Str::uuid(),
                ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
            );
            $this->assertSame(200, $checkOut['status']);
            $session->refresh();
        }

        return $session;
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email, 'password' => 'password',
        ])->assertOk();
        $cookie = $login->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }
}
