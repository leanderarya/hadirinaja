<?php

namespace Tests\Feature\S3;

use App\Models\Employee;
use App\Services\ShiftChangeService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsShiftChangeFixtures;
use Tests\TestCase;

class ShiftChangeConcurrencyTest extends TestCase
{
    use BuildsShiftChangeFixtures, DatabaseMigrations;

    public static function operations(): array
    {
        return ['same key' => [true], 'competing publications' => [false]];
    }

    #[DataProvider('operations')]
    public function test_acceptance_waits_for_employee_lock_and_publishes_once(bool $sameKey): void
    {
        $f = $this->shiftFixture();
        $owner = $f['members'][1];
        $employee = $f['people'][0];
        $requests = [];
        foreach ([1, 2] as $number) {
            $requests[$number] = app(ShiftChangeService::class)->create($f['members'][0], [
                'kind' => 'swap', 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][1]->id,
                'target_entry_id' => $f['rows'][1]->id, 'reason' => 'Concurrent QA swap',
            ], 'request-'.$number)['id'];
        }
        $directory = sys_get_temp_dir().'/hadirinaja-s3-'.Str::uuid();
        mkdir($directory, 0700, true);
        $startPath = $directory.'/start';
        $processes = [];

        try {
            DB::beginTransaction();
            $lockedEmployee = Employee::query()->whereKey($employee->getKey())->lockForUpdate()->first();
            $this->assertNotNull($lockedEmployee);

            foreach ([1, 2] as $worker) {
                $process = new Process(
                    [PHP_BINARY, base_path('tests/Support/scheduling-write-worker.php')],
                    base_path(),
                    [
                        'APP_ENV' => 'testing',
                        'DB_CONNECTION' => 'mysql',
                        'DB_HOST' => '127.0.0.1',
                        'DB_PORT' => (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT'),
                        'DB_DATABASE' => 'hadirinaja_test',
                        'DB_URL' => '',
                        'S3_READY_FILE' => $directory."/ready-$worker",
                        'S3_START_FILE' => $startPath,
                        'S3_ATTEMPT_FILE' => $directory."/attempt-$worker",
                        'S3_RESULT_FILE' => $directory."/result-$worker",
                        'S3_MEMBERSHIP_ID' => (string) $owner->getKey(),
                        'S3_EMPLOYEE_ID' => (string) $employee->getKey(),
                        'S3_OPERATION' => 'shift_change_accept',
                        'S3_REQUEST_ID' => (string) $requests[$sameKey ? 1 : $worker],
                    ],
                    null,
                    25,
                );
                $process->start();
                $processes[$worker] = $process;
            }

            $this->waitForFiles([$directory.'/ready-1', $directory.'/ready-2'], $processes);
            $connectionIds = [
                json_decode(file_get_contents($directory.'/ready-1'), true, flags: JSON_THROW_ON_ERROR)['connection_id'],
                json_decode(file_get_contents($directory.'/ready-2'), true, flags: JSON_THROW_ON_ERROR)['connection_id'],
            ];
            $this->assertCount(2, array_unique($connectionIds), 'Workers must use independent MySQL connections.');

            file_put_contents($startPath, 'start');
            $this->waitForFiles([$directory.'/attempt-1', $directory.'/attempt-2'], $processes);
            usleep(700_000);
            foreach ($processes as $worker => $process) {
                $this->assertTrue($process->isRunning(), "Worker $worker must wait for the employee row lock.");
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
            $this->assertEqualsCanonicalizing($sameKey ? ['created', 'created'] : ['created', 'conflict'], array_column($results, 'status'));
            $this->assertGreaterThanOrEqual(500, min(array_column($results, 'elapsed_ms')));
            $this->assertSame(2, DB::table('schedule_revisions')->whereNotNull('published_at')->count());
            $this->assertSame(2, DB::table('scheduling_operations')->count());
            $this->assertSame(1, DB::table('scheduling_change_events')->where('resource_type', 'shift_change_request')->where('action', 'accepted')->count());
            $this->assertSame(3, (int) DB::table('schedule_weeks')->value('lock_version'));
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
        $this->fail('Timed out waiting for concurrent weekly schedule workers.');
    }
}
