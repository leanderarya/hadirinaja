<?php

namespace Tests\Feature\S4;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceEvidenceLegalHoldRequest;
use App\Models\AttendanceEvidenceLegalHoldWorkflowEvent;
use App\Models\User;
use App\Services\AttendanceEvidenceExpirationService;
use App\Services\AttendanceEvidenceLegalHoldService;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PDOException;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class LegalHoldWorkflowTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseMigrations, DatabaseTruncation {
        DatabaseMigrations::runDatabaseMigrations as private runFreshDatabaseMigrations;
    }

    public function runDatabaseMigrations(): void
    {
        if (getenv('HADIRINAJA_TEST_SCHEMA_PREPARED') !== '1') {
            $this->runFreshDatabaseMigrations();

            return;
        }
        $this->truncateDatabaseTables();
        $this->beforeApplicationDestroyed(fn () => $this->truncateTablesForAllConnections());
    }

    /** @var list<string> */
    private array $temporaryDirectories = [];

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        foreach ($this->temporaryDirectories as $directory) {
            $this->removeTree($directory);
        }
        parent::tearDown();
    }

    public function test_placement_retry_rolls_back_the_lease_request_and_workflow_event(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        $evidence = $this->createEvidence($fixture);
        $attempts = 0;
        AttendanceEvidenceLegalHoldWorkflowEvent::created(static function () use (&$attempts): void {
            if (++$attempts === 1) {
                throw new PDOException("SQLSTATE[HY000]: General error: 1020 Record has changed since last read in table 'attendance_evidence'; try restarting transaction");
            }
        });

        $request = app(AttendanceEvidenceLegalHoldService::class)->requestPlacement(
            $fixture['owner'], (int) $evidence->attendance_event_id, 'case-retry',
            'Verify atomic preservation on a retry.', 7,
        );

        $this->assertSame(2, $attempts);
        $this->assertTrue($request['preservation_lease_granted']);
        $this->assertNotNull($evidence->fresh()->legal_hold_lease_consumed_at);
        $this->assertDatabaseCount('attendance_evidence_legal_hold_requests', 1);
        $this->assertDatabaseCount('attendance_evidence_legal_hold_workflow_events', 1);
        $this->assertDatabaseCount('attendance_evidence_legal_hold_events', 0);
    }

    public function test_supervisor_can_request_in_scope_and_owner_approval_is_audited_and_bounds_hold(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        Storage::fake('local');
        $fixture = $this->fixture();
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $evidence = $this->createEvidence($fixture);
        $event = $evidence->event;

        $this->loginAs($supervisorUser);
        $request = $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$event->getKey().'/legal-hold-requests', [
            'hold_reference' => 'case-legal-2026-01',
            'justification' => 'Preserve evidence for an active documented legal review.',
            'duration_days' => 90,
        ])->assertCreated()->json('request');
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$event->getKey().'/legal-hold-requests', [
            'hold_reference' => 'case-repeat',
            'justification' => 'A second request must not stack a pending preservation lease.',
            'duration_days' => 30,
        ])->assertConflict()->assertJsonPath('code', 'legal_hold_request_pending');

        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Reviewed case reference and approved preservation.',
        ])->assertOk()->assertJsonPath('request.status', 'approved');

        $hold = DB::table('attendance_evidence_legal_hold_events')->where('legal_hold_request_id', $request['id'])->first();
        $this->assertNotNull($hold);
        $this->assertSame('placed', $hold->action);
        $this->assertSame(
            CarbonImmutable::parse($hold->occurred_at, 'UTC')->addDays(90)->getTimestamp(),
            CarbonImmutable::parse($hold->expires_at, 'UTC')->getTimestamp(),
        );
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'approved', 'actor_membership_id' => $fixture['owner']->getKey(),
        ]);

        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => CarbonImmutable::now('UTC')->subDays(91)->format('Y-m-d H:i:s'),
        ]);
        $result = app(AttendanceEvidenceExpirationService::class)->run(false, 100, CarbonImmutable::now('UTC'));
        $this->assertSame(1, $result['held']);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertExists($evidence->storage_path);
    }

    public function test_only_single_active_owner_can_self_approve_and_audit_marks_exception(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        $evidence = $this->createEvidence($fixture);
        $this->loginAs($fixture['ownerUser']);
        $request = $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-single-owner',
            'justification' => 'Preserve evidence while the tenant has only one active Owner.',
            'duration_days' => 30,
        ])->assertCreated()->json('request');

        $this->browserRequest()->postJson('/api/v1/management/attendance/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Approved under the documented single Owner exception.',
        ])->assertOk();

        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'single_owner_approved',
            'actor_membership_id' => $fixture['owner']->getKey(),
        ]);
        $this->assertTrue(app(AttendanceEvidenceLegalHoldService::class)
            ->hasActiveHold((int) $fixture['tenant']->getKey(), (int) $evidence->getKey(), now('UTC')));
        $workflowEvent = AttendanceEvidenceLegalHoldWorkflowEvent::query()->where('request_id', $request['id'])->firstOrFail();
        $this->expectException(\LogicException::class);
        $workflowEvent->update(['reason' => 'Tampering must be rejected.']);
    }

    public function test_owner_cannot_self_approve_when_another_active_owner_exists(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        [$secondOwnerUser, $secondOwner] = $this->membershipFor($fixture['owner']);
        app(TenantMembershipService::class)->assignRole($fixture['owner'], $secondOwner, TenantRole::Owner);
        $evidence = $this->createEvidence($fixture);
        $this->loginAs($fixture['ownerUser']);
        $request = $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-two-owners',
            'justification' => 'This request requires an independent active Owner decision.',
            'duration_days' => 30,
        ])->assertCreated()->json('request');
        $this->browserRequest()->postJson('/api/v1/management/attendance/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Self approval is forbidden when another Owner exists.',
        ])->assertForbidden();
        $this->assertSame('pending', AttendanceEvidenceLegalHoldRequest::query()->findOrFail($request['id'])->status);

        $this->loginAs($secondOwnerUser);
        $this->browserRequest()->postJson('/api/v1/management/attendance/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Independent Owner reviewed and approved the request.',
        ])->assertOk();
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'approved', 'actor_membership_id' => $secondOwner->getKey(),
        ]);
    }

    public function test_legacy_unbounded_hold_is_listed_and_only_becomes_bounded_after_owner_review(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        $evidence = $this->createEvidence($fixture);
        $legacyId = DB::table('attendance_evidence_legal_hold_events')->insertGetId([
            'tenant_id' => $fixture['tenant']->getKey(),
            'attendance_evidence_id' => $evidence->getKey(),
            'attendance_event_id' => $evidence->attendance_event_id,
            'hold_reference' => 'legacy-case-2026',
            'action' => 'placed',
            'actor_membership_id' => $fixture['owner']->getKey(),
            'occurred_at' => now('UTC'),
        ]);
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->getJson('/api/v1/management/attendance/legal-holds')
            ->assertOk()->assertJsonPath('active_holds.0.hold_event_id', $legacyId)
            ->assertJsonPath('active_holds.0.legacy_unbounded', true);

        $request = $this->browserRequest()->postJson('/api/v1/management/attendance/legal-holds/'.$legacyId.'/extension-requests', [
            'justification' => 'Owner review sets an explicit bounded term for this legacy case.',
            'duration_days' => 30,
        ])->assertCreated()->json('request');
        $this->browserRequest()->postJson('/api/v1/management/attendance/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Legacy hold reviewed and converted to a bounded approval.',
        ])->assertOk();

        $events = DB::table('attendance_evidence_legal_hold_events')
            ->where('attendance_evidence_id', $evidence->getKey())->orderBy('id')->get();
        $this->assertSame(['placed', 'released', 'placed'], $events->pluck('action')->all());
        $this->assertNull($events[0]->expires_at);
        $this->assertNotNull($events[2]->expires_at);
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'legacy_bounded',
        ]);
        $this->assertTrue(app(AttendanceEvidenceLegalHoldService::class)
            ->hasActiveHold((int) $fixture['tenant']->getKey(), (int) $evidence->getKey(), now('UTC')));
    }

    public function test_supervisor_scope_employee_and_cross_tenant_checks_are_enforced(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        $evidence = $this->createEvidence($fixture);
        [$supervisorUser] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        $this->loginAs($supervisorUser);
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-out-of-scope',
            'justification' => 'This request is outside the supervisor assigned outlet scope.',
            'duration_days' => 5,
        ])->assertForbidden();

        $this->loginAs($fixture['employeeUser']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-employee',
            'justification' => 'Employees are not allowed to submit legal hold requests.',
            'duration_days' => 5,
        ])->assertForbidden();

        $other = $this->fixture('Different tenant');
        $this->loginAs($other['ownerUser']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-cross-tenant',
            'justification' => 'Cross tenant hold requests must not reveal evidence existence.',
            'duration_days' => 5,
        ])->assertNotFound();
    }

    public function test_pending_lease_is_exactly_bounded_and_expiry_is_audited_before_deletion(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        Storage::fake('local');
        $fixture = $this->fixture();
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $evidence = $this->createEvidence($fixture);
        $event = $evidence->event;
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => CarbonImmutable::now('UTC')->subDays(91)->format('Y-m-d H:i:s'),
        ]);

        $this->loginAs($supervisorUser);
        $request = $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$event->getKey().'/legal-hold-requests', [
            'hold_reference' => 'case-lease',
            'justification' => 'Request a bounded preservation review before evidence deletion.',
            'duration_days' => 10,
        ])->assertCreated()->json('request');
        $leaseExpiry = CarbonImmutable::parse($request['lease_expires_at'], 'UTC');
        $protected = app(AttendanceEvidenceExpirationService::class)->run(false, 100, $leaseExpiry->subSecond());
        $this->assertSame(1, $protected['held']);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertExists($evidence->storage_path);

        $expiredRequests = app(AttendanceEvidenceLegalHoldService::class)->expireDue(1000, $leaseExpiry->toMutable());
        $this->assertSame(1, $expiredRequests);
        $this->assertSame('expired', AttendanceEvidenceLegalHoldRequest::query()->findOrFail($request['id'])->status);
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'request_expired',
        ]);
        $retry = $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$event->getKey().'/legal-hold-requests', [
            'hold_reference' => 'case-no-repeat-lease',
            'justification' => 'A repeated request cannot obtain another preservation lease.',
            'duration_days' => 10,
        ])->assertCreated()->json('request');
        $this->assertFalse($retry['preservation_lease_granted']);
        $deleted = app(AttendanceEvidenceExpirationService::class)->run(false, 100, $leaseExpiry->addSecond()->toMutable());
        $this->assertSame(1, $deleted['deleted']);
        $this->assertSame('expired', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertMissing($evidence->storage_path);
    }

    public function test_deletion_pending_and_expired_evidence_cannot_be_activated_by_hold(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        $evidence = $this->createEvidence($fixture);
        $this->loginAs($fixture['ownerUser']);
        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update(['lifecycle_state' => 'deletion_pending']);
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-too-late',
            'justification' => 'This hold request cannot reverse the deletion lifecycle state.',
            'duration_days' => 10,
        ])->assertConflict()->assertJsonPath('code', 'evidence_not_available');
        $this->assertSame('deletion_pending', $evidence->fresh()->lifecycle_state);
        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update(['lifecycle_state' => 'expired', 'storage_path' => null, 'sha256' => null]);
        $this->browserRequest()->postJson('/api/v1/management/attendance/events/'.$evidence->attendance_event_id.'/legal-hold-requests', [
            'hold_reference' => 'case-expired',
            'justification' => 'An expired evidence tombstone cannot become active again.',
            'duration_days' => 10,
        ])->assertConflict()->assertJsonPath('code', 'evidence_not_available');
        $this->assertSame('expired', $evidence->fresh()->lifecycle_state);
    }

    public function test_rejection_extension_release_and_automatic_expiry_are_audited(): void
    {
        Storage::fake('local');
        $fixture = $this->fixture();
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $evidence = $this->createEvidence($fixture);
        $eventId = (int) $evidence->attendance_event_id;
        $base = '/api/v1/management/attendance';

        $this->loginAs($supervisorUser);
        $request = $this->browserRequest()->postJson($base.'/events/'.$eventId.'/legal-hold-requests', [
            'hold_reference' => 'case-renewal',
            'justification' => 'Preserve this evidence for a documented review and decision.',
            'duration_days' => 1,
        ])->assertCreated()->json('request');
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->postJson($base.'/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Initial hold approved after checking the case basis.',
        ])->assertOk();
        $placement = DB::table('attendance_evidence_legal_hold_events')->where('legal_hold_request_id', $request['id'])->first();

        $this->loginAs($supervisorUser);
        $extension = $this->browserRequest()->postJson($base.'/legal-holds/'.$placement->id.'/extension-requests', [
            'justification' => 'The documented review is still active and requires more time.',
            'duration_days' => 10,
        ])->assertCreated()->json('request');
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->postJson($base.'/legal-hold-requests/'.$extension['id'].'/reject', [
            'decision_reason' => 'The extension request needs a stronger current justification.',
        ])->assertOk()->assertJsonPath('request.status', 'rejected');
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $extension['id'], 'action' => 'rejected',
        ]);

        $this->loginAs($supervisorUser);
        $extension = $this->browserRequest()->postJson($base.'/legal-holds/'.$placement->id.'/extension-requests', [
            'justification' => 'The revised case record confirms the review remains active.',
            'duration_days' => 10,
        ])->assertCreated()->json('request');
        $this->loginAs($fixture['ownerUser']);
        $this->browserRequest()->postJson($base.'/legal-hold-requests/'.$extension['id'].'/approve', [
            'decision_reason' => 'The updated supporting review was checked and approved.',
        ])->assertOk();
        $latestPlacement = DB::table('attendance_evidence_legal_hold_events')
            ->where('attendance_evidence_id', $evidence->getKey())->where('action', 'placed')->orderByDesc('id')->first();
        $this->assertGreaterThan($placement->expires_at, $latestPlacement->expires_at);
        $this->browserRequest()->postJson($base.'/legal-holds/'.$latestPlacement->id.'/release', [
            'reason' => 'The legal review ended and the Owner releases the hold.',
        ])->assertOk()->assertJsonPath('state', 'released');
        $this->assertSame('released', AttendanceEvidenceLegalHoldRequest::query()->findOrFail($extension['id'])->status);
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'action' => 'released', 'actor_membership_id' => $fixture['owner']->getKey(),
        ]);

        $clock = CarbonImmutable::parse('2026-08-01 12:00:00', 'UTC');
        CarbonImmutable::setTestNow($clock);
        $request = $this->browserRequest()->postJson($base.'/events/'.$eventId.'/legal-hold-requests', [
            'hold_reference' => 'case-expiring',
            'justification' => 'A separate documented review requires a short preservation period.',
            'duration_days' => 1,
        ])->assertCreated()->json('request');
        $this->browserRequest()->postJson($base.'/legal-hold-requests/'.$request['id'].'/approve', [
            'decision_reason' => 'Approved for one bounded review period.',
        ])->assertOk();
        CarbonImmutable::setTestNow($clock->addDay());
        $expired = app(AttendanceEvidenceLegalHoldService::class)->expireDue();
        $this->assertSame(1, $expired);
        $this->assertDatabaseHas('attendance_evidence_legal_hold_events', [
            'attendance_evidence_id' => $evidence->getKey(),
            'hold_reference' => 'case-expiring',
            'action' => 'expired',
        ]);
        $this->assertDatabaseHas('attendance_evidence_legal_hold_workflow_events', [
            'request_id' => $request['id'], 'action' => 'hold_expired',
        ]);
    }

    public function test_concurrent_hold_request_and_deletion_worker_never_claim_false_preservation(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        $fixture = $this->fixture();
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $fixture['outlet']);
        $directory = sys_get_temp_dir().'/hadirinaja-s6c-'.Str::uuid();
        mkdir($directory, 0700, true);
        $this->temporaryDirectories[] = $directory;
        $evidenceRoot = $directory.'/private';
        mkdir($evidenceRoot, 0700, true);
        config(['filesystems.disks.local.root' => $evidenceRoot]);
        Storage::forgetDisk('local');
        $evidence = $this->createEvidence($fixture);
        $event = $evidence->event;
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => CarbonImmutable::now('UTC')->subDays(91)->format('Y-m-d H:i:s'),
        ]);

        $startPath = $directory.'/start';
        $runId = (string) Str::uuid();
        $processes = [];
        foreach (['request', 'expire'] as $index => $mode) {
            $processes[$mode] = new Process(
                [PHP_BINARY, base_path('tests/Support/legal-hold-race-worker.php')],
                base_path(),
                $this->disposableDatabaseWorkerEnvironment() + [
                    'S6C_EVIDENCE_ROOT' => $evidenceRoot,
                    'S6C_READY_FILE' => $directory.'/ready-'.$index,
                    'S6C_START_FILE' => $startPath,
                    'S6C_RESULT_FILE' => $directory.'/result-'.$mode,
                    'S6C_NOW' => CarbonImmutable::now('UTC')->format(DATE_ATOM),
                    'S6C_MODE' => $mode,
                    'S6C_MEMBERSHIP_ID' => (string) $supervisor->getKey(),
                    'S6C_EVENT_ID' => (string) $event->getKey(),
                    'S6C_RUN_ID' => $runId,
                ],
                null,
                25,
            );
            $processes[$mode]->start();
        }

        try {
            $this->waitForFiles([$directory.'/ready-0', $directory.'/ready-1'], $processes);
            file_put_contents($startPath, 'release');
            foreach ($processes as $process) {
                $process->wait();
                $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput().$process->getOutput());
            }
            $requestResult = json_decode((string) file_get_contents($directory.'/result-request'), true, flags: JSON_THROW_ON_ERROR);
            $expireResult = json_decode((string) file_get_contents($directory.'/result-expire'), true, flags: JSON_THROW_ON_ERROR);
            $this->assertNotSame($requestResult['connection_id'], $expireResult['connection_id']);

            if ($requestResult['status'] === 'accepted') {
                $this->assertSame('available', $evidence->fresh()->lifecycle_state);
                $this->assertTrue($requestResult['request']['preservation_lease_granted']);
                $this->assertSame(1, $expireResult['summary']['held']);
                Storage::disk('local')->assertExists($evidence->storage_path);
            } else {
                $this->assertSame(409, $requestResult['http_status']);
                $this->assertSame('evidence_not_available', $requestResult['body']['code']);
                $this->assertSame(1, $expireResult['summary']['deleted']);
                $this->assertSame('expired', $evidence->fresh()->lifecycle_state);
                Storage::disk('local')->assertMissing($evidence->storage_path);
            }
        } finally {
            file_put_contents($startPath, 'release');
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop(1);
                }
            }
        }
    }

    /** @return array<string, mixed> */
    private function fixture(string $name = 'Legal hold tenant'): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner($name);
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Legal hold outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Legal hold employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion(
            $owner,
            $outlet,
            CarbonImmutable::today('UTC')->toDateString(),
            ['attendance_mode' => 'hybrid', 'personal_location_validation' => [
                'required' => false, 'radius_meters' => 100, 'latitude' => -6.2, 'longitude' => 106.816666,
            ]],
            'Legal hold fixture policy',
        );

        return compact('ownerUser', 'tenant', 'owner', 'outlet', 'employeeUser', 'membership', 'employee');
    }

    private function createEvidence(array $fixture): AttendanceEvidence
    {
        $result = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']),
            $fixture['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            ['status' => 'unavailable'],
            UploadedFile::fake()->image('camera.jpg', 640, 480),
        );
        $event = AttendanceEvent::query()->whereKey($result['body']['event']['id'])->firstOrFail();

        return AttendanceEvidence::query()->where('attendance_event_id', $event->getKey())->firstOrFail();
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
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

    /** @param list<string> $paths
     * @param  array<string, Process>  $processes
     */
    private function waitForFiles(array $paths, array $processes): void
    {
        $deadline = microtime(true) + 20;
        while (microtime(true) < $deadline) {
            foreach ($processes as $process) {
                if (! $process->isRunning() && $process->getExitCode() !== 0) {
                    $this->fail($process->getErrorOutput().$process->getOutput());
                }
            }
            if (count(array_filter($paths, 'is_file')) === count($paths)) {
                return;
            }
            usleep(10_000);
        }

        $this->fail('Timed out waiting for legal hold race workers.');
    }

    private function removeTree(string $path): void
    {
        if (! is_dir($path)) {
            @unlink($path);

            return;
        }
        foreach (new \FilesystemIterator($path) as $item) {
            $this->removeTree($item->getPathname());
        }
        @rmdir($path);
    }
}
