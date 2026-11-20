<?php

namespace Database\Seeders;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceEvidence;
use App\Models\Employee;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\ApprovalWorkflowService;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\PlannerStaffingService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use App\Services\WeeklyPlannerService;
use App\Support\EmployeeUatDatabaseGuard;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

final class EmployeeUatSeeder extends Seeder
{
    private const MAIN_TENANT = 'HadirinAja Employee UAT';

    private const FOREIGN_TENANT = 'HadirinAja Foreign UAT';

    public function run(): void
    {
        EmployeeUatDatabaseGuard::assertTarget();
        $password = (string) env('HADIRINAJA_UAT_EMPLOYEE_PASSWORD');

        if (! preg_match('/^[a-f0-9]{64}$/D', $password)) {
            throw new RuntimeException('The private Employee UAT password is missing or invalid.');
        }

        if (Tenant::query()->exists()) {
            throw new RuntimeException('EmployeeUatSeeder requires a fresh, empty Employee UAT database.');
        }

        DB::transaction(function () use ($password): void {
            $today = CarbonImmutable::now('Asia/Jakarta')->startOfDay();
            $now = CarbonImmutable::now('Asia/Jakarta');
            $utcToday = CarbonImmutable::today('UTC')->toDateString();
            $todayString = $today->toDateString();
            $futureWeek = $today->startOfWeek()->addWeek()->toDateString();
            $shiftStart = $now->subMinutes(20);
            if ($shiftStart->toDateString() !== $todayString) {
                $shiftStart = $today;
            }
            $shiftEnd = $now->addHours(6);
            $crossesMidnight = $shiftEnd->toDateString() !== $todayString;

            $organizations = app(OrganizationService::class);
            $memberships = app(TenantMembershipService::class);
            $assignments = app(EmployeeOutletAssignmentService::class);
            $policies = app(AttendancePolicyService::class);
            $shiftTemplates = app(ShiftTemplateService::class);

            $ownerUser = $this->user('uat.owner@example.test', 'Employee UAT Owner', $password);
            $tenant = $organizations->createTenant($ownerUser, self::MAIN_TENANT);
            $owner = TenantMembership::query()->forTenant((int) $tenant->getKey())
                ->where('user_id', $ownerUser->getKey())->firstOrFail();
            $businessUnit = $organizations->createBusinessUnit($owner, 'UAT Operations');
            $primaryOutlet = $organizations->createOutlet($owner, $businessUnit, 'UAT Central');
            $secondaryOutlet = $organizations->createOutlet($owner, $businessUnit, 'UAT Riverside');

            $checkIn = $this->employee(
                $owner,
                'uat.checkin@example.test',
                'Employee UAT Check-in',
                $password,
                $organizations,
                $memberships,
            );
            $checkOut = $this->employee(
                $owner,
                'uat.checkout@example.test',
                'Employee UAT Checkout',
                $password,
                $organizations,
                $memberships,
            );

            foreach ([$checkIn, $checkOut] as $fixture) {
                $assignments->assignPrimaryOutlet(
                    $owner,
                    $fixture['employee'],
                    $primaryOutlet,
                    CarbonImmutable::now('UTC')->subDay(),
                );
            }

            $policy = [
                'attendance_mode' => 'hybrid',
                'personal_location_validation' => [
                    'required' => false,
                    'radius_meters' => 100,
                    'latitude' => -6.2088,
                    'longitude' => 106.8456,
                ],
            ];
            foreach ([$primaryOutlet, $secondaryOutlet] as $outlet) {
                $policies->createOutletVersion($owner, $outlet, $utcToday, $policy, 'Deterministic Employee UAT policy.');
            }

            $shift = $shiftTemplates->create(
                $owner,
                'UAT Current Shift',
                $shiftStart->format('H:i'),
                $shiftEnd->format('H:i'),
                $crossesMidnight,
                $utcToday,
                'Current-time Employee UAT eligibility window.',
            )->versions->firstOrFail();
            $staffingShifts = [];
            foreach (PlannerStaffingService::SHIFTS as $role => [$start, $end]) {
                $staffingShifts[$role] = $shiftTemplates->create(
                    $owner,
                    'UAT Staffing '.ucfirst($role),
                    $start,
                    $end,
                    false,
                    $utcToday,
                    'Required staffing template for the published Employee UAT roster.',
                )->versions->firstOrFail()->getKey();
            }

            foreach ([$checkIn, $checkOut] as $fixture) {
                DB::table('weekly_schedule_rules')->insert([
                    'tenant_id' => $tenant->getKey(),
                    'employee_id' => $fixture['employee']->getKey(),
                    'outlet_id' => $primaryOutlet->getKey(),
                    'weekday' => $today->isoWeekday(),
                    'shift_template_version_id' => $shift->getKey(),
                    'effective_from' => $todayString,
                    'effective_until' => null,
                    'created_by_user_id' => $ownerUser->getKey(),
                    'created_at' => CarbonImmutable::now('UTC'),
                    'updated_at' => CarbonImmutable::now('UTC'),
                ]);
            }

            $this->publishFutureRoster(
                $owner,
                (int) $primaryOutlet->getKey(),
                $futureWeek,
                $checkIn['employee'],
                $checkOut['employee'],
                $staffingShifts,
            );

            $workflow = app(ApprovalWorkflowService::class);
            $requestDates = [
                $today->addDays(3)->toDateString(),
                $today->addDays(5)->toDateString(),
                $today->addDays(7)->toDateString(),
            ];
            $requests = [];
            foreach ($requestDates as $index => $date) {
                $requests[] = $workflow->submitEmployeeRequest(
                    $checkIn['membership'],
                    $checkIn['user'],
                    [
                        'type' => 'leave',
                        'category' => 'annual',
                        'starts_on' => $date,
                        'ends_on' => $date,
                        'reason' => 'Synthetic Employee UAT request '.($index + 1).'.',
                    ],
                    sprintf('d0000000-0000-4000-8000-%012d', $index + 1),
                );
            }
            $workflow->decide(
                $owner,
                $ownerUser,
                (int) $requests[1]->getKey(),
                'approved',
                'Synthetic Employee UAT approval.',
                'd0000000-0000-4000-8001-000000000001',
            );
            $workflow->decide(
                $owner,
                $ownerUser,
                (int) $requests[2]->getKey(),
                'rejected',
                'Synthetic Employee UAT rejection.',
                'd0000000-0000-4000-8001-000000000002',
            );

            foreach ([$checkIn, $checkOut] as $fixture) {
                $assignments->assignTemporaryOutlet(
                    $owner,
                    $fixture['employee'],
                    $secondaryOutlet,
                    CarbonImmutable::now('UTC')->subDays(10),
                    CarbonImmutable::now('UTC')->subDays(2),
                );
            }

            $attendance = app(AttendanceService::class)->checkIn(
                AttendanceActor::personal($checkOut['membership']),
                $checkOut['employee'],
                $primaryOutlet,
                'd0000000-0000-4000-8002-000000000001',
                null,
                null,
            );
            if ($attendance['status'] !== 201) {
                throw new RuntimeException('The synthetic checkout-eligible session could not be created.');
            }

            AttendanceEvidence::query()->create([
                'tenant_id' => $tenant->getKey(),
                'attendance_session_id' => (int) $attendance['body']['session']['id'],
                'attendance_event_id' => (int) $attendance['body']['event']['id'],
                'evidence_type' => 'personal_photo',
                'storage_path' => null,
                'detected_mime_type' => null,
                'stored_mime_type' => null,
                'stored_size_bytes' => null,
                'image_width' => null,
                'image_height' => null,
                'sha256' => null,
                'validation_status' => 'validated_normalized',
                'received_at' => CarbonImmutable::now('UTC')->subDays(91),
                'lifecycle_state' => 'expired',
                'expires_at' => CarbonImmutable::now('UTC')->subDay(),
                'deletion_attempts' => 1,
            ]);

            $foreignOwnerUser = $this->user('uat.foreign-owner@example.test', 'Employee UAT Foreign Owner', $password);
            $foreignTenant = $organizations->createTenant($foreignOwnerUser, self::FOREIGN_TENANT);
            $foreignOwner = TenantMembership::query()->forTenant((int) $foreignTenant->getKey())
                ->where('user_id', $foreignOwnerUser->getKey())->firstOrFail();
            $foreignEmployee = $organizations->registerEmployee($foreignOwner, 'Employee UAT Foreign');
            $foreignEmployeeUser = $this->user('uat.foreign@example.test', 'Employee UAT Foreign', $password);
            $foreignMembership = $memberships->addMembership($foreignOwner, $foreignEmployeeUser);
            $memberships->assignRole($foreignOwner, $foreignMembership, TenantRole::Employee);
            $memberships->linkEmployee($foreignOwner, $foreignMembership, $foreignEmployee);

            $workflow->submitEmployeeRequest(
                $foreignMembership,
                $foreignEmployeeUser,
                [
                    'type' => 'leave',
                    'category' => 'permission',
                    'starts_on' => $today->addDays(4)->toDateString(),
                    'ends_on' => $today->addDays(4)->toDateString(),
                    'reason' => 'Synthetic foreign-tenant isolation request.',
                ],
                'd0000000-0000-4000-8003-000000000001',
            );
        });

        $this->command?->info('Employee UAT fixtures created: check-in, checkout, requests, published roster, two outlets, tenant isolation, and expired evidence tombstone.');
    }

