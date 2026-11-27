<?php

namespace Tests\Feature\S2;

use App\Models\KioskPairingCode;
use App\Services\KioskPairingService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class KioskPairingConcurrencyTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseMigrations;

    public function test_two_concurrent_pairing_redemptions_create_exactly_one_device(): void
    {
        [, , $owner] = $this->tenantWithOwner('Concurrent kiosk tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Shared outlet');
        $code = app(KioskPairingService::class)->issuePairingCode($owner, $outlet, 'Shared tablet')['code'];
        $hash = hash_hmac('sha256', $code, (string) config('app.key'));
        $pairing = KioskPairingCode::query()->where('code_hash', $hash)->firstOrFail();
        $directory = sys_get_temp_dir().'/hadirinaja-s2-'.Str::uuid();
        mkdir($directory, 0700, true);

        $startPath = $directory.'/start';
        $processes = [];

        try {
            DB::beginTransaction();
            KioskPairingCode::query()->whereKey($pairing->getKey())->lockForUpdate()->firstOrFail();

            foreach ([1, 2] as $worker) {
                $process = new Process(
                    [PHP_BINARY, base_path('tests/Support/kiosk-pairing-worker.php')],
                    base_path(),
                    [
                        'APP_ENV' => 'testing',
                        'DB_CONNECTION' => 'mysql',
                        'DB_HOST' => '127.0.0.1',
                        'DB_PORT' => (string) config('database.connections.mysql.port'),
                        'DB_DATABASE' => (string) config('database.connections.mysql.database'),
                        'DB_URL' => '',
                        'S2_READY_FILE' => $directory."/ready-$worker",
                        'S2_START_FILE' => $startPath,
                        'S2_ATTEMPT_FILE' => $directory."/attempt-$worker",
                        'S2_RESULT_FILE' => $directory."/result-$worker",
                        'S2_PAIR_CODE' => $code,
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
                $this->assertTrue($process->isRunning(), "Worker $worker must wait for the pairing row lock.");
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
            $this->assertEqualsCanonicalizing(['paired', 'rejected'], array_column($results, 'status'));
            $this->assertSame(1, DB::table('kiosk_devices')->where('tenant_id', $owner->tenant_id)->count());
            $this->assertNotNull($pairing->fresh()->redeemed_at);
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

        $this->fail('Timed out waiting for concurrent kiosk workers.');
    }
}
