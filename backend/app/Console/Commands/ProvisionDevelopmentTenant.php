<?php

namespace App\Console\Commands;

use App\Models\BusinessUnit;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\DevelopmentTenantProvisioner;
use App\Services\ManagementChangeRecorder;
use App\Services\OrganizationService;
use App\Support\SchedulingDefaults;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

final class ProvisionDevelopmentTenant extends Command
{
    private const OWNER_ID = 2;

    private const OWNER_NAME = 'Arya';

    private const CONFIRMATION = 'CREATE-OPERASIONAL-CEPAT-KOPI-TEH-POCI';

    /** @var list<string> */
    private const REQUIRED_TABLES = [
        'tenants',
        'tenant_memberships',
        'tenant_role_assignments',
        'tenant_attendance_policy_versions',
        'business_units',
        'outlets',
        'outlet_calendar_versions',
        'management_change_events',
    ];

    protected $signature = 'organization:provision-development
        {--execute-write : Enable the separately authorized development write path}
        {--owner-authorized : Assert that separate Owner authorization was obtained}
        {--confirmation= : Required confirmation phrase for write mode}';

    protected $description = 'Validate or provision the approved development organization; dry-run is the default.';

    public function handle(): int
    {
        try {
            $owner = $this->preflight();
        } catch (Throwable) {
            $this->error('Preflight stopped safely. No write was attempted; inspect local configuration and service availability.');

            return self::FAILURE;
        }

        if (! (bool) $this->option('execute-write')) {
            $this->displayPlan($owner);

            return self::SUCCESS;
        }

        if (app()->environment() !== 'local') {
            $this->error('Write mode is disabled outside the local application environment. No records were changed.');

            return self::FAILURE;
        }

        if (! (bool) $this->option('owner-authorized')) {
            $this->error('Separate Owner authorization is required. No records were changed.');

            return self::FAILURE;
        }

        if ((string) $this->option('confirmation') !== self::CONFIRMATION) {
            $this->error('Write mode requires the exact confirmation phrase. No records were changed.');

            return self::FAILURE;
        }

        if (! $this->confirm('Proceed with the previously authorized development provisioning?', false)) {
            $this->warn('Provisioning cancelled. No records were changed.');

            return self::SUCCESS;
        }

        try {
            $result = app(DevelopmentTenantProvisioner::class)->provision($owner);
        } catch (Throwable) {
            $this->error('Provisioning stopped. The result may be uncertain; inspect persisted state before retrying. No cleanup was attempted.');

            return self::FAILURE;
        }

        $this->info('Provisioning completed in one database transaction.');
        $this->line('Tenant ID: '.$result['tenant']->getKey());
        $this->line('Owner membership ID: '.$result['membership']->getKey());
        $this->line('Owner role assignment ID: '.$result['owner_role']->getKey());
        $this->line('Tenant policy version ID: '.$result['tenant_policy']->getKey());
        foreach ($result['business_units'] as $unit) {
            $this->line('Business Unit '.$unit->name.' ID: '.$unit->getKey());
        }
        foreach ($result['outlets'] as $outlet) {
            $this->line('Outlet '.$outlet->name.' ID: '.$outlet->getKey().' (Business Unit ID '.$outlet->business_unit_id.')');
        }
        $this->line('Outlet calendar version IDs: '.collect($result['calendars'])->pluck('id')->implode(', '));
        $this->line('Management change event IDs: '.collect($result['management_events'])->pluck('id')->implode(', '));

        return self::SUCCESS;
    }

    private function preflight(): User
    {
        if (! in_array(app()->environment(), ['local', 'testing'], true)) {
            throw new RuntimeException('The command is available only in local or isolated testing environments.');
        }

        $connectionName = (string) config('database.default');
        $connectionConfig = config("database.connections.{$connectionName}");
        $expectedDatabase = app()->environment() === 'local' ? 'hadirinaja_dev' : 'hadirinaja_test';
        if (
            $connectionName !== 'mysql'
            || ! is_array($connectionConfig)
            || ($connectionConfig['database'] ?? null) !== $expectedDatabase
            || ! in_array($connectionConfig['host'] ?? null, ['127.0.0.1', 'localhost', '::1'], true)
            || (string) ($connectionConfig['port'] ?? '') !== '3306'
            || filled($connectionConfig['url'] ?? null)
        ) {
            throw new RuntimeException('The effective connection is not the approved local MySQL target.');
        }

        $connection = DB::connection($connectionName);
        $database = $connection->getDatabaseName();
        if ($database !== $expectedDatabase) {
            throw new RuntimeException("The active database is not {$expectedDatabase}.");
        }

        $this->assertRequiredTablesAreInnoDb($database);
        $this->assertServiceContracts();
        $this->assertApprovedDefaults();

        $owner = User::query()->whereKey(self::OWNER_ID)->first();
        if (! $owner || $owner->name !== self::OWNER_NAME) {
            throw new RuntimeException('The approved existing Owner account is unavailable or does not match.');
        }

        $hasExistingOwnerMembership = TenantMembership::query()
            ->where('user_id', self::OWNER_ID)
            ->where('is_active', true)
            ->whereHas('roles', fn ($query) => $query->where('role', 'owner'))
            ->exists();
        if (! $hasExistingOwnerMembership) {
            throw new RuntimeException('User ID 2 no longer has an active Owner membership.');
        }

        $targetName = mb_strtolower(trim(DevelopmentTenantProvisioner::TENANT_NAME));
        $targetExists = Tenant::query()->get(['name'])->contains(
            fn (Tenant $tenant): bool => mb_strtolower(trim($tenant->name)) === $targetName,
        );
        if ($targetExists) {
            throw new RuntimeException('The target tenant already exists; inspect it before proceeding.');
        }

        return $owner;
    }

