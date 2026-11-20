<?php

namespace Tests\Feature\S2;

use App\Models\Employee;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AttendancePolicyService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

final class CepatKopiProductionBootstrapTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    private const OWNER_EMAIL = 'owner.synthetic@example.test';

    private const OWNER_PASSWORD = 'SyntheticOwnerPass123!';

    /** @var list<string> */
    private array $csvPaths = [];

    private ?string $originalPassword = null;

    private bool $passwordWasSet = false;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);
        $value = getenv('CEPAT_KOPI_OWNER_PASSWORD');
        $this->passwordWasSet = $value !== false;
        $this->originalPassword = $value === false ? null : (string) $value;
    }

    protected function tearDown(): void
    {
        foreach ($this->csvPaths as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }

        if ($this->passwordWasSet) {
            putenv('CEPAT_KOPI_OWNER_PASSWORD='.$this->originalPassword);
        } else {
            putenv('CEPAT_KOPI_OWNER_PASSWORD');
        }

        parent::tearDown();
    }

    public function test_first_run_creates_only_master_data_and_api_settings_are_ready(): void
    {
        putenv('CEPAT_KOPI_OWNER_PASSWORD='.self::OWNER_PASSWORD);
        [$exitCode, $output] = $this->runBootstrap($this->csvFile(), execute: true);

        self::assertSame(0, $exitCode, $output);
        self::assertStringContainsString('committed and verified', $output);
        self::assertStringNotContainsString('owner.synthetic@example.test', $output);
        self::assertStringNotContainsString('employee.kaliceret@example.test', $output);
        self::assertStringNotContainsString('supervisor.only@example.test', $output);
        self::assertStringNotContainsString(self::OWNER_PASSWORD, $output);
        self::assertStringContainsString('grace=15m photo=required geofence=required/25m cutover=null', $output);
        self::assertMatchesRegularExpression('/Shift weekday_middle: 11:00–18:00 version=\d+/', $output);
        self::assertStringContainsString('"schedule_weeks":0', $output);
        self::assertStringContainsString('"temporary_assignments":0', $output);
        self::assertStringContainsString('"attendance_sessions":0', $output);

        $tenant = Tenant::query()->where('name', 'Cepat Kopi')->sole();
        $owner = User::query()->where('email', self::OWNER_EMAIL)->sole();
        self::assertSame(1, User::query()->count());
        self::assertTrue(Hash::check(self::OWNER_PASSWORD, $owner->password));
        self::assertSame(1, TenantMembership::query()->forTenant((int) $tenant->getKey())->count());
        self::assertSame(1, DB::table('tenant_role_assignments')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('employee_user_links')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('supervisor_outlet_scopes')->where('tenant_id', $tenant->getKey())->count());

        $unit = DB::table('business_units')->where('tenant_id', $tenant->getKey())->sole();
        self::assertSame('Cepat Kopi', $unit->name);
        $outlets = DB::table('outlets')->where('tenant_id', $tenant->getKey())->orderBy('name')->get()->keyBy('name');
        self::assertSame(['Cepat Kopi Kaliceret', 'Cepat Kopi Karangawen'], $outlets->keys()->all());

        $today = CarbonImmutable::today('Asia/Jakarta')->toDateString();
        $effectiveTenantPolicy = app(AttendancePolicyService::class)->effective((int) $tenant->getKey(), null, $today);
        self::assertSame($today, $effectiveTenantPolicy['effective_from']);
        self::assertSame('personal', $effectiveTenantPolicy['configuration']['attendance_mode']);
        self::assertSame(15, $effectiveTenantPolicy['configuration']['late_tolerance_minutes']);
        self::assertTrue($effectiveTenantPolicy['configuration']['require_personal_photo']);
        self::assertSame(5, $effectiveTenantPolicy['configuration']['planner_weekend_starts_on']);
        self::assertSame('cepat_kopi', $effectiveTenantPolicy['configuration']['planner_shift_profile']);

        $expectedOutlets = [
            'Cepat Kopi Kaliceret' => [-7.1080958195341, 110.65293870057619],
            'Cepat Kopi Karangawen' => [-7.048333850399655, 110.59257456881024],
        ];
        foreach ($expectedOutlets as $name => [$latitude, $longitude]) {
            $outlet = $outlets[$name];
            $effective = app(AttendancePolicyService::class)->effective(
                (int) $tenant->getKey(),
                (int) $outlet->id,
                $today,
            );
            self::assertSame('personal', $effective['configuration']['attendance_mode']);
            self::assertSame(15, $effective['configuration']['late_tolerance_minutes']);
            self::assertTrue($effective['configuration']['require_personal_photo']);
            self::assertSame(25, $effective['configuration']['personal_location_validation']['radius_meters']);
            self::assertSame($latitude, $effective['configuration']['personal_location_validation']['latitude']);
            self::assertSame($longitude, $effective['configuration']['personal_location_validation']['longitude']);
            self::assertSame($today, DB::table('outlet_attendance_policy_versions')
                ->where('id', $effective['outlet_version_id'])->value('effective_from'));

            $calendar = DB::table('outlet_calendar_versions')->where('tenant_id', $tenant->getKey())
                ->where('outlet_id', $outlet->id)->where('effective_from', $today)->sole();
            self::assertSame('Asia/Jakarta', $calendar->timezone);
            self::assertSame([1, 2, 3, 4, 5, 6, 7], json_decode($calendar->operating_weekdays, true, flags: JSON_THROW_ON_ERROR));
            self::assertNull(DB::table('outlets')->where('id', $outlet->id)->value('weekly_planner_start_on'));
        }

        self::assertSame(2, Employee::query()->forTenant((int) $tenant->getKey())->count());
        self::assertDatabaseMissing('employees', ['tenant_id' => $tenant->getKey(), 'name' => 'Supervisor Only']);
        self::assertSame(2, DB::table('employee_outlet_assignments')->where('tenant_id', $tenant->getKey())
            ->where('assignment_type', 'primary')->count());
        self::assertSame(0, DB::table('employee_outlet_assignments')->where('tenant_id', $tenant->getKey())
            ->where('assignment_type', 'temporary')->count());
        self::assertSame(0, DB::table('schedule_weeks')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('weekly_schedule_rules')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('schedule_exceptions')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('tenant_holiday_references')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('attendance_sessions')->where('tenant_id', $tenant->getKey())->count());
        self::assertSame(0, DB::table('attendance_events')->where('tenant_id', $tenant->getKey())->count());

        $shifts = DB::table('shift_templates as templates')
            ->join('shift_template_versions as versions', function ($join): void {
                $join->on('versions.tenant_id', '=', 'templates.tenant_id')
                    ->on('versions.shift_template_id', '=', 'templates.id');
            })
            ->where('templates.tenant_id', $tenant->getKey())
            ->orderBy('templates.name')
            ->get(['templates.name', 'versions.start_time', 'versions.end_time', 'versions.effective_from']);
        self::assertCount(5, $shifts);
        self::assertTrue($shifts->every(fn ($shift): bool => $shift->effective_from === $today));
        self::assertSame([
            'Jumat–Minggu 08:00–16:00' => '08:00:00–16:00:00',
            'Jumat–Minggu 16:00–23:00' => '16:00:00–23:00:00',
            'Senin–Kamis 08:00–16:00' => '08:00:00–16:00:00',
            'Senin–Kamis 11:00–18:00' => '11:00:00–18:00:00',
            'Senin–Kamis 16:00–22:00' => '16:00:00–22:00:00',
        ], $shifts->mapWithKeys(fn ($shift): array => [
            $shift->name => $shift->start_time.'–'.$shift->end_time,
        ])->all());

        $this->loginAsOwner($owner);
        $weekStart = CarbonImmutable::today('Asia/Jakarta')
            ->subDays(CarbonImmutable::today('Asia/Jakarta')->dayOfWeekIso - 1)
            ->toDateString();
        $planner = $this->browserRequest()->getJson(
            '/api/v1/management/scheduling/planner/outlets/'.$outlets['Cepat Kopi Kaliceret']->id.'/weeks/'.$weekStart,
        )->assertOk();
        $planner->assertJsonPath('planner_settings.weekend_starts_on', 5)
            ->assertJsonPath('planner_settings.custom', true)
            ->assertJsonPath('planner_settings.weekday_shifts.middle.0', '11:00:00')
            ->assertJsonPath('planner_settings.weekday_shifts.middle.1', '18:00:00')
            ->assertJsonPath('planner_settings.weekend_evening.0', '16:00:00')
            ->assertJsonPath('planner_settings.weekend_evening.1', '23:00:00')
            ->assertJsonPath('outlet.weekly_planner_start_on', null);

        $invitation = $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'employee.supervisor@example.test',
            'role' => 'supervisor',
            'outlet_ids' => [$outlets['Cepat Kopi Kaliceret']->id, $outlets['Cepat Kopi Karangawen']->id],
        ])->assertCreated();
        $invitationId = (int) $invitation->json('invitation.id');
        self::assertSame(
            [(int) $outlets['Cepat Kopi Kaliceret']->id, (int) $outlets['Cepat Kopi Karangawen']->id],
            DB::table('tenant_access_invitation_outlet_scopes')->where('tenant_id', $tenant->getKey())
                ->where('invitation_id', $invitationId)->orderBy('outlet_id')->pluck('outlet_id')->map(fn ($id): int => (int) $id)->all(),
        );
        self::assertSame(1, User::query()->count(), 'Supervisor and Employee identities remain without login accounts.');
    }

    public function test_rerun_is_a_verified_no_op_with_an_unchanged_database_fingerprint(): void
    {
        putenv('CEPAT_KOPI_OWNER_PASSWORD='.self::OWNER_PASSWORD);
        $path = $this->csvFile();
        [$firstCode, $firstOutput] = $this->runBootstrap($path, execute: true);
        self::assertSame(0, $firstCode, $firstOutput);
        $before = $this->bootstrapFingerprint();

        [$secondCode, $secondOutput] = $this->runBootstrap($path, execute: true);

        self::assertSame(0, $secondCode, $secondOutput);
        self::assertStringContainsString('already matches; no writes', $secondOutput);
        self::assertSame($before, $this->bootstrapFingerprint());
        self::assertStringNotContainsString('owner.synthetic@example.test', $secondOutput);
    }

    public function test_dry_run_reports_counts_and_settings_without_writing(): void
    {
        $path = $this->csvFile();
        $before = $this->bootstrapFingerprint();

        [$exitCode, $output] = $this->runBootstrap($path, dryRun: true);

        self::assertSame(0, $exitCode, $output);
        self::assertStringContainsString('DRY RUN: no application records were written.', $output);
        self::assertStringContainsString('"employee_profiles":2', $output);
        self::assertStringContainsString('ATTENDANCE_EVIDENCE_REQUIRE_PERSONAL_PHOTO=true', $output);
        self::assertStringNotContainsString('owner.synthetic@example.test', $output);
        self::assertStringNotContainsString('employee.kaliceret@example.test', $output);
        self::assertSame($before, $this->bootstrapFingerprint());
    }

    public function test_invalid_csv_and_owner_password_fail_without_writes_or_sensitive_output(): void
    {
        $before = $this->bootstrapFingerprint();
        $invalidCsv = $this->csvFile();
        file_put_contents($invalidCsv, implode("\n", [
            'name,email,role',
            'Synthetic Owner,owner.synthetic@example.test,owner',
        ]));
        [$csvExitCode, $csvOutput] = $this->runBootstrap($invalidCsv, dryRun: true);
        self::assertSame(1, $csvExitCode);
        self::assertStringContainsString('exactly the name,email,role,outlet columns', $csvOutput);
        self::assertStringNotContainsString('owner.synthetic@example.test', $csvOutput);
        self::assertSame($before, $this->bootstrapFingerprint());

        putenv('CEPAT_KOPI_OWNER_PASSWORD=short-secret');
        [$passwordExitCode, $passwordOutput] = $this->runBootstrap($this->csvFile(), execute: true);
        self::assertSame(1, $passwordExitCode);
        self::assertStringContainsString('Kata sandi Owner harus', $passwordOutput);
        self::assertStringNotContainsString('short-secret', $passwordOutput);
        self::assertStringNotContainsString('owner.synthetic@example.test', $passwordOutput);
        self::assertSame($before, $this->bootstrapFingerprint());
    }

    public function test_write_requires_owner_authorization_and_exact_confirmation(): void
    {
        $before = $this->bootstrapFingerprint();
        $csv = $this->csvFile();

        [$authorizationExitCode, $authorizationOutput] = $this->runBootstrapWithOptions([
            '--csv' => $csv,
            '--execute' => true,
            '--confirmation' => 'BOOTSTRAP-CEPAT-KOPI',
        ]);
        self::assertSame(1, $authorizationExitCode);
        self::assertStringContainsString('Separate Owner authorization is required', $authorizationOutput);
        self::assertSame($before, $this->bootstrapFingerprint());

        [$confirmationExitCode, $confirmationOutput] = $this->runBootstrapWithOptions([
            '--csv' => $csv,
            '--execute' => true,
            '--owner-authorized' => true,
            '--confirmation' => 'incorrect',
        ]);
        self::assertSame(1, $confirmationExitCode);
        self::assertStringContainsString('exact --confirmation phrase', $confirmationOutput);
        self::assertSame($before, $this->bootstrapFingerprint());
    }

    public function test_conflicting_cepat_kopi_tenant_is_rejected_without_changes(): void
    {
        [$user] = $this->tenantWithOwner('Cepat Kopi');
        $before = $this->bootstrapFingerprint();

        [$exitCode, $output] = $this->runBootstrap($this->csvFile());

        self::assertSame(1, $exitCode);
        self::assertStringContainsString('does not match this bootstrap', $output);
        self::assertStringNotContainsString('owner.synthetic@example.test', $output);
        self::assertSame($before, $this->bootstrapFingerprint());
        self::assertSame(1, User::query()->whereKey($user->getKey())->count());
        self::assertSame(0, DB::table('business_units')->where('tenant_id', Tenant::query()->where('name', 'Cepat Kopi')->value('id'))->count());
    }

    private function csvFile(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'ck-bootstrap-');
        if (! is_string($path)) {
            self::fail('Unable to create a synthetic test CSV.');
        }
        $this->csvPaths[] = $path;
        file_put_contents($path, implode("\n", [
            'name,email,role,outlet',
            'Synthetic Owner,owner.synthetic@example.test,owner,',
            'Synthetic Employee,employee.kaliceret@example.test,employee,Kaliceret',
            'Supervisor Only,supervisor.only@example.test,supervisor,Karangawen',
            'Synthetic Supervisor,employee.supervisor@example.test,supervisor,Kaliceret|Karangawen',
            'Synthetic Supervisor,employee.supervisor@example.test,employee,Karangawen',
            '',
        ]));

        return $path;
    }

    /** @return array{int, string} */
    private function runBootstrap(string $path, bool $execute = false, bool $dryRun = false): array
    {
        $options = ['--csv' => $path];
        if ($execute) {
            $options += [
                '--execute' => true,
                '--owner-authorized' => true,
                '--confirmation' => 'BOOTSTRAP-CEPAT-KOPI',
            ];
        }
        if ($dryRun) {
            $options['--dry-run'] = true;
        }

        return $this->runBootstrapWithOptions($options);
    }

    /** @return array{int, string} */
    private function runBootstrapWithOptions(array $options): array
    {
        $exitCode = Artisan::call('organization:bootstrap-cepat-kopi', $options);

        return [$exitCode, Artisan::output()];
    }

    private function bootstrapFingerprint(): string
    {
        $tables = [
            'tenants',
            'users',
            'tenant_memberships',
            'tenant_role_assignments',
            'business_units',
            'outlets',
            'outlet_calendar_versions',
            'tenant_attendance_policy_versions',
            'outlet_attendance_policy_versions',
            'employees',
            'employee_outlet_assignments',
            'employee_user_links',
            'shift_templates',
            'shift_template_versions',
            'scheduling_change_events',
        ];
        $data = [];
        foreach ($tables as $table) {
            $data[$table] = DB::table($table)->orderBy('id')->get()->map(fn ($row): array => (array) $row)->all();
        }

        return hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
    }

    private function loginAsOwner(User $owner): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $owner->email,
            'password' => self::OWNER_PASSWORD,
        ])->assertOk();
        $cookie = $response->getCookie(config('session.cookie'));
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
}
