<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\BusinessUnit;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\OutletAttendancePolicyVersion;
use App\Models\OutletCalendarException;
use App\Models\OutletCalendarVersion;
use App\Models\ScheduleException;
use App\Models\ShiftTemplate;
use App\Models\ShiftTemplateVersion;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantHolidayReference;
use App\Models\TenantMembership;
use App\Models\User;
use App\Models\WeeklyScheduleRule;
use App\Services\AttendancePolicyService;
use App\Services\EffectiveScheduleResolver;
use App\Services\EmployeeScheduleService;
use App\Services\LocalTimeResolver;
use App\Services\OutletCalendarService;
use App\Services\ShiftTemplateService;
use App\Services\TenantAuthorization;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class SchedulingController extends Controller
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly AttendancePolicyService $policies,
        private readonly ShiftTemplateService $shifts,
        private readonly EmployeeScheduleService $schedules,
        private readonly OutletCalendarService $calendars,
        private readonly EffectiveScheduleResolver $resolver,
        private readonly LocalTimeResolver $localTime,
    ) {}

    public function context(Request $request): JsonResponse
    {
        $membership = $this->activeMembership($request);
        $tenantId = (int) $membership->tenant_id;
        /** @var User $user */
        $user = $request->user();
        $owner = $this->authorization->isOwner($membership);
        $supervisor = $this->authorization->hasRole($membership, TenantRole::Supervisor);
        $manager = $owner || $supervisor;
        $units = $this->authorization->businessUnitsFor($user, $tenantId);
        $outlets = $this->authorization->outletsFor($user, $tenantId);
        $employeeId = $this->linkedEmployeeId($membership);

        if ($owner) {
            $employees = Employee::query()->forTenant($tenantId)->orderBy('name')->get();
        } elseif ($supervisor) {
            $outletIds = $membership->supervisorScopes()->where('tenant_id', $tenantId)->pluck('outlet_id');
            $employeeIds = EmployeeOutletAssignment::query()->forTenant($tenantId)->whereIn('outlet_id', $outletIds)->distinct()->pluck('employee_id');
            $ruleEmployeeIds = WeeklyScheduleRule::query()->forTenant($tenantId)->whereIn('outlet_id', $outletIds)->distinct()->pluck('employee_id');
            $employees = Employee::query()->forTenant($tenantId)->whereIn('id', $employeeIds->merge($ruleEmployeeIds)->unique())->orderBy('name')->get();
        } else {
            $employees = $employeeId === null ? collect() : Employee::query()->forTenant($tenantId)->whereKey($employeeId)->get();
        }

        $shiftTemplates = $manager ? ShiftTemplate::query()->forTenant($tenantId)->with(['versions' => fn ($query) => $query->orderBy('revision')])
            ->orderBy('name')->get()->map(fn (ShiftTemplate $template): array => $this->templateData($template))->values() : collect();

        return response()->json([
            'tenant' => ['id' => $tenantId, 'name' => $membership->tenant->name],
            'user' => ['id' => (int) $user->getKey(), 'name' => $user->name],
            'roles' => $membership->roles()->pluck('role')->map(fn ($role): string => $role instanceof TenantRole ? $role->value : (string) $role)->values(),
            'capabilities' => [
                'manage_schedules' => $manager,
                'manage_policies' => $owner,
                'manage_templates' => $owner,
                'manage_calendars' => $owner,
                'read_personal_schedule' => $employeeId !== null,
            ],
            'employee_id' => $employeeId,
            'business_units' => $units->map(fn (BusinessUnit $unit): array => ['id' => (int) $unit->getKey(), 'name' => $unit->name])->values(),
            'outlets' => $outlets->map(fn (Outlet $outlet): array => [
                'id' => (int) $outlet->getKey(),
                'name' => $outlet->name,
                'business_unit_id' => (int) $outlet->business_unit_id,
            ])->values(),
            'employees' => $employees->map(fn (Employee $employee): array => ['id' => (int) $employee->getKey(), 'name' => $employee->name])->values(),
            'shift_templates' => $shiftTemplates,
        ]);
    }

    public function week(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'week_start' => ['required', 'date_format:Y-m-d'],
            'outlet_id' => ['required', 'integer', 'min:1'],
        ]);
        $membership = $this->activeMembership($request);
        $tenantId = (int) $membership->tenant_id;
        $outlet = $this->tenantOutlet($tenantId, (int) $validated['outlet_id']);
        $this->requireManager($membership);
        $this->requireOutletScope($membership, $outlet);
        $date = CarbonImmutable::createFromFormat('!Y-m-d', $validated['week_start'], 'UTC');

        if (! $date || $date->toDateString() !== $validated['week_start']) {
            return response()->json(['message' => 'Tanggal awal minggu tidak valid.'], 422);
        }

        $timezone = $this->timezoneAt($tenantId, (int) $outlet->getKey(), $date->toDateString());
        $start = $this->localTime->instant($date->toDateString(), '00:00:00', $timezone)->setTimezone(new \DateTimeZone('UTC'));
        $end = $this->localTime->instant($date->addDays(7)->toDateString(), '00:00:00', $timezone)->setTimezone(new \DateTimeZone('UTC'));
        $assignedEmployeeIds = EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('outlet_id', $outlet->getKey())
            ->where('effective_from', '<', $end)->where('effective_until', '>', $start)
            ->distinct()->pluck('employee_id');
        $ruleEmployeeIds = WeeklyScheduleRule::query()->forTenant($tenantId)->where('outlet_id', $outlet->getKey())
            ->where('effective_from', '<', $date->addDays(7)->toDateString())
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $date->toDateString()))
            ->distinct()->pluck('employee_id');
        $exceptionEmployeeIds = ScheduleException::query()->forTenant($tenantId)->where('outlet_id', $outlet->getKey())
            ->whereBetween('work_date', [$date->toDateString(), $date->addDays(6)->toDateString()])
            ->whereNull('superseded_at')->distinct()->pluck('employee_id');
        $employeeIds = $assignedEmployeeIds->merge($ruleEmployeeIds)->merge($exceptionEmployeeIds)->unique()->map(fn ($id): int => (int) $id)->values();
        $employees = Employee::query()->forTenant($tenantId)->whereIn('id', $employeeIds)->orderBy('name')->get()->keyBy('id');
        $resolved = $this->resolver->resolveWeek($tenantId, $employeeIds->all(), $date->toDateString(), 7, (int) $outlet->getKey());
        $daysByEmployee = collect($resolved)->groupBy('employeeId');

        return response()->json([
            'week_start' => $date->toDateString(),
            'week_end' => $date->addDays(6)->toDateString(),
            'timezone' => $timezone,
            'outlet' => ['id' => (int) $outlet->getKey(), 'name' => $outlet->name, 'business_unit_id' => (int) $outlet->business_unit_id],
            'days' => collect(range(0, 6))->map(fn (int $offset): string => $date->addDays($offset)->toDateString())->values(),
            'employees' => $employees->map(fn (Employee $employee): array => [
                'id' => (int) $employee->getKey(),
                'name' => $employee->name,
                'days' => ($daysByEmployee->get($employee->getKey()) ?? collect())->map->toArray()->values(),
            ])->values(),
        ]);
    }

    public function personalWeek(Request $request): JsonResponse
    {
        $validated = $request->validate(['week_start' => ['required', 'date_format:Y-m-d']]);
        $membership = $this->activeMembership($request);
        $employeeId = $this->linkedEmployeeId($membership);

        if ($employeeId === null) {
            throw new AuthorizationException('Akun ini tidak terhubung ke identitas karyawan.');
        }

        $date = CarbonImmutable::createFromFormat('!Y-m-d', $validated['week_start'], 'UTC');
        if (! $date || $date->toDateString() !== $validated['week_start']) {
            return response()->json(['message' => 'Tanggal awal minggu tidak valid.'], 422);
        }

        $resolved = $this->resolver->resolveWeek((int) $membership->tenant_id, [$employeeId], $date->toDateString());

        return response()->json(['week_start' => $date->toDateString(), 'days' => array_map(fn ($item): array => $item->toArray(), $resolved)]);
    }

    public function resolve(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'work_date' => ['required', 'date_format:Y-m-d'],
            'outlet_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $membership = $this->activeMembership($request);
        $tenantId = (int) $membership->tenant_id;
        $employeeId = (int) $validated['employee_id'];
        $outletId = isset($validated['outlet_id']) ? (int) $validated['outlet_id'] : null;
        $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->first();

        if (! $employee) {
            return response()->json(['message' => 'Karyawan tidak tersedia.'], 404);
        }

        if ($outletId !== null) {
            $outlet = $this->tenantOutlet($tenantId, $outletId);
            $this->requireManager($membership);
            $this->requireOutletScope($membership, $outlet);
        } elseif ($this->linkedEmployeeId($membership) !== $employeeId) {
            throw new AuthorizationException('Resolver tanpa outlet hanya tersedia untuk jadwal pribadi.');
        }

        return response()->json(['schedule' => $this->resolver->resolve($tenantId, $employeeId, $validated['work_date'], $outletId)->toArray()]);
    }

    public function policy(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['nullable', 'integer', 'min:1'],
            'effective_date' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $membership = $this->activeMembership($request);
        $tenantId = (int) $membership->tenant_id;
        $owner = $this->authorization->isOwner($membership);
        $outletId = isset($validated['outlet_id']) ? (int) $validated['outlet_id'] : null;

        if ($outletId !== null) {
            $outlet = $this->tenantOutlet($tenantId, $outletId);
            $this->requireManager($membership);
            $this->requireOutletScope($membership, $outlet);
        } elseif (! $owner) {
            throw new AuthorizationException('Pilih outlet yang termasuk cakupan akses Anda.');
        }

        $date = $validated['effective_date'] ?? CarbonImmutable::today('UTC')->toDateString();
        $result = $this->policies->effective($tenantId, $outletId, $date);
        $history = $owner ? [
            'tenant_versions' => TenantAttendancePolicyVersion::query()->forTenant($tenantId)->orderBy('effective_from')->get()
                ->map(fn (TenantAttendancePolicyVersion $version): array => [
                    'id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString(),
                    'configuration' => $version->configuration, 'actor_user_id' => $version->actor_user_id,
                    'reason' => $version->reason,
                ])->values(),
            'outlet_versions' => $outletId === null ? collect() : OutletAttendancePolicyVersion::query()->forTenant($tenantId)
                ->where('outlet_id', $outletId)->orderBy('effective_from')->get()
                ->map(fn (OutletAttendancePolicyVersion $version): array => [
                    'id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString(),
                    'overrides' => $version->overrides, 'actor_user_id' => $version->actor_user_id,
                    'reason' => $version->reason,
                ])->values(),
        ] : null;

        return response()->json(['effective_date' => $date, 'effective' => $result, 'history' => $history]);
    }

    public function createTenantPolicy(Request $request): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
            'configuration' => ['required', 'array:late_tolerance_minutes,check_in_window,attendance_mode,personal_location_validation,retroactive_request_limit_days,operational_review'],
            'configuration.late_tolerance_minutes' => ['required', 'integer', 'min:0', 'max:180'],
            'configuration.check_in_window' => ['required', 'array:early_minutes,late_minutes'],
            'configuration.check_in_window.early_minutes' => ['required', 'integer', 'min:0', 'max:360'],
            'configuration.check_in_window.late_minutes' => ['required', 'integer', 'min:0', 'max:360'],
            'configuration.attendance_mode' => ['required', Rule::in(['kiosk', 'personal', 'hybrid'])],
            'configuration.personal_location_validation' => ['required', 'array:required,radius_meters,latitude,longitude'],
            'configuration.personal_location_validation.required' => ['required', 'accepted'],
            'configuration.personal_location_validation.radius_meters' => ['required', 'integer', 'min:50', 'max:5000'],
            'configuration.personal_location_validation.latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'configuration.personal_location_validation.longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'configuration.retroactive_request_limit_days' => ['required', 'integer', 'min:0', 'max:30'],
            'configuration.operational_review' => ['required', 'array:schedule_change_reason_required,minimum_notice_hours'],
            'configuration.operational_review.schedule_change_reason_required' => ['required', 'accepted'],
            'configuration.operational_review.minimum_notice_hours' => ['required', 'integer', 'min:0', 'max:168'],
        ]);
        $this->assertGeofenceCoordinatePair($validated['configuration']['personal_location_validation'], 'configuration.personal_location_validation');
        $version = $this->policies->createTenantVersion($this->activeMembership($request), $validated['effective_from'], $validated['configuration'], $validated['reason']);

        return response()->json(['version' => ['id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString()]], 201);
    }

    public function createOutletPolicy(Request $request, int $outlet): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
            'overrides' => ['required', 'array:late_tolerance_minutes,check_in_window,attendance_mode,personal_location_validation,retroactive_request_limit_days,operational_review'],
            'overrides.late_tolerance_minutes' => ['sometimes', 'integer', 'min:0', 'max:180'],
            'overrides.check_in_window' => ['sometimes', 'array:early_minutes,late_minutes'],
            'overrides.check_in_window.early_minutes' => ['sometimes', 'integer', 'min:0', 'max:360'],
            'overrides.check_in_window.late_minutes' => ['sometimes', 'integer', 'min:0', 'max:360'],
            'overrides.attendance_mode' => ['sometimes', Rule::in(['kiosk', 'personal', 'hybrid'])],
            'overrides.personal_location_validation' => ['sometimes', 'array:required,radius_meters,latitude,longitude'],
            'overrides.personal_location_validation.required' => ['sometimes', 'accepted'],
            'overrides.personal_location_validation.radius_meters' => ['sometimes', 'integer', 'min:50', 'max:5000'],
            'overrides.personal_location_validation.latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'overrides.personal_location_validation.longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'overrides.retroactive_request_limit_days' => ['sometimes', 'integer', 'min:0', 'max:30'],
            'overrides.operational_review' => ['sometimes', 'array:schedule_change_reason_required,minimum_notice_hours'],
            'overrides.operational_review.schedule_change_reason_required' => ['sometimes', 'accepted'],
            'overrides.operational_review.minimum_notice_hours' => ['sometimes', 'integer', 'min:0', 'max:168'],
        ]);

        if (isset($validated['overrides']['personal_location_validation'])) {
            $this->assertGeofenceCoordinatePair($validated['overrides']['personal_location_validation'], 'overrides.personal_location_validation');
        }

        if ($validated['overrides'] === []) {
            throw ValidationException::withMessages(['overrides' => 'Pilih sedikitnya satu field kebijakan untuk diubah.']);
        }

        $version = $this->policies->createOutletVersion(
            $this->activeMembership($request), $this->outletReference($outlet),
            $validated['effective_from'], $validated['overrides'], $validated['reason'],
        );

        return response()->json(['version' => ['id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString()]], 201);
    }

    public function shifts(Request $request): JsonResponse
    {
        $membership = $this->activeMembership($request);
        $this->requireManager($membership);
        $templates = ShiftTemplate::query()->forTenant((int) $membership->tenant_id)->with(['versions' => fn ($query) => $query->orderBy('revision')])
            ->orderBy('name')->get()->map(fn (ShiftTemplate $template): array => $this->templateData($template))->values();

        return response()->json(['shift_templates' => $templates]);
    }

    public function createShift(Request $request): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i'],
            'crosses_midnight' => ['required', 'boolean'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $template = $this->shifts->create(
            $this->activeMembership($request), trim($validated['name']), $validated['start_time'].':00',
            $validated['end_time'].':00', (bool) $validated['crosses_midnight'],
            $validated['effective_from'], $validated['reason'],
        );

        return response()->json(['shift_template' => $this->templateData($template)], 201);
    }

    public function reviseShift(Request $request, int $template): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i'],
            'crosses_midnight' => ['required', 'boolean'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $version = $this->shifts->revise(
            $this->activeMembership($request), $template, $validated['start_time'].':00',
            $validated['end_time'].':00', (bool) $validated['crosses_midnight'],
            $validated['effective_from'], $validated['reason'],
        );

        return response()->json(['version' => $this->versionData($version->load('template'))], 201);
    }

    public function createWeeklyRule(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'outlet_id' => ['required', 'integer', 'min:1'],
            'weekday' => ['required', 'integer', 'between:1,7'],
            'shift_template_version_id' => ['nullable', 'integer', 'min:1'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'effective_until' => ['nullable', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $rule = $this->schedules->createWeeklyRule(
            $this->activeMembership($request), (int) $validated['employee_id'], (int) $validated['outlet_id'],
            (int) $validated['weekday'], isset($validated['shift_template_version_id']) ? (int) $validated['shift_template_version_id'] : null,
            $validated['effective_from'], $validated['effective_until'] ?? null, $validated['reason'],
        );

        return response()->json(['schedule_rule' => $this->weeklyRuleData($rule)], 201);
    }

    public function createException(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'outlet_id' => ['required', 'integer', 'min:1'],
            'work_date' => ['required', 'date_format:Y-m-d'],
            'status' => ['required', Rule::in(['work', 'rest'])],
            'shift_template_version_id' => ['nullable', 'required_if:status,work', 'prohibited_if:status,rest', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $exception = $this->schedules->createException(
            $this->activeMembership($request), (int) $validated['employee_id'], (int) $validated['outlet_id'],
            $validated['work_date'], $validated['status'], isset($validated['shift_template_version_id']) ? (int) $validated['shift_template_version_id'] : null,
            $validated['reason'],
        );

        return response()->json(['exception' => [
            'id' => (int) $exception->getKey(), 'revision' => (int) $exception->revision,
            'employee_id' => (int) $exception->employee_id, 'outlet_id' => (int) $exception->outlet_id,
            'work_date' => $exception->work_date->toDateString(), 'status' => $exception->status,
        ]], 201);
    }

    public function calendar(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'days' => ['nullable', 'integer', 'min:1', 'max:14'],
        ]);
        $membership = $this->activeMembership($request);
        $tenantId = (int) $membership->tenant_id;
        $outlet = $this->tenantOutlet($tenantId, (int) $validated['outlet_id']);
        $this->requireManager($membership);
        $this->requireOutletScope($membership, $outlet);
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $validated['start_date'], 'UTC');
        if (! $start || $start->toDateString() !== $validated['start_date']) {
            return response()->json(['message' => 'Tanggal kalender tidak valid.'], 422);
        }

        $days = (int) ($validated['days'] ?? 7);
        $end = $start->addDays($days - 1);
        $versions = OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outlet->getKey())
            ->where('effective_from', '<=', $end->toDateString())->orderBy('effective_from')->get();
        $exceptions = OutletCalendarException::query()->forTenant($tenantId)->where('outlet_id', $outlet->getKey())
            ->whereBetween('calendar_date', [$start->toDateString(), $end->toDateString()])->whereNull('superseded_at')->get()->keyBy(fn ($item): string => $item->calendar_date->toDateString());
        $holidays = TenantHolidayReference::query()->forTenant($tenantId)->whereBetween('holiday_date', [$start->toDateString(), $end->toDateString()])->get()
            ->groupBy(fn ($holiday): string => $holiday->holiday_date->toDateString());
        $calendarDays = [];

        for ($offset = 0; $offset < $days; $offset++) {
            $date = $start->addDays($offset);
            $version = $versions->last(fn (OutletCalendarVersion $item): bool => $item->effective_from->toDateString() <= $date->toDateString());
            $timezone = $version?->timezone ?? SchedulingDefaults::TIMEZONE;
            $exception = $exceptions->get($date->toDateString());
            $isOpen = $exception ? $exception->status === 'open' : in_array((int) $date->isoWeekday(), array_map('intval', $version?->operating_weekdays ?? SchedulingDefaults::operatingWeekdays()), true);
            $calendarDays[] = [
                'date' => $date->toDateString(),
                'timezone' => $timezone,
                'status' => $isOpen ? 'open' : 'closed',
                'holiday_references' => ($holidays->get($date->toDateString()) ?? collect())->map(fn (TenantHolidayReference $holiday): array => [
                    'id' => (int) $holiday->getKey(), 'name' => $holiday->name, 'region' => $holiday->region,
                ])->values(),
                'exception' => $exception ? ['id' => (int) $exception->getKey(), 'revision' => (int) $exception->revision, 'status' => $exception->status] : null,
            ];
        }

        return response()->json([
            'outlet' => ['id' => (int) $outlet->getKey(), 'name' => $outlet->name],
            'days' => $calendarDays,
            'versions' => $this->authorization->isOwner($membership) ? $versions->map(fn (OutletCalendarVersion $version): array => [
                'id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString(),
                'timezone' => $version->timezone, 'operating_weekdays' => $version->operating_weekdays,
                'reason' => $version->reason, 'actor_user_id' => $version->actor_user_id,
            ])->values() : null,
        ]);
    }

    public function createCalendarVersion(Request $request): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'timezone' => ['required', 'string', 'max:64'],
            'operating_weekdays' => ['required', 'array', 'min:1', 'max:7'],
            'operating_weekdays.*' => ['required', 'integer', 'between:1,7', 'distinct'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $version = $this->calendars->createVersion(
            $this->activeMembership($request), $this->outletReference((int) $validated['outlet_id']),
            $validated['effective_from'], $validated['timezone'], $validated['operating_weekdays'], $validated['reason'],
        );

        return response()->json(['version' => ['id' => (int) $version->getKey(), 'effective_from' => $version->effective_from->toDateString()]], 201);
    }

    public function createCalendarException(Request $request): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'calendar_date' => ['required', 'date_format:Y-m-d'],
            'status' => ['required', Rule::in(['open', 'closed'])],
            'holiday_reference_id' => ['nullable', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        $exception = $this->calendars->createDateException(
            $this->activeMembership($request), $this->outletReference((int) $validated['outlet_id']),
            $validated['calendar_date'], $validated['status'], isset($validated['holiday_reference_id']) ? (int) $validated['holiday_reference_id'] : null,
            $validated['reason'],
        );

        return response()->json(['exception' => ['id' => (int) $exception->getKey(), 'revision' => (int) $exception->revision]], 201);
    }

    public function createHoliday(Request $request): JsonResponse
    {
        $this->authorization->requireOwner($this->activeMembership($request));
        $validated = $request->validate([
            'holiday_date' => ['required', 'date_format:Y-m-d'],
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'region' => ['nullable', 'string', 'max:120'],
        ]);
        $holiday = $this->calendars->createHolidayReference(
            $this->activeMembership($request), $validated['holiday_date'], trim($validated['name']), $validated['region'] ?? null,
        );

        return response()->json(['holiday_reference' => [
            'id' => (int) $holiday->getKey(), 'holiday_date' => $holiday->holiday_date->toDateString(), 'name' => $holiday->name,
        ]], 201);
    }

    private function activeMembership(Request $request): TenantMembership
    {
        /** @var TenantMembership $membership */
        $membership = $request->attributes->get('activeMembership');

        return $membership;
    }

    /** @param array<string, mixed> $location */
    private function assertGeofenceCoordinatePair(array $location, string $field): void
    {
        $latitude = $location['latitude'] ?? null;
        $longitude = $location['longitude'] ?? null;

        if (($latitude === null) !== ($longitude === null)) {
            throw ValidationException::withMessages([$field => 'Latitude dan longitude harus diisi bersama atau sama-sama dikosongkan.']);
        }
    }

    private function linkedEmployeeId(TenantMembership $membership): ?int
    {
        $id = EmployeeUserLink::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->value('employee_id');

        return $id === null ? null : (int) $id;
    }

    private function requireManager(TenantMembership $membership): void
    {
        if (! $this->authorization->isOwner($membership) && ! $this->authorization->hasRole($membership, TenantRole::Supervisor)) {
            throw new AuthorizationException('Akses penjadwalan hanya tersedia untuk Owner atau Supervisor.');
        }
    }

    private function requireOutletScope(TenantMembership $membership, Outlet $outlet): void
    {
        if (! $this->authorization->canManageOutlet($membership, $outlet)) {
            throw new AuthorizationException('Outlet berada di luar cakupan akses Anda.');
        }
    }

    private function tenantOutlet(int $tenantId, int $outletId): Outlet
    {
        $outlet = Outlet::query()->forTenant($tenantId)->whereKey($outletId)->first();
        if (! $outlet) {
            abort(404, 'Outlet tidak tersedia.');
        }

        return $outlet;
    }

    private function outletReference(int $outletId): Outlet
    {
        $outlet = new Outlet;
        $outlet->setAttribute($outlet->getKeyName(), $outletId);

        return $outlet;
    }

    private function timezoneAt(int $tenantId, int $outletId, string $date): string
    {
        return OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $date)->orderByDesc('effective_from')->value('timezone') ?? SchedulingDefaults::TIMEZONE;
    }

    /** @return array<string, mixed> */
    private function templateData(ShiftTemplate $template): array
    {
        return [
            'id' => (int) $template->getKey(),
            'name' => $template->name,
            'versions' => $template->versions->map(fn (ShiftTemplateVersion $version): array => $this->versionData($version))->values(),
        ];
    }

    /** @return array<string, mixed> */
    private function versionData(ShiftTemplateVersion $version): array
    {
        return [
            'id' => (int) $version->getKey(),
            'revision' => (int) $version->revision,
            'start_time' => substr((string) $version->start_time, 0, 5),
            'end_time' => substr((string) $version->end_time, 0, 5),
            'crosses_midnight' => (bool) $version->crosses_midnight,
            'effective_from' => $version->effective_from->toDateString(),
            'template_name' => $version->template?->name,
        ];
    }

    /** @return array<string, mixed> */
    private function weeklyRuleData(WeeklyScheduleRule $rule): array
    {
        return [
            'id' => (int) $rule->getKey(),
            'employee_id' => (int) $rule->employee_id,
            'employee_name' => $rule->employee->name,
            'outlet_id' => (int) $rule->outlet_id,
            'weekday' => (int) $rule->weekday,
            'shift_template_version_id' => $rule->shift_template_version_id === null ? null : (int) $rule->shift_template_version_id,
            'shift_name' => $rule->shiftVersion?->template?->name,
            'effective_from' => $rule->effective_from->toDateString(),
            'effective_until' => $rule->effective_until?->toDateString(),
        ];
    }
}