    /** @return array{employee: Employee, user: User, membership: TenantMembership} */
    private function employee(
        TenantMembership $owner,
        string $email,
        string $name,
        string $password,
        OrganizationService $organizations,
        TenantMembershipService $memberships,
    ): array {
        $employee = $organizations->registerEmployee($owner, $name);
        $user = $this->user($email, $name, $password);
        $membership = $memberships->addMembership($owner, $user);
        $memberships->assignRole($owner, $membership, TenantRole::Employee);
        $memberships->linkEmployee($owner, $membership, $employee);

        return compact('employee', 'user', 'membership');
    }

    private function user(string $email, string $name, string $password): User
    {
        return User::query()->create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
        ]);
    }

    private function publishFutureRoster(
        TenantMembership $owner,
        int $outletId,
        string $weekStart,
        Employee $checkInEmployee,
        Employee $checkOutEmployee,
        array $staffingShifts,
    ): void {
        $planner = app(WeeklyPlannerService::class);
        $current = $planner->read($owner, $outletId, $weekStart);
        $entries = [];

        for ($offset = 0; $offset < 7; $offset++) {
            $date = CarbonImmutable::parse($weekStart, 'Asia/Jakarta')->addDays($offset)->toDateString();
            foreach ([$checkInEmployee, $checkOutEmployee] as $employee) {
                $isRest = ((int) $employee->getKey() === (int) $checkInEmployee->getKey() && $offset === 6)
                    || ((int) $employee->getKey() === (int) $checkOutEmployee->getKey() && $offset === 2);
                $entries[] = [
                    'employee_id' => (int) $employee->getKey(),
                    'work_date' => $date,
                    'status' => $isRest ? 'rest' : 'work',
                    'shift_template_version_id' => $isRest
                        ? null
                        : $staffingShifts[
                            (int) $employee->getKey() === (int) $checkInEmployee->getKey() ? 'morning' : 'evening'
                        ],
                ];
            }
        }

        $draft = $planner->save($owner, $outletId, $weekStart, [
            'expected_version' => (int) $current['version'],
            'reason' => 'Deterministic Employee UAT published schedule.',
            'staffing' => $staffingShifts,
            'entries' => $entries,
        ], 'employee-uat-roster-save');

        $planner->publish($owner, $outletId, $weekStart, [
            'expected_version' => (int) $draft['version'],
            'expected_published_revision_id' => null,
            'activate_cutover' => true,
            'warnings_checksum' => $draft['staffing_report']['checksum'],
            'reason' => 'Activate deterministic Employee UAT schedule.',
        ], 'employee-uat-roster-publish');
    }
}
