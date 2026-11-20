<?php

namespace Tests\Feature;

use App\Enums\TenantRole;
use App\Models\ManagementChangeEvent;
use App\Models\Tenant;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\DevelopmentTenantProvisioner;
use App\Services\ManagementChangeRecorder;
use App\Services\OrganizationService;
use App\Support\SchedulingDefaults;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class DevelopmentTenantProvisioningTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDatabaseName() === 'hadirinaja_dev'
            || DB::connection()->getDatabaseName() !== 'hadirinaja_test') {
            throw new RuntimeException('Provisioning tests require the isolated hadirinaja_test database.');
        }
    }

    public function test_provisioning_creates_the_exact_organization_and_preserves_existing_owner_memberships(): void
    {
        $owner = User::factory()->create();
        $existingTenant = app(OrganizationService::class)->createTenant($owner, 'Existing test tenant');
        $existingMembership = $existingTenant->memberships()->firstOrFail();
        $existingMembershipId = $existingMembership->getKey();
        $existingTenantId = $existingTenant->getKey();

        $result = app(DevelopmentTenantProvisioner::class)->provision($owner);
        $tenant = $result['tenant'];

        $this->assertSame(DevelopmentTenantProvisioner::TENANT_NAME, $tenant->name);
        $this->assertDatabaseCount('tenants', 2);
        $this->assertDatabaseCount('business_units', 2);
        $this->assertDatabaseCount('outlets', 5);
        $this->assertDatabaseCount('tenant_memberships', 2);
        $this->assertDatabaseCount('tenant_role_assignments', 2);
        $this->assertDatabaseCount('tenant_attendance_policy_versions', 2);
        $this->assertDatabaseCount('outlet_calendar_versions', 5);
        $this->assertDatabaseCount('management_change_events', 7);

        $this->assertDatabaseHas('tenant_memberships', [
            'id' => $result['membership']->getKey(),
            'tenant_id' => $tenant->getKey(),
            'user_id' => $owner->getKey(),
            'is_active' => true,
        ]);
        $this->assertDatabaseHas('tenant_role_assignments', [
            'id' => $result['owner_role']->getKey(),
            'tenant_id' => $tenant->getKey(),
            'tenant_membership_id' => $result['membership']->getKey(),
            'role' => TenantRole::Owner->value,
        ]);

        $units = collect($result['business_units'])->keyBy('name');
        $this->assertSame(['Cepat Kopi', 'Teh Poci'], $units->keys()->sort()->values()->all());
        $outlets = collect($result['outlets'])->keyBy('name');
        $this->assertSame(5, $outlets->pluck('id')->unique()->count());
        $this->assertSame(
            $units->get('Cepat Kopi')->getKey(),
            $outlets->get('Cepat Kopi Karangawen')->business_unit_id,
        );
        $this->assertSame(
            $units->get('Cepat Kopi')->getKey(),
            $outlets->get('Cepat Kopi Kaliceret')->business_unit_id,
        );
        $this->assertSame(
            $units->get('Teh Poci')->getKey(),
            $outlets->get('Teh Poci Karangawen')->business_unit_id,
        );
        $this->assertSame(
            $units->get('Teh Poci')->getKey(),
            $outlets->get('Teh Poci Sugihmanik')->business_unit_id,
        );
        $this->assertSame(
            $units->get('Teh Poci')->getKey(),
            $outlets->get('Teh Poci Kaliceret')->business_unit_id,
        );

        $policy = TenantAttendancePolicyVersion::query()->where('tenant_id', $tenant->getKey())->firstOrFail();
        $this->assertSame($tenant->created_at->toDateString(), $policy->effective_from->toDateString());
        $this->assertEquals(SchedulingDefaults::attendancePolicy(), $policy->configuration);
        $calendars = DB::table('outlet_calendar_versions as calendars')
            ->join('outlets', 'outlets.id', '=', 'calendars.outlet_id')
            ->where('calendars.tenant_id', $tenant->getKey())
            ->get([
                'calendars.timezone',
                'calendars.operating_weekdays',
                'calendars.actor_user_id',
                'calendars.effective_from',
                'outlets.created_at',
            ]);
        $this->assertCount(5, $calendars);
        $this->assertTrue($calendars->every(fn (object $calendar): bool => $calendar->timezone === 'Asia/Jakarta'
            && json_decode($calendar->operating_weekdays, true) === [1, 2, 3, 4, 5, 6, 7]
            && (int) $calendar->actor_user_id === (int) $owner->getKey()
            && substr($calendar->effective_from, 0, 10) === substr($calendar->created_at, 0, 10)
        ));
        $this->assertSame(0, DB::table('outlet_attendance_policy_versions')->where('tenant_id', $tenant->getKey())->count());
        $this->assertSame(0, DB::table('employees')->where('tenant_id', $tenant->getKey())->count());
        $this->assertSame(0, DB::table('employee_outlet_assignments')->where('tenant_id', $tenant->getKey())->count());
        $this->assertSame(0, DB::table('attendance_sessions')->where('tenant_id', $tenant->getKey())->count());
        $this->assertSame(0, DB::table('kiosk_devices')->where('tenant_id', $tenant->getKey())->count());
        $this->assertSame(0, DB::table('shift_templates')->where('tenant_id', $tenant->getKey())->count());

        $this->assertSame($existingTenantId, $existingMembership->fresh()->tenant_id);
        $this->assertTrue($existingMembership->fresh()->is_active);
        $this->assertDatabaseHas('tenant_role_assignments', [
            'tenant_id' => $existingTenantId,
            'tenant_membership_id' => $existingMembershipId,
            'role' => TenantRole::Owner->value,
        ]);
        $this->assertSame(2, TenantMembership::query()->where('user_id', $owner->getKey())->count());
        $this->assertSame(7, ManagementChangeEvent::query()->where('tenant_id', $tenant->getKey())->count());
    }

    public function test_existing_target_tenant_stops_duplicate_provisioning(): void
    {
        $owner = User::factory()->create();
        Tenant::query()->create(['name' => '  '.mb_strtoupper(DevelopmentTenantProvisioner::TENANT_NAME).'  ']);

        try {
            app(DevelopmentTenantProvisioner::class)->provision($owner);
            $this->fail('An existing normalized target tenant must stop provisioning.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('tenant', $exception->errors());
        }

        $this->assertDatabaseCount('tenants', 1);
        $this->assertDatabaseCount('business_units', 0);
        $this->assertDatabaseCount('outlets', 0);
    }

    public function test_audit_failure_rolls_back_the_entire_provisioning_transaction_without_cleanup(): void
    {
        $owner = User::factory()->create();
        $recorder = Mockery::mock(ManagementChangeRecorder::class);
        $recorder->shouldReceive('record')->once()->andThrow(new RuntimeException('Synthetic audit failure.'));
        $this->app->instance(ManagementChangeRecorder::class, $recorder);

        try {
            app(DevelopmentTenantProvisioner::class)->provision($owner);
            $this->fail('A management audit failure must abort provisioning.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Synthetic audit failure.', $exception->getMessage());
        }

        $this->assertDatabaseCount('tenants', 0);
        $this->assertDatabaseCount('tenant_memberships', 0);
        $this->assertDatabaseCount('tenant_role_assignments', 0);
        $this->assertDatabaseCount('tenant_attendance_policy_versions', 0);
        $this->assertDatabaseCount('business_units', 0);
        $this->assertDatabaseCount('outlets', 0);
        $this->assertDatabaseCount('outlet_calendar_versions', 0);
        $this->assertDatabaseCount('management_change_events', 0);
    }

    public function test_outlet_audit_failure_rolls_back_the_created_outlet_and_its_calendar(): void
    {
        $owner = User::factory()->create();
        $realRecorder = new ManagementChangeRecorder;
        $recorder = Mockery::mock(ManagementChangeRecorder::class)->makePartial();
        $callCount = 0;
        $recorder->shouldReceive('record')->times(3)->andReturnUsing(
            function (...$arguments) use (&$callCount, $realRecorder): ManagementChangeEvent {
                $callCount++;
                if ($callCount === 3) {
                    throw new RuntimeException('Synthetic Outlet audit failure.');
                }

                return $realRecorder->record(...$arguments);
            },
        );
        $this->app->instance(ManagementChangeRecorder::class, $recorder);

        try {
            app(DevelopmentTenantProvisioner::class)->provision($owner);
            $this->fail('An Outlet audit failure must abort provisioning.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Synthetic Outlet audit failure.', $exception->getMessage());
        }

        $this->assertDatabaseCount('tenants', 0);
        $this->assertDatabaseCount('business_units', 0);
        $this->assertDatabaseCount('outlets', 0);
        $this->assertDatabaseCount('outlet_calendar_versions', 0);
        $this->assertDatabaseCount('management_change_events', 0);
    }

    public function test_command_dry_run_is_non_writing_and_write_mode_is_disabled_in_testing(): void
    {
        $owner = User::factory()->create(['id' => 2, 'name' => 'Arya']);
        app(OrganizationService::class)->createTenant($owner, 'Existing Owner tenant');
        $before = [
            'tenants' => DB::table('tenants')->count(),
            'business_units' => DB::table('business_units')->count(),
            'outlets' => DB::table('outlets')->count(),
        ];

        $dryRunExit = Artisan::call('organization:provision-development');
        $dryRunOutput = Artisan::output();
        $this->assertSame(0, $dryRunExit);
        $this->assertStringContainsString('DRY RUN', $dryRunOutput);
        $this->assertStringContainsString(DevelopmentTenantProvisioner::TENANT_NAME, $dryRunOutput, $dryRunOutput);

        $writeExit = Artisan::call('organization:provision-development', [
            '--execute-write' => true,
            '--owner-authorized' => true,
            '--confirmation' => 'CREATE-OPERASIONAL-CEPAT-KOPI-TEH-POCI',
        ]);
        $this->assertSame(1, $writeExit);
        $this->assertStringContainsString('disabled outside the local', Artisan::output());
        $this->assertSame($before, [
            'tenants' => DB::table('tenants')->count(),
            'business_units' => DB::table('business_units')->count(),
            'outlets' => DB::table('outlets')->count(),
        ]);
    }

    public function test_command_rejects_a_wrong_configured_database_before_using_it(): void
    {
        $owner = User::factory()->create(['id' => 2, 'name' => 'Arya']);
        app(OrganizationService::class)->createTenant($owner, 'Existing Owner tenant');
        $originalDatabase = config('database.connections.mysql.database');
        config(['database.connections.mysql.database' => 'hadirinaja_dev']);

        try {
            $exit = Artisan::call('organization:provision-development');
            $output = Artisan::output();
        } finally {
            config(['database.connections.mysql.database' => $originalDatabase]);
        }

        $this->assertSame(1, $exit);
        $this->assertStringContainsString('Preflight stopped safely', $output);
        $this->assertSame('hadirinaja_test', DB::connection()->getDatabaseName());
        $this->assertDatabaseCount('tenants', 1);
    }

    public function test_command_fails_closed_when_the_approved_owner_is_missing_or_not_an_owner(): void
    {
        $exitWithoutUser = Artisan::call('organization:provision-development');
        $this->assertSame(1, $exitWithoutUser);
        $this->assertStringContainsString('Preflight stopped safely', Artisan::output());
        $this->assertDatabaseCount('tenants', 0);

        $user = User::factory()->create(['id' => 2, 'name' => 'Arya']);
        $exitWithoutOwnerRole = Artisan::call('organization:provision-development');
        $this->assertSame(1, $exitWithoutOwnerRole);
        $this->assertStringContainsString('Preflight stopped safely', Artisan::output());
        $this->assertSame(0, $user->memberships()->count());
        $this->assertDatabaseCount('tenants', 0);
    }

    public function test_command_fails_closed_when_a_required_service_cannot_be_resolved(): void
    {
        $owner = User::factory()->create(['id' => 2, 'name' => 'Arya']);
        app(OrganizationService::class)->createTenant($owner, 'Existing Owner tenant');
        $this->app->bind(DevelopmentTenantProvisioner::class, function (): never {
            throw new RuntimeException('Synthetic unavailable service.');
        });

        $exit = Artisan::call('organization:provision-development');

        $this->assertSame(1, $exit);
        $this->assertStringContainsString('Preflight stopped safely', Artisan::output());
        $this->assertDatabaseCount('tenants', 1);
        $this->assertDatabaseCount('business_units', 0);
        $this->assertDatabaseCount('outlets', 0);
    }
}
