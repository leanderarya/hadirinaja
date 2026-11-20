<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Models\ScheduleException;
use App\Models\ShiftTemplateVersion;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\WeeklyScheduleRule;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class EmployeeScheduleService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly LocalTimeResolver $localTime,
        private readonly SchedulingChangeRecorder $changes,
        private readonly PlannerNotificationService $notifications,
    ) {}

    public function createWeeklyRule(
        TenantMembership $actor,
        int $employeeId,
        int $outletId,
        int $weekday,
        ?int $shiftVersionId,
        string $effectiveFrom,
        ?string $effectiveUntil,
        string $reason,
    ): WeeklyScheduleRule {
        $tenantId = (int) $actor->tenant_id;
        $this->assertDateRange($effectiveFrom, $effectiveUntil);

        if ($weekday < 1 || $weekday > 7) {
            throw ValidationException::withMessages(['weekday' => 'Hari kerja harus bernilai 1 sampai 7.']);
        }

        return DB::transaction(function () use ($actor, $tenantId, $employeeId, $outletId, $weekday, $shiftVersionId, $effectiveFrom, $effectiveUntil, $reason): WeeklyScheduleRule {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->first();
            $outlet = Outlet::query()->forTenant($tenantId)->whereKey($outletId)->first();

            if (! $employee || ! $outlet) {
                throw ValidationException::withMessages(['employee_id' => 'Karyawan atau outlet tidak tersedia pada organisasi aktif.']);
            }

            if (! $this->authorization->canManageOutlet($actor, $outlet)) {
                throw new AuthorizationException('Pengguna tidak memiliki cakupan pengelolaan outlet ini.');
            }

            $this->assertLegacyWritable($outlet, $effectiveUntil);
            $this->assertLocalDate($tenantId, $outletId, $effectiveFrom, 'effective_from');
            $shift = $this->tenantShift($tenantId, $shiftVersionId);
            if ($shift && $shift->effective_from->toDateString() > $effectiveFrom) {
                throw ValidationException::withMessages(['shift_template_version_id' => 'Versi shift belum berlaku pada awal jadwal.']);
            }

            $this->assertAssignmentForRule($employee, $outlet, $weekday, $shift, $effectiveFrom, $effectiveUntil);
            $priorRules = WeeklyScheduleRule::query()->forTenant($tenantId)->where('employee_id', $employeeId)
                ->where('weekday', $weekday)->orderBy('effective_from')->lockForUpdate()->get();

            foreach ($priorRules as $prior) {
                if ($prior->effective_from->toDateString() === $effectiveFrom) {
                    throw ValidationException::withMessages(['effective_from' => 'Jadwal untuk karyawan dan hari tersebut sudah ada pada tanggal ini.']);
                }

                $candidateEndsBeforePrior = $effectiveUntil !== null && $effectiveUntil <= $prior->effective_from->toDateString();
                if ($prior->effective_from->toDateString() > $effectiveFrom && ! $candidateEndsBeforePrior) {
                    throw ValidationException::withMessages(['effective_from' => 'Jadwal bertabrakan dengan versi masa depan yang sudah tersimpan.']);
                }

                $priorOpenAtStart = $prior->effective_from->toDateString() < $effectiveFrom
                    && ($prior->effective_until === null || $prior->effective_until->toDateString() > $effectiveFrom);

                if ($priorOpenAtStart) {
                    $before = ['effective_from' => $prior->effective_from->toDateString(), 'effective_until' => $prior->effective_until?->toDateString()];
                    $prior->forceFill(['effective_until' => $effectiveFrom])->save();
                    $this->changes->record($tenantId, 'weekly_schedule_rule', (int) $prior->getKey(), 'period_closed', (int) $actor->user_id, $reason, $before, [
                        'effective_from' => $prior->effective_from->toDateString(),
                        'effective_until' => $effectiveFrom,
                    ]);
                }
            }

            $candidate = new WeeklyScheduleRule([
                'tenant_id' => $tenantId,
                'employee_id' => $employeeId,
                'outlet_id' => $outletId,
                'weekday' => $weekday,
                'shift_template_version_id' => $shift?->getKey(),
                'effective_from' => $effectiveFrom,
                'effective_until' => $effectiveUntil,
                'created_by_user_id' => $actor->user_id,
            ]);
            $this->assertNoRecurringOverlap($candidate, $shift);

            $rule = WeeklyScheduleRule::query()->create($candidate->getAttributes());
            $this->changes->record($tenantId, 'weekly_schedule_rule', (int) $rule->getKey(), 'created', (int) $actor->user_id, $reason, null, [
                'employee_id' => $employeeId,
                'outlet_id' => $outletId,
                'weekday' => $weekday,
                'shift_template_version_id' => $shift?->getKey(),
                'effective_from' => $effectiveFrom,
                'effective_until' => $effectiveUntil,
            ]);

            $this->notifications->employees($tenantId, [$employeeId], 'assignment_changed', 'legacy-rule:'.$rule->id, ['week_start' => CarbonImmutable::parse($effectiveFrom)->startOfWeek()->toDateString()]);

            return $rule->load(['employee', 'outlet', 'shiftVersion.template']);
        });
    }

    public function createException(
        TenantMembership $actor,
        int $employeeId,
        int $outletId,
        string $workDate,
        string $status,
        ?int $shiftVersionId,
        string $reason,
    ): ScheduleException {
        $tenantId = (int) $actor->tenant_id;
        $this->assertDateRange($workDate, null);

        return DB::transaction(function () use ($actor, $tenantId, $employeeId, $outletId, $workDate, $status, $shiftVersionId, $reason): ScheduleException {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->first();
            $outlet = Outlet::query()->forTenant($tenantId)->whereKey($outletId)->first();

            if (! $employee || ! $outlet) {
                throw ValidationException::withMessages(['employee_id' => 'Karyawan atau outlet tidak tersedia pada organisasi aktif.']);
            }

            if (! $this->authorization->canManageOutlet($actor, $outlet)) {
                throw new AuthorizationException('Pengguna tidak memiliki cakupan pengelolaan outlet ini.');
            }

            $this->assertLegacyWritable($outlet, CarbonImmutable::parse($workDate)->addDay()->toDateString());
            $this->assertLocalDate($tenantId, $outletId, $workDate, 'work_date');
            $timezone = $this->timezoneAt($tenantId, $outletId, $workDate);

            if (! in_array($status, ['work', 'rest'], true)) {
                throw ValidationException::withMessages(['status' => 'Pilih bekerja atau libur.']);
            }

            $shift = $this->tenantShift($tenantId, $shiftVersionId);
            if (($status === 'work' && ! $shift) || ($status === 'rest' && $shift)) {
                throw ValidationException::withMessages(['shift_template_version_id' => 'Shift hanya perlu dipilih untuk pengecualian bekerja.']);
            }

            if ($shift && $shift->effective_from->toDateString() > $workDate) {
                throw ValidationException::withMessages(['shift_template_version_id' => 'Versi shift belum berlaku pada tanggal ini.']);
            }

            $interval = $shift ? $this->interval($shift, $workDate, $timezone) : null;
            if ($interval && ! $this->hasAssignment($employee, $outletId, $interval[0], $interval[1])) {
                throw ValidationException::withMessages(['outlet_id' => 'Karyawan tidak memiliki penugasan outlet yang mencakup seluruh shift.']);
            }
            if ($interval) {
                $this->assertNoEffectiveOverlap(new ScheduleException([
                    'tenant_id' => $tenantId, 'employee_id' => $employeeId, 'outlet_id' => $outletId,
                    'work_date' => $workDate, 'status' => $status, 'shift_template_version_id' => $shiftVersionId,
                ]), $shift, $workDate, CarbonImmutable::parse($workDate)->addDay()->toDateString(), 'work_date');
            }

            $previous = ScheduleException::query()->forTenant($tenantId)->where('employee_id', $employeeId)
                ->where('work_date', $workDate)->whereNull('superseded_at')->lockForUpdate()->first();
            $revision = (int) (ScheduleException::query()->forTenant($tenantId)->where('employee_id', $employeeId)
                ->where('work_date', $workDate)->max('revision') ?? 0) + 1;
            $previousValues = $previous ? [
                'status' => $previous->status,
                'outlet_id' => $previous->outlet_id,
                'shift_template_version_id' => $previous->shift_template_version_id,
            ] : null;

            if ($previous) {
                $previous->forceFill(['superseded_at' => now()])->save();
            }

            $exception = ScheduleException::query()->create([
                'tenant_id' => $tenantId,
                'employee_id' => $employeeId,
                'work_date' => $workDate,
                'revision' => $revision,
                'status' => $status,
                'outlet_id' => $outletId,
                'shift_template_version_id' => $shift?->getKey(),
                'created_by_user_id' => $actor->user_id,
                'reason' => trim($reason),
            ]);
            $this->changes->record($tenantId, 'schedule_exception', (int) $exception->getKey(), $previous ? 'revised' : 'created', (int) $actor->user_id, $reason, $previousValues, [
                'employee_id' => $employeeId,
                'work_date' => $workDate,
                'status' => $status,
                'outlet_id' => $outletId,
                'shift_template_version_id' => $shift?->getKey(),
            ]);

            $this->notifications->employees($tenantId, [$employeeId], 'assignment_changed', 'exception:'.$exception->id, ['week_start' => CarbonImmutable::parse($workDate)->startOfWeek()->toDateString()]);

            return $exception->load(['shiftVersion.template']);
        });
    }

    private function assertNoRecurringOverlap(WeeklyScheduleRule $candidate, ?ShiftTemplateVersion $shift): void
    {
        $this->assertNoEffectiveOverlap($candidate, $shift, $candidate->effective_from->toDateString(),
            $candidate->effective_until?->toDateString(), 'shift_template_version_id');
    }

    private function assertNoEffectiveOverlap(
        WeeklyScheduleRule|ScheduleException $candidate,
        ?ShiftTemplateVersion $shift,
        string $from,
        ?string $until,
        string $field,
    ): void {
        if (! $shift) {
            return;
        }

        $tenantId = (int) $candidate->tenant_id;
        $rules = WeeklyScheduleRule::query()->forTenant($tenantId)->where('employee_id', $candidate->employee_id)
            ->with('shiftVersion')->get();
        $exceptions = ScheduleException::query()->forTenant($tenantId)->where('employee_id', $candidate->employee_id)
            ->whereNull('superseded_at')->with('shiftVersion')->get()->keyBy(fn ($item) => $item->work_date->toDateString());
        $candidate->setRelation('shiftVersion', $shift);
        if ($candidate instanceof WeeklyScheduleRule) {
            $rules->push($candidate);
        } else {
            $exceptions->put($from, $candidate);
        }
        $outletIds = $rules->pluck('outlet_id')->merge($exceptions->pluck('outlet_id'))->filter()->unique();
        $calendars = OutletCalendarVersion::query()->forTenant($tenantId)->whereIn('outlet_id', $outletIds)
            ->orderBy('effective_from')->get();
        $timezoneAt = fn ($outletId, $date) => $calendars->last(fn ($calendar) => (int) $calendar->outlet_id === (int) $outletId
            && $calendar->effective_from->toDateString() <= $date)?->timezone ?? SchedulingDefaults::TIMEZONE;
        $cutovers = Outlet::query()->forTenant($tenantId)->pluck('weekly_planner_start_on', 'id');
        $legacyAllowed = fn ($row, $date) => ! $cutovers->get($row->outlet_id) || $date < $cutovers->get($row->outlet_id);
        $published = DB::table('schedule_entries as pe')->join('schedule_weeks as pw', fn ($join) => $join->on('pw.tenant_id', '=', 'pe.tenant_id')->on('pw.published_revision_id', '=', 'pe.revision_id'))
            ->join('outlets as po', fn ($join) => $join->on('po.tenant_id', '=', 'pw.tenant_id')->on('po.id', '=', 'pw.outlet_id'))
            ->where('pe.tenant_id', $tenantId)->where('pe.employee_id', $candidate->employee_id)->where('pe.status', 'work')
            ->whereNotNull('po.weekly_planner_start_on')->whereColumn('pe.work_date', '>=', 'po.weekly_planner_start_on')
            ->get(['pe.work_date', 'pe.schedule_snapshot']);
        $effective = function (string $date) use ($exceptions, $rules, $legacyAllowed) {
            if ($exceptions->has($date) && $legacyAllowed($exceptions->get($date), $date)) {
                return $exceptions->get($date);
            }

            return $rules->first(fn ($rule) => $legacyAllowed($rule, $date) && (int) $rule->weekday === CarbonImmutable::parse($date)->isoWeekday()
                && $this->inRange($date, $rule->effective_from->toDateString(), $rule->effective_until?->toDateString()));
        };

        $end = $until ?? '9999-12-31';
        $boundaries = [$from, $end];
        // ponytail: Within each segment, rules, overrides and UTC offsets are stable;
        // one seven-day cycle is sufficient. Split around neighbour dates as well.
        $split = function (string $date) use (&$boundaries, $from, $end): void {
            for ($offset = -3; $offset <= 3; $offset++) {
                $boundary = CarbonImmutable::parse($date)->addDays($offset)->toDateString();
                if ($boundary > $from && $boundary < $end) {
                    $boundaries[] = $boundary;
                }
            }
        };
        foreach ($rules as $rule) {
            $split($rule->effective_from->toDateString());
            if ($rule->effective_until !== null) {
                $split($rule->effective_until->toDateString());
            }
        }
        foreach ($exceptions->keys() as $date) {
            $split($date);
        }
        foreach ($published as $entry) {
            $split($entry->work_date);
        }
        foreach ($cutovers->filter() as $cutover) {
            $split($cutover);
        }
        foreach ($calendars as $calendar) {
            $split($calendar->effective_from->toDateString());
        }
        $rangeStart = CarbonImmutable::parse($from, 'UTC')->subDays(3)->getTimestamp();
        $rangeEnd = CarbonImmutable::parse($end, 'UTC')->addDays(3)->getTimestamp();
        foreach ($calendars->pluck('timezone')->push(SchedulingDefaults::TIMEZONE)->unique() as $timezone) {
            foreach ((new DateTimeZone($timezone))->getTransitions($rangeStart, $rangeEnd) ?: [] as $transition) {
                $split(CarbonImmutable::createFromTimestampUTC($transition['ts'])->toDateString());
            }
        }
        $boundaries = array_values(array_unique($boundaries));
        sort($boundaries);
        for ($segment = 0; $segment < count($boundaries) - 1; $segment++) {
            $start = CarbonImmutable::parse($boundaries[$segment]);
            for ($day = 0; $day < 7; $day++) {
                $date = $start->addDays($day);
                $dateKey = $date->toDateString();
                if ($dateKey >= $boundaries[$segment + 1]) {
                    break;
                }
                if ($effective($dateKey) !== $candidate) {
                    continue;
                }
                $interval = $this->interval($shift, $dateKey, $timezoneAt($candidate->outlet_id, $dateKey));
                foreach ($published as $entry) {
                    if (abs(CarbonImmutable::parse($entry->work_date)->diffInDays($date, false)) > 3) {
                        continue;
                    }
                    $snapshot = json_decode($entry->schedule_snapshot, true, flags: JSON_THROW_ON_ERROR);
                    if ($entry->work_date === $dateKey || $this->overlaps($interval, [new DateTimeImmutable($snapshot['scheduled_start']), new DateTimeImmutable($snapshot['scheduled_end'])])) {
                        throw ValidationException::withMessages([$field => 'Jadwal bertabrakan dengan shift karyawan yang sudah aktif.']);
                    }
                }
                // IANA offsets can place overlapping shifts more than one local date apart.
                for ($offset = -3; $offset <= 3; $offset++) {
                    if ($offset === 0) {
                        continue;
                    }
                    $otherDate = $date->addDays($offset)->toDateString();
                    $other = $effective($otherDate);
                    if (! $other?->shiftVersion) {
                        continue;
                    }
                    $otherInterval = $this->interval($other->shiftVersion, $otherDate, $timezoneAt($other->outlet_id, $otherDate));
                    if ($this->overlaps($interval, $otherInterval)) {
                        throw ValidationException::withMessages([$field => 'Jadwal bertabrakan dengan shift karyawan yang sudah aktif.']);
                    }
                }
            }
        }
    }

    private function assertAssignmentForRule(Employee $employee, Outlet $outlet, int $weekday, ?ShiftTemplateVersion $shift, string $from, ?string $until): void
    {
        $first = CarbonImmutable::parse($from);
        while ((int) $first->isoWeekday() !== $weekday) {
            $first = $first->addDay();
        }

        if ($until !== null && $first->toDateString() >= $until) {
            throw ValidationException::withMessages(['effective_until' => 'Rentang jadwal tidak mencakup hari kerja yang dipilih.']);
        }

        if (! $shift) {
            $zone = $this->timezoneAt((int) $employee->tenant_id, (int) $outlet->getKey(), $first->toDateString());
            $dayStart = $this->localTime->instant($first->toDateString(), '00:00:00', $zone);
            $dayEnd = $this->localTime->instant($first->addDay()->toDateString(), '00:00:00', $zone);
            if (! $this->hasAssignment($employee, (int) $outlet->getKey(), $dayStart, $dayEnd)) {
                throw ValidationException::withMessages(['outlet_id' => 'Karyawan tidak memiliki penugasan pada outlet dan tanggal istirahat tersebut.']);
            }

            return;
        }

        $firstZone = $this->timezoneAt((int) $employee->tenant_id, (int) $outlet->getKey(), $first->toDateString());
        $firstInterval = $this->interval($shift, $first->toDateString(), $firstZone);
        if (! $this->hasAssignment($employee, (int) $outlet->getKey(), $firstInterval[0], $firstInterval[1])) {
            throw ValidationException::withMessages(['outlet_id' => 'Penugasan outlet karyawan tidak mencakup shift berulang ini.']);
        }

        if ($until === null) {
            $openEnded = EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
                ->where('employee_id', $employee->getKey())->where('outlet_id', $outlet->getKey())
                ->where('effective_from', '<=', $firstInterval[0]->setTimezone(new DateTimeZone('UTC')))
                ->where('effective_until', '>=', '9999-12-31 23:59:59')->exists();

            if (! $openEnded) {
                throw ValidationException::withMessages(['effective_until' => 'Jadwal berulang tanpa tanggal akhir memerlukan penugasan outlet yang masih terbuka.']);
            }

            return;
        }

        $last = CarbonImmutable::parse($until)->subDay();
        while ((int) $last->isoWeekday() !== $weekday) {
            $last = $last->subDay();
        }
        $lastZone = $this->timezoneAt((int) $employee->tenant_id, (int) $outlet->getKey(), $last->toDateString());
        $lastInterval = $this->interval($shift, $last->toDateString(), $lastZone);

        if (! $this->hasAssignment($employee, (int) $outlet->getKey(), $firstInterval[0], $lastInterval[1])) {
            throw ValidationException::withMessages(['effective_until' => 'Satu penugasan outlet harus mencakup seluruh periode jadwal berulang.']);
        }
    }

    /** @return array{DateTimeImmutable, DateTimeImmutable} */
    private function interval(ShiftTemplateVersion $shift, string $date, string $timezone): array
    {
        $startTime = substr((string) $shift->start_time, 0, 8);
        $endTime = substr((string) $shift->end_time, 0, 8);
        $endDate = $shift->crosses_midnight ? CarbonImmutable::parse($date)->addDay()->toDateString() : $date;
        $start = $this->localTime->instant($date, $startTime, $timezone);
        $end = $this->localTime->instant($endDate, $endTime, $timezone);

        if ($end <= $start) {
            throw ValidationException::withMessages(['end_time' => 'Rentang waktu shift tidak valid pada zona waktu outlet.']);
        }

        return [$start, $end];
    }

    private function hasAssignment(Employee $employee, int $outletId, DateTimeImmutable $start, DateTimeImmutable $end): bool
    {
        return EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $start->setTimezone(new DateTimeZone('UTC')))
            ->where('effective_until', '>=', $end->setTimezone(new DateTimeZone('UTC')))
            ->exists();
    }

    private function timezoneAt(int $tenantId, int $outletId, string $date): string
    {
        return OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $date)->orderByDesc('effective_from')->value('timezone') ?? SchedulingDefaults::TIMEZONE;
    }

    private function tenantShift(int $tenantId, ?int $shiftVersionId): ?ShiftTemplateVersion
    {
        if ($shiftVersionId === null) {
            return null;
        }

        $shift = ShiftTemplateVersion::query()->forTenant($tenantId)->whereKey($shiftVersionId)->with('template')->first();

        if (! $shift) {
            throw ValidationException::withMessages(['shift_template_version_id' => 'Versi shift tidak tersedia pada organisasi aktif.']);
        }

        return $shift;
    }

    private function assertDateRange(string $from, ?string $until): void
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $end = $until === null ? null : CarbonImmutable::createFromFormat('!Y-m-d', $until, 'UTC');

        if (! $start || $start->toDateString() !== $from || ($end && $end->toDateString() !== $until) || ($until !== null && ! $end)) {
            throw ValidationException::withMessages(['effective_from' => 'Rentang jadwal harus berisi tanggal yang valid.']);
        }

        if ($until !== null && $until <= $from) {
            throw ValidationException::withMessages(['effective_until' => 'Tanggal akhir harus setelah tanggal mulai dan bersifat eksklusif.']);
        }
    }

    private function assertLegacyWritable(Outlet $outlet, ?string $until): void
    {
        abort_if($outlet->weekly_planner_start_on !== null && ($until === null || $until > $outlet->weekly_planner_start_on),
            409, 'Tanggal tersebut dikelola melalui roster mingguan.');
    }

    private function assertLocalDate(int $tenantId, int $outletId, string $date, string $field): void
    {
        $timezone = $this->timezoneAt($tenantId, $outletId, $date);
        if ($date < CarbonImmutable::today($timezone)->toDateString()) {
            throw ValidationException::withMessages([$field => 'Perubahan jadwal tidak boleh berlaku surut.']);
        }
    }

    private function inRange(string $date, string $from, ?string $until): bool
    {
        return $date >= $from && ($until === null || $date < $until);
    }

    /** @param array{DateTimeImmutable, DateTimeImmutable} $first @param array{DateTimeImmutable, DateTimeImmutable} $second */
    private function overlaps(array $first, array $second): bool
    {
        return $first[0] < $second[1] && $second[0] < $first[1];
    }
}
