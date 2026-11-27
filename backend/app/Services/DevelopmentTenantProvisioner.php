<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\ManagementChangeEvent;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Models\Tenant;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use App\Support\SchedulingDefaults;
use App\Support\VerifiedDisposableTestDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

final class DevelopmentTenantProvisioner
{
    public const TENANT_NAME = 'Operasional Cepat Kopi & Teh Poci';

    /** @var array<string, list<string>> */
    private const ORGANIZATION = [
        'Cepat Kopi' => [
            'Cepat Kopi Karangawen',
            'Cepat Kopi Kaliceret',
        ],
        'Teh Poci' => [
            'Teh Poci Karangawen',
            'Teh Poci Sugihmanik',
            'Teh Poci Kaliceret',
        ],
    ];

    private const LOCK_NAME = 'hadirinaja:development-tenant-provisioning';

    public function __construct(
        private readonly OrganizationService $organization,
        private readonly ManagementChangeRecorder $changes,
    ) {}

    /** @return array<string, mixed> */
    public function provision(User $owner): array
    {
        $environment = app()->environment();
        $connectionConfig = config('database.connections.'.config('database.default'));

        $isApprovedLocalDatabase = $environment === 'local'
            && config('database.default') === 'mysql'
            && is_array($connectionConfig)
            && ($connectionConfig['database'] ?? null) === 'hadirinaja_dev'
            && in_array($connectionConfig['host'] ?? null, ['127.0.0.1', 'localhost', '::1'], true)
            && (string) ($connectionConfig['port'] ?? '') === '3306'
            && ! filled($connectionConfig['url'] ?? null);
        $isVerifiedTestDatabase = $environment === 'testing'
            && config('database.default') === 'mysql'
            && is_array($connectionConfig)
            && VerifiedDisposableTestDatabase::isConfigured($connectionConfig);

        if (! $isApprovedLocalDatabase && ! $isVerifiedTestDatabase) {
            throw new RuntimeException('Development tenant provisioning is restricted to its verified local or isolated test database.');
        }

        $connection = DB::connection();
        if ($isVerifiedTestDatabase) {
            VerifiedDisposableTestDatabase::assertConnected($connection);
        }
        $database = $connection->getDatabaseName();
        $expectedDatabase = $environment === 'local' ? 'hadirinaja_dev' : 'hadirinaja_test';
        if ($database !== $expectedDatabase) {
            throw new RuntimeException('The active database does not match its approved environment.');
        }

        $lock = $connection->selectOne('SELECT GET_LOCK(?, 5) AS acquired', [self::LOCK_NAME]);

        if ((int) ($lock->acquired ?? 0) !== 1) {
            throw new RuntimeException('Another development tenant provisioning operation is active.');
        }

        try {
            return $connection->transaction(function () use ($owner): array {
                $this->assertTargetDoesNotExist();
                $existingMemberships = $this->ownerMembershipSnapshot($owner);
                $tenant = $this->organization->createTenant($owner, self::TENANT_NAME);
                $membership = TenantMembership::query()
                    ->forTenant((int) $tenant->getKey())
                    ->where('user_id', $owner->getKey())
                    ->firstOrFail();

                $roles = $membership->roles()->pluck('role')->map(fn ($role): string => $role->value)->sort()->values()->all();
                if (! $membership->is_active || $roles !== [TenantRole::Owner->value]) {
                    throw new RuntimeException('Tenant creation did not produce an active Owner membership.');
                }

                $units = [];
                $outlets = [];
                $events = [];
                $calendars = [];

                foreach (self::ORGANIZATION as $unitName => $outletNames) {
                    $unit = $this->organization->createBusinessUnit($membership, $unitName);
                    $units[] = $unit;
                    $events[] = $this->changes->record($membership, 'business_unit', (int) $unit->getKey(), 'created', ['name']);

                    foreach ($outletNames as $outletName) {
                        $outlet = $this->organization->createOutlet($membership, $unit, $outletName);
                        $outlets[] = $outlet;
                        $events[] = $this->changes->record(
                            $membership,
                            'outlet',
                            (int) $outlet->getKey(),
                            'created',
                            ['name', 'business_unit_id'],
                            null,
                            (int) $outlet->getKey(),
                        );
                        $calendars[] = OutletCalendarVersion::query()
                            ->forTenant((int) $tenant->getKey())
                            ->where('outlet_id', $outlet->getKey())
                            ->firstOrFail();
                    }
                }

                $this->assertExistingMembershipsUnchanged($owner, $existingMemberships);
                $this->assertProvisionedOrganization($tenant, $membership, $units, $outlets, $events, $calendars);

                return [
                    'tenant' => $tenant,
                    'membership' => $membership,
                    'tenant_policy' => TenantAttendancePolicyVersion::query()
                        ->forTenant((int) $tenant->getKey())->firstOrFail(),
                    'owner_role' => TenantRoleAssignment::query()
                        ->forTenant((int) $tenant->getKey())
                        ->where('tenant_membership_id', $membership->getKey())
                        ->where('role', TenantRole::Owner->value)
                        ->firstOrFail(),
                    'business_units' => $units,
                    'outlets' => $outlets,
                    'calendars' => $calendars,
                    'management_events' => $events,
                ];
            });
        } finally {
            $connection->selectOne('SELECT RELEASE_LOCK(?) AS released', [self::LOCK_NAME]);
        }
    }

