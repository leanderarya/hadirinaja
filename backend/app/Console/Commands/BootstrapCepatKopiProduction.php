<?php

namespace App\Console\Commands;

use App\Services\CepatKopiProductionBootstrap;
use DomainException;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

final class BootstrapCepatKopiProduction extends Command
{
    private const CONFIRMATION = 'BOOTSTRAP-CEPAT-KOPI';

    protected $signature = 'organization:bootstrap-cepat-kopi
        {--csv= : CSV source path; defaults to HADIRINAJA_RUNTIME/cepat-kopi-people.csv}
        {--dry-run : Validate and report without writing (default)}
        {--execute : Execute the bootstrap after explicit authorization}
        {--owner-authorized : Assert separate Owner authorization for the write}
        {--confirmation= : Exact confirmation phrase required for the write}';

    protected $description = 'Dry-run or bootstrap the Cepat Kopi production master data from a local CSV.';

    public function handle(CepatKopiProductionBootstrap $bootstrap): int
    {
        try {
            $this->assertDatabaseTarget();
            $execute = (bool) $this->option('execute');
            if ($execute && (bool) $this->option('dry-run')) {
                throw new DomainException('Choose either --execute or --dry-run, not both.');
            }
            if ($execute) {
                $this->assertWriteAuthorization();
            }

            $csvPath = $this->csvPath();
            if ($csvPath === null) {
                throw new DomainException('Provide --csv or set HADIRINAJA_RUNTIME. No records were changed.');
            }
            $plan = $bootstrap->loadCsv($csvPath);
            $inspection = $bootstrap->inspect($plan);

            if (! $execute) {
                $this->info($inspection['action'] === 'no-op'
                    ? 'DRY RUN: existing bootstrap matches; no writes.'
                    : 'DRY RUN: no application records were written.');
                $this->displayReport($bootstrap->report($inspection['tenant_id'], $plan));

                return self::SUCCESS;
            }

            if ($inspection['action'] === 'no-op') {
                $result = $inspection + ['report' => $bootstrap->report((int) $inspection['tenant_id'], $plan)];
            } else {
                $result = $bootstrap->execute($plan, $this->ownerPassword());
            }

            $this->info($result['action'] === 'created'
                ? 'Cepat Kopi bootstrap committed and verified.'
                : 'Cepat Kopi bootstrap already matches; no writes were made.');
            $this->displayReport($result['report']);

            return self::SUCCESS;
        } catch (DomainException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        } catch (Throwable) {
            $this->error('Bootstrap stopped safely. No personal data or exception details were written to console output.');

            return self::FAILURE;
        }
    }

    private function assertDatabaseTarget(): void
    {
        $environment = app()->environment();
        if (! in_array($environment, ['testing', 'staging', 'production'], true)) {
            throw new DomainException('This command is available only in testing, staging, or production environments.');
        }

        $connectionName = (string) config('database.default');
        $connectionConfig = config("database.connections.{$connectionName}");
        if ($connectionName !== 'mysql' || ! is_array($connectionConfig) || filled($connectionConfig['url'] ?? null)) {
            throw new DomainException('The effective database connection is not an approved MySQL target.');
        }

        $connection = DB::connection($connectionName);
        if ($environment === 'testing') {
            $this->assertDisposableTestTarget($connectionConfig, $connection);

            return;
        }

        if ($connection->getDatabaseName() === 'hadirinaja_test') {
            throw new DomainException('Production bootstrap cannot target the named test database.');
        }
    }

