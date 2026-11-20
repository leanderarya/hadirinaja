<?php

namespace Tests\Feature\S1;

use App\Models\Employee;
use App\Services\OrganizationService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class PrimaryAssignmentConcurrencyTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseMigrations;

    public function test_two_concurrent_primary_changes_serialize_on_the_employee_row(): void
    {
        [, , $owner] = $this->tenantWithOwner('Concurrent tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Primary outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Concurrent employee');
        $directory = sys_get_temp_dir().'/hadirinaja-s1-'.Str::uuid();
        mkdir($directory, 0700, true);

        $startPath = $directory.'/start';
        $effectiveFrom = now()->addMinute()->toDateTimeString();
        $processes = [];

        try {
            DB::beginTransaction();
            $lockedEmployee = Employee::query()->whereKey($employee->getKey())->lockForUpdate()->first();
            $this->assertNotNull($lockedEmployee);

            foreach ([1, 2] as $worker) {
                $process = new Process(
                    [PHP_BINARY, base_path('tests/Support/primary-assignment-worker.php')],
                    base_path(),
                    [
                        ...$this->disposableDatabaseWorkerEnvironment(),
                        'S1_READY_FILE' => $directory."/ready-$worker",
                        'S1_START_FILE' => $startPath,
                        'S1_ATTEMPT_FILE' => $directory."/attempt-$worker",
                        'S1_RESULT_FILE' => $directory."/result-$worker",
                        'S1_MEMBERSHIP_ID' => (string) $owner->getKey(),
                        'S1_EMPLOYEE_ID' => (string) $employee->getKey(),
                        'S1_OUTLET_ID' => (string) $outlet->getKey(),
                        'S1_EFFECTIVE_FROM' => $effectiveFrom,
                    ],
                    null,
                    25,
                );
                $process->start();
                $processes[$worker] = $process;
            }

            $this->waitForFiles([$directory.'/ready-1', $directory.'/ready-2'], $processes);
            $workerIdentities = [
                json_decode(file_get_contents($directory.'/ready-1'), true, flags: JSON_THROW_ON_ERROR),
                json_decode(file_get_contents($directory.'/ready-2'), true, flags: JSON_THROW_ON_ERROR),
            ];
            foreach ($workerIdentities as $identity) {
                $this->assertSame(getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE'), $identity['database_name']);
                $this->assertSame(getenv('HADIRINAJA_TEST_DISPOSABLE_PORT'), $identity['port']);
                $this->assertSame(realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR')), $identity['data_directory']);
                $this->assertSame(realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET')), $identity['socket']);
                $this->assertSame(getenv('DB_USERNAME').'@127.0.0.1', $identity['account_name']);
            }
            $readyConnections = array_column($workerIdentities, 'connection_id');
            $this->assertCount(2, array_unique($readyConnections), 'Workers must use independent MySQL connections.');

            file_put_contents($startPath, 'start');
            $this->waitForFiles([$directory.'/attempt-1', $directory.'/attempt-2'], $processes);
            usleep(700_000);

            foreach ($processes as $worker => $process) {
                $this->assertTrue($process->isRunning(), "Worker $worker must remain blocked while the parent holds the employee lock.");
                $this->assertFileDoesNotExist($directory."/result-$worker");
            }

            DB::commit();

            foreach ($processes as $process) {
                $process->wait();
                $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
            }

            $results = [
                json_decode(file_get_contents($directory.'/result-1'), true, flags: JSON_THROW_ON_ERROR),
                json_decode(file_get_contents($directory.'/result-2'), true, flags: JSON_THROW_ON_ERROR),
            ];
            $this->assertEqualsCanonicalizing(['created', 'conflict'], array_column($results, 'status'));
            $this->assertGreaterThanOrEqual(500, min(array_column($results, 'elapsed_ms')));
            $this->assertSame(1, Employee::query()->findOrFail($employee->getKey())->assignments()
                ->where('assignment_type', 'primary')->where('effective_until', '9999-12-31 23:59:59')->count());
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

            foreach (glob($directory.'/*') ?: [] as $path) {
                unlink($path);
            }

            rmdir($directory);
        }
    }

    /** @param array<int, Process> $processes */
    private function waitForFiles(array $paths, array $processes): void
    {
        $deadline = microtime(true) + 12;

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

        $this->fail('Timed out waiting for concurrent assignment workers.');
    }
}