    private function assertTargetDoesNotExist(): void
    {
        $target = mb_strtolower(trim(self::TENANT_NAME));
        $exists = Tenant::query()->get(['name'])->contains(
            fn (Tenant $tenant): bool => mb_strtolower(trim($tenant->name)) === $target,
        );

        if ($exists) {
            throw ValidationException::withMessages(['tenant' => 'The target development tenant already exists.']);
        }
    }

    /** @return array<int, array{tenant_id:int,active:bool,roles:list<string>}> */
    private function ownerMembershipSnapshot(User $owner): array
    {
        return $owner->memberships()->with('roles')->orderBy('id')->get()
            ->mapWithKeys(fn (TenantMembership $membership): array => [(int) $membership->getKey() => [
                'tenant_id' => (int) $membership->tenant_id,
                'active' => (bool) $membership->is_active,
                'roles' => $membership->roles->pluck('role')->map(fn ($role): string => $role->value)->sort()->values()->all(),
            ]])->all();
    }

    /** @param array<int, array{tenant_id:int,active:bool,roles:list<string>}> $snapshot */
    private function assertExistingMembershipsUnchanged(User $owner, array $snapshot): void
    {
        $current = $this->ownerMembershipSnapshot($owner);
        $existingMemberships = array_intersect_key($current, $snapshot);

        if ($existingMemberships !== $snapshot || count($current) !== count($snapshot) + 1) {
            throw new RuntimeException('Existing Owner memberships changed during development tenant provisioning.');
        }
    }