    private function assertRequiredTablesAreInnoDb(string $database): void
    {
        $tables = DB::select(
            'SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('.
            implode(',', array_fill(0, count(self::REQUIRED_TABLES), '?')).')',
            [$database, ...self::REQUIRED_TABLES],
        );
        $engines = collect($tables)->keyBy('TABLE_NAME');

        foreach (self::REQUIRED_TABLES as $table) {
            if (strtoupper((string) ($engines->get($table)->ENGINE ?? '')) !== 'INNODB') {
                throw new RuntimeException("Required table {$table} is missing or is not InnoDB.");
            }
        }
    }

    private function assertServiceContracts(): void
    {
        $contracts = [
            [OrganizationService::class, 'createTenant', [User::class, 'string']],
            [OrganizationService::class, 'createBusinessUnit', [TenantMembership::class, 'string']],
            [OrganizationService::class, 'createOutlet', [TenantMembership::class, BusinessUnit::class, 'string', '?string']],
            [ManagementChangeRecorder::class, 'record', [TenantMembership::class, 'string', 'int', 'string', 'array', '?int', '?int']],
            [DevelopmentTenantProvisioner::class, 'provision', [User::class]],
        ];

        foreach ($contracts as [$class, $method, $expectedTypes]) {
            $service = app($class);
            $actualTypes = array_map(static function (\ReflectionParameter $parameter): string {
                $type = $parameter->getType();
                if (! $type instanceof \ReflectionNamedType) {
                    return '';
                }

                return $type->allowsNull() && ! $type->isBuiltin()
                    ? '?'.$type->getName()
                    : ($type->allowsNull() && $parameter->isOptional() ? '?'.$type->getName() : $type->getName());
            }, (new \ReflectionMethod($service, $method))->getParameters());

            if ($actualTypes !== $expectedTypes) {
                throw new RuntimeException("The required service contract {$class}::{$method} has changed.");
            }
        }
    }

    private function assertApprovedDefaults(): void
    {
        $policy = SchedulingDefaults::attendancePolicy();
        $expectedPolicy = [
            'late_tolerance_minutes' => 5,
            'check_in_window' => ['early_minutes' => 60, 'late_minutes' => 60],
            'attendance_mode' => 'kiosk',
            'personal_location_validation' => ['required' => true, 'radius_meters' => 100],
            'retroactive_request_limit_days' => 7,
            'operational_review' => ['schedule_change_reason_required' => true, 'minimum_notice_hours' => 24],
        ];
        if ($policy !== $expectedPolicy
            || SchedulingDefaults::TIMEZONE !== 'Asia/Jakarta'
            || SchedulingDefaults::operatingWeekdays() !== [1, 2, 3, 4, 5, 6, 7]) {
            throw new RuntimeException('The approved tenant policy or Outlet calendar defaults have changed.');
        }
    }

    private function displayPlan(User $owner): void
    {
        $counts = [
            'tenants' => Tenant::query()->count(),
            'business_units' => DB::table('business_units')->count(),
            'outlets' => DB::table('outlets')->count(),
        ];
        $this->info('DRY RUN — no application records were written.');
        $this->line('Tenant: '.DevelopmentTenantProvisioner::TENANT_NAME);
        $this->line('Primary Owner: User ID '.self::OWNER_ID.' ('.$owner->name.')');
        $this->line('Business Units: Cepat Kopi (2 Outlets), Teh Poci (3 Outlets).');
        $this->line('Outlets: Cepat Kopi Karangawen; Cepat Kopi Kaliceret; Teh Poci Karangawen; Teh Poci Sugihmanik; Teh Poci Kaliceret.');
        $this->line('Current database counts: '.json_encode($counts, JSON_THROW_ON_ERROR));
        foreach (Tenant::query()->orderBy('id')->get(['id', 'name']) as $tenant) {
            $tenantId = (int) $tenant->getKey();
            $this->line(sprintf(
                'Existing tenant #%d %s: %d Business Units, %d Outlets.',
                $tenantId,
                $tenant->name,
                DB::table('business_units')->where('tenant_id', $tenantId)->count(),
                DB::table('outlets')->where('tenant_id', $tenantId)->count(),
            ));
        }
        $this->line('Expected automatic records: 1 tenant policy, 5 Outlet calendars, 7 management change events.');
        $this->line('No employees, assignments, attendance, kiosks, policy overrides, or shifts.');
    }
}
