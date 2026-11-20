<?php

namespace Tests\Feature\S5;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceEvent;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\ApprovalWorkflowService;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\CorrectionEvidenceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class ApprovalConcurrencyTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseTruncation;

    /** @var list<string> */
    private array $temporaryDirectories = [];

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        foreach ($this->temporaryDirectories as $directory) {
            $this->removeTree($directory);
        }
        // Keep committed worker fixtures out of subsequent RefreshDatabase tests.
        $this->truncateTablesForAllConnections();

        parent::tearDown();
    }

    public function test_approval_racing_with_rejection_and_duplicate_retry_cannot_create_competing_decisions(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $first = $this->leaveRequest($fixture, $today->addDay()->toDateString(), 'Uji race approve reject.');
        $reviewerTwo = $this->independentOwner($fixture);
        $results = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $first, 'approved', 'Disetujui secara bersamaan.'),
            $this->worker('decide', $reviewerTwo['membership'], $reviewerTwo['user'], $first, 'rejected', 'Ditolak secara bersamaan.'),
        ]);

        $this->assertSame(2, count(array_unique(array_column($results, 'connection_id'))));
        $this->assertEqualsCanonicalizing(['decided', 'conflict'], array_column($results, 'outcome'));
        $this->assertContains($first->fresh()->status, ['approved', 'rejected']);
        $this->assertSame(1, DB::table('approval_decisions')->where('approval_request_id', $first->getKey())->count());

        $second = $this->leaveRequest($fixture, $today->addDays(3)->toDateString(), 'Uji idempotensi keputusan.');
        $sharedKey = (string) Str::uuid();
        $retryResults = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $second, 'approved', 'Keputusan idempoten.', $sharedKey),
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $second, 'approved', 'Keputusan idempoten.', $sharedKey),
        ]);

        $this->assertEqualsCanonicalizing(['decided', 'decided'], array_column($retryResults, 'outcome'));
        $this->assertSame($retryResults[0]['connection_id'] === $retryResults[1]['connection_id'], false);
        $this->assertSame(1, DB::table('approval_decisions')->where('approval_request_id', $second->getKey())->count());
        $this->assertSame('approved', $second->fresh()->status);
    }

    public function test_approval_racing_with_employee_cancellation_has_one_terminal_state(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(12, 0));
        $fixture = $this->fixture();
        $request = $this->leaveRequest($fixture, $today->addDay()->toDateString(), 'Uji race cancel approve.');
        $results = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $request, 'approved', 'Disetujui saat dibatalkan.'),
            $this->worker('cancel', $fixture['membership'], $fixture['employeeUser'], $request),
        ]);

        $outcomes = array_column($results, 'outcome');
        $this->assertSame(1, count(array_filter($outcomes, fn (string $outcome): bool => $outcome === 'conflict')));
        $this->assertSame(1, count(array_filter($outcomes, fn (string $outcome): bool => in_array($outcome, ['decided', 'cancelled'], true))));
        $this->assertContains($request->fresh()->status, ['approved', 'cancelled']);
        $this->assertSame(1, DB::table('approval_decisions')->where('approval_request_id', $request->getKey())->count());
    }

    public function test_revision_migration_preserves_legacy_claims_and_guards_recorded_dependencies(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        Carbon::setTestNow($today->setTime(16, 5));
        $request = $this->correctionRequest($fixture, $session, $today->setTime(8, 5), $today->setTime(16, 0), 'Koreksi historis.');
        $claim = AttendanceCorrection::query()->where('approval_request_id', $request->getKey())->sole();
        $migration = require database_path('migrations/2026_11_05_000004_add_correction_revision_basis.php');

        try {
            $migration->down();
            $this->fail('A versioned claim must prevent schema rollback.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('discard recorded correction dependencies', $exception->getMessage());
        }

        // Simulate a pre-migration claim in this disposable database.
        DB::table('attendance_corrections')->where('id', $claim->getKey())->update(['contract_version' => 1]);
        $migration->down();
        $this->assertFalse(Schema::hasColumn('attendance_corrections', 'basis_correction_id'));
        $migration->up();

        $legacy = $claim->fresh();
        $this->assertSame(1, $legacy->contract_version);
        $this->assertNull($legacy->basis_correction_id);
        $this->assertSame($claim->original_values, $legacy->original_values);
        $this->assertSame($claim->proposed_values, $legacy->proposed_values);
    }

    public function test_overlapping_overnight_reconstructions_cannot_both_be_approved(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(10, 0));
        $fixture = $this->fixture();
        $workflow = app(ApprovalWorkflowService::class);
        $submit = fn (CarbonImmutable $start, CarbonImmutable $end) => $workflow->submitEmployeeRequest(
            $fixture['membership'], $fixture['employeeUser'], [
                'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
                'work_date' => $start->setTimezone('Asia/Jakarta')->toDateString(),
                'effective_outlet_id' => $fixture['outlet']->getKey(),
                'effective_check_in_at' => $start->toIso8601String(),
                'effective_check_out_at' => $end->toIso8601String(), 'reason' => 'Presensi terlewat.',
            ], (string) Str::uuid(),
        );
        $first = $submit($today->subDay()->setTime(16, 0), $today->setTime(1, 0));
        $second = $submit($today->setTime(0, 0), $today->setTime(2, 0));
        $otherOwner = $this->independentOwner($fixture);
        $results = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $first, 'approved', 'Catatan diperiksa.'),
            $this->worker('decide', $otherOwner['membership'], $otherOwner['user'], $second, 'approved', 'Catatan diperiksa.'),
        ]);

        $this->assertEqualsCanonicalizing(['decided', 'conflict'], array_column($results, 'outcome'));
        $this->assertDatabaseCount('approval_decisions', 1);
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
    }

    public function test_conflicting_corrections_cannot_both_become_effective(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        Carbon::setTestNow($today->setTime(16, 5));
        $first = $this->correctionRequest($fixture, $session, $today->setTime(8, 5), $today->setTime(16, 0), 'Koreksi A.');
        $second = $this->correctionRequest($fixture, $session, $today->setTime(7, 55), $today->setTime(16, 0), 'Koreksi B.');
        $reviewerTwo = $this->independentOwner($fixture);
        $results = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $first, 'approved', 'Koreksi diperiksa.'),
            $this->worker('decide', $reviewerTwo['membership'], $reviewerTwo['user'], $second, 'approved', 'Koreksi diperiksa.'),
        ]);

        $this->assertEqualsCanonicalizing(['decided', 'conflict'], array_column($results, 'outcome'));
        $this->assertSame(1, ApprovalRequest::query()->whereIn('id', [$first->getKey(), $second->getKey()])->where('status', 'approved')->count());
        $this->assertSame(1, DB::table('approval_decisions')->whereIn('approval_request_id', [$first->getKey(), $second->getKey()])->count());
        $this->assertContains('pending', [$first->fresh()->status, $second->fresh()->status]);
    }

    public function test_revision_approval_and_reversal_serialize_and_replayed_reversal_is_unique(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        Carbon::setTestNow($today->setTime(16, 10));
        $workflow = app(ApprovalWorkflowService::class);
        $base = $this->correctionRequest($fixture, $session, $today->setTime(8, 1), $today->setTime(16, 0), 'Koreksi awal.');
        $workflow->decide($fixture['owner'], $fixture['ownerUser'], (int) $base->getKey(), 'approved', 'Dasar disetujui.', (string) Str::uuid());
        $baseApproval = $base->decisions()->sole();
        $baseDecision = (string) $baseApproval->getKey();
        $migration = require database_path('migrations/2026_11_05_000005_add_correction_reversal_decision.php');
        $migration->down();
        $migration->up();
        $this->assertSame($baseApproval->getAttributes(), $baseApproval->fresh()->getAttributes());

        $revision = $this->correctionRequest($fixture, $session, $today->setTime(8, 3), $today->setTime(16, 0), 'Revisi berdasarkan koreksi awal.');
        $otherOwner = $this->independentOwner($fixture);

        $revisionWorker = $this->worker('decide', $otherOwner['membership'], $otherOwner['user'], $revision, 'approved');
        $revisionWorker['test_now'] = $today->setTime(16, 9)->toIso8601String();
        $results = $this->runConcurrent($fixture, [
            $this->worker('reverse', $fixture['owner'], $fixture['ownerUser'], $base, $baseDecision),
            $revisionWorker,
        ]);
        $this->assertSame(1, count(array_filter($results, fn (array $result): bool => $result['outcome'] === 'conflict')));
        if ($revision->fresh()->status === 'approved') {
            $this->assertSame(['conflict', 'decided'], array_column($results, 'outcome'));
            $this->assertSame(1, $base->decisions()->count());
            $this->assertTrue($revision->decisions()->sole()->acted_at->lessThan($baseApproval->acted_at));
            $target = $revision;
        } else {
            $this->assertSame(['reversed', 'conflict'], array_column($results, 'outcome'));
            $this->assertSame(2, $base->decisions()->count());
            $this->assertSame(0, $revision->decisions()->count());
            $target = $this->correctionRequest($fixture, $session, $today->setTime(8, 4), $today->setTime(16, 0), 'Koreksi berdasarkan fakta asli.');
            $workflow->decide($fixture['owner'], $fixture['ownerUser'], (int) $target->getKey(), 'approved', 'Disetujui setelah peninjauan.', (string) Str::uuid());
        }

        $spec = $this->worker('reverse', $fixture['owner'], $fixture['ownerUser'], $target, (string) $target->decisions()->sole()->getKey());
        $results = $this->runConcurrent($fixture, [$spec, $spec]);
        $this->assertSame(['reversed', 'reversed'], array_column($results, 'outcome'));
        $this->assertSame(1, $target->decisions()->where('action', 'reversed')->count());
        $this->assertSame(2, $target->decisions()->count());
        $this->assertSame(2, $session->events()->count());

        try {
            $migration->down();
            $migration->up();
            $this->fail('A recorded reversal must prevent rollback.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('after a reversal has been recorded', $exception->getMessage());
        }
    }

    public function test_concurrent_correction_uploads_from_distinct_actors_cannot_create_a_fourth_slot(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        Carbon::setTestNow($today->setTime(16, 10));
        $request = $this->correctionRequest($fixture, $session, $today->setTime(8, 1), $today->setTime(16, 0), 'Koreksi dengan bukti.');
        $evidence = app(CorrectionEvidenceService::class);
        for ($i = 0; $i < 2; $i++) {
            $evidence->upload($fixture['membership'], $fixture['employeeUser'], (int) $request->getKey(),
                UploadedFile::fake()->image('evidence.png', 10, 10), (string) Str::uuid(), null, null);
        }

        $results = $this->runConcurrent($fixture, [
            $this->worker('evidence_upload', $fixture['owner'], $fixture['ownerUser'], $request),
            $this->worker('evidence_upload', $fixture['membership'], $fixture['employeeUser'], $request),
        ], lock: fn () => ApprovalRequest::query()->whereKey($request->getKey())->lockForUpdate()->first());
        $this->assertEqualsCanonicalizing(['uploaded', 'conflict'], array_column($results, 'outcome'));
        $this->assertSame([1, 2, 3], DB::table('correction_evidence')->orderBy('slot')->pluck('slot')->all());
        $this->assertSame(3, DB::table('correction_evidence_audit')->where('action', 'uploaded')->count());
    }

    public function test_correction_expiry_and_hold_request_compete_for_the_same_file_lock(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, true);
        Carbon::setTestNow($today->setTime(16, 10));
        $request = $this->correctionRequest($fixture, $session, $today->setTime(8, 1), $today->setTime(16, 0), 'Koreksi dengan bukti.');
        $uploaded = app(CorrectionEvidenceService::class)->upload(
            $fixture['membership'], $fixture['employeeUser'], (int) $request->getKey(),
            UploadedFile::fake()->image('hold.png', 10, 10), (string) Str::uuid(), null, null,
        );
        $row = DB::table('correction_evidence')->find($uploaded['id']);
        $hold = $this->worker('evidence_hold', $fixture['owner'], $fixture['ownerUser'], $request, (string) $row->id);
        $expiry = $this->worker('evidence_expire', $fixture['owner'], $fixture['ownerUser'], $request);
        $hold['test_now'] = $expiry['test_now'] = CarbonImmutable::parse($row->expires_at, 'UTC')->toIso8601String();

        $results = $this->runConcurrent($fixture, [$hold, $expiry],
            lock: fn () => DB::table('correction_evidence')->where('id', $row->id)->lockForUpdate()->first());
        $actions = DB::table('correction_evidence_audit')->where('evidence_id', $row->id)->pluck('action')->all();
        if ($results[0]['outcome'] === 'held') {
            $this->assertSame('protected', $results[1]['outcome']);
            $this->assertContains('hold_requested', $actions);
            $this->assertNotContains('expired', $actions);
            Storage::disk('local')->assertExists($row->storage_path);
        } else {
            $this->assertSame(['conflict', 'expired'], array_column($results, 'outcome'));
            $this->assertNotContains('hold_requested', $actions);
            $this->assertContains('expired', $actions);
            Storage::disk('local')->assertMissing($row->storage_path);
        }
    }

    public function test_real_checkout_racing_with_admin_resolution_never_creates_two_closures(): void
    {
        $today = CarbonImmutable::today('UTC');
        Carbon::setTestNow($today->setTime(8, 0));
        $fixture = $this->fixture();
        $session = $this->recordSession($fixture, false);
        Carbon::setTestNow($today->setTime(12, 0));
        $request = $this->correctionRequest($fixture, $session, $session->check_in_at->utc(), $today->setTime(11, 0), 'Checkout administrasi diminta.');
        $results = $this->runConcurrent($fixture, [
            $this->worker('decide', $fixture['owner'], $fixture['ownerUser'], $request, 'approved', 'Waktu dikonfirmasi.'),
            $this->worker('check_out', $fixture['membership'], $fixture['employeeUser']),
        ]);

        $session->refresh();
        $this->assertSame(0, DB::table('attendance_active_session_owners')->where('employee_id', $fixture['employee']->getKey())->count());
        $physicalCheckoutCount = AttendanceEvent::query()->where('attendance_session_id', $session->getKey())->where('event_type', 'check_out')->count();
        $this->assertLessThanOrEqual(1, $physicalCheckoutCount);

        if ($physicalCheckoutCount === 1) {
            $this->assertSame('closed', $session->status);
            $this->assertSame('pending', $request->fresh()->status);
            $this->assertSame('conflict', collect($results)->firstWhere('outcome', 'conflict')['outcome']);
        } else {
            $this->assertSame('administratively_resolved', $session->status);
            $this->assertSame('approved', $request->fresh()->status);
            $this->assertSame(1, DB::table('approval_decisions')->where('approval_request_id', $request->getKey())->count());
            $this->assertContains(409, array_column($results, 'http_status'));
        }
    }

    private function fixture(): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('S5 concurrency tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'S5 concurrency outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan S5 concurrency');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion(
            $owner, $outlet, CarbonImmutable::today('UTC')->toDateString(), [
                'attendance_mode' => 'hybrid',
                'personal_location_validation' => [
                    'required' => true, 'radius_meters' => 100, 'latitude' => -6.2, 'longitude' => 106.816666,
                ],
            ], 'S5 concurrency fixture',
        );

        return compact('ownerUser', 'tenant', 'owner', 'outlet', 'employeeUser', 'membership', 'employee');
    }

    private function leaveRequest(array $fixture, string $date, string $reason): ApprovalRequest
    {
        return app(ApprovalWorkflowService::class)->submitEmployeeRequest(
            $fixture['membership'], $fixture['employeeUser'], [
                'type' => 'leave', 'category' => 'permission', 'starts_on' => $date,
                'ends_on' => $date, 'reason' => $reason,
            ], (string) Str::uuid(),
        );
    }

    private function correctionRequest(array $fixture, AttendanceSession $session, CarbonImmutable $checkIn, CarbonImmutable $checkOut, string $reason): ApprovalRequest
    {
        return app(ApprovalWorkflowService::class)->submitEmployeeRequest(
            $fixture['membership'], $fixture['employeeUser'], [
                'type' => 'attendance_correction',
                'attendance_session_id' => (int) $session->getKey(),
                'effective_check_in_at' => $checkIn->toIso8601String(),
                'effective_check_out_at' => $checkOut->toIso8601String(),
                'reason' => $reason,
            ], (string) Str::uuid(),
        );
    }

    private function recordSession(array $fixture, bool $closed): AttendanceSession
    {
        $actor = AttendanceActor::personal($fixture['membership']);
        $checkIn = app(AttendanceService::class)->checkIn(
            $actor, $fixture['employee'], $fixture['outlet'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $this->assertSame(201, $checkIn['status']);
        $session = AttendanceSession::query()->findOrFail($checkIn['body']['session']['id']);

        if ($closed) {
            Carbon::setTestNow($session->check_in_at->utc()->addHours(8));
            $checkOut = app(AttendanceService::class)->checkOut(
                $actor, $fixture['employee'], (string) Str::uuid(),
                ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
            );
            $this->assertSame(200, $checkOut['status']);
            $session->refresh();
        }

        return $session;
    }

    /** @return array<string, mixed> */
    private function worker(
        string $operation,
        TenantMembership $membership,
        User $user,
        ?ApprovalRequest $request = null,
        ?string $decision = null,
        string $reason = 'Keputusan uji.',
        ?string $key = null,
    ): array {
        return [
            'operation' => $operation,
            'membership_id' => (int) $membership->getKey(),
            'user_id' => (int) $user->getKey(),
            'request_id' => $request ? (int) $request->getKey() : 0,
            'decision' => $decision ?? '',
            'reason' => $reason,
            'key' => $key ?? (string) Str::uuid(),
        ];
    }

    /** @return array{user: User, membership: TenantMembership} */
    private function independentOwner(array $fixture): array
    {
        [$user, $membership] = $this->membershipFor($fixture['owner'], TenantRole::Owner);

        return compact('user', 'membership');
    }

    /** @param list<array<string, mixed>> $specifications
     * @return list<array<string, mixed>>
     */
    private function runConcurrent(array $fixture, array $specifications, ?callable $lock = null): array
    {
        $directory = sys_get_temp_dir().'/hadirinaja-s5-'.Str::uuid();
        mkdir($directory, 0700, true);
        $this->temporaryDirectories[] = $directory;
        $startPath = $directory.'/start';
        $processes = [];

        try {
            foreach ($specifications as $index => $specification) {
                $readyPath = $directory.'/ready-'.$index;
                $attemptPath = $directory.'/attempt-'.$index;
                $resultPath = $directory.'/result-'.$index;
                $environment = $this->disposableDatabaseWorkerEnvironment() + [
                    'S5_READY_FILE' => $readyPath,
                    'S5_START_FILE' => $startPath,
                    'S5_ATTEMPT_FILE' => $attemptPath,
                    'S5_RESULT_FILE' => $resultPath,
                    'S5_TENANT_ID' => (string) $fixture['tenant']->getKey(),
                    'S5_EMPLOYEE_ID' => (string) $fixture['employee']->getKey(),
                    'S5_MEMBERSHIP_ID' => (string) $specification['membership_id'],
                    'S5_USER_ID' => (string) $specification['user_id'],
                    'S5_REQUEST_ID' => (string) $specification['request_id'],
                    'S5_DECISION' => (string) $specification['decision'],
                    'S5_REASON' => (string) $specification['reason'],
                    'S5_IDEMPOTENCY_KEY' => (string) $specification['key'],
                    'S5_OPERATION' => (string) $specification['operation'],
                    'S5_TEST_NOW' => $specification['test_now'] ?? '',
                ];
                $process = new Process(
                    [PHP_BINARY, base_path('tests/Support/approval-operation-worker.php')],
                    base_path(),
                    $environment,
                    null,
                    25,
                );
                $process->start();
                $processes[$index] = $process;
                $this->waitForFiles([$readyPath], $processes, $directory);
            }

            $connectionIds = array_map(
                fn (int $index): int => (int) json_decode(file_get_contents($directory.'/ready-'.$index), true, flags: JSON_THROW_ON_ERROR)['connection_id'],
                array_keys($specifications),
            );
            $this->assertCount(count($specifications), array_unique($connectionIds), 'Each child process must hold a distinct MySQL connection.');

            DB::beginTransaction();
            $locked = $lock === null
                ? Employee::query()->forTenant((int) $fixture['tenant']->getKey())->whereKey($fixture['employee']->getKey())->lockForUpdate()->first()
                : $lock();
            $this->assertNotNull($locked);
            file_put_contents($startPath, 'release');
            $attemptPaths = array_map(fn (int $index): string => $directory.'/attempt-'.$index, array_keys($specifications));
            $this->waitForFiles($attemptPaths, $processes, $directory);
            usleep(200_000);
            foreach ($processes as $index => $process) {
                $this->assertTrue($process->isRunning(), "Worker $index should wait on the parent-held row lock.");
                $this->assertFileDoesNotExist($directory.'/result-'.$index);
            }
            DB::commit();

            foreach ($processes as $index => $process) {
                $process->wait();
                $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput().$process->getOutput());
                $this->assertFileExists($directory.'/result-'.$index);
            }

            return array_map(
                fn (int $index): array => json_decode(file_get_contents($directory.'/result-'.$index), true, flags: JSON_THROW_ON_ERROR),
                array_keys($specifications),
            );
        } finally {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
            file_put_contents($startPath, 'release');
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop(1);
                }
            }
        }
    }

    /** @param list<string> $paths
     * @param  array<int, Process>  $processes
     */
    private function waitForFiles(array $paths, array $processes, string $directory): void
    {
        $deadline = microtime(true) + 20;
        while (microtime(true) < $deadline) {
            if (count(array_filter($paths, 'is_file')) === count($paths)) {
                return;
            }
            foreach ($processes as $index => $process) {
                if (! $process->isRunning() && $process->getExitCode() !== 0) {
                    $this->fail("Approval worker $index failed: ".$process->getErrorOutput().$process->getOutput());
                }
            }
            usleep(10_000);
        }
        $diagnostics = [];
        foreach ($processes as $index => $process) {
            $resultPath = $directory.'/result-'.$index;
            $diagnostics[] = [
                'worker' => $index,
                'running' => $process->isRunning(),
                'exit_code' => $process->getExitCode(),
                'result' => is_file($resultPath) ? file_get_contents($resultPath) : null,
            ];
        }
        $this->fail('Timed out waiting for independent MySQL approval workers: '.json_encode($diagnostics, JSON_THROW_ON_ERROR));
    }

    private function removeTree(string $path): void
    {
        if (! is_dir($path)) {
            if (is_file($path)) {
                unlink($path);
            }

            return;
        }
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($iterator as $item) {
            $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        }
        rmdir($path);
    }
}
