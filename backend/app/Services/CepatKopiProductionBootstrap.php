<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\OutletAttendancePolicyVersion;
use App\Models\OutletCalendarVersion;
use App\Models\ShiftTemplate;
use App\Models\Tenant;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use App\Support\IdentityNormalizer;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Throwable;

final class CepatKopiProductionBootstrap
{
    public const TENANT_NAME = 'Cepat Kopi';

    public const REASON = 'Cepat Kopi production bootstrap v1';

    private const LOCK_NAME = 'hadirinaja:cepat-kopi-bootstrap';

    private const OPEN_ENDED_AT = '9999-12-31 23:59:59';

    /** @var list<string> */
    private const CSV_HEADERS = ['name', 'email', 'role', 'outlet'];

    /** @var array<string, array{name: string, latitude: float, longitude: float}> */
    private const OUTLETS = [
        'Kaliceret' => [
            'name' => 'Cepat Kopi Kaliceret',
            'latitude' => -7.1080958195341,
            'longitude' => 110.65293870057619,
        ],
        'Karangawen' => [
            'name' => 'Cepat Kopi Karangawen',
            'latitude' => -7.048333850399655,
            'longitude' => 110.59257456881024,
        ],
    ];

    /**
     * @var array<string, array{name: string, start: string, end: string}>
     */
    private const SHIFTS = [
        'weekday_morning' => ['name' => 'Senin–Kamis 08:00–16:00', 'start' => '08:00', 'end' => '16:00'],
        'weekday_middle' => ['name' => 'Senin–Kamis 11:00–18:00', 'start' => '11:00', 'end' => '18:00'],
        'weekday_evening' => ['name' => 'Senin–Kamis 16:00–22:00', 'start' => '16:00', 'end' => '22:00'],
        'weekend_morning' => ['name' => 'Jumat–Minggu 08:00–16:00', 'start' => '08:00', 'end' => '16:00'],
        'weekend_evening' => ['name' => 'Jumat–Minggu 16:00–23:00', 'start' => '16:00', 'end' => '23:00'],
    ];

    public function loadCsv(string $path): array
    {
        $resolvedPath = realpath($path);
        if ($resolvedPath === false || ! is_file($resolvedPath) || ! is_readable($resolvedPath)) {
            throw new DomainException('CSV is unavailable or unreadable. No records were changed.');
        }

        $handle = @fopen($resolvedPath, 'rb');
        if ($handle === false) {
            throw new DomainException('CSV is unavailable or unreadable. No records were changed.');
        }

        try {
            $header = fgetcsv($handle, null, ',', '"', '');
            if (! is_array($header)) {
                throw new DomainException('CSV header is missing or invalid. No records were changed.');
            }

            $header = array_map(static function ($field): string {
                $value = trim((string) $field);

                return preg_replace('/^\xEF\xBB\xBF/', '', $value) ?? $value;
            }, $header);

            if (count($header) !== count(self::CSV_HEADERS)
                || count(array_unique($header)) !== count(self::CSV_HEADERS)
                || array_diff(self::CSV_HEADERS, $header) !== []) {
                throw new DomainException('CSV must contain exactly the name,email,role,outlet columns. No records were changed.');
            }

            $owner = null;
            $employees = [];
            $supervisors = [];
            $identityNames = [];
            $line = 1;

            while (($row = fgetcsv($handle, null, ',', '"', '')) !== false) {
                $line++;
                if (count($row) === 1 && trim((string) $row[0]) === '') {
                    continue;
                }
                if (count($row) !== count($header)) {
                    throw new DomainException("CSV row {$line} has an invalid number of columns. No records were changed.");
                }

                $data = array_combine($header, array_map(static fn ($field): string => trim((string) $field), $row));
                if (! is_array($data)) {
                    throw new DomainException("CSV row {$line} is invalid. No records were changed.");
                }

                $name = $data['name'];
                $email = IdentityNormalizer::email($data['email']);
                $role = strtolower($data['role']);
                $outlet = $data['outlet'];

                if ($name === '' || mb_strlen($name) > 120 || filter_var($email, FILTER_VALIDATE_EMAIL) === false
                    || strlen($email) > 255 || ! in_array($role, ['owner', 'employee', 'supervisor'], true)) {
                    throw new DomainException("CSV row {$line} has invalid identity data. No records were changed.");
                }

                if (isset($identityNames[$email]) && $identityNames[$email] !== $name) {
                    throw new DomainException("CSV row {$line} conflicts with another row for the same identity. No records were changed.");
                }
                $identityNames[$email] = $name;

                if ($role === 'owner') {
                    if ($owner !== null || $outlet !== '') {
                        throw new DomainException("CSV row {$line} conflicts with the single Owner row requirements. No records were changed.");
                    }
                    $owner = ['name' => $name, 'email' => $email];

                    continue;
                }

                if ($role === 'employee') {
                    $outletKey = $this->normalizeOutlet($outlet);
                    if (isset($employees[$email]) || $outletKey === null) {
                        throw new DomainException("CSV row {$line} has a duplicate Employee or invalid Outlet. No records were changed.");
                    }
                    $employees[$email] = ['name' => $name, 'email' => $email, 'outlet' => $outletKey];

                    continue;
                }

                if ($email === ($owner['email'] ?? null)) {
                    throw new DomainException("CSV row {$line} assigns multiple roles to the Owner identity. No records were changed.");
                }
                $outletKeys = $this->normalizeSupervisorOutlets($outlet, $line);
                if (! isset($supervisors[$email])) {
                    $supervisors[$email] = ['name' => $name, 'email' => $email, 'outlets' => []];
                }
                $supervisors[$email]['outlets'] = array_values(array_unique([
                    ...$supervisors[$email]['outlets'],
                    ...$outletKeys,
                ]));
            }

            if ($owner === null || $employees === []) {
                throw new DomainException('CSV must contain exactly one Owner and at least one Employee. No records were changed.');
            }
            if (isset($employees[$owner['email']])) {
                throw new DomainException('CSV assigns multiple roles to the Owner identity. No records were changed.');
            }
            foreach ($supervisors as $supervisor) {
                if ($supervisor['email'] === $owner['email']) {
                    throw new DomainException('CSV assigns multiple roles to the Owner identity. No records were changed.');
                }
            }

            return [
                'owner' => $owner,
                'employees' => array_values($employees),
                'supervisors' => array_values($supervisors),
            ];
        } catch (Throwable $exception) {
            if ($exception instanceof DomainException) {
                throw $exception;
            }

            throw new DomainException('CSV could not be parsed. No records were changed.');
        } finally {
            fclose($handle);
        }
    }