    /** @param list<BusinessUnit> $units
     * @param  list<Outlet>  $outlets
     * @param  list<ManagementChangeEvent>  $events
     * @param  list<OutletCalendarVersion>  $calendars
     */
    private function assertProvisionedOrganization(
        Tenant $tenant,
        TenantMembership $membership,
        array $units,
        array $outlets,
        array $events,
        array $calendars,
    ): void {
        $tenantId = (int) $tenant->getKey();
        $unitIds = collect($units)->keyBy('name');
        $outletsByName = collect($outlets)->keyBy('name');
        $policy = TenantAttendancePolicyVersion::query()->forTenant($tenantId)->get();
        $expectedPolicy = SchedulingDefaults::attendancePolicy();

        if (
            count($units) !== 2
            || count($outlets) !== 5
            || count($events) !== 7
            || count($calendars) !== 5
            || $unitIds->keys()->sort()->values()->all() !== ['Cepat Kopi', 'Teh Poci']
            || $outletsByName->count() !== 5
            || $policy->count() !== 1
            || $policy->first()->configuration != $expectedPolicy
            || $policy->first()->effective_from->toDateString() !== $tenant->created_at->toDateString()
            || (int) $policy->first()->actor_user_id !== (int) $membership->user_id
            || $policy->first()->reason !== 'Kebijakan awal tenant.'
        ) {
            throw new RuntimeException('Created organization record counts or tenant policy do not match the approved plan.');
        }

        $expectedOutletsByUnit = [
            'Cepat Kopi' => ['Cepat Kopi Karangawen', 'Cepat Kopi Kaliceret'],
            'Teh Poci' => ['Teh Poci Karangawen', 'Teh Poci Sugihmanik', 'Teh Poci Kaliceret'],
        ];
        foreach ($expectedOutletsByUnit as $unitName => $names) {
            $unit = $unitIds->get($unitName);
            foreach ($names as $name) {
                $outlet = $outletsByName->get($name);
                if (! $outlet || (int) $outlet->tenant_id !== $tenantId || (int) $outlet->business_unit_id !== (int) $unit->getKey()) {
                    throw new RuntimeException('An Outlet is missing or linked to the wrong tenant or Business Unit.');
                }
            }
        }

        $calendarOutletIds = [];
        foreach ($calendars as $calendar) {
            $outlet = $outletsByName->firstWhere('id', $calendar->outlet_id);
            if (
                (int) $calendar->tenant_id !== $tenantId
                || ! $outlet
                || $calendar->timezone !== 'Asia/Jakarta'
                || $calendar->operating_weekdays !== [1, 2, 3, 4, 5, 6, 7]
                || (int) $calendar->actor_user_id !== (int) $membership->user_id
                || $calendar->effective_from->toDateString() !== $outlet->created_at->toDateString()
                || $calendar->reason !== 'Kalender awal outlet menggunakan zona waktu Asia/Jakarta dan buka setiap hari.'
            ) {
                throw new RuntimeException('An initial Outlet calendar does not match the approved baseline.');
            }
            $calendarOutletIds[] = (int) $calendar->outlet_id;
        }
        if (count(array_unique($calendarOutletIds)) !== 5) {
            throw new RuntimeException('Each Outlet must have exactly one initial calendar.');
        }

        $expectedEventSubjects = collect($units)->map(fn (BusinessUnit $unit): array => [
            'subject_type' => 'business_unit',
            'subject_id' => (int) $unit->getKey(),
            'outlet_id' => null,
            'changed_fields' => ['name'],
        ])->merge(collect($outlets)->map(fn (Outlet $outlet): array => [
            'subject_type' => 'outlet',
            'subject_id' => (int) $outlet->getKey(),
            'outlet_id' => (int) $outlet->getKey(),
            'changed_fields' => ['name', 'business_unit_id'],
        ]))->sortBy(fn (array $event): string => $event['subject_type'].':'.$event['subject_id'])->values()->all();
        $actualEvents = collect($events)->map(function (ManagementChangeEvent $event) use ($membership, $tenantId): array {
            if (
                (int) $event->tenant_id !== $tenantId
                || (int) $event->actor_user_id !== (int) $membership->user_id
                || (int) $event->actor_membership_id !== (int) $membership->getKey()
                || $event->action !== 'created'
                || $event->employee_id !== null
            ) {
                throw new RuntimeException('A management creation event has an unexpected tenant or actor.');
            }

            return [
                'subject_type' => $event->subject_type,
                'subject_id' => (int) $event->subject_id,
                'outlet_id' => $event->outlet_id === null ? null : (int) $event->outlet_id,
                'changed_fields' => $event->changed_fields,
            ];
        })->sortBy(fn (array $event): string => $event['subject_type'].':'.$event['subject_id'])->values()->all();
        if ($actualEvents !== $expectedEventSubjects) {
            throw new RuntimeException('Management creation events do not match the expected audit payloads.');
        }

        if (
            DB::table('outlet_attendance_policy_versions')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('employees')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('employee_outlet_assignments')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('attendance_sessions')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('attendance_events')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('attendance_corrections')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('attendance_finalizations')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('attendance_idempotency_records')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('kiosk_devices')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('kiosk_pairing_codes')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('employee_pin_enrollment_codes')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('shift_templates')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('shift_template_versions')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('weekly_schedule_rules')->where('tenant_id', $tenantId)->count() !== 0
            || DB::table('schedule_exceptions')->where('tenant_id', $tenantId)->count() !== 0
        ) {
            throw new RuntimeException('Unexpected operational records exist in the new tenant.');
        }
    }
}
