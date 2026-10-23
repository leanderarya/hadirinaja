<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Models\ScheduleException;
use App\Models\ShiftTemplateVersion;
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
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->first();
            $outlet = Outlet::query()->forTenant($tenantId)->whereKey($outletId)->first();

            if (! $employee || ! $outlet) {
                throw ValidationException::withMessages(['employee_id' => 'Karyawan atau outlet tidak tersedia pada organisasi aktif.']);
            }

            if (! $this->authorization->canManageOutlet($actor, $outlet)) {
                throw new AuthorizationException('Pengguna tidak memiliki cakupan pengelolaan outlet ini.');
            }

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
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->first();
            $outlet = Outlet::query()->forTenant($tenantId)->whereKey($outletId)->first();

            if (! $employee || ! $outlet) {
                throw ValidationException::withMessages(['employee_id' => 'Karyawan atau outlet tidak tersedia pada organisasi aktif.']);
            }

            if (! $this->authorization->canManageOutlet($actor, $outlet)) {
                throw new AuthorizationException('Pengguna tidak memiliki cakupan pengelolaan outlet ini.');
            }

            $timezone = $this->timezoneAt($tenantId, $outletId, CarbonImmutable::now('UTC')->toDateString());
            if ($workDate < CarbonImmutable::now($timezone)->toDateString()) {
                throw ValidationException::withMessages(['work_date' => 'Pengecualian jadwal tidak boleh mengubah tanggal yang sudah lewat.']);
            }

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
                $this->assertNoAdjacentWeeklyOverlap($tenantId, $employeeId, $workDate, $interval);
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

            return $exception->load(['shiftVersion.template']);
        });
    }

    private function assertNoRecurringOverlap(WeeklyScheduleRule $candidate, ?ShiftTemplateVersion $shift): void
    {
        if (! $shift) {
            return;
        }

        $tenantId = (int) $candidate->tenant_id;
        $start = $candidate->effective_from->toDateString();
        $end = $candidate->effective_until?->toDateString();
        $expandedStart = CarbonImmutable::parse($start)->subDay()->toDateString();
        $expandedEnd = $end === null ? '9999-12-31' : CarbonImmutable::parse($end)->addDay()->toDateString();
        $rules = WeeklyScheduleRule::query()->forTenant($tenantId)->where('employee_id', $candidate->employee_id)
            ->whereNotNull('shift_template_version_id')
            ->where('effective_from', '<', $expandedEnd)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $expandedStart))
            ->with(['outlet', 'shiftVersion'])->get();

        foreach ($rules as $existing) {
            if ($existing->getKey() === $candidate->getKey()) {
                continue;
            }

            $candidateFirstDate = CarbonImmutable::parse($start);
            $existingFirstPossible = CarbonImmutable::parse($existing->effective_from->toDateString())->subDay();
            $testStart = $candidateFirstDate->greaterThan($existingFirstPossible) ? $candidateFirstDate : $existingFirstPossible;
            $testLast = $testStart->addDays(13);
            if ($end !== null && $testLast->toDateString() >= $end) {
                $testLast = CarbonImmutable::parse($end)->subDay();
            }
            if ($existing->effective_until !== null && $testLast->toDateString() > $existing->effective_until->toDateString()) {
                $testLast = $existing->effective_until;
            }

            for ($candidateDate = $testStart; $candidateDate->toDateString() <= $testLast->toDateString(); $candidateDate = $candidateDate->addDay()) {
                if ((int) $candidateDate->isoWeekday() !== (int) $candidate->weekday
                    || ! $this->inRange($candidateDate->toDateString(), $start, $end)) {
                    continue;
                }

                $candidateZone = $this->timezoneAt($tenantId, (int) $candidate->outlet_id, $candidateDate->toDateString());
                $candidateInterval = $this->interval($shift, $candidateDate->toDateString(), $candidateZone);

                for ($offset = -1; $offset <= 1; $offset++) {
                    $existingDate = $candidateDate->addDays($offset);
                    $existingActive = $this->inRange($existingDate->toDateString(), $existing->effective_from->toDateString(), $existing->effective_until?->toDateString());
                    if (! $existingActive || (int) $existingDate->isoWeekday() !== (int) $existing->weekday || ! $existing->shiftVersion) {
                        continue;
                    }

                    $existingZone = $this->timezoneAt($tenantId, (int) $existing->outlet_id, $existingDate->toDateString());
                    $existingInterval = $this->interval($existing->shiftVersion, $existingDate->toDateString(), $existingZone);

                    if ($this->overlaps($candidateInterval, $existingInterval)) {
                        throw ValidationException::withMessages(['shift_template_version_id' => 'Jadwal bertabrakan dengan shift karyawan yang sudah aktif.']);
                    }
                }
            }
        }
    }

    /** @param array{DateTimeImmutable, DateTimeImmutable} $candidateInterval */
    private function assertNoAdjacentWeeklyOverlap(int $tenantId, int $employeeId, string $workDate, array $candidateInterval): void
    {
        $from = CarbonImmutable::parse($workDate)->subDay()->toDateString();
        $until = CarbonImmutable::parse($workDate)->addDay()->toDateString();
        $rules = WeeklyScheduleRule::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->whereNotNull('shift_template_version_id')->where('effective_from', '<=', $until)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $from))
            ->with(['shiftVersion', 'outlet'])->get();

        foreach ($rules as $rule) {
            $anchor = CarbonImmutable::parse($from);
            for ($offset = 0; $offset < 3; $offset++) {
                $date = $anchor->addDays($offset);
                if ((int) $date->isoWeekday() !== (int) $rule->weekday || ! $this->inRange($date->toDateString(), $rule->effective_from->toDateString(), $rule->effective_until?->toDateString())) {
                    continue;
                }

                if ($date->toDateString() === $workDate) {
                    continue;
                }

                $zone = $this->timezoneAt($tenantId, (int) $rule->outlet_id, $date->toDateString());
                $existingInterval = $this->interval($rule->shiftVersion, $date->toDateString(), $zone);

                if ($this->overlaps($candidateInterval, $existingInterval)) {
                    throw ValidationException::withMessages(['work_date' => 'Pengecualian bertabrakan dengan shift berulang di tanggal yang berdekatan.']);
                }
            }
        }

        $exceptions = ScheduleException::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->whereBetween('work_date', [$from, $until])->where('status', 'work')->whereNull('superseded_at')
            ->with(['shiftVersion'])->get();

        foreach ($exceptions as $exception) {
            if ($exception->work_date->toDateString() === $workDate || ! $exception->shiftVersion || $exception->outlet_id === null) {
                continue;
            }

            $zone = $this->timezoneAt($tenantId, (int) $exception->outlet_id, $exception->work_date->toDateString());
            $existingInterval = $this->interval($exception->shiftVersion, $exception->work_date->toDateString(), $zone);

            if ($this->overlaps($candidateInterval, $existingInterval)) {
                throw ValidationException::withMessages(['work_date' => 'Pengecualian bertabrakan dengan pengecualian kerja di tanggal yang berdekatan.']);
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

        if ($from < CarbonImmutable::today('UTC')->toDateString()) {
            throw ValidationException::withMessages(['effective_from' => 'Perubahan jadwal tidak boleh berlaku surut.']);
        }

        if ($until !== null && $until <= $from) {
            throw ValidationException::withMessages(['effective_until' => 'Tanggal akhir harus setelah tanggal mulai dan bersifat eksklusif.']);
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