    public function inspect(array $plan): array
    {
        $matches = Tenant::query()->get(['id', 'name'])->filter(
            fn (Tenant $tenant): bool => mb_strtolower(trim($tenant->name)) === mb_strtolower(self::TENANT_NAME),
        );

        if ($matches->count() > 1) {
            throw new DomainException('More than one Cepat Kopi tenant exists. No records were changed.');
        }

        if ($matches->isEmpty()) {
            if (User::query()->where('email', $plan['owner']['email'])->exists()) {
                throw new DomainException('The Owner identity already exists. Resolve the identity collision before retrying.');
            }

            return ['action' => 'insert', 'tenant_id' => null];
        }

        $tenantId = (int) $matches->first()->id;
        if (! $this->matchesExistingBootstrap($tenantId, $plan)) {
            throw new DomainException('A Cepat Kopi tenant exists but does not match this bootstrap. No records were changed.');
        }

        return ['action' => 'no-op', 'tenant_id' => $tenantId];
    }

    public function execute(array $plan, string $ownerPassword): array
    {
        $connection = DB::connection();
        $lock = $connection->selectOne('SELECT GET_LOCK(?, 0) AS acquired', [self::LOCK_NAME]);
        if ((int) ($lock->acquired ?? 0) !== 1) {
            throw new DomainException('Another Cepat Kopi bootstrap is running. No records were changed.');
        }

        try {
            return $connection->transaction(function () use ($plan, $ownerPassword): array {
                $existing = $this->inspect($plan);
                if ($existing['action'] === 'no-op') {
                    return [
                        ...$existing,
                        'report' => $this->report((int) $existing['tenant_id'], $plan),
                    ];
                }

                $today = CarbonImmutable::today(SchedulingDefaults::TIMEZONE);
                $ownerUser = User::query()->create([
                    'name' => $plan['owner']['name'],
                    'email' => $plan['owner']['email'],
                    'password' => Hash::make($ownerPassword),
                ]);

                $organizations = app(OrganizationService::class);
                $tenant = $organizations->createTenant($ownerUser, self::TENANT_NAME);
                $tenantId = (int) $tenant->getKey();
                $owner = TenantMembership::query()->forTenant($tenantId)
                    ->where('user_id', $ownerUser->getKey())->firstOrFail();
                $unit = $organizations->createBusinessUnit($owner, self::TENANT_NAME);
                $outlets = [];

                foreach (self::OUTLETS as $key => $definition) {
                    $outlet = $outlets[$key] = $organizations->createOutlet($owner, $unit, $definition['name']);
                    $this->ensureCurrentCalendar($owner, $outlet, $today->toDateString());
                }

                $this->ensureTenantPolicy($owner, $today->toDateString());
                $policies = app(AttendancePolicyService::class);
                foreach (self::OUTLETS as $key => $definition) {
                    $policies->createOutletVersion(
                        $owner,
                        $outlets[$key],
                        $today->toDateString(),
                        $this->outletPolicy($definition),
                        self::REASON,
                    );
                }

                foreach ($plan['employees'] as $employeeRecord) {
                    $employee = $organizations->registerEmployee($owner, $employeeRecord['name']);
                    app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
                        $owner,
                        $employee,
                        $outlets[$employeeRecord['outlet']],
                        $today->startOfDay()->utc(),
                    );
                }

                foreach (self::SHIFTS as $definition) {
                    app(ShiftTemplateService::class)->create(
                        $owner,
                        $definition['name'],
                        $definition['start'],
                        $definition['end'],
                        false,
                        $today->toDateString(),
                        self::REASON,
                    );
                }

                if (! $this->matchesExistingBootstrap($tenantId, $plan)) {
                    throw new RuntimeException('Bootstrap verification failed; transaction rolled back.');
                }

                return [
                    'action' => 'created',
                    'tenant_id' => $tenantId,
                    'report' => $this->report($tenantId, $plan),
                ];
            });
        } finally {
            $connection->selectOne('SELECT RELEASE_LOCK(?)', [self::LOCK_NAME]);
        }
    }

    public function report(?int $tenantId, array $plan): array
    {
        $today = CarbonImmutable::today(SchedulingDefaults::TIMEZONE)->toDateString();
        $policies = app(AttendancePolicyService::class);
        $outlets = [];

        foreach (self::OUTLETS as $definition) {
            if ($tenantId === null) {
                $configuration = [
                    'attendance_mode' => 'personal',
                    'late_tolerance_minutes' => 15,
                    'require_personal_photo' => true,
                    'personal_location_validation' => ['required' => true, 'radius_meters' => 25],
                ];
                $outletPolicyDate = $today;
                $cutover = null;
            } else {
                $outlet = Outlet::query()->forTenant($tenantId)->where('name', $definition['name'])->first();
                $effective = $outlet
                    ? $policies->effective($tenantId, (int) $outlet->getKey(), $today)
                    : ['configuration' => []];
                $configuration = $effective['configuration'] ?? [];
                $outletPolicyDate = OutletAttendancePolicyVersion::query()->forTenant($tenantId)
                    ->where('outlet_id', $outlet?->getKey())
                    ->where('effective_from', '<=', $today)
                    ->orderByDesc('effective_from')
                    ->value('effective_from');
                $cutover = $outlet?->weekly_planner_start_on === null
                    ? null
                    : (string) $outlet->weekly_planner_start_on;
            }

            $location = $configuration['personal_location_validation'] ?? [];
            $outlets[$definition['name']] = [
                'effective_from' => $outletPolicyDate,
                'attendance_mode' => $configuration['attendance_mode'] ?? null,
                'late_tolerance_minutes' => $configuration['late_tolerance_minutes'] ?? null,
                'require_personal_photo' => (bool) ($configuration['require_personal_photo'] ?? false),
                'location_required' => (bool) ($location['required'] ?? false),
                'radius_meters' => isset($location['radius_meters']) ? (int) $location['radius_meters'] : null,
                'weekly_planner_start_on' => $cutover,
            ];
        }

        $tenantConfiguration = $tenantId === null
            ? $this->tenantPolicy()
            : ($policies->effective($tenantId, null, $today)['configuration'] ?? []);
        $plannerSettings = app(PlannerStaffingService::class)->settings($tenantConfiguration);
        $shiftVersions = [];
        $countForTenant = static fn (string $table): int => $tenantId === null
            ? 0
            : DB::table($table)->where('tenant_id', $tenantId)->count();

        foreach (self::SHIFTS as $key => $definition) {
            $version = null;
            if ($tenantId !== null) {
                $template = ShiftTemplate::query()->forTenant($tenantId)->where('name', $definition['name'])->first();
                $version = $template?->versions()->where('effective_from', '<=', $today)
                    ->orderByDesc('effective_from')->orderByDesc('revision')->first();
            }
            $shiftVersions[$key] = [
                'start_time' => $version?->start_time ?? $definition['start'].':00',
                'end_time' => $version?->end_time ?? $definition['end'].':00',
                'version_id' => $version ? (int) $version->getKey() : null,
            ];
        }

        return [
            'effective_date' => $today,
            'timezone' => SchedulingDefaults::TIMEZONE,
            'counts' => [
                'tenants' => 1,
                'business_units' => 1,
                'outlets' => count(self::OUTLETS),
                'owner_accounts' => 1,
                'employee_profiles' => count($plan['employees']),
                'supervisor_contacts' => count($plan['supervisors']),
                'employee_accounts_created' => 0,
                'supervisor_accounts_created' => 0,
                'schedule_weeks' => $countForTenant('schedule_weeks'),
                'schedule_entries' => $countForTenant('schedule_entries'),
                'weekly_schedule_rules' => $countForTenant('weekly_schedule_rules'),
                'schedule_exceptions' => $countForTenant('schedule_exceptions'),
                'holiday_references' => $countForTenant('tenant_holiday_references'),
                'temporary_assignments' => $tenantId === null ? 0 : DB::table('employee_outlet_assignments')
                    ->where('tenant_id', $tenantId)->where('assignment_type', 'temporary')->count(),
                'attendance_sessions' => $countForTenant('attendance_sessions'),
                'attendance_events' => $countForTenant('attendance_events'),
            ],
            'outlets' => $outlets,
            'planner_settings' => $plannerSettings,
            'shift_versions' => $shiftVersions,
            'staging_environment' => ['ATTENDANCE_EVIDENCE_REQUIRE_PERSONAL_PHOTO' => 'true'],
        ];
    }

    private function matchesExistingBootstrap(int $tenantId, array $plan): bool
    {
        $tenant = Tenant::query()->whereKey($tenantId)->first();
        if (! $tenant || mb_strtolower(trim($tenant->name)) !== mb_strtolower(self::TENANT_NAME)) {
            return false;
        }

        $bootstrapDate = CarbonImmutable::parse($tenant->created_at)
            ->setTimezone(SchedulingDefaults::TIMEZONE)->toDateString();
        $ownerUser = User::query()->where('email', $plan['owner']['email'])->first();
        if (! $ownerUser || $ownerUser->name !== $plan['owner']['name']) {
            return false;
        }

        $ownerMembership = TenantMembership::query()->forTenant($tenantId)
            ->where('user_id', $ownerUser->getKey())->where('is_active', true)->first();
        if (! $ownerMembership || ! TenantRoleAssignment::query()->forTenant($tenantId)
            ->where('tenant_membership_id', $ownerMembership->getKey())
            ->where('role', TenantRole::Owner->value)->exists()) {
            return false;
        }

        $units = BusinessUnit::query()->forTenant($tenantId)->where('name', self::TENANT_NAME)->get();
        if ($units->count() !== 1) {
            return false;
        }

        $outlets = Outlet::query()->forTenant($tenantId)->where('business_unit_id', $units->first()->getKey())
            ->get()->keyBy('name');
        if ($outlets->count() !== count(self::OUTLETS)) {
            return false;
        }

        foreach (self::OUTLETS as $definition) {
            $outlet = $outlets->get($definition['name']);
            if (! $outlet) {
                return false;
            }

            $calendar = OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outlet->getKey())
                ->where('effective_from', $bootstrapDate)->first();
            if (! $calendar || $calendar->timezone !== SchedulingDefaults::TIMEZONE
                || array_map('intval', $calendar->operating_weekdays) !== SchedulingDefaults::operatingWeekdays()) {
                return false;
            }

            $policy = OutletAttendancePolicyVersion::query()->forTenant($tenantId)
                ->where('outlet_id', $outlet->getKey())->where('effective_from', $bootstrapDate)->first();
            if (! $policy || $policy->overrides != $this->outletPolicy($definition)) {
                return false;
            }
        }

        $tenantPolicy = TenantAttendancePolicyVersion::query()->forTenant($tenantId)
            ->where('effective_from', $bootstrapDate)->first();
        if (! $tenantPolicy || $tenantPolicy->configuration != $this->tenantPolicy()) {
            return false;
        }

        $actualEmployees = [];
        foreach (Employee::query()->forTenant($tenantId)->get() as $employee) {
            $assignment = EmployeeOutletAssignment::query()->forTenant($tenantId)
                ->where('employee_id', $employee->getKey())
                ->where('assignment_type', 'primary')
                ->where('effective_from', $this->localDayStartUtc($bootstrapDate))
                ->where('effective_until', self::OPEN_ENDED_AT)
                ->first();
            if (! $assignment) {
                return false;
            }
            $outletKey = collect(self::OUTLETS)->search(
                fn (array $definition): bool => (int) $outlets[$definition['name']]->getKey() === (int) $assignment->outlet_id,
            );
            if (! is_string($outletKey)) {
                return false;
            }
            $actualEmployees[] = [$employee->name, $outletKey];
        }

        $expectedEmployees = array_map(
            static fn (array $employee): array => [$employee['name'], $employee['outlet']],
            $plan['employees'],
        );
        sort($actualEmployees);
        sort($expectedEmployees);
        if ($actualEmployees !== $expectedEmployees) {
            return false;
        }

        foreach (self::SHIFTS as $definition) {
            $template = ShiftTemplate::query()->forTenant($tenantId)->where('name', $definition['name'])->first();
            $version = $template?->versions()->where('effective_from', $bootstrapDate)->where('revision', 1)->first();
            if (! $version || $version->start_time !== $definition['start'].':00'
                || $version->end_time !== $definition['end'].':00' || $version->crosses_midnight) {
                return false;
            }
        }

        return true;
    }

    private function ensureTenantPolicy(TenantMembership $owner, string $effectiveFrom): void
    {
        $policies = app(AttendancePolicyService::class);
        $existing = TenantAttendancePolicyVersion::query()->forTenant((int) $owner->tenant_id)
            ->where('effective_from', $effectiveFrom)->exists();

        if ($existing) {
            $policies->reviseTenantVersion($owner, $effectiveFrom, $this->tenantPolicy(), self::REASON);

            return;
        }

        $policies->createTenantVersion($owner, $effectiveFrom, $this->tenantPolicy(), self::REASON);
    }

    private function ensureCurrentCalendar(TenantMembership $owner, Outlet $outlet, string $effectiveFrom): void
    {
        $exists = OutletCalendarVersion::query()->forTenant((int) $owner->tenant_id)
            ->where('outlet_id', $outlet->getKey())->where('effective_from', $effectiveFrom)->exists();
        if ($exists) {
            return;
        }

        app(OutletCalendarService::class)->createVersion(
            $owner,
            $outlet,
            $effectiveFrom,
            SchedulingDefaults::TIMEZONE,
            SchedulingDefaults::operatingWeekdays(),
            self::REASON,
        );
    }

    private function tenantPolicy(): array
    {
        return [
            ...SchedulingDefaults::attendancePolicy(),
            'late_tolerance_minutes' => 15,
            'attendance_mode' => 'personal',
            'personal_location_validation' => ['required' => true, 'radius_meters' => 25],
            'require_personal_photo' => true,
            'planner_weekend_starts_on' => 5,
            'planner_shift_profile' => 'cepat_kopi',
        ];
    }

    private function outletPolicy(array $definition): array
    {
        return [
            'personal_location_validation' => [
                'required' => true,
                'radius_meters' => 25,
                'latitude' => $definition['latitude'],
                'longitude' => $definition['longitude'],
            ],
        ];
    }

    private function normalizeOutlet(string $value): ?string
    {
        $normalized = mb_strtolower(trim($value));
        foreach (self::OUTLETS as $key => $definition) {
            if (in_array($normalized, [mb_strtolower($key), mb_strtolower($definition['name'])], true)) {
                return $key;
            }
        }

        return null;
    }

    /** @return list<string> */
    private function normalizeSupervisorOutlets(string $value, int $line): array
    {
        if (trim($value) === '') {
            return [];
        }

        $outlets = [];
        foreach (explode('|', $value) as $item) {
            $key = $this->normalizeOutlet($item);
            if ($key === null) {
                throw new DomainException("CSV row {$line} has an invalid Supervisor Outlet. No records were changed.");
            }
            $outlets[] = $key;
        }
        if (count(array_unique($outlets)) !== count($outlets)) {
            throw new DomainException("CSV row {$line} repeats a Supervisor Outlet. No records were changed.");
        }

        return $outlets;
    }

    private function localDayStartUtc(string $date): string
    {
        return CarbonImmutable::parse($date, SchedulingDefaults::TIMEZONE)
            ->startOfDay()->utc()->format('Y-m-d H:i:s');
    }
}
