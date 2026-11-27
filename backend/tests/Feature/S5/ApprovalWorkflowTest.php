<?php

namespace Tests\Feature\S5;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceEvent;
use App\Models\AttendanceFinalization;
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
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class ApprovalWorkflowTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['features.kiosk_enabled' => true]);
    }

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

    public function test_completed_reconstruction_is_idempotent_and_projects_without_physical_facts(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(16, 0));
        $fixture = $this->fixture();
        $this->loginAs($fixture['employeeUser']);
        $key = (string) Str::uuid();
        $payload = [
            'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
            'work_date' => $today->toDateString(), 'effective_outlet_id' => $fixture['outlet']->getKey(),
            'effective_check_in_at' => $today->setTime(1, 0)->toIso8601String(),
            'effective_check_out_at' => $today->setTime(9, 0)->toIso8601String(),
            'reason' => 'Kedua pencatatan terlewat setelah pekerjaan selesai.',
        ];
        $submit = fn (array $data, string $id) => $this->browserRequest()->withHeader('Idempotency-Key', $id)
            ->postJson('/api/v1/attendance/me/requests', $data);
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign reconstruction tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $submit([...$payload, 'effective_outlet_id' => $foreignOutlet->getKey()], (string) Str::uuid())
            ->assertUnprocessable()->assertJsonValidationErrors('effective_outlet_id');
        $submit([...$payload, 'effective_check_out_at' => $today->setTime(17, 0)->toIso8601String()], (string) Str::uuid())
            ->assertUnprocessable();
        $requestId = $submit($payload, $key)->assertCreated()->assertJsonPath('request.status', 'pending')->json('request.id');
        $options = $this->browserRequest()->getJson('/api/v1/attendance/me/effective?from='.$today->toDateString().'&to='.$today->toDateString())
            ->assertOk()->json('correction_options.reconstructions');
        $this->assertNotEmpty($options);
        $this->assertFalse(collect($options)->contains('can_start', true));
        $submit($payload, $key)->assertCreated()->assertJsonPath('request.id', $requestId);
        $submit($payload, (string) Str::uuid())->assertUnprocessable()->assertJsonValidationErrors('correction');
        $project = fn () => app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame([], $project()['sources']);

        $snapshot = ['sources' => [], 'effective_duration_seconds' => 0, 'outcome' => 'absence'];
        $historical = AttendanceFinalization::query()->create([
            'tenant_id' => $fixture['tenant']->getKey(), 'employee_id' => $fixture['employee']->getKey(),
            'outlet_id' => $fixture['outlet']->getKey(), 'work_date' => $today->toDateString(), 'revision' => 1,
            'outcome' => 'absence', 'reason' => 'Snapshot sebelum rekonstruksi.',
            'projection_snapshot' => $snapshot, 'actor_user_id' => $fixture['ownerUser']->getKey(),
            'finalized_at' => $today->setTime(15, 0)->toDateTimeString(),
        ]);
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Catatan kerja lengkap diperiksa.',
            ])->assertOk();
        $day = $project();
        $this->assertSame([], $day['sessions']);
        $this->assertSame('reconstruction', $day['sources'][0]['source_kind']);
        $this->assertSame($requestId, $day['sources'][0]['source_id']);
        $this->assertNull($day['sources'][0]['physical']);
        $this->assertFalse($day['sources'][0]['effective']['assignment_exception_approved']);
        $this->assertSame(28800, $day['effective_duration_seconds']);
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $query = http_build_query(['from' => $today->toDateString(), 'to' => $today->toDateString()]);
        $this->browserRequest()->getJson('/api/v1/management/reports/attendance?'.$query)->assertOk()
            ->assertJsonFragment(['source_kind' => 'reconstruction']);
        $revised = app(ApprovalWorkflowService::class)->finalize(
            $fixture['owner'], $fixture['ownerUser'], (int) $fixture['employee']->getKey(),
            $today->toDateString(), $day['outcome'], 'Finalisasi setelah rekonstruksi disetujui.', $day['finalization_review_basis'],
        );
        $this->assertSame(2, (int) $revised->revision);
        $this->assertEquals($snapshot, $historical->fresh()->projection_snapshot);
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?'.$query
            .'&employee_id='.$fixture['employee']->getKey().'&compare_revision=1')
            ->assertOk()->assertJsonPath('historical_comparison.snapshot.effective_duration_seconds', 0)
            ->assertJsonPath('attendance.0.effective_duration_seconds', 28800);
        $approval = ApprovalRequest::query()->findOrFail($requestId)->decisions()->sole();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/reversal', [
                'decision_id' => $approval->getKey(), 'reason' => 'Klaim dibatalkan setelah pemeriksaan ulang.',
            ])->assertOk();
        $this->assertSame([], $project()['sources']);
        $this->assertTrue($project()['requires_refinalization']);
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $this->browserRequest()->getJson('/api/v1/management/reports/attendance?'.$query)
            ->assertOk()->assertJsonMissing(['source_kind' => 'reconstruction']);
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?'.$query
            .'&employee_id='.$fixture['employee']->getKey().'&compare_revision=2')
            ->assertOk()->assertJsonPath('historical_comparison.snapshot.effective_duration_seconds', 28800);

    }

    public function test_late_reconstruction_with_missing_assignment_requires_an_audited_owner_decision(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $workDate = $today->subDays(20);
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $payload = [
            'work_date' => $workDate->toDateString(), 'effective_outlet_id' => $fixture['outlet']->getKey(),
            'effective_check_in_at' => $workDate->setTime(1, 0)->toIso8601String(),
            'effective_check_out_at' => $workDate->setTime(9, 0)->toIso8601String(),
            'reason' => 'Pekerjaan lampau dikonfirmasi oleh catatan Outlet.',
        ];
        $this->loginAs($fixture['employeeUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                ...$payload, 'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
            ])->assertUnprocessable()->assertJsonValidationErrors('work_date');

        $this->loginAs($supervisorUser);
        $id = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/attendance/reconstructions', [...$payload, 'employee_id' => $fixture['employee']->getKey()])
            ->assertCreated()->assertJsonPath('request.details.deadline.owner_required', true)
            ->assertJsonPath('request.details.assignment_exception_required', true)->json('request.id');
        [$peerUser, $peer] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $peer, $fixture['outlet']);
        $approve = fn () => $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$id.'/decision', [
                'decision' => 'approved', 'reason' => 'Pengecualian disetujui berdasarkan bukti operasional.',
            ]);
        $this->loginAs($peerUser);
        $approve()->assertForbidden();
        $this->loginAs($fixture['ownerUser']);
        $approve()->assertOk()
            ->assertJsonPath('request.decision_history.0.effective_values.assignment_exception_approved', true)
            ->assertJsonPath('request.decision_history.0.effective_values.historical_assignment_id', null);
    }

    public function test_later_policy_cutoff_uses_inclusive_outlet_local_work_date(): void
    {
        $date = CarbonImmutable::parse('2026-10-21T00:00:00Z');
        Carbon::setTestNow($date);
        $fixture = $this->fixture();
        $outlet = app(OrganizationService::class)->createOutlet($fixture['owner'], $fixture['unit'], 'Outlet tenggat');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $fixture['owner'], $fixture['employee'], $outlet, $date,
        );
        $policy = app(AttendancePolicyService::class);
        $policy->createOutletVersion($fixture['owner'], $outlet, '2026-10-21', ['retroactive_request_limit_days' => 1], 'Tenggat historis');
        $policy->createOutletVersion($fixture['owner'], $outlet, '2026-10-22', ['retroactive_request_limit_days' => 3], 'Tenggat terkini');

        Carbon::setTestNow(CarbonImmutable::parse('2026-10-24T16:59:59Z'));
        $this->loginAs($fixture['employeeUser']);
        $payload = [
            'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
            'work_date' => '2026-10-21', 'effective_outlet_id' => $outlet->getKey(),
            'effective_check_in_at' => '2026-10-21T00:10:00+07:00',
            'effective_check_out_at' => '2026-10-21T03:00:00+07:00', 'reason' => 'Presensi terlewat.',
        ];
        $submit = fn () => $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', $payload);
        $options = $this->browserRequest()->getJson('/api/v1/attendance/me/effective?from=2026-10-21&to=2026-10-21')
            ->assertOk()->json('correction_options.reconstructions');
        $option = collect($options)->firstWhere('outlet.id', (int) $outlet->getKey());
        $this->assertTrue($option['can_start']);
        $this->assertSame('2026-10-24T17:00:00+00:00', $option['deadline']['exclusive_at']);
        $submit()->assertCreated()->assertJsonPath('request.details.deadline.exclusive_at', '2026-10-24T17:00:00+00:00');
        Carbon::setTestNow(CarbonImmutable::parse('2026-10-24T17:00:00Z'));
        $options = $this->browserRequest()->getJson('/api/v1/attendance/me/effective?from=2026-10-21&to=2026-10-21')
            ->assertOk()->json('correction_options.reconstructions');
        $this->assertFalse(collect($options)->firstWhere('outlet.id', (int) $outlet->getKey())['can_start']);
        $submit()->assertUnprocessable()->assertJsonValidationErrors('work_date');
    }

    public function test_start_only_correction_preserves_active_ownership_and_later_physical_checkout(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, false);
        $this->loginAs($fixture['employeeUser']);
        $id = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'attendance_correction', 'attendance_session_id' => $session->getKey(),
                'effective_check_in_at' => $today->setTime(7, 30)->toIso8601String(),
                'reason' => 'Mulai bekerja sebelum mencatat presensi.',
            ])->assertCreated()->json('request.id');
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$id.'/decision', [
                'decision' => 'approved', 'reason' => 'Waktu masuk diperiksa.',
            ])->assertOk();
        $this->assertSame('active', $session->fresh()->status);
        $this->assertDatabaseCount('attendance_active_session_owners', 1);
        Carbon::setTestNow($today->setTime(9, 0));
        $checkout = app(AttendanceService::class)->checkOut(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10], null,
        );
        $this->assertSame(200, $checkout['status']);
        $day = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame($today->setTime(9, 0)->toIso8601String(), $day['sessions'][0]['effective']['check_out_at']);
        $this->assertSame(5400, $day['effective_duration_seconds']);
        $this->assertDatabaseCount('attendance_events', 2);
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

        $firstRevision = AttendanceCorrection::query()->where('approval_request_id', $requestId)->sole();
        $this->assertSame(2, $firstRevision->contract_version);
        $this->assertNull($firstRevision->basis_correction_id);
        $this->assertSame((int) $session->outlet_id, $firstRevision->original_values['recorded']['outlet_id']);
        $this->assertSame($session->work_date->toDateString(), $firstRevision->original_values['recorded']['work_date']);

        $this->loginAs($fixture['employeeUser']);
        $revisionKey = (string) Str::uuid();
        $revisionPayload = [
            'type' => 'attendance_correction',
            'attendance_session_id' => $session->getKey(),
            'effective_check_in_at' => $today->setTime(8, 6)->toIso8601String(),
            'reason' => 'Penyesuaian lanjutan berdasarkan catatan operasional.',
        ];
        $submitRevision = fn () => $this->browserRequest()->withHeader('Idempotency-Key', $revisionKey)
            ->postJson('/api/v1/attendance/me/requests', $revisionPayload)->assertCreated();
        $revisionRequestId = $submitRevision()->json('request.id');
        $submitRevision()->assertJsonPath('request.id', $revisionRequestId);
        $revision = AttendanceCorrection::query()->where('approval_request_id', $revisionRequestId)->sole();
        $this->assertSame((int) $firstRevision->getKey(), $revision->basis_correction_id);
        $this->assertSame($firstRevision->proposed_values['check_in_at'], $revision->original_values['check_in_at']);

        $this->loginAs($fixture['ownerUser']);
        $decisionKey = (string) Str::uuid();
        $approveRevision = fn () => $this->browserRequest()->withHeader('Idempotency-Key', $decisionKey)
            ->postJson('/api/v1/management/approvals/'.$revisionRequestId.'/decision', [
                'decision' => 'approved', 'reason' => 'Penyesuaian lanjutan diperiksa.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');
        $approveRevision();
        $approveRevision()->assertJsonCount(1, 'request.decision_history');
        $latest = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame($today->setTime(8, 6)->toIso8601String(), $latest['sessions'][0]['effective']['check_in_at']);
        $this->assertSame((int) $revision->getKey(), $latest['sessions'][0]['correction']['correction_id']);
        $this->assertSame((int) $firstRevision->getKey(), $latest['sessions'][0]['correction']['basis_correction_id']);
        $this->assertSame(2, $session->events()->count());

        $request = ApprovalRequest::query()->findOrFail($requestId);
        try {
            $request->forceFill(['details' => ['category' => 'rewritten']])->save();
            $this->fail('Submitted approval payload must be immutable.');
        } catch (\LogicException) {
            $this->assertSame('attendance_correction', $request->fresh()->request_type);
        }
    }

    public function test_sensitive_supervisor_corrections_require_owner_review_and_keep_reversal_history(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $shift = app(ShiftTemplateService::class)->create(
            $fixture['owner'], 'Shift S5 reversal', '15:00:00', '23:00:00', false, $today->toDateString(), 'Jadwal uji pembalikan.',
        )->versions->firstOrFail();
        app(EmployeeScheduleService::class)->createWeeklyRule(
            $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
            $today->isoWeekday(), (int) $shift->getKey(), $today->toDateString(), null, 'Jadwal uji pembalikan.',
        );
        $session = $this->recordSession($fixture, true);
        $recorded = $session->getAttributes();
        Carbon::setTestNow($today->setTime(16, 10));
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $this->loginAs($supervisorUser);
        $submit = fn (int $minute): int => $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/attendance/sessions/'.$session->getKey().'/corrections', [
                'effective_check_in_at' => $today->setTime(8, $minute)->toIso8601String(),
                'effective_check_out_at' => $session->check_out_at->utc()->subMinutes($minute * 30)->toIso8601String(),
                'reason' => 'Usulan koreksi Supervisor.',
            ])->assertAccepted()->json('request.id');
        $approve = fn (int $id): TestResponse => $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$id.'/decision', [
                'decision' => 'approved', 'reason' => 'Catatan kerja telah diperiksa.',
            ]);
        $reverse = fn (int $requestId, int $decisionId, string $key, string $reason = 'Koreksi dibalik berdasarkan catatan.') => $this->browserRequest()->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/management/approvals/'.$requestId.'/reversal', ['decision_id' => $decisionId, 'reason' => $reason]);

        $first = $submit(1);
        $this->loginAs($fixture['ownerUser']);
        $firstDecision = $approve($first)->assertOk()->json('request.decision_history.0.id');
        $this->loginAs($supervisorUser);
        $stale = $submit(2);
        $latest = $submit(3);
        $this->loginAs($fixture['ownerUser']);
        $latestDecision = $approve($latest)->assertOk()->json('request.decision_history.0.id');
        $approve($stale)->assertUnprocessable()->assertJsonValidationErrors('correction');
        $project = fn () => app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $finalize = fn (?string $basis) => $this->browserRequest()->postJson('/api/v1/management/attendance/finalizations', [
            'employee_id' => $fixture['employee']->getKey(), 'work_date' => $today->toDateString(),
            'outcome' => $project()['outcome'], 'reason' => 'Hasil efektif ditinjau.', 'reviewed_basis' => $basis,
        ]);
        // The pending stale proposal is resolved independently before finalization.
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$stale.'/decision', [
                'decision' => 'rejected', 'reason' => 'Basis usulan sudah berubah.',
            ])->assertOk();
        $finalize(null)->assertCreated()->assertJsonPath('finalization.revision', 1);
        $snapshot = AttendanceFinalization::query()->sole()->projection_snapshot;
        $reverse($first, $firstDecision, (string) Str::uuid())->assertUnprocessable()->assertJsonValidationErrors('decision_id');

        $this->loginAs($supervisorUser);
        $reverse($latest, $latestDecision, (string) Str::uuid())->assertForbidden();

        $destination = app(OrganizationService::class)->createOutlet($fixture['owner'], $fixture['unit'], 'Outlet tujuan tanpa akses historis');
        [$destinationSupervisorUser, $destinationSupervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $destinationSupervisor, $destination);
        $this->loginAs($destinationSupervisorUser);
        $projectionQuery = http_build_query([
            'from' => $today->toDateString(), 'to' => $today->toDateString(), 'employee_id' => $fixture['employee']->getKey(),
        ]);
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?'.$projectionQuery)->assertForbidden();
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?'.$projectionQuery.'&compare_revision=1')->assertForbidden();
        $this->browserRequest()->getJson('/api/v1/management/approvals/'.$latest)->assertForbidden();
        $finalize(null)->assertForbidden();

        [$foreignUser] = $this->tenantWithOwner('Foreign reversal tenant');
        $this->loginAs($foreignUser);
        $reverse($latest, $latestDecision, (string) Str::uuid())->assertForbidden();

        $this->loginAs($fixture['ownerUser']);
        $key = (string) Str::uuid();
        $reverse($latest, $latestDecision, $key, ' ')->assertUnprocessable()->assertJsonValidationErrors('reason');
        $reverse($latest, $firstDecision, $key)->assertUnprocessable()->assertJsonValidationErrors('decision_id');
        $reverse($latest, $latestDecision, $key)->assertOk()->assertJsonPath('request.reversed', true)
            ->assertJsonPath('request.status', 'approved')
            ->assertJsonPath('request.decision_history.1.proposed_values.reverses_decision_id', $latestDecision);
        $reverse($latest, $latestDecision, $key)->assertOk()->assertJsonCount(2, 'request.decision_history');
        $reverse($latest, $latestDecision, $key, 'Alasan baru.')->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->assertSame($first, $project()['sessions'][0]['correction']['request_id']);
        $this->assertFalse($project()['is_finalized']);
        $reviewedBasis = $project()['finalization_review_basis'];
        $finalize(null)->assertUnprocessable()->assertJsonValidationErrors('reviewed_basis');

        $reverse($first, $firstDecision, (string) Str::uuid())->assertOk();
        $this->assertNull($project()['sessions'][0]['correction']);
        $finalize($reviewedBasis)->assertUnprocessable()->assertJsonValidationErrors('reviewed_basis');
        $this->loginAs($supervisorUser);
        $finalize($project()['finalization_review_basis'])->assertCreated()->assertJsonPath('finalization.revision', 2);
        $this->loginAs($fixture['ownerUser']);
        $this->assertTrue($project()['is_finalized']);
        $this->assertEquals($snapshot, AttendanceFinalization::query()->where('revision', 1)->sole()->projection_snapshot);
        $this->assertSame($recorded, $session->fresh()->getAttributes());
        $this->assertSame(2, $session->events()->count());
        $this->assertDatabaseCount('attendance_active_session_owners', 0);

        $this->loginAs($supervisorUser);
        $pendingOnPhysical = $submit(4);
        $temporary = $submit(5);
        $this->loginAs($fixture['ownerUser']);
        $temporaryDecision = $approve($temporary)->assertOk()->json('request.decision_history.0.id');
        $reverse($temporary, $temporaryDecision, (string) Str::uuid())->assertOk();
        $this->assertNull($project()['sessions'][0]['correction']);
        $approve($pendingOnPhysical)->assertUnprocessable()->assertJsonValidationErrors('correction');
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

        $approval = ApprovalRequest::query()->findOrFail($requestId)->decisions()->sole();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/reversal', [
                'decision_id' => $approval->getKey(), 'reason' => 'Waktu akhir sebelumnya tidak dapat dikonfirmasi.',
            ])->assertOk();
        $this->assertSame('administratively_resolved', $session->fresh()->status);
        $this->assertNull(app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString())['effective_duration_seconds']);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $this->assertSame(1, $session->events()->count());

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

    public function test_owner_administrative_correction_applies_immediately_is_audited_and_can_be_reversed(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        $recordedCheckIn = $session->fresh()->check_in_at->utc()->toIso8601String();
        $recordedCheckOut = $session->fresh()->check_out_at->utc()->toIso8601String();

        $this->loginAs($fixture['ownerUser']);
        $url = '/api/v1/management/attendance/sessions/'.$session->getKey().'/corrections';
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson($url, [
                'effective_check_in_at' => $today->setTime(8, 15)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(15, 45)->toIso8601String(),
            ])->assertUnprocessable()->assertJsonValidationErrors('reason');

        $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson($url, [
                'effective_check_in_at' => $today->setTime(8, 15)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(15, 45)->toIso8601String(),
                'reason' => 'Waktu dikoreksi berdasarkan catatan Owner.',
            ])->assertOk()
            ->assertJsonPath('applied', true)
            ->assertJsonPath('classification', 'sensitive')
            ->assertJsonPath('request.status', 'approved')
            ->assertJsonPath('request.details.submitted_as', 'owner_administrative_correction')
            ->assertJsonPath('request.decision_history.0.action', 'approved');
        $requestId = (int) $response->json('request.id');
        $decisionId = (int) $response->json('request.decision_history.0.id');

        $projection = fn () => app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame($today->setTime(8, 15)->toIso8601String(), $projection()['sessions'][0]['effective']['check_in_at']);
        $this->assertSame($today->setTime(15, 45)->toIso8601String(), $projection()['sessions'][0]['effective']['check_out_at']);
        $this->assertSame($recordedCheckIn, $session->fresh()->check_in_at->utc()->toIso8601String());
        $this->assertSame($recordedCheckOut, $session->fresh()->check_out_at->utc()->toIso8601String());
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $fixture['tenant']->getKey(),
            'subject_type' => 'attendance_correction',
            'subject_id' => $requestId,
            'action' => 'owner_administrative_correction_applied',
        ]);

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$requestId.'/reversal', [
                'decision_id' => $decisionId,
                'reason' => 'Koreksi dibalik setelah verifikasi ulang.',
            ])->assertOk()->assertJsonPath('request.reversed', true);
        $this->assertNull($projection()['sessions'][0]['correction']);
    }

    public function test_owner_administrative_reconstruction_is_applied_immediately(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        Carbon::setTestNow($today->setTime(17, 0));
        $this->loginAs($fixture['ownerUser']);

        $result = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/attendance/reconstructions', [
                'employee_id' => $fixture['employee']->getKey(),
                'work_date' => $today->toDateString(),
                'effective_check_in_at' => $today->setTime(8, 0)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(9, 0)->toIso8601String(),
                'effective_outlet_id' => $fixture['outlet']->getKey(),
                'reason' => 'Owner melengkapi catatan kerja yang terlewat.',
            ])->assertCreated()
            ->assertJsonPath('applied', true)
            ->assertJsonPath('request.status', 'approved')
            ->assertJsonPath('request.details.submitted_as', 'owner_administrative_reconstruction')
            ->assertJsonPath('request.decision_history.0.action', 'approved');

        $requestId = (int) $result->json('request.id');
        $projection = app(EffectiveAttendanceProjectionService::class)
            ->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), $today->toDateString());
        $this->assertSame('reconstruction', $projection['sources'][0]['source_kind']);
        $this->assertSame(3600, $projection['effective_duration_seconds']);
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $fixture['tenant']->getKey(),
            'subject_type' => 'attendance_correction',
            'subject_id' => $requestId,
            'action' => 'owner_administrative_reconstruction_applied',
        ]);
    }

    public function test_supervisor_sensitive_administrative_correction_stays_pending(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);

        $this->loginAs($supervisorUser);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/attendance/sessions/'.$session->getKey().'/corrections', [
                'effective_check_in_at' => $today->setTime(8, 30)->toIso8601String(),
                'effective_check_out_at' => $session->check_out_at->utc()->toIso8601String(),
                'reason' => 'Supervisor mengusulkan perubahan waktu.',
            ])->assertAccepted()
            ->assertJsonPath('applied', false)
            ->assertJsonPath('classification', 'sensitive')
            ->assertJsonPath('request.status', 'pending')
            ->assertJsonCount(0, 'request.decision_history');
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

        $claim = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
                'work_date' => $today->toDateString(), 'effective_outlet_id' => $fixture['outlet']->getKey(),
                'effective_check_in_at' => $today->setTime(1, 0)->toIso8601String(),
                'effective_check_out_at' => $today->setTime(9, 0)->toIso8601String(),
                'reason' => 'Koreksi kehadiran Owner sebagai karyawan.',
            ])->assertCreated();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$claim->json('request.id').'/decision', [
                'decision' => 'approved', 'reason' => 'Kehadiran telah diperiksa.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');

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

    public function test_origin_review_scope_excludes_checkout_destination_and_other_outlet_history(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $organization = app(OrganizationService::class);
        $actual = $fixture['outlet'];
        $destination = $organization->createOutlet($fixture['owner'], $fixture['unit'], 'Checkout destination only');
        $assignments = app(EmployeeOutletAssignmentService::class);
        $session = $this->recordSession([...$fixture, 'outlet' => $actual], false);
        Carbon::setTestNow($today->setTime(16, 0));
        $rejectedCheckout = app(AttendanceService::class)->checkOut(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20],
            null, $destination, (int) $session->getKey(),
        );
        $this->assertSame(409, $rejectedCheckout['status']);
        $this->assertSame('session_at_origin_outlet', $rejectedCheckout['body']['code']);
        $checkout = app(AttendanceService::class)->checkOut(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20],
            null, $actual, (int) $session->getKey(),
        );
        $this->assertSame(200, $checkout['status']);
        $this->assertSame((int) $actual->getKey(), $session->events()->where('event_type', 'check_out')->sole()->checkout_outlet_id);

        $assignments->assignPrimaryOutlet($fixture['owner'], $fixture['employee'], $destination, now());
        $this->loginAs($fixture['employeeUser']);
        $requestId = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/requests', [
            'type' => 'attendance_correction', 'attendance_session_id' => $session->getKey(),
            'effective_check_in_at' => $today->setTime(8, 5)->toIso8601String(), 'reason' => 'Perbaikan waktu mulai.',
        ])->assertCreated()->assertJsonPath('request.details.historical_primary_outlet_id', $fixture['outlet']->getKey())->json('request.id');
        Storage::fake('local');
        $file = $this->browserRequest()->post('/api/v1/correction-evidence/'.$requestId, [
            'key' => (string) Str::uuid(), 'file' => UploadedFile::fake()->image('scope.png', 10, 10),
        ], ['Accept' => 'application/json'])->assertOk()->json('file.id');

        $memberships = app(TenantMembershipService::class);
        [$primaryUser, $primary] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        [$actualUser, $actualReviewer] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        [$destinationUser, $destinationReviewer] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        $memberships->assignSupervisorOutletScope($fixture['owner'], $primary, $fixture['outlet']);
        $memberships->assignSupervisorOutletScope($fixture['owner'], $actualReviewer, $actual);
        $memberships->assignSupervisorOutletScope($fixture['owner'], $destinationReviewer, $destination);

        $approvalUrl = '/api/v1/management/approvals/'.$requestId;
        $fileUrl = '/api/v1/correction-evidence/'.$requestId.'/'.$file;
        $key = (string) Str::uuid();
        $approve = fn () => $this->browserRequest()->withHeader('Idempotency-Key', $key)->postJson($approvalUrl.'/decision', [
            'decision' => 'approved', 'reason' => 'Koreksi telah diperiksa.',
        ]);
        $this->loginAs($destinationUser);
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?employee_id='.$fixture['employee']->getKey()
            .'&from='.$today->toDateString().'&to='.$today->toDateString())->assertForbidden();
        $this->browserRequest()->getJson('/api/v1/management/approvals?status=pending')->assertOk()->assertJsonCount(0, 'requests');
        $this->browserRequest()->getJson($approvalUrl)->assertForbidden();
        $this->browserRequest()->getJson($fileUrl)->assertForbidden();
        $approve()->assertForbidden();

        $this->loginAs($actualUser);
        $this->browserRequest()->getJson($approvalUrl)->assertOk()->assertJsonPath('request.can_decide', true);
        $this->browserRequest()->getJson($fileUrl)->assertOk();

        $this->loginAs($primaryUser);
        $this->browserRequest()->getJson('/api/v1/management/approvals?status=pending&outlet_id='.$fixture['outlet']->getKey())
            ->assertOk()->assertJsonPath('requests.0.id', $requestId)->assertJsonPath('requests.0.can_decide', true);
        // Simulate a pre-04B request whose physical session has historical assignments but no Primary snapshot in the request.
        DB::table('approval_requests')->where('tenant_id', $fixture['tenant']->getKey())->where('id', $requestId)
            ->update(['details' => DB::raw("JSON_REMOVE(details, '$.historical_primary_outlet_id')")]);
        $this->browserRequest()->getJson('/api/v1/management/approvals?status=pending&outlet_id='.$fixture['outlet']->getKey())
            ->assertOk()->assertJsonPath('requests.0.id', $requestId)->assertJsonPath('requests.0.can_decide', true);
        $this->browserRequest()->getJson($fileUrl)->assertOk();
        $date = $today->toDateString();
        $this->browserRequest()->getJson('/api/v1/management/attendance/effective?employee_id='.$fixture['employee']->getKey()
            .'&from='.$date.'&to='.$date)->assertOk();
        $decisionId = $approve()->assertOk()->assertJsonPath('request.status', 'approved')->json('request.decision_history.0.id');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())->postJson($approvalUrl.'/reversal', [
            'decision_id' => $decisionId, 'reason' => 'Percobaan Supervisor.',
        ])->assertForbidden();
        $memberships->revokeSupervisorOutletScope($fixture['owner'], $primary, $fixture['outlet']);
        $this->browserRequest()->getJson($approvalUrl)->assertForbidden();
        $this->browserRequest()->getJson($fileUrl)->assertForbidden();
        $approve()->assertForbidden();
        $this->assertSame(2, $session->events()->count());
    }

    public function test_historical_primary_can_discover_and_approve_ordinary_reconstruction(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $actual = $fixture['outlet'];
        $request = app(ApprovalWorkflowService::class)->submitEmployeeRequest($fixture['membership'], $fixture['employeeUser'], [
            'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
            'work_date' => $today->toDateString(), 'effective_outlet_id' => $actual->getKey(),
            'effective_check_in_at' => $today->setTime(1, 0)->toIso8601String(),
            'effective_check_out_at' => $today->setTime(9, 0)->toIso8601String(),
            'reason' => 'Pekerjaan selesai tanpa pencatatan fisik.',
        ], (string) Str::uuid());
        [$user, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $this->loginAs($user);
        $this->browserRequest()->getJson('/api/v1/management/approvals?outlet_id='.$fixture['outlet']->getKey())
            ->assertOk()->assertJsonPath('requests.0.id', $request->getKey())->assertJsonPath('requests.0.can_decide', true);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/management/approvals/'.$request->getKey().'/decision', [
                'decision' => 'approved', 'reason' => 'Rekonstruksi ditinjau dari Outlet utama historis.',
            ])->assertOk()->assertJsonPath('request.status', 'approved');
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
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
