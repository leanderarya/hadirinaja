<?php

namespace Tests\Feature\S3;

use App\Models\Employee;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class WeeklyScheduleConcurrencyTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseMigrations;

    public static function operations(): array
    {
        return ['weekly rules' => ['weekly'], 'weekly and exception' => ['mixed'], 'exceptions' => ['exceptions']];
    }

    #[DataProvider('operations')]
    public function test_concurrent_conflicting_weekly_rules_serialize_on_employee_row(string $mode): void
    {
        [, , $owner] = $this->tenantWithOwner('Concurrent scheduling tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Concurrent outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Concurrent employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $effectiveFrom = CarbonImmutable::today('UTC')->addDay();
        $shift = app(ShiftTemplateService::class)->create(
            $owner, 'Concurrent shift', '20:00:00', '04:00:00', true,
            $effectiveFrom->toDateString(), 'Concurrency fixture',
        )->versions->first();
        $morning = app(ShiftTemplateService::class)->create($owner, 'Morning', '03:30', '09:00', false, $effectiveFrom->toDateString(), 'Concurrency fixture')->versions->first();
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
                        'DB_PORT' => '3306',
                        'DB_DATABASE' => 'hadirinaja_test',
                        'DB_URL' => '',
                        'S3_READY_FILE' => $directory."/ready-$worker",
                        'S3_START_FILE' => $startPath,
                        'S3_ATTEMPT_FILE' => $directory."/attempt-$worker",
                        'S3_RESULT_FILE' => $directory."/result-$worker",
                        'S3_MEMBERSHIP_ID' => (string) $owner->getKey(),
                        'S3_EMPLOYEE_ID' => (string) $employee->getKey(),
                        'S3_OUTLET_ID' => (string) $outlet->getKey(),
                        'S3_WEEKDAY' => (string) $effectiveFrom->isoWeekday(),
                        'S3_SHIFT_VERSION_ID' => (string) ($worker === 2 && $mode !== 'weekly' ? $morning->getKey() : $shift->getKey()),
                        'S3_OPERATION' => $mode === 'exceptions' || ($mode === 'mixed' && $worker === 2) ? 'exception' : 'weekly',
                        'S3_WORK_DATE' => ($worker === 2 && $mode !== 'weekly' ? $effectiveFrom->addDay() : $effectiveFrom)->toDateString(),
                        'S3_EFFECTIVE_FROM' => $effectiveFrom->toDateString(),
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
            $this->assertEqualsCanonicalizing(['created', 'conflict'], array_column($results, 'status'));
            $this->assertGreaterThanOrEqual(500, min(array_column($results, 'elapsed_ms')));
            $this->assertSame(1, DB::table('weekly_schedule_rules')->where('employee_id', $employee->getKey())->count()
                + DB::table('schedule_exceptions')->where('employee_id', $employee->getKey())->count());
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
