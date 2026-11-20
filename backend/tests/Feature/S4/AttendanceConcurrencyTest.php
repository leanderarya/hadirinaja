<?php

namespace Tests\Feature\S4;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceEvidenceAuditEvent;
use App\Models\AttendanceEvent;
use App\Models\Employee;
use App\Models\KioskDevice;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeePinService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Closure;
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

class AttendanceConcurrencyTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseTruncation;

    /** @var list<string> */
    private array $temporaryFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->temporaryFiles as $path) {
            $this->removeTree($path);
        }

        // Keep committed worker fixtures out of subsequent RefreshDatabase tests.
        $this->truncateTablesForAllConnections();

        parent::tearDown();
    }

    public function test_two_independent_mysql_connections_cannot_create_two_active_sessions(): void
    {
        $fixture = $this->fixture();
        $results = $this->runConcurrent($fixture, [
            $this->worker('personal', 'check_in'),
            $this->worker('personal', 'check_in'),
        ]);

        $this->assertSame(2, count(array_unique(array_column($results, 'connection_id'))));
        $this->assertEqualsCanonicalizing([201, 409], array_column($results, 'status'));
        $this->assertSame(1, DB::table('attendance_sessions')->where('status', 'active')->count());
        $this->assertSame(1, DB::table('attendance_events')->where('event_type', 'check_in')->count());
        $this->assertSame(1, DB::table('attendance_active_session_owners')->count());
    }

    public function test_checkout_provenance_migration_round_trips_legacy_rows_and_protects_new_bindings(): void
    {
        $fixture = $this->fixture();
        $actor = AttendanceActor::personal($fixture['membership']);
        $attendance = app(AttendanceService::class);
        $location = ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10];
        $checkIn = $attendance->checkIn($actor, $fixture['employee'], $fixture['outlet'], (string) Str::uuid(), $location, null);
        $this->assertSame(201, $checkIn['status']);
        $sessionId = $checkIn['body']['session']['id'];
        $migration = require base_path('database/migrations/2026_11_05_000001_add_checkout_provenance.php');
        $verifiedMigration = require base_path('database/migrations/2026_11_05_000002_enable_verified_personal_checkout_contract.php');
        $kioskMigration = require base_path('database/migrations/2026_11_05_000003_enable_verified_kiosk_checkout_contract.php');

        $kioskMigration->down();
        $verifiedMigration->down();
        $migration->down();
        $this->assertFalse(Schema::hasColumn('attendance_events', 'checkout_outlet_id'));
        $this->assertFalse(Schema::hasColumn('attendance_idempotency_records', 'contract_version'));
        $this->assertDatabaseHas('attendance_active_session_owners', ['attendance_session_id' => $sessionId]);
        $migration->up();
        $verifiedMigration->up();
        $kioskMigration->up();

        $this->assertDatabaseHas('attendance_events', [
            'id' => $checkIn['body']['event']['id'], 'attendance_session_id' => $sessionId,
            'outlet_id' => $fixture['outlet']->getKey(), 'checkout_outlet_id' => null, 'checkout_context' => null,
        ]);
        $this->assertDatabaseHas('attendance_idempotency_records', [
            'operation' => 'check_in', 'contract_version' => 1, 'checkout_outlet_id' => null,
        ]);
        $checkout = $attendance->checkOut($actor, $fixture['employee'], (string) Str::uuid(), $location, null);
        $this->assertSame(200, $checkout['status']);

        try {
            $migration->down();
            $this->fail('Expected rollback to protect recorded checkout bindings.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('would discard recorded bindings', $exception->getMessage());
        }
        $this->assertDatabaseHas('attendance_events', [
            'id' => $checkout['body']['event']['id'], 'checkout_outlet_id' => $fixture['outlet']->getKey(),
        ]);
    }

    public function test_two_independent_mysql_checkouts_close_once_and_release_the_active_owner(): void
    {
        $fixture = $this->fixture();
        $actor = AttendanceActor::personal($fixture['membership']);
        $created = app(AttendanceService::class)->checkIn(
            $actor,
            $fixture['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10],
            null,
        );
        $this->assertSame(201, $created['status']);

        $results = $this->runConcurrent($fixture, [
            $this->worker('personal', 'check_out'),
            $this->worker('personal', 'check_out'),
        ]);

        $this->assertEqualsCanonicalizing([200, 409], array_column($results, 'status'));
        $this->assertSame(1, DB::table('attendance_sessions')->where('status', 'closed')->count());
        $this->assertSame(1, DB::table('attendance_events')->where('event_type', 'check_out')->count());
        $this->assertSame(0, DB::table('attendance_active_session_owners')->count());

        $next = app(AttendanceService::class)->checkIn(
            $actor,
            $fixture['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10],
            null,
        );
        $this->assertSame(201, $next['status']);
        $this->assertSame(1, DB::table('attendance_active_session_owners')->count());
    }

    public function test_two_verified_personal_checkouts_close_the_original_session_once(): void
    {
        [$fixture, $checkout, $assignment] = $this->verifiedCheckoutFixture();
        $results = $this->runConcurrent($fixture, [$checkout, [...$checkout, 'key' => (string) Str::uuid()]]);
        $this->assertEqualsCanonicalizing([200, 409], array_column($results, 'status'));
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseHas('attendance_events', [
            'event_type' => 'check_out', 'attendance_session_id' => $checkout['checkout_session_id'],
            'outlet_id' => $fixture['outlet']->getKey(), 'checkout_outlet_id' => $assignment->outlet_id,
            'location_verdict' => 'verified',
        ]);

        $migration = require base_path('database/migrations/2026_11_05_000002_enable_verified_personal_checkout_contract.php');
        $this->expectExceptionMessage('Verified checkout rollback would discard recovery contracts');
        $migration->down();
    }

    public function test_verified_checkout_rechecks_origin_assignment_after_waiting_for_employee_lock(): void
    {
        [$fixture, $checkout, $assignment] = $this->verifiedCheckoutFixture();
        [$result] = $this->runConcurrent($fixture, [$checkout], fn () => $assignment
            ->forceFill(['effective_until' => now()])->save());

        $this->assertSame(403, $result['status']);
        $this->assertSame('outlet_assignment_required', $result['body']['code']);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertDatabaseHas('attendance_active_session_owners', ['attendance_session_id' => $checkout['checkout_session_id']]);
    }

    public function test_two_kiosk_checkouts_cannot_close_the_cross_outlet_session_twice(): void
    {
        [$fixture, $checkout, $assignment] = $this->verifiedCheckoutFixture(kiosk: true);
        $results = $this->runConcurrent($fixture, [$checkout, [...$checkout, 'key' => (string) Str::uuid()]]);
        $this->assertEqualsCanonicalizing([200, 409], array_column($results, 'status'));
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseCount('attendance_evidence', 1);
        $this->assertDatabaseHas('attendance_events', [
            'event_type' => 'check_out', 'attendance_session_id' => $checkout['checkout_session_id'],
            'outlet_id' => $fixture['outlet']->getKey(), 'checkout_outlet_id' => $assignment->outlet_id,
            'authenticated_kiosk_outlet_id' => $assignment->outlet_id,
            'kiosk_device_id' => $checkout['device_id'], 'location_verdict' => 'verified',
        ]);

        $migration = require base_path('database/migrations/2026_11_05_000003_enable_verified_kiosk_checkout_contract.php');
        $this->expectExceptionMessage('Verified checkout rollback would discard recovery contracts');
        $migration->down();
    }

    public function test_kiosk_checkout_rejects_origin_assignment_revoked_while_waiting_for_employee_lock(): void
    {
        [$fixture, $checkout, $assignment] = $this->verifiedCheckoutFixture(kiosk: true);
        [$result] = $this->runConcurrent($fixture, [$checkout], fn () => $assignment
            ->forceFill(['effective_until' => now()])->save());
        $this->assertSame(403, $result['status']);
        $this->assertSame('outlet_assignment_required', $result['body']['code']);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertDatabaseHas('attendance_active_session_owners', ['attendance_session_id' => $checkout['checkout_session_id']]);
    }

    private function verifiedCheckoutFixture(bool $kiosk = false): array
    {
        $fixture = $this->fixture();
        $assignment = $fixture['employee']->assignments()->firstOrFail();
        $result = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], $fixture['outlet'],
            (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10], null,
        );
        $this->assertSame(201, $result['status']);

        $operation = $kiosk
            ? $this->worker('kiosk', 'check_out', deviceId: (int) $this->kioskDevice($fixture)->getKey())
            : [...$this->worker('personal', 'check_out'), 'checkout_outlet_id' => $fixture['outlet']->getKey()];

        return [$fixture, [
            ...$operation,
            'checkout_session_id' => $result['body']['session']['id'],
        ], $assignment];
    }

    public function test_concurrent_retries_with_one_idempotency_key_return_one_committed_event(): void
    {
        $fixture = $this->fixture();
        $sharedKey = (string) Str::uuid();
        $results = $this->runConcurrent($fixture, [
            $this->worker('personal', 'check_in', $sharedKey),
            $this->worker('personal', 'check_in', $sharedKey),
        ]);

        $this->assertSame([201, 201], array_column($results, 'status'));
        $this->assertSame(
            $results[0]['body']['event']['id'],
            $results[1]['body']['event']['id'],
        );
        $this->assertSame(1, DB::table('attendance_sessions')->count());
        $this->assertSame(1, DB::table('attendance_events')->count());
        $this->assertSame(1, DB::table('attendance_idempotency_records')->count());
    }

    public function test_concurrent_personal_photo_retries_with_one_key_create_one_evidence_record(): void
    {
        $fixture = $this->fixture();
        $sharedKey = (string) Str::uuid();
        $results = $this->runConcurrent($fixture, [
            $this->worker('personal', 'check_in', $sharedKey, withPhoto: true),
            $this->worker('personal', 'check_in', $sharedKey, withPhoto: true),
        ]);

        $this->assertSame([201, 201], array_column($results, 'status'));
        $this->assertSame($results[0]['body']['event']['id'], $results[1]['body']['event']['id']);
        $this->assertSame(1, DB::table('attendance_sessions')->count());
        $this->assertSame(1, DB::table('attendance_events')->count());
        $this->assertSame(1, DB::table('attendance_evidence')->count());
        $this->assertSame(1, DB::table('attendance_idempotency_records')->count());
    }

    public function test_independent_expiration_workers_do_not_double_process_an_evidence_row(): void
    {
        $fixture = $this->fixture();
        config(['attendance_evidence.deletion_enabled' => true]);
        $directory = sys_get_temp_dir().'/hadirinaja-s5-'.Str::uuid();
        mkdir($directory, 0700, true);
        $this->temporaryFiles[] = $directory;
        $evidenceRoot = $directory.'/private';
        mkdir($evidenceRoot, 0700, true);
        config(['filesystems.disks.local.root' => $evidenceRoot]);
        Storage::forgetDisk('local');

        $photoPath = $this->createPhoto($directory.'/camera.jpg');
        $result = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']),
            $fixture['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10],
            new UploadedFile($photoPath, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true),
        );
        $event = AttendanceEvent::query()->whereKey($result['body']['event']['id'])->firstOrFail();
        $evidence = AttendanceEvidence::query()->where('attendance_event_id', $event->getKey())->firstOrFail();
        $recordedAt = CarbonImmutable::now('UTC')->subDays(91);
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);

        $startPath = $directory.'/start';
        $processes = [];
        foreach ([0, 1] as $index) {
            $processes[] = new Process(
                [PHP_BINARY, base_path('tests/Support/evidence-expiration-worker.php')],
                base_path(),
                $this->disposableDatabaseWorkerEnvironment() + [
                    'ATTENDANCE_EVIDENCE_DELETION_ENABLED' => 'true',
                    'S5_EVIDENCE_ROOT' => $evidenceRoot,
                    'S5_READY_FILE' => $directory.'/ready-'.$index,
                    'S5_START_FILE' => $startPath,
                    'S5_RESULT_FILE' => $directory.'/result-'.$index,
                    'S5_NOW' => CarbonImmutable::now('UTC')->format(DATE_ATOM),
                ],
                null,
                25,
            );
        }
        foreach ($processes as $process) {
            $process->start();
        }
        $this->waitForFiles([$directory.'/ready-0', $directory.'/ready-1'], $processes);
        file_put_contents($startPath, 'release');
        foreach ($processes as $process) {
            $process->wait();
            $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput().$process->getOutput());
        }
        $results = array_map(
            static fn (int $index): array => json_decode((string) file_get_contents($directory.'/result-'.$index), true, flags: JSON_THROW_ON_ERROR),
            [0, 1],
        );

        $this->assertCount(2, array_unique(array_column($results, 'connection_id')));
        $this->assertSame(1, array_sum(array_column(array_column($results, 'summary'), 'deleted')));
        $this->assertSame('expired', $evidence->fresh()->lifecycle_state);
        $this->assertSame(1, AttendanceEvidenceAuditEvent::query()
            ->where('attendance_evidence_id', $evidence->getKey())->where('action', 'deletion')->where('outcome', 'success')->count());
    }

    public function test_personal_and_kiosk_checkins_racing_share_the_same_active_session_invariant(): void
    {
        $fixture = $this->fixture();
        $device = $this->kioskDevice($fixture);
        $results = $this->runConcurrent($fixture, [
            $this->worker('personal', 'check_in'),
            $this->worker('kiosk', 'check_in', deviceId: (int) $device->getKey()),
        ]);

        $this->assertSame(2, count(array_unique(array_column($results, 'connection_id'))));
        $this->assertEqualsCanonicalizing([201, 409], array_column($results, 'status'));
        $this->assertSame(1, DB::table('attendance_sessions')->count());
        $this->assertSame(1, DB::table('attendance_events')->count());
        $this->assertSame(1, DB::table('attendance_active_session_owners')->count());
        $this->assertSame(1, DB::table('attendance_idempotency_records')->where('status', 'completed')->count());
        $this->assertSame(1, DB::table('attendance_idempotency_records')->where('status', 'rejected')->count());

        if (DB::table('attendance_events')->where('origin', 'kiosk')->exists()) {
            $this->assertSame(1, DB::table('attendance_evidence')->count());
        } else {
            $this->assertSame(0, DB::table('attendance_evidence')->count());
        }
    }

    /** @return array<string, mixed> */
    private function fixture(): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Attendance concurrency tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Concurrency outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Concurrent employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion(
            $owner,
            $outlet,
            CarbonImmutable::today('UTC')->toDateString(),
            [
                'attendance_mode' => 'hybrid',
                'personal_location_validation' => [
                    'required' => true,
                    'radius_meters' => 100,
                    'latitude' => -6.2,
                    'longitude' => 106.816666,
                ],
            ],
            'S4 concurrency fixture',
        );

        return compact('ownerUser', 'tenant', 'owner', 'outlet', 'employeeUser', 'membership', 'employee');
    }

    private function kioskDevice(array $fixture): KioskDevice
    {
        $pairings = app(KioskPairingService::class);
        $paired = $pairings->redeemPairingCode(
            $pairings->issuePairingCode($fixture['owner'], $fixture['outlet'], 'Concurrency kiosk')['code'],
        );
        $pins = app(EmployeePinService::class);
        $pins->redeemEnrollmentCode(
            $paired['device'],
            $pins->issueEnrollmentCode($fixture['owner'], $fixture['employee'], $fixture['outlet'])['code'],
            '123456',
        );

        return $paired['device'];
    }

    /** @return array<string, mixed> */
    private function worker(
        string $origin,
        string $operation,
        ?string $key = null,
        ?int $deviceId = null,
        bool $withPhoto = false,
    ): array {
        return [
            'origin' => $origin,
            'operation' => $operation,
            'key' => $key ?? (string) Str::uuid(),
            'device_id' => $deviceId,
            'with_photo' => $withPhoto,
        ];
    }

    /** @param list<array<string, mixed>> $specifications
     * @return list<array<string, mixed>>
     */
    private function runConcurrent(array $fixture, array $specifications, ?Closure $whileLocked = null): array
    {
        $directory = sys_get_temp_dir().'/hadirinaja-s4-'.Str::uuid();
        mkdir($directory, 0700, true);
        $this->temporaryFiles[] = $directory;
        $startPath = $directory.'/start';
        $photoPath = $this->createPhoto($directory.'/kiosk-camera.jpg');
        $evidenceRoot = $directory.'/private';
        $processes = [];

        try {
            foreach ($specifications as $index => $specification) {
                $readyFile = $directory.'/ready-'.$index;
                $attemptFile = $directory.'/attempt-'.$index;
                $resultFile = $directory.'/result-'.$index;
                $environment = $this->disposableDatabaseWorkerEnvironment() + [
                    'S4_EVIDENCE_ROOT' => $evidenceRoot,
                    'S4_READY_FILE' => $readyFile,
                    'S4_STAGE_FILE' => $directory.'/stage-'.$index,
                    'S4_START_FILE' => $startPath,
                    'S4_ATTEMPT_FILE' => $attemptFile,
                    'S4_RESULT_FILE' => $resultFile,
                    'S4_TENANT_ID' => (string) $fixture['tenant']->getKey(),
                    'S4_EMPLOYEE_ID' => (string) $fixture['employee']->getKey(),
                    'S4_OUTLET_ID' => (string) $fixture['outlet']->getKey(),
                    'S4_CHECKOUT_OUTLET_ID' => (string) ($specification['checkout_outlet_id'] ?? 0),
                    'S4_CHECKOUT_SESSION_ID' => (string) ($specification['checkout_session_id'] ?? 0),
                    'S4_MEMBERSHIP_ID' => (string) $fixture['membership']->getKey(),
                    'S4_DEVICE_ID' => (string) ($specification['device_id'] ?? 0),
                    'S4_ORIGIN' => (string) $specification['origin'],
                    'S4_OPERATION' => (string) $specification['operation'],
                    'S4_IDEMPOTENCY_KEY' => (string) $specification['key'],
                    'S4_PHOTO_PATH' => $photoPath,
                    'S4_WITH_PHOTO' => ($specification['with_photo'] ?? false) ? '1' : '0',
                ];
                $process = new Process(
                    [PHP_BINARY, base_path('tests/Support/attendance-operation-worker.php')],
                    base_path(),
                    $environment,
                    null,
                    25,
                );
                $process->start();
                $processes[$index] = $process;
                $this->waitForFiles([$readyFile], [$process]);
            }

            $connectionIds = [];
            foreach (array_keys($specifications) as $index) {
                $ready = json_decode(file_get_contents($directory.'/ready-'.$index), true, flags: JSON_THROW_ON_ERROR);
                $connectionIds[] = (int) $ready['connection_id'];
            }
            $this->assertCount(count($specifications), array_unique($connectionIds), 'Each child process must hold a distinct MySQL connection.');

            DB::beginTransaction();
            $locked = Employee::query()->forTenant((int) $fixture['tenant']->getKey())
                ->whereKey($fixture['employee']->getKey())->lockForUpdate()->first();
            $this->assertNotNull($locked);

            file_put_contents($startPath, 'release');
            $attemptPaths = array_map(fn (int $index): string => $directory.'/attempt-'.$index, array_keys($specifications));
            $this->waitForFiles($attemptPaths, $processes);
            usleep(200_000);
            foreach ($processes as $index => $process) {
                $this->assertTrue($process->isRunning(), "Worker $index should be waiting for the held employee lock.");
                $this->assertFileDoesNotExist($directory.'/result-'.$index);
            }

            $whileLocked?->__invoke();
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
    private function waitForFiles(array $paths, array $processes): void
    {
        $deadline = microtime(true) + 15;
        while (microtime(true) < $deadline) {
            if (count(array_filter($paths, 'is_file')) === count($paths)) {
                return;
            }
            foreach ($processes as $process) {
                if (! $process->isRunning() && $process->getExitCode() !== 0) {
                    $this->fail($process->getErrorOutput().$process->getOutput());
                }
            }
            usleep(10_000);
        }
        $diagnostics = [];
        foreach ($processes as $index => $process) {
            $stagePath = dirname($paths[0]).'/stage-'.$index;
            $diagnostics[] = [
                'worker' => $index,
                'running' => $process->isRunning(),
                'exit_code' => $process->getExitCode(),
                'stage' => is_file($stagePath) ? file_get_contents($stagePath) : null,
            ];
        }
        $this->fail('Timed out waiting for independent MySQL attendance workers: '.json_encode($diagnostics, JSON_THROW_ON_ERROR));
    }

    private function createPhoto(string $path): string
    {
        $image = imagecreatetruecolor(640, 480);
        for ($y = 0; $y < 480; $y += 6) {
            for ($x = 0; $x < 640; $x += 6) {
                $value = ($x * 17 + $y * 29 + 13) & 0xFF;
                $color = imagecolorallocate($image, $value, ($value * 3) & 0xFF, ($value * 7) & 0xFF);
                imagefilledrectangle($image, $x, $y, $x + 5, $y + 5, $color);
            }
        }
        imagejpeg($image, $path, 85);
        imagedestroy($image);

        return $path;
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
