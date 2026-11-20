<?php

namespace Database\Seeders;

use App\Enums\TenantRole;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AttendancePolicyService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use App\Support\EmployeeUatDatabaseGuard;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

final class CepatKopiUatSeeder extends Seeder
{
    public const TENANT = 'Cepat Kopi';

    public const OWNER = 'owner@cepat-kopi-uat.example.test';

    private const TIMEZONE = 'Asia/Jakarta';

    private const REASON = 'Cepat Kopi local master fixture v1';

    public const OUTLETS = [
        'Kaliceret' => ['spbu' => '4458124', 'latitude' => -7.1080958195341, 'longitude' => 110.65293870057619, 'employees' => ['Vita', 'Adam', 'Rizal']],
        'Karangawen' => ['spbu' => '4459513', 'latitude' => -7.048333850399655, 'longitude' => 110.59257456881024, 'employees' => ['Intan', 'Nejwa', 'Nejla']],
    ];

    private const SHIFTS = [
        'Sen–Kam 08:00–16:00' => ['08:00', '16:00'],
        'Sen–Kam 11:00–18:00' => ['11:00', '18:00'],
        'Sen–Kam 16:00–22:00' => ['16:00', '22:00'],
        'Jum–Min 08:00–16:00' => ['08:00', '16:00'],
        'Jum–Min 16:00–23:00' => ['16:00', '23:00'],
    ];

    public static function identities(): array
    {
        $identities = [self::OWNER => ['name' => 'Cepat Kopi UAT Owner', 'outlet' => null]];
        foreach (self::OUTLETS as $outlet => $definition) {
            foreach ($definition['employees'] as $name) {
                $identities[strtolower($name).'@cepat-kopi-uat.example.test'] = ['name' => $name, 'outlet' => $outlet];
            }
        }

        return $identities;
    }

    public function run(): void
    {
        $this->execute(false);
    }