    private function assertDisposableTestTarget(array $config, $connection): void
    {
        $port = (string) ($config['port'] ?? '');
        $expectedDataDirectory = getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR') ?: '';
        $expectedSocket = getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET') ?: '';

        if (getenv('HADIRINAJA_TEST_SCHEMA_PREPARED') !== '1'
            || $connection->getDatabaseName() !== 'hadirinaja_test'
            || ($config['host'] ?? null) !== '127.0.0.1'
            || $port === ''
            || $port !== (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT')
            || ! str_starts_with((string) ($config['username'] ?? ''), 'p2d_runner_')
            || $expectedDataDirectory === '' || $expectedSocket === '') {
            throw new DomainException('Testing mode requires the verified disposable MySQL runner.');
        }

        $identity = $connection->selectOne(
            'SELECT DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket',
        );
        if (
            $identity->database_name !== 'hadirinaja_test'
            || (string) $identity->port !== $port
            || realpath((string) $identity->data_directory) !== realpath($expectedDataDirectory)
            || realpath((string) $identity->socket) !== realpath($expectedSocket)
        ) {
            throw new DomainException('Testing mode is not connected to the verified disposable MySQL instance.');
        }
    }

    private function assertWriteAuthorization(): void
    {
        if (! (bool) $this->option('owner-authorized')) {
            throw new DomainException('Separate Owner authorization is required. No records were changed.');
        }
        if ((string) $this->option('confirmation') !== self::CONFIRMATION) {
            throw new DomainException('Write mode requires the exact --confirmation phrase. No records were changed.');
        }
    }

    private function csvPath(): ?string
    {
        $provided = trim((string) $this->option('csv'));
        if ($provided !== '') {
            return $provided;
        }

        $runtime = rtrim((string) getenv('HADIRINAJA_RUNTIME'), DIRECTORY_SEPARATOR);

        return $runtime === '' ? null : $runtime.DIRECTORY_SEPARATOR.'cepat-kopi-people.csv';
    }

    private function ownerPassword(): string
    {
        $password = (string) getenv('CEPAT_KOPI_OWNER_PASSWORD');
        if ($password === '') {
            $password = (string) $this->secret('Kata sandi Owner');
            $confirmation = (string) $this->secret('Ulangi kata sandi Owner');
            if (! hash_equals($password, $confirmation)) {
                throw new DomainException('Kata sandi Owner tidak cocok. No records were changed.');
            }
        }

        if (strlen($password) < 12 || strlen($password) > 72
            || preg_match('/[A-Za-z]/', $password) !== 1 || preg_match('/\d/', $password) !== 1) {
            throw new DomainException('Kata sandi Owner harus 12–72 byte dan memuat huruf serta angka. No records were changed.');
        }

        return $password;
    }

    private function displayReport(array $report): void
    {
        $this->line('Tanggal efektif: '.$report['effective_date'].' ('.$report['timezone'].')');
        $this->line('Hitungan: '.json_encode($report['counts'], JSON_THROW_ON_ERROR));

        foreach ($report['outlets'] as $name => $policy) {
            $this->line(sprintf(
                'Policy %s: effective_from=%s mode=%s grace=%sm photo=%s geofence=%s/%sm cutover=%s',
                $name,
                $policy['effective_from'] ?? 'unavailable',
                $policy['attendance_mode'] ?? 'unavailable',
                $policy['late_tolerance_minutes'] ?? 'unavailable',
                $policy['require_personal_photo'] ? 'required' : 'not-required',
                $policy['location_required'] ? 'required' : 'not-required',
                $policy['radius_meters'] ?? 'unavailable',
                $policy['weekly_planner_start_on'] ?? 'null',
            ));
        }

        $settings = $report['planner_settings'];
        $this->line(sprintf(
            'Planner: weekend_starts_on=%s profile=%s',
            $settings['weekend_starts_on'] === 5 ? 'Friday' : 'Saturday',
            $settings['custom'] ? 'cepat_kopi' : 'standard',
        ));
        foreach ($report['shift_versions'] as $key => $version) {
            $this->line(sprintf(
                'Shift %s: %s–%s version=%s',
                $key,
                substr($version['start_time'], 0, 5),
                substr($version['end_time'], 0, 5),
                $version['version_id'] ?? 'pending',
            ));
        }
        foreach ($report['staging_environment'] as $name => $value) {
            $this->line('Staging environment: '.$name.'='.$value);
        }
    }
}
