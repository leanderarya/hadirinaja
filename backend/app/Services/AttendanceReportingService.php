<?php

namespace App\Services;

use App\Data\ReportingScope;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceFinalization;
use App\Models\AttendanceSession;
use App\Models\ScheduleException;
use App\Models\WeeklyScheduleRule;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

final class AttendanceReportingService
{
    private const MAX_ROWS = 5000;

    private const MAX_EXPORT_ROWS = 500;

    public function __construct(
        private readonly EffectiveAttendanceReader $projection,
        private readonly ReportingAccessService $access,
    ) {}

    /** @return array<string, mixed> */
    public function filterOptions(ReportingScope $scope): array
    {
        return [
            'business_units' => $scope->businessUnits,
            'outlets' => array_map(fn (array $outlet): array => [
                'id' => $outlet['id'],
                'name' => $outlet['name'],
                'business_unit_id' => $outlet['business_unit_id'],
                'business_unit_name' => $outlet['business_unit_name'],
            ], $scope->outlets),
            'employee_filter' => 'employee_id',
            'maximum_days' => 31,
        ];
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function dashboard(ReportingScope $scope, array $filters): array
    {
        $rows = $this->reportRows($scope, $filters, true);
        $sessions = collect($rows)->flatMap(fn (array $row): array => $row['sessions']);
        $pendingReviewIds = collect($rows)->flatMap(fn (array $row): array => $row['pending_review_request_ids'])->unique();
        $pendingCorrectionIds = collect($rows)->flatMap(fn (array $row): array => $row['pending_correction_request_ids'])->unique();
        $outcomes = collect($rows)->countBy('outcome')->all();
        $approvalSummary = $this->approvalSummary($scope, $filters);
        $knownActualSeconds = $sessions->whereNotNull('actual_duration_seconds')->sum('actual_duration_seconds');
        $knownEffectiveSeconds = $sessions->sum('effective_duration_seconds') + collect($rows)->pluck('reconstructions')->collapse()->sum('effective.duration_seconds');

        return [
            'metrics' => [
                'unique_employees' => collect($rows)->pluck('employee.id')->unique()->count(),
                'employee_workdays' => count($rows),
                'scheduled_employee_workdays' => collect($rows)->where('schedule.status', 'scheduled')->count(),
                'recorded_attendance_employee_workdays' => collect($rows)->filter(fn (array $row): bool => $row['sessions'] !== [])->count(),
                'recorded_attendance_unique_employees' => collect($rows)->filter(fn (array $row): bool => $row['sessions'] !== [])
                    ->pluck('employee.id')->unique()->count(),
                'attendance_sessions' => $sessions->count(),
                'active_attendance_sessions' => $sessions->where('recording_status', 'active')->count(),
                'completed_attendance_sessions' => $sessions->where('recording_status', 'closed')->count(),
                'administratively_resolved_sessions' => $sessions->where('recording_status', 'administratively_resolved')->count(),
                'pending_review_requests' => $pendingReviewIds->count(),
                'pending_correction_requests' => $pendingCorrectionIds->count(),
                'employee_workdays_with_unresolved_review' => collect($rows)->where('review.status', 'pending')->count(),
                'potential_absence_employee_workdays' => collect($rows)->where('outcome', 'potential_absence')->count(),
                'finalized_absence_employee_workdays' => collect($rows)
                    ->filter(fn (array $row): bool => $row['is_finalized'] && ($row['finalization']['outcome'] ?? null) === 'absence')->count(),
                'known_actual_duration_seconds' => (int) $knownActualSeconds,
                'known_effective_duration_seconds' => (int) $knownEffectiveSeconds,
            ],
            'outcomes' => $outcomes,
            'approval_requests' => $approvalSummary,
            'provenance' => $this->access->provenance($scope, $filters, 'operational_dashboard'),
        ];
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function attendancePage(ReportingScope $scope, array $filters): array
    {
        $rows = $this->reportRows($scope, $filters, true);
        $total = count($rows);
        $perPage = $filters['per_page'];
        $page = $filters['page'];

        return [
            'data' => array_slice($rows, ($page - 1) * $perPage, $perPage),
            'pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $perPage)),
                'has_more' => $page * $perPage < $total,
            ],
            'totals' => $this->reportTotals($rows),
            'provenance' => $this->access->provenance($scope, $filters, 'attendance_detail'),
        ];
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function approvalSummary(ReportingScope $scope, array $filters): array
    {
        if ($filters['outlet_ids'] === []) {
            if (! $this->includeTenantLevelRequests($scope, $filters)) {
                return ['total_requests' => 0, 'by_type_and_status' => []];
            }
        }

        $query = ApprovalRequest::query()->forTenant($scope->tenantId)
            ->where(function ($outlets) use ($scope, $filters): void {
                if ($filters['outlet_ids'] !== []) {
                    $outlets->whereIn('outlet_id', $filters['outlet_ids']);
                }
                if ($this->includeTenantLevelRequests($scope, $filters)) {
                    $outlets->orWhereNull('outlet_id');
                }
            })
            ->where(function ($date) use ($filters): void {
                $date->whereBetween('work_date', [$filters['from'], $filters['to']])
                    ->orWhere(fn ($range) => $range->where('starts_on', '<=', $filters['to'])->where('ends_on', '>=', $filters['from']));
            });
        if ($filters['employee_id'] !== null) {
            $query->where('employee_id', $filters['employee_id']);
        }

        $counts = $query->selectRaw('request_type, status, COUNT(*) as request_count')
            ->groupBy('request_type', 'status')->orderBy('request_type')->orderBy('status')->get()
            ->map(fn ($row): array => [
                'type' => (string) $row->request_type,
                'status' => (string) $row->status,
                'requests' => (int) $row->request_count,
            ])->values()->all();

        return [
            'total_requests' => array_sum(array_column($counts, 'requests')),
            'by_type_and_status' => $counts,
        ];
    }

    /** @param array<string, mixed> $filters @return list<array<string, mixed>> */
    public function exportRows(ReportingScope $scope, array $filters): array
    {
        $pairs = $this->candidatePairs($scope, $filters, self::MAX_ROWS + 1);
        if (count($pairs) > self::MAX_ROWS) {
            throw ValidationException::withMessages(['export' => 'Laporan dibatasi maksimal 5.000 employee-workdays. Persempit rentang atau filter.']);
        }

        $rows = $this->shapeRows($scope, $filters, $pairs);
        if ($filters['status'] !== null) {
            $rows = array_values(array_filter($rows, fn (array $row): bool => $row['outcome'] === $filters['status']));
        }
        if (count($rows) > self::MAX_EXPORT_ROWS) {
            throw ValidationException::withMessages(['export' => 'Ekspor dibatasi maksimal 500 employee-workdays. Persempit rentang atau filter.']);
        }

        return $rows;
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function reportTotalsForFilters(ReportingScope $scope, array $filters): array
    {
        return $this->reportTotals($this->reportRows($scope, $filters, false));
    }

    /** @param array<string, mixed> $filters @return list<array<string, mixed>> */
    private function reportRows(ReportingScope $scope, array $filters, bool $applyStatus): array
    {
        $pairs = $this->candidatePairs($scope, $filters, self::MAX_ROWS + 1);
        if (count($pairs) > self::MAX_ROWS) {
            throw ValidationException::withMessages(['to' => 'Laporan melebihi 5.000 employee-workdays. Persempit rentang atau filter.']);
        }

        $rows = $this->shapeRows($scope, $filters, $pairs);
        if ($applyStatus && $filters['status'] !== null) {
            $rows = array_values(array_filter($rows, fn (array $row): bool => $row['outcome'] === $filters['status']));
        }

        usort($rows, function (array $left, array $right): int {
            $dateOrder = strcmp($right['work_date'], $left['work_date']);
            if ($dateOrder !== 0) {
                return $dateOrder;
            }

            $nameOrder = strcasecmp($left['employee']['name'], $right['employee']['name']);

            return $nameOrder !== 0 ? $nameOrder : ($left['employee']['id'] <=> $right['employee']['id']);
        });

        return $rows;
    }

    /** @param list<array{employee_id:int,work_date:string}> $pairs @return list<array<string, mixed>> */
    private function shapeRows(ReportingScope $scope, array $filters, array $pairs): array
    {
        if ($pairs === []) {
            return [];
        }

        $projectionByKey = $this->projection->projectPairs(
            $scope->tenantId,
            $pairs,
            $filters['outlet_ids'],
            count($filters['outlet_ids']) === 1 ? $filters['outlet_ids'][0] : null,
        );
        $outletsById = collect($scope->outlets)->keyBy('id');
        $rows = [];

        foreach ($pairs as $pair) {
            $key = $pair['employee_id'].'|'.$pair['work_date'];
            $projection = $projectionByKey[$key] ?? null;
            if ($projection === null) {
                continue;
            }

            $scheduled = $projection['schedule']['status'] === 'scheduled';
            $sessions = $projection['sessions'];
            $requests = $projection['leave_requests'] !== [] || $projection['overtime_requests'] !== []
                || $projection['pending_corrections'] !== [] || $projection['review']['cases'] !== [];
            if (! $scheduled && $projection['sources'] === [] && ! $requests && $projection['finalization'] === null) {
                continue;
            }

            $outletIds = collect([$projection['outlet']['id'] ?? null])
                ->merge(collect($projection['sources'])->pluck('effective.outlet_id'))
                ->filter()->map(fn ($id): int => (int) $id)->unique()->values();
            $outlets = $outletIds->map(function (int $id) use ($outletsById): ?array {
                $outlet = $outletsById->get($id);
                if (! $outlet) {
                    return null;
                }

                return [
                    'id' => $id,
                    'name' => $outlet['name'],
                    'business_unit_id' => $outlet['business_unit_id'],
                    'business_unit_name' => $outlet['business_unit_name'],
                ];
            })->filter()->values();
            $businessUnits = $outlets->map(fn (array $outlet): array => [
                'id' => $outlet['business_unit_id'],
                'name' => $outlet['business_unit_name'],
            ])->unique('id')->values();
            $scheduleStart = $projection['schedule']['scheduled_start'] ?? null;
            $scheduleEnd = $projection['schedule']['scheduled_end'] ?? null;
            $scheduledDuration = $scheduleStart && $scheduleEnd
                ? max(0, CarbonImmutable::parse($scheduleEnd)->getTimestamp() - CarbonImmutable::parse($scheduleStart)->getTimestamp())
                : null;
            $rowSessions = collect($sessions)->map(fn (array $session): array => [
                'id' => $session['id'],
                'timezone' => $session['schedule_snapshot']['timezone'] ?? null,
                'work_date' => $session['effective']['work_date'],
                'recording_status' => $session['recording_status'],
                'attendance_modes' => collect($session['original']['events'])->pluck('origin')->unique()->values()->all(),
                'original' => $session['original'],
                'effective' => $session['effective'],
                'actual_duration_seconds' => $session['actual_duration_seconds'],
                'effective_duration_seconds' => $session['effective']['duration_seconds'],
                'review_indicators' => $session['review_indicators'],
                'correction' => $session['correction'] ? [
                    'request_id' => $session['correction']['request_id'],
                    'decision_id' => $session['correction']['decision_id'],
                    'actor_user_id' => $session['correction']['actor_user_id'],
                    'decided_at' => $session['correction']['decided_at'],
                    'classification' => $session['correction']['classification'],
                    'reason' => $session['correction']['reason'],
                ] : null,
            ])->values()->all();
            $leaveRequests = collect($projection['leave_requests'])->map(fn (array $request): array => [
                'id' => $request['id'],
                'status' => $request['status'],
                'category' => $request['category'],
                'type' => $request['type'],
            ])->values()->all();
            $overtimeRequests = collect($projection['overtime_requests'])->map(function (array $request): array {
                $requested = isset($request['details']['requested_minutes']) ? (int) $request['details']['requested_minutes'] : null;

                return [
                    'id' => $request['id'],
                    'status' => $request['status'],
                    'requested_minutes' => $requested,
                    'approved_minutes' => $request['status'] === 'approved' ? $requested : null,
                ];
            })->values()->all();
            $reviewCases = collect($projection['review']['cases'])->map(fn (array $request): array => [
                'id' => $request['id'],
                'status' => $request['status'],
                'case_type' => $request['category'],
                'type' => $request['type'],
            ])->values()->all();
            $finalization = $projection['finalization'] ? [
                'id' => $projection['finalization']['id'],
                'revision' => $projection['finalization']['revision'],
                'outcome' => $projection['finalization']['outcome'],
                'reason' => $projection['finalization']['reason'],
                'actor_user_id' => $projection['finalization']['actor_user_id'],
                'finalized_at' => $projection['finalization']['finalized_at'],
            ] : null;
            $pendingReviewIds = collect($reviewCases)->where('status', 'pending')->pluck('id')->map(fn ($id): int => (int) $id)->all();
            $pendingCorrectionIds = collect($projection['pending_corrections'])->pluck('id')->map(fn ($id): int => (int) $id)->all();

            $rows[] = [
                'work_date' => $projection['work_date'],
                'employee' => $projection['employee'],
                'business_units' => $businessUnits->all(),
                'outlets' => $outlets->all(),
                'schedule' => [
                    'status' => $projection['schedule']['status'],
                    'shift' => $projection['schedule']['shift'],
                    'scheduled_start' => $scheduleStart,
                    'scheduled_end' => $scheduleEnd,
                    'duration_seconds' => $scheduledDuration,
                    'timezone' => $projection['schedule']['timezone'],
                    'provenance' => $projection['schedule']['provenance'],
                ],
                'sessions' => $rowSessions,
                'reconstructions' => collect($projection['sources'])->where('source_kind', 'reconstruction')->values()->all(),
                'actual_duration_seconds' => $projection['actual_duration_seconds'],
                'effective_duration_seconds' => $projection['effective_duration_seconds'],
                'approved_leave' => $projection['approved_leave'] ? [
                    'id' => $projection['approved_leave']['id'],
                    'status' => $projection['approved_leave']['status'],
                    'category' => $projection['approved_leave']['category'],
                ] : null,
                'leave_requests' => $leaveRequests,
                'overtime_requests' => $overtimeRequests,
                'review' => [
                    'status' => $projection['review']['status'],
                    'indicators' => $projection['review']['indicators'],
                    'unreviewed_indicators' => $projection['review']['unreviewed_indicators'],
                    'cases' => $reviewCases,
                ],
                'outcome' => $projection['outcome'],
                'is_finalized' => $projection['is_finalized'],
                'requires_refinalization' => $projection['requires_refinalization'],
                'finalization' => $finalization,
                'correction_decision_ids' => $projection['projection_provenance']['correction_decision_ids'],
                'source_attendance_event_ids' => $projection['original_attendance_references'],
                'pending_review_request_ids' => $pendingReviewIds,
                'pending_correction_request_ids' => $pendingCorrectionIds,
            ];
        }

        return $rows;
    }

    /** @param array<string, mixed> $filters @return list<array{employee_id:int,work_date:string}> */
    private function candidatePairs(ReportingScope $scope, array $filters, int $limit): array
    {
        if ($filters['outlet_ids'] === []) {
            return [];
        }

        $pairs = [];
        $add = function (int $employeeId, string $workDate) use (&$pairs, $limit): void {
            if ($employeeId > 0) {
                $pairs[$employeeId.'|'.$workDate] = ['employee_id' => $employeeId, 'work_date' => $workDate];
                if (count($pairs) > $limit) {
                    throw ValidationException::withMessages(['to' => 'Laporan melebihi batas data. Persempit rentang atau filter.']);
                }
            }
        };
        $employeeConstraint = function ($query) use ($filters): void {
            if ($filters['employee_id'] !== null) {
                $query->where('employee_id', $filters['employee_id']);
            }
        };

        $rules = WeeklyScheduleRule::query()->forTenant($scope->tenantId)
            ->whereIn('outlet_id', $filters['outlet_ids'])
            ->where('effective_from', '<=', $filters['to'])
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $filters['from']))
            ->when($filters['employee_id'] !== null, $employeeConstraint)->get();
        $dates = [];
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $filters['from'], 'UTC');
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $filters['to'], 'UTC');
        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $dates[] = $date;
            $dateKey = $date->toDateString();
            foreach ($rules as $rule) {
                if ((int) $rule->weekday === $date->isoWeekday()
                    && $rule->effective_from->toDateString() <= $dateKey
                    && ($rule->effective_until === null || $rule->effective_until->toDateString() > $dateKey)) {
                    $add((int) $rule->employee_id, $dateKey);
                }
            }
        }

        $exceptions = ScheduleException::query()->forTenant($scope->tenantId)
            ->whereIn('outlet_id', $filters['outlet_ids'])
            ->whereBetween('work_date', [$filters['from'], $filters['to']])
            ->whereNull('superseded_at')
            ->when($filters['employee_id'] !== null, $employeeConstraint)->get();
        foreach ($exceptions as $exception) {
            $add((int) $exception->employee_id, $exception->work_date->toDateString());
        }

        $sessions = AttendanceSession::query()->forTenant($scope->tenantId)
            ->whereIn('outlet_id', $filters['outlet_ids'])
            ->whereBetween('work_date', [$filters['from'], $filters['to']])
            ->when($filters['employee_id'] !== null, $employeeConstraint)
            ->get(['employee_id', 'work_date']);
        foreach ($sessions as $session) {
            $add((int) $session->employee_id, $session->work_date->toDateString());
        }

        $corrections = AttendanceCorrection::query()->forTenant($scope->tenantId)
            ->whereHas('approvalRequest', fn ($request) => $request->where('status', 'approved'))
            ->where(function ($date) use ($filters): void {
                $date->whereHas('session', fn ($session) => $session->whereBetween('work_date', [$filters['from'], $filters['to']]))
                    ->orWhereRaw(
                        "JSON_UNQUOTE(JSON_EXTRACT(proposed_values, '$.work_date')) BETWEEN ? AND ?",
                        [$filters['from'], $filters['to']],
                    );
            })
            ->where(function ($outlet) use ($filters): void {
                $outlet->whereHas('session', fn ($session) => $session->whereIn('outlet_id', $filters['outlet_ids']));
                foreach ($filters['outlet_ids'] as $outletId) {
                    $outlet->orWhereJsonContains('proposed_values->outlet_id', (int) $outletId);
                }
            })
            ->when($filters['employee_id'] !== null, $employeeConstraint)->get(['employee_id', 'proposed_values']);
        foreach ($corrections as $correction) {
            $effectiveDate = (string) ($correction->proposed_values['work_date'] ?? '');
            if ($effectiveDate >= $filters['from'] && $effectiveDate <= $filters['to']) {
                $add((int) $correction->employee_id, $effectiveDate);
            }
        }

        $requests = ApprovalRequest::query()->forTenant($scope->tenantId)
            ->where(function ($outlets) use ($scope, $filters): void {
                if ($filters['outlet_ids'] !== []) {
                    $outlets->whereIn('outlet_id', $filters['outlet_ids']);
                }
                if ($this->includeTenantLevelRequests($scope, $filters)) {
                    $outlets->orWhereNull('outlet_id');
                }
            })
            ->where(function ($date) use ($filters): void {
                $date->whereBetween('work_date', [$filters['from'], $filters['to']])
                    ->orWhere(fn ($range) => $range->where('starts_on', '<=', $filters['to'])->where('ends_on', '>=', $filters['from']));
            })
            ->when($filters['employee_id'] !== null, $employeeConstraint)->get();
        foreach ($requests as $request) {
            if ($request->work_date !== null) {
                $add((int) $request->employee_id, $request->work_date->toDateString());
            }
            if ($request->starts_on !== null && $request->ends_on !== null) {
                $first = max($filters['from'], $request->starts_on->toDateString());
                $last = min($filters['to'], $request->ends_on->toDateString());
                $leaveStart = CarbonImmutable::createFromFormat('!Y-m-d', $first, 'UTC');
                $leaveEnd = CarbonImmutable::createFromFormat('!Y-m-d', $last, 'UTC');
                for ($date = $leaveStart; $date->lessThanOrEqualTo($leaveEnd); $date = $date->addDay()) {
                    $add((int) $request->employee_id, $date->toDateString());
                }
            }
        }

        $finalizations = AttendanceFinalization::query()->forTenant($scope->tenantId)
            ->whereIn('outlet_id', $filters['outlet_ids'])
            ->whereBetween('work_date', [$filters['from'], $filters['to']])
            ->when($filters['employee_id'] !== null, $employeeConstraint)->get(['employee_id', 'work_date']);
        foreach ($finalizations as $finalization) {
            $add((int) $finalization->employee_id, $finalization->work_date->toDateString());
        }

        return array_values($pairs);
    }

    /** @param array<string, mixed> $filters */
    private function includeTenantLevelRequests(ReportingScope $scope, array $filters): bool
    {
        return $scope->owner
            && $filters['business_unit_id'] === null
            && count($filters['outlet_ids']) === count($scope->outletIds)
            && array_diff($scope->outletIds, $filters['outlet_ids']) === [];
    }

    /** @param list<array<string, mixed>> $rows @return array<string, mixed> */
    private function reportTotals(array $rows): array
    {
        $sessions = collect($rows)->flatMap(fn (array $row): array => $row['sessions']);

        return [
            'employee_workdays' => count($rows),
            'unique_employees' => collect($rows)->pluck('employee.id')->unique()->count(),
            'attendance_sessions' => $sessions->count(),
            'known_actual_duration_seconds' => (int) $sessions->whereNotNull('actual_duration_seconds')->sum('actual_duration_seconds'),
            'known_effective_duration_seconds' => (int) ($sessions->sum('effective_duration_seconds') + collect($rows)->pluck('reconstructions')->collapse()->sum('effective.duration_seconds')),
        ];
    }
}