    public function execute(bool $preview): array
    {
        EmployeeUatDatabaseGuard::assertTarget();
        if (config('attendance_evidence.require_personal_photo') !== false) {
            throw new RuntimeException('Global photo behavior differs from the existing local UAT baseline.');
        }

        $connection = DB::connection();
        if ((int) $connection->selectOne('SELECT GET_LOCK(?, 0) AS acquired', [self::REASON])->acquired !== 1) {
            throw new RuntimeException('Cepat Kopi seeding is already running.');
        }

        try {
            return $connection->transaction(function () use ($preview): array {
                $tenantIds = Tenant::query()->where('name', self::TENANT)->pluck('id');
                $emails = User::query()->whereIn('email', array_keys(self::identities()))->pluck('email')->all();
                if ($tenantIds->count() === 1 && count($emails) === count(self::identities())) {
                    $id = (int) $tenantIds->sole();
                    $this->assertRecords($id);

                    return ['action' => 'no-op', 'tenant_id' => $id, 'inserts' => []];
                }
                if ($tenantIds->isNotEmpty() || $emails !== []) {
                    throw new RuntimeException('Tenant name or fixture login collision; no records were changed.');
                }

                $today = CarbonImmutable::today(self::TIMEZONE);
                if ($preview) {
                    return [
                        'action' => 'preview', 'tenant' => self::TENANT, 'effective_date' => $today->toDateString(),
                        'inserts' => ['tenant' => 1, 'business_unit' => 1, 'outlets' => 2, 'users' => 7,
                            'memberships' => 7, 'roles' => 7, 'employees' => 6, 'employee_links' => 6,
                            'assignments' => 6, 'tenant_policy' => 1, 'outlet_policies' => 2,
                            'outlet_calendars' => 2, 'shift_templates' => 5, 'shift_versions' => 5, 'scheduling_audit' => 7],
                        'timezone' => self::TIMEZONE, 'outlets' => self::OUTLETS, 'identities' => self::identities(),
                        'outlet_policy' => ['attendance_mode' => 'personal', 'late_tolerance_minutes' => 15, 'location_required' => true, 'radius_meters' => 25],
                        'shift_templates' => self::SHIFTS, 'updates' => [],
                    ];
                }

                $password = (string) getenv('CEPAT_KOPI_UAT_PASSWORD');
                if (! preg_match('/^[a-f0-9]{48}$/D', $password)) {
                    throw new RuntimeException('Missing dedicated synthetic Cepat Kopi password.');
                }

                $organizations = app(OrganizationService::class);
                $memberships = app(TenantMembershipService::class);
                $policies = app(AttendancePolicyService::class);
                $ownerUser = $this->createUser(self::OWNER, self::identities()[self::OWNER]['name'], $password);
                $tenant = $organizations->createTenant($ownerUser, self::TENANT);
                $tenantId = (int) $tenant->getKey();
                $owner = TenantMembership::query()->forTenant($tenantId)->where('user_id', $ownerUser->id)->sole();
                $unit = $organizations->createBusinessUnit($owner, self::TENANT);
                $outlets = [];
                foreach (self::OUTLETS as $name => $definition) {
                    $outlet = $outlets[$name] = $organizations->createOutlet($owner, $unit, $name);
                    $policies->createOutletVersion($owner, $outlet, $today->toDateString(), $this->outletPolicy($definition), self::REASON);
                }

                foreach (self::identities() as $email => $identity) {
                    if ($identity['outlet'] === null) {
                        continue;
                    }
                    $employee = $organizations->registerEmployee($owner, $identity['name']);
                    $membership = $memberships->addMembership($owner, $this->createUser($email, $identity['name'], $password));
                    $memberships->assignRole($owner, $membership, TenantRole::Employee);
                    $memberships->linkEmployee($owner, $membership, $employee);
                    app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlets[$identity['outlet']], $today->utc());
                }

                foreach (self::SHIFTS as $name => [$start, $end]) {
                    app(ShiftTemplateService::class)->create($owner, $name, $start, $end, false, $today->toDateString(), self::REASON);
                }

                $this->assertRecords($tenantId);

                return ['action' => 'inserted', 'tenant_id' => $tenantId];
            });
        } finally {
            $connection->selectOne('SELECT RELEASE_LOCK(?)', [self::REASON]);
        }
    }

    private function createUser(string $email, string $name, string $password): User
    {
        return User::query()->create(['name' => $name, 'email' => $email, 'password' => Hash::make($password)]);
    }

    private function outletPolicy(array $definition): array
    {
        return [
            'attendance_mode' => 'personal', 'late_tolerance_minutes' => 15,
            'personal_location_validation' => [
                'required' => true, 'radius_meters' => 25,
                'latitude' => $definition['latitude'], 'longitude' => $definition['longitude'],
            ],
        ];
    }

    private function assertRecords(int $tenantId): void
    {
        $rows = fn (string $table) => DB::table($table)->where('tenant_id', $tenantId);
        $this->expect(DB::table('tenants')->where('id', $tenantId)->value('name') === self::TENANT, 'tenant identity');
        $unit = $rows('business_units')->sole();
        $this->expect($unit->name === self::TENANT, 'business unit');
        $tenantPolicies = $rows('tenant_attendance_policy_versions')->get();
        $default = SchedulingDefaults::attendancePolicy();
        $approved = [...$default, 'require_personal_photo' => true, 'planner_weekend_starts_on' => 5, 'planner_shift_profile' => 'cepat_kopi'];
        $this->expect($tenantPolicies->isNotEmpty() && $tenantPolicies->every(function ($row) use ($default, $approved): bool {
            $value = json_decode($row->configuration, true, flags: JSON_THROW_ON_ERROR);

            return $value == $default || $value == $approved;
        }), 'tenant policy baseline');
        $outlets = $rows('outlets')->get()->keyBy('name');
        $this->expect($rows('outlets')->count() === count(self::OUTLETS), 'outlet count');
        foreach (self::OUTLETS as $name => $definition) {
            $outlet = $outlets->get($name);
            $this->expect($outlet && (int) $outlet->business_unit_id === (int) $unit->id, 'outlet '.$name);
            $calendar = $rows('outlet_calendar_versions')->where('outlet_id', $outlet->id)->sole();
            $this->expect($calendar->timezone === self::TIMEZONE && json_decode($calendar->operating_weekdays, true) === [1, 2, 3, 4, 5, 6, 7], 'calendar '.$name);
            $overrides = $rows('outlet_attendance_policy_versions')->where('outlet_id', $outlet->id)->sole();
            $effective = app(AttendancePolicyService::class)->effective($tenantId, (int) $outlet->id, CarbonImmutable::today(self::TIMEZONE)->toDateString());
            $this->expect($overrides->reason === self::REASON
                && json_decode($overrides->overrides, true, flags: JSON_THROW_ON_ERROR) == $this->outletPolicy($definition)
                && $effective['configuration']['attendance_mode'] === 'personal'
                && $effective['configuration']['late_tolerance_minutes'] === 15
                && $effective['configuration']['personal_location_validation'] == $this->outletPolicy($definition)['personal_location_validation'], 'effective policy '.$name);
        }

        $this->expect($rows('employees')->count() === 6 && $rows('employee_user_links')->count() === 6
            && $rows('employee_outlet_assignments')->count() === 6 && $rows('tenant_memberships')->count() === 7
            && $rows('tenant_role_assignments')->count() === 7, 'employee, membership and assignment counts');
        foreach (self::identities() as $email => $identity) {
            $user = User::query()->where('email', $email)->sole();
            $membership = DB::table('tenant_memberships')->where('user_id', $user->id)->sole();
            $this->expect($user->email === $email && $user->name === $identity['name'] && $user->phone === null
                && (int) $membership->tenant_id === $tenantId
                && (bool) $membership->is_active && $membership->revoked_at === null, 'identity '.$email);
            $role = $rows('tenant_role_assignments')->where('tenant_membership_id', $membership->id)->sole();
            $this->expect($role->role === ($identity['outlet'] === null ? 'owner' : 'employee'), 'role '.$email);
            if ($identity['outlet'] !== null) {
                $link = $rows('employee_user_links')->where('tenant_membership_id', $membership->id)->sole();
                $employee = $rows('employees')->where('id', $link->employee_id)->sole();
                $assignment = $rows('employee_outlet_assignments')->where('employee_id', $employee->id)->sole();
                $this->expect($employee->name === $identity['name']
                    && (int) $assignment->outlet_id === (int) $outlets[$identity['outlet']]->id
                    && $assignment->assignment_type === 'primary'
                    && CarbonImmutable::parse($assignment->effective_from, 'UTC')->isPast()
                    && $assignment->effective_until === '9999-12-31 23:59:59', 'employee placement '.$email);
            }
        }

        $this->expect($rows('shift_templates')->count() === count(self::SHIFTS), 'shift count');
        foreach (self::SHIFTS as $name => [$start, $end]) {
            $template = $rows('shift_templates')->where('name', $name)->sole();
            $version = $rows('shift_template_versions')->where('shift_template_id', $template->id)->sole();
            $this->expect($version->start_time === $start.':00' && $version->end_time === $end.':00'
                && ! $version->crosses_midnight && $version->reason === self::REASON, 'shift '.$name);
        }
    }

    private function expect(bool $matches, string $record): void
    {
        if (! $matches) {
            throw new RuntimeException('Fixture mismatch: '.$record.'; no records were overwritten.');
        }
    }
}
