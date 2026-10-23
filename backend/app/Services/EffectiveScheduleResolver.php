<?php

namespace App\Services;

use App\Data\EffectiveScheduleResult;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\OutletAttendancePolicyVersion;
use App\Models\OutletCalendarException;
use App\Models\OutletCalendarVersion;
use App\Models\ScheduleException;
use App\Models\ShiftTemplateVersion;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantHolidayReference;
use App\Models\WeeklyScheduleRule;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use Illuminate\Validation\ValidationException;

final class EffectiveScheduleResolver
{
    public function __construct(private readonly LocalTimeResolver $localTime) {}

    public function resolve(
        int $tenantId,
        int $employeeId,
        string $workDate,
        ?int $outletContext = null,
        ?array $outletScopeIds = null,
    ): EffectiveScheduleResult {
        return $this->resolveWeek($tenantId, [$employeeId], $workDate, 1, $outletContext, $outletScopeIds)[0];
    }

    /**
     * Resolve a contiguous range with batched domain reads for schedule listings.
     *
     * @param  list<int>  $employeeIds
     * @return list<EffectiveScheduleResult>
     */
    public function resolveWeek(
        int $tenantId,
        array $employeeIds,
        string $startDate,
        int $days = 7,
        ?int $outletContext = null,
        ?array $outletScopeIds = null,
    ): array {
        if ($days < 1 || $days > 14) {
            throw ValidationException::withMessages(['days' => 'Rentang jadwal harus terdiri dari 1 sampai 14 hari.']);
        }

        $start = $this->date($startDate);
        $dates = [];

        for ($offset = 0; $offset < $days; $offset++) {
            $dates[] = $start->addDays($offset);
        }

        $employeeIds = array_values(array_unique(array_map('intval', $employeeIds)));

        if ($employeeIds === []) {
            return [];
        }

        $end = $dates[array_key_last($dates)];
        $firstDate = $start->toDateString();
        $lastDate = $end->toDateString();
        $employees = Employee::query()->forTenant($tenantId)->whereIn('id', $employeeIds)->get()->keyBy('id');
        $rulesQuery = WeeklyScheduleRule::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employees->keys())
            ->where('effective_from', '<=', $lastDate)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $firstDate))
            ->with(['outlet', 'shiftVersion.template']);
        if ($outletScopeIds !== null) {
            $rulesQuery->whereIn('outlet_id', $outletScopeIds);
        }
        $rules = $rulesQuery->get()->groupBy('employee_id');
        $exceptionsQuery = ScheduleException::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employees->keys())
            ->whereBetween('work_date', [$firstDate, $lastDate])
            ->whereNull('superseded_at')
            ->with(['shiftVersion.template']);
        if ($outletScopeIds !== null) {
            $exceptionsQuery->whereIn('outlet_id', $outletScopeIds);
        }
        $exceptions = $exceptionsQuery->get()
            ->groupBy(fn (ScheduleException $exception): string => $exception->employee_id.'|'.$exception->work_date->toDateString());
        $assignments = EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employees->keys())
            ->where('effective_from', '<', $end->addDays(2)->endOfDay()->utc())
            ->where('effective_until', '>', $start->subDays(2)->startOfDay()->utc())
            ->get()->groupBy('employee_id');

        $outletIds = collect([$outletContext])
            ->merge($outletScopeIds ?? [])
            ->merge($rules->flatten()->pluck('outlet_id'))
            ->merge($exceptions->flatten()->pluck('outlet_id'))
            ->filter()->map(fn ($id): int => (int) $id)->unique()->values();
        $outlets = Outlet::query()->forTenant($tenantId)->whereIn('id', $outletIds)->get()->keyBy('id');
        $calendarVersions = OutletCalendarVersion::query()->forTenant($tenantId)
            ->whereIn('outlet_id', $outletIds)->where('effective_from', '<=', $lastDate)
            ->orderBy('effective_from')->get()->groupBy('outlet_id');
        $calendarExceptions = OutletCalendarException::query()->forTenant($tenantId)
            ->whereIn('outlet_id', $outletIds)->whereBetween('calendar_date', [$firstDate, $lastDate])
            ->whereNull('superseded_at')->get()->groupBy(fn (OutletCalendarException $exception): string => $exception->outlet_id.'|'.$exception->calendar_date->toDateString());
        $tenantPolicies = TenantAttendancePolicyVersion::query()->forTenant($tenantId)
            ->where('effective_from', '<=', $lastDate)->orderBy('effective_from')->get();
        $outletPolicies = OutletAttendancePolicyVersion::query()->forTenant($tenantId)
            ->whereIn('outlet_id', $outletIds)->where('effective_from', '<=', $lastDate)
            ->orderBy('effective_from')->get()->groupBy('outlet_id');
        $holidays = TenantHolidayReference::query()->forTenant($tenantId)
            ->whereBetween('holiday_date', [$firstDate, $lastDate])->get()
            ->groupBy(fn (TenantHolidayReference $holiday): string => $holiday->holiday_date->toDateString());

        $context = compact(
            'tenantId', 'dates', 'employees', 'rules', 'exceptions', 'assignments', 'outlets',
            'calendarVersions', 'calendarExceptions', 'tenantPolicies', 'outletPolicies', 'holidays', 'outletContext'
        );
        $results = [];

        foreach ($employees as $employee) {
            foreach ($dates as $date) {
                $results[] = $this->resolveFromContext($employee, $date, $context);
            }
        }

        return $results;
    }

    /** @param array<string, mixed> $context */
    private function resolveFromContext(Employee $employee, CarbonImmutable $date, array $context): EffectiveScheduleResult
    {
        $tenantId = (int) $context['tenantId'];
        $dateKey = $date->toDateString();
        $weekday = (int) $date->isoWeekday();
        $workRules = ($context['rules']->get($employee->getKey()) ?? collect())
            ->filter(fn (WeeklyScheduleRule $rule): bool => (int) $rule->weekday === $weekday
                && $rule->effective_from->toDateString() <= $dateKey
                && ($rule->effective_until === null || $rule->effective_until->toDateString() > $dateKey));
        $activeExceptions = $context['exceptions']->get($employee->getKey().'|'.$dateKey) ?? collect();
        $conflicts = [];
        $provenance = ['source' => 'none', 'schedule_rule_id' => null, 'exception_id' => null, 'exception_revision' => null];
        $status = 'unscheduled';
        $outletId = null;
        $shiftVersion = null;

        if ($activeExceptions->count() > 1 || $workRules->count() > 1) {
            $conflicts[] = 'contradictory_schedule_rules';
        } elseif ($activeExceptions->isNotEmpty()) {
            /** @var ScheduleException $exception */
            $exception = $activeExceptions->first();
            $provenance = [
                'source' => 'date_exception',
                'schedule_rule_id' => null,
                'exception_id' => (int) $exception->getKey(),
                'exception_revision' => (int) $exception->revision,
            ];
            $status = $exception->status === 'rest' ? 'rest' : 'scheduled';
            $outletId = $exception->outlet_id === null ? null : (int) $exception->outlet_id;
            $shiftVersion = $exception->shiftVersion;
        } elseif ($workRules->isNotEmpty()) {
            /** @var WeeklyScheduleRule $rule */
            $rule = $workRules->first();
            $provenance = ['source' => 'weekly_rule', 'schedule_rule_id' => (int) $rule->getKey(), 'exception_id' => null, 'exception_revision' => null];
            $status = $rule->shift_template_version_id === null ? 'rest' : 'scheduled';
            $outletId = (int) $rule->outlet_id;
            $shiftVersion = $rule->shiftVersion;
        }

        $selectedOutlet = $context['outletContext'];

        if ($selectedOutlet !== null && $outletId !== null && $outletId !== (int) $selectedOutlet) {
            $status = 'unscheduled';
            $outletId = (int) $selectedOutlet;
            $shiftVersion = null;
            $conflicts = [];
            $provenance = ['source' => 'outlet_filter', 'schedule_rule_id' => null, 'exception_id' => null, 'exception_revision' => null];
        } elseif ($selectedOutlet !== null && $outletId === null && in_array($status, ['rest', 'unscheduled'], true)) {
            $outletId = (int) $selectedOutlet;
        }

        $outlet = $outletId === null ? null : $context['outlets']->get($outletId);
        $calendar = $outletId === null ? null : $this->effectiveVersion($context['calendarVersions']->get($outletId) ?? collect(), $dateKey);
        $timezone = $calendar?->timezone ?? SchedulingDefaults::TIMEZONE;
        $shift = null;
        $scheduledStart = null;
        $scheduledEnd = null;
        $outletOperating = null;

        if ($status === 'scheduled' && $shiftVersion instanceof ShiftTemplateVersion) {
            $shift = [
                'template_id' => (int) $shiftVersion->shift_template_id,
                'version_id' => (int) $shiftVersion->getKey(),
                'revision' => (int) $shiftVersion->revision,
                'name' => $shiftVersion->template?->name,
                'start_time' => substr((string) $shiftVersion->start_time, 0, 8),
                'end_time' => substr((string) $shiftVersion->end_time, 0, 8),
                'crosses_midnight' => (bool) $shiftVersion->crosses_midnight,
            ];

            if ($shiftVersion->effective_from->toDateString() > $dateKey) {
                $conflicts[] = 'shift_template_not_effective';
            } else {
                try {
                    $endDate = $shiftVersion->crosses_midnight ? $date->addDay()->toDateString() : $dateKey;
                    $startInstant = $this->localTime->instant($dateKey, $shift['start_time'], $timezone);
                    $endInstant = $this->localTime->instant($endDate, $shift['end_time'], $timezone);

                    if ($endInstant <= $startInstant) {
                        $conflicts[] = 'invalid_shift_interval';
                    } else {
                        $scheduledStart = $startInstant->format(DateTimeImmutable::ATOM);
                        $scheduledEnd = $endInstant->format(DateTimeImmutable::ATOM);
                        if (! $this->hasAssignment($context['assignments']->get($employee->getKey()) ?? collect(), $outletId, $startInstant, $endInstant)) {
                            $conflicts[] = 'employee_not_assigned_to_outlet';
                        }
                    }
                } catch (ValidationException) {
                    $conflicts[] = 'invalid_local_time';
                }
            }
        }

        if ($outlet !== null && $calendar !== null) {
            $operating = in_array($weekday, array_map('intval', $calendar->operating_weekdays), true);
            $dateException = $context['calendarExceptions']->get($outletId.'|'.$dateKey)?->first();

            if ($dateException instanceof OutletCalendarException) {
                $operating = $dateException->status === 'open';
                $provenance['calendar_exception_id'] = (int) $dateException->getKey();
                $provenance['calendar_exception_revision'] = (int) $dateException->revision;
            } else {
                $provenance['calendar_exception_id'] = null;
                $provenance['calendar_exception_revision'] = null;
            }

            $outletOperating = $operating;

            if ($status === 'scheduled' && ! $operating) {
                $conflicts[] = 'outlet_closed';
            }
        }

        $holidayRecords = $context['holidays']->get($dateKey) ?? collect();
        $holidayReferences = $holidayRecords->map(fn (TenantHolidayReference $holiday): array => [
            'id' => (int) $holiday->getKey(),
            'name' => $holiday->name,
            'region' => $holiday->region,
        ])->values()->all();
        $tenantPolicy = $this->effectiveVersion($context['tenantPolicies'], $dateKey);
        $outletPolicy = $outletId === null
            ? null
            : $this->effectiveVersion($context['outletPolicies']->get($outletId) ?? collect(), $dateKey);
        $policy = $tenantPolicy?->configuration;

        if ($policy !== null && $outletPolicy !== null) {
            $policy = array_replace_recursive($policy, $outletPolicy->overrides);
        }

        if ($policy === null) {
            $conflicts[] = 'attendance_policy_missing';
        }

        $provenance['calendar_version_id'] = $calendar ? (int) $calendar->getKey() : null;

        return new EffectiveScheduleResult(
            employeeId: (int) $employee->getKey(),
            tenantId: $tenantId,
            workDate: $dateKey,
            status: $status,
            outletId: $outletId,
            outletName: $outlet?->name,
            timezone: $timezone,
            shift: $shift,
            scheduledStart: $scheduledStart,
            scheduledEnd: $scheduledEnd,
            tenantPolicyVersionId: $tenantPolicy ? (int) $tenantPolicy->getKey() : null,
            outletPolicyVersionId: $outletPolicy ? (int) $outletPolicy->getKey() : null,
            policy: $policy,
            provenance: $provenance,
            holidayReferences: $holidayReferences,
            outletOperating: $outletOperating,
            conflicts: array_values(array_unique($conflicts)),
        );
    }

    private function hasAssignment($assignments, int $outletId, DateTimeImmutable $start, DateTimeImmutable $end): bool
    {
        return $assignments->contains(fn (EmployeeOutletAssignment $assignment): bool => (int) $assignment->outlet_id === $outletId
            && $assignment->effective_from->utc()->lessThanOrEqualTo($start->setTimezone(new \DateTimeZone('UTC')))
            && $assignment->effective_until->utc()->greaterThanOrEqualTo($end->setTimezone(new \DateTimeZone('UTC')))
        );
    }

    private function effectiveVersion($versions, string $date): mixed
    {
        return $versions->last(fn ($version): bool => $version->effective_from->toDateString() <= $date);
    }

    private function date(string $value): CarbonImmutable
    {
        $date = CarbonImmutable::createFromFormat('!Y-m-d', $value, 'UTC');

        if (! $date || $date->toDateString() !== $value) {
            throw ValidationException::withMessages(['work_date' => 'Tanggal kerja harus memakai format YYYY-MM-DD yang valid.']);
        }

        return $date;
    }
}
