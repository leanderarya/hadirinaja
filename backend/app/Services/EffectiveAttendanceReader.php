<?php

namespace App\Services;

use App\Data\EffectiveScheduleResult;
use App\Models\ApprovalDecision;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceFinalization;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\Outlet;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

final class EffectiveAttendanceReader
{
    public function __construct(
        private readonly EffectiveScheduleResolver $schedules,
        private readonly PhysicalAttendanceSourceAdapter $physicalSources,
    ) {}

    /** @return array<string, mixed> */
    public function project(
        int $tenantId,
        int $employeeId,
        string $workDate,
        ?array $outletScopeIds = null,
        ?int $outletContext = null,
    ): array {
        $key = $employeeId.'|'.$workDate;
        $results = $this->projectPairs(
            $tenantId,
            [['employee_id' => $employeeId, 'work_date' => $workDate]],
            $outletScopeIds,
            $outletContext,
        );

        return $results[$key];
    }

    /**
     * Resolve many employee-workdays with batched source reads for management reporting.
     *
     * @param  list<array{employee_id:int, work_date:string}>  $pairs
     * @param  list<int>|null  $outletScopeIds  Null means an unscoped, tenant-authorized caller.
     * @return array<string, array<string, mixed>> keyed by "employeeId|workDate"
     */
    public function projectPairs(
        int $tenantId,
        array $pairs,
        ?array $outletScopeIds = null,
        ?int $outletContext = null,
    ): array {
        $normalized = [];
        foreach ($pairs as $pair) {
            $employeeId = (int) ($pair['employee_id'] ?? 0);
            $workDate = (string) ($pair['work_date'] ?? '');
            $date = CarbonImmutable::createFromFormat('!Y-m-d', $workDate, 'UTC');

            if ($employeeId < 1 || ! $date || $date->toDateString() !== $workDate) {
                throw ValidationException::withMessages(['work_date' => 'Tanggal atau karyawan laporan tidak valid.']);
            }

            $normalized[$employeeId.'|'.$workDate] = ['employee_id' => $employeeId, 'work_date' => $workDate];
        }

        if ($normalized === []) {
            return [];
        }

        $pairs = array_values($normalized);
        $employeeIds = collect($pairs)->pluck('employee_id')->unique()->values()->all();
        $dates = collect($pairs)->pluck('work_date')->unique()->sort()->values();
        $from = $dates->first();
        $to = $dates->last();
        $fromDate = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $toDate = CarbonImmutable::createFromFormat('!Y-m-d', $to, 'UTC');

        if ($fromDate->diffInDays($toDate) > 30) {
            throw ValidationException::withMessages(['work_date' => 'Rentang proyeksi harus mencakup 1 sampai 31 hari.']);
        }

        $employees = Employee::query()->forTenant($tenantId)->whereIn('id', $employeeIds)->get()->keyBy('id');
        if ($employees->count() !== count($employeeIds)) {
            throw ValidationException::withMessages(['employee_id' => 'Karyawan tidak tersedia pada organisasi aktif.']);
        }

        $employeesByDate = collect($pairs)->groupBy('work_date');
        $schedulesByKey = [];
        foreach ($employeesByDate as $workDate => $datePairs) {
            foreach ($datePairs->pluck('employee_id')->unique()->chunk(200) as $chunk) {
                foreach ($this->schedules->resolveWeek(
                    $tenantId,
                    $chunk->all(),
                    (string) $workDate,
                    1,
                    $outletContext,
                    $outletScopeIds,
                ) as $schedule) {
                    $schedulesByKey[$schedule->employeeId.'|'.$schedule->workDate] = $schedule;
                }
            }
        }

        $sessionsQuery = AttendanceSession::query()->forTenant($tenantId)
            ->with(['outlet', 'events.evidence'])
            ->whereIn('employee_id', $employeeIds)
            ->where(function ($query) use ($from, $to): void {
                $query->whereBetween('work_date', [$from, $to])
                    ->orWhereHas('corrections', function ($corrections) use ($from, $to): void {
                        $corrections->whereHas('approvalRequest', fn ($request) => $request->where('status', 'approved'))
                            ->whereRaw(
                                "JSON_UNQUOTE(JSON_EXTRACT(proposed_values, '$.work_date')) BETWEEN ? AND ?",
                                [$from, $to],
                            );
                    });
            });

        if ($outletScopeIds !== null) {
            $sessionsQuery->where(function ($scope) use ($tenantId, $outletScopeIds): void {
                $scope->whereIn('outlet_id', $outletScopeIds);

                if ($outletScopeIds !== []) {
                    $scope->orWhereHas('corrections', function ($corrections) use ($tenantId, $outletScopeIds): void {
                        $corrections->where('tenant_id', $tenantId)
                            ->whereHas('approvalRequest', fn ($request) => $request->where('status', 'approved'))
                            ->where(function ($effectiveOutlet) use ($outletScopeIds): void {
                                foreach ($outletScopeIds as $outletId) {
                                    $effectiveOutlet->orWhereJsonContains('proposed_values->outlet_id', (int) $outletId);
                                }
                            });
                    });
                }
            });
        }

        $sessions = $sessionsQuery->orderBy('check_in_at')->orderBy('id')->get();
        $sessionIds = $sessions->pluck('id')->map(fn ($id): int => (int) $id)->values();
        $approvedCorrections = $this->approvedCorrections($tenantId, $sessionIds);
        $effectiveOutletIds = $sessions->map(function (AttendanceSession $session) use ($approvedCorrections): int {
            $correction = $approvedCorrections->get((int) $session->getKey());

            return (int) ($correction['proposed_values']['outlet_id'] ?? $session->outlet_id);
        })->concat($sessions->flatMap(fn (AttendanceSession $session) => $session->events->pluck('checkout_outlet_id')))
            ->filter()->unique()->values();
        $effectiveOutlets = Outlet::query()->forTenant($tenantId)->whereIn('id', $effectiveOutletIds)->get()->keyBy('id');

        $requestsQuery = ApprovalRequest::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employeeIds)
            ->where(function ($query) use ($from, $to): void {
                $query->whereBetween('work_date', [$from, $to])
                    ->orWhere(fn ($range) => $range->where('starts_on', '<=', $to)->where('ends_on', '>=', $from));
            })
            ->with('decisions')->orderBy('id');

        if ($outletScopeIds !== null) {
            $requestsQuery->where(function ($scope) use ($outletScopeIds): void {
                $scope->whereIn('outlet_id', $outletScopeIds)->orWhereNull('outlet_id');
            });
        }
        $requestsByEmployee = $requestsQuery->get()->groupBy('employee_id');

        $finalizationsQuery = AttendanceFinalization::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employeeIds)->whereBetween('work_date', [$from, $to])
            ->orderByDesc('revision');
        if ($outletScopeIds !== null) {
            $finalizationsQuery->whereIn('outlet_id', $outletScopeIds);
        }
        $finalizationsByKey = $finalizationsQuery->get()
            ->unique(fn (AttendanceFinalization $row): string => $row->employee_id.'|'.$row->work_date->toDateString())
            ->keyBy(fn (AttendanceFinalization $row): string => $row->employee_id.'|'.$row->work_date->toDateString());

        $reversals = ApprovalDecision::query()->forTenant($tenantId)->where('action', 'reversed')
            ->whereIn('employee_id', $employeeIds)
            ->where(fn ($query) => $query->whereBetween('original_values->work_date', [$from, $to])
                ->orWhereBetween('effective_values->work_date', [$from, $to]))
            ->orderBy('id')->get()->groupBy('employee_id');

        $sessionsByEmployee = $sessions->groupBy('employee_id');
        $results = [];

        foreach ($pairs as $pair) {
            $key = $pair['employee_id'].'|'.$pair['work_date'];
            $employee = $employees->get($pair['employee_id']);
            $schedule = $schedulesByKey[$key] ?? null;
            if (! $schedule instanceof EffectiveScheduleResult) {
                continue;
            }

            $employeeSessions = $sessionsByEmployee->get($pair['employee_id'], collect());
            $employeeRequests = $requestsByEmployee->get($pair['employee_id'], collect());
            $dayRequests = $employeeRequests->filter(function (ApprovalRequest $request) use ($pair): bool {
                return $request->work_date?->toDateString() === $pair['work_date']
                    || ($request->starts_on !== null && $request->ends_on !== null
                        && $request->starts_on->toDateString() <= $pair['work_date']
                        && $request->ends_on->toDateString() >= $pair['work_date']);
            })->values();

            $results[$key] = $this->buildProjection(
                $tenantId,
                $employee,
                $pair['work_date'],
                $schedule,
                $employeeSessions,
                $approvedCorrections,
                $effectiveOutlets,
                $dayRequests,
                $reversals->get($pair['employee_id'], collect()),
                $finalizationsByKey->get($key),
                $outletScopeIds,
            );
        }

        return $results;
    }

    /** @return list<array<string, mixed>> */
    public function range(int $tenantId, int $employeeId, string $from, string $to): array
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $to, 'UTC');

        if (! $start || ! $end || $end->lessThan($start) || $start->diffInDays($end) > 30) {
            throw ValidationException::withMessages(['to' => 'Rentang proyeksi harus mencakup 1 sampai 31 hari.']);
        }

        $pairs = [];
        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $pairs[] = ['employee_id' => $employeeId, 'work_date' => $date->toDateString()];
        }

        $projected = $this->projectPairs($tenantId, $pairs);

        return array_values($projected);
    }

    /**
     * @param  Collection<int, AttendanceSession>  $sessions
     * @param  Collection<int, array<string, mixed>>  $approvedCorrections
     * @param  Collection<int, Outlet>  $effectiveOutlets
     * @param  Collection<int, ApprovalRequest>  $requests
     * @param  Collection<int, ApprovalDecision>  $reversals
     * @return array<string, mixed>
     */
    private function buildProjection(
        int $tenantId,
        Employee $employee,
        string $workDate,
        EffectiveScheduleResult $schedule,
        Collection $sessions,
        Collection $approvedCorrections,
        Collection $effectiveOutlets,
        Collection $requests,
        Collection $reversals,
        ?AttendanceFinalization $latestFinalization,
        ?array $outletScopeIds,
    ): array {
        $sessionRows = [];
        $sourceRows = [];
        $effectiveSessionIds = [];
        $departureDecisionIds = [];
        $snapshotSessionOutlets = collect($latestFinalization?->projection_snapshot['sessions'] ?? [])->pluck('effective.outlet_id', 'id');

        foreach ($sessions as $session) {
            $physical = $this->physicalSources->adapt($session);
            $correction = $approvedCorrections->get((int) $session->getKey());
            $originalWorkDate = $physical->workDate;
            $effectiveValues = $correction['proposed_values'] ?? [];
            $effectiveWorkDate = (string) ($effectiveValues['work_date'] ?? $originalWorkDate);

            if ($effectiveWorkDate !== $workDate) {
                if ($correction && $originalWorkDate === $workDate
                    && ($outletScopeIds === null || in_array((int) $session->outlet_id, $outletScopeIds, true))) {
                    $departureDecisionIds[] = $correction['decision_id'];
                }

                continue;
            }

            $effectiveCheckIn = $effectiveValues['check_in_at'] ?? $physical->checkInAt->toIso8601String();
            $effectiveCheckOut = $effectiveValues['check_out_at'] ?? $physical->checkOutAt?->toIso8601String();
            $effectiveOutletId = (int) ($effectiveValues['outlet_id'] ?? $session->outlet_id);
            if ($outletScopeIds !== null && ! in_array($effectiveOutletId, $outletScopeIds, true)) {
                if ($correction && in_array((int) $snapshotSessionOutlets->get($session->getKey()), $outletScopeIds, true)) {
                    $departureDecisionIds[] = $correction['decision_id'];
                }

                continue;
            }

            $durationSeconds = $this->durationSeconds($effectiveCheckIn, $effectiveCheckOut);
            $actualDurationSeconds = $physical->durationSeconds();
            $checkout = collect($physical->events)->firstWhere('type', 'check_out')['checkout_destination'] ?? null;
            $effectiveSessionIds[] = (int) $session->getKey();
            $sessionRows[] = [
                'id' => (int) $session->getKey(),
                'outlet' => [
                    'id' => $effectiveOutletId,
                    'name' => $effectiveOutlets->get($effectiveOutletId)?->name,
                ],
                'recording_status' => $session->status,
                'original' => [
                    ...$physical->original(),
                    'outlet' => ['id' => (int) $session->outlet_id, 'name' => $session->outlet?->name],
                ],
                'checkout_destination' => $checkout === null ? null : [
                    ...$checkout,
                    'name' => $effectiveOutlets->get($checkout['id'])?->name,
                ],
                'evidence' => $session->events->filter(fn ($event): bool => $event->evidence !== null)
                    ->map(fn ($event): array => [
                        'event_id' => (int) $event->getKey(),
                        'type' => $event->event_type,
                        'available' => AttendanceEvidenceExpirationService::availableToEmployee($event),
                        'expires_at' => AttendanceEvidenceExpirationService::employeeExpiresAt($event)->toIso8601String(),
                    ])->values()->all(),
                'effective' => [
                    'work_date' => $effectiveWorkDate,
                    'check_in_at' => $effectiveCheckIn,
                    'check_out_at' => $effectiveCheckOut,
                    'duration_seconds' => $durationSeconds,
                    'outlet_id' => $effectiveOutletId,
                ],
                'actual_duration_seconds' => $actualDurationSeconds,
                'schedule_snapshot' => $session->schedule_snapshot,
                'policy_snapshot' => $session->policy_snapshot,
                'review_indicators' => $session->review_indicators ?? [],
                'correction' => $correction ? [
                    'request_id' => $correction['request_id'],
                    'classification' => $correction['classification'],
                    'decision_id' => $correction['decision_id'],
                    'decided_at' => $correction['decided_at'],
                    'actor_user_id' => $correction['actor_user_id'],
                    'reason' => $correction['reason'],
                    ...$correction['revision'],
                ] : null,
            ];
            // Existing approved session overlays remain in force; they are not separate sources.
            $sourceRows[] = [
                'source_kind' => $physical->kind(),
                'source_id' => $physical->sessionId,
                'physical' => $physical->facts(),
                'effective' => $sessionRows[array_key_last($sessionRows)]['effective'],
            ];
        }

        $reconstructionDecisions = [];
        $reconstructionRequestIds = [];
        foreach ($requests->where('request_type', 'attendance_correction')->where('status', 'approved') as $request) {
            if (($request->details['correction_target'] ?? null) !== 'reconstruction'
                || $request->decisions->contains('action', 'reversed')) {
                continue;
            }

            $decision = $request->decisions->firstWhere('action', 'approved');
            if (! $decision?->effective_values) {
                continue;
            }

            $values = $decision->effective_values;
            $sourceRows[] = [
                'source_kind' => 'reconstruction',
                'source_id' => (int) $request->getKey(),
                'physical' => null,
                'effective' => [
                    ...$values,
                    'duration_seconds' => $this->durationSeconds($values['check_in_at'], $values['check_out_at']),
                ],
                'decision_id' => (int) $decision->getKey(),
            ];
            $reconstructionDecisions[] = (int) $decision->getKey();
            $reconstructionRequestIds[] = (int) $request->getKey();
        }

        $leaveRequests = $requests->where('request_type', 'leave')->values();
        $approvedLeave = $leaveRequests->first(fn (ApprovalRequest $request): bool => $request->status === 'approved');
        $overtimeRequests = $requests->where('request_type', 'overtime')->values();
        $pendingCorrections = $requests->where('request_type', 'attendance_correction')
            ->where('status', 'pending')->values();
        $reviewRequests = $requests->where('request_type', 'attendance_review')
            ->filter(function (ApprovalRequest $request) use ($workDate, $effectiveSessionIds, $reconstructionRequestIds): bool {
                $reconstructionId = $request->details['reconstruction_request_id'] ?? null;
                if ($reconstructionId !== null && ! in_array((int) $reconstructionId, $reconstructionRequestIds, true)) {
                    return false;
                }
                if ($request->work_date?->toDateString() === $workDate) {
                    return true;
                }

                $sessionId = $request->details['attendance_session_id'] ?? null;

                return $sessionId !== null && in_array((int) $sessionId, $effectiveSessionIds, true);
            })->values();
        $pendingReviews = $reviewRequests->where('status', 'pending')->values();
        $leaveConflictCase = $reviewRequests->first(fn (ApprovalRequest $request): bool => ($request->details['case_type'] ?? null) === 'leave_attendance_conflict');
        $sessionIndicators = collect($sessionRows)->flatMap(fn (array $row): array => $row['review_indicators'])->unique()->values();
        $reviewedIndicators = $reviewRequests->whereIn('status', ['approved', 'rejected'])
            ->flatMap(fn (ApprovalRequest $request): array => $request->details['indicators'] ?? [($request->details['indicator'] ?? '')])
            ->filter()->unique()->values();
        $unreviewedIndicators = $sessionIndicators->diff($reviewedIndicators)->values();
        $scheduleVisible = $outletScopeIds === null || $schedule->outletId === null
            || in_array($schedule->outletId, $outletScopeIds, true);
        $scheduledEnd = $scheduleVisible && $schedule->scheduledEnd
            ? CarbonImmutable::parse($schedule->scheduledEnd)->utc()
            : null;
        $windowOver = $scheduledEnd !== null
            ? CarbonImmutable::now('UTC')->greaterThanOrEqualTo($scheduledEnd)
            : false;
        $absenceReview = $reviewRequests->first(fn (ApprovalRequest $request): bool => ($request->details['case_type'] ?? null) === 'potential_absence');
        $absenceConfirmed = $absenceReview?->status === 'approved';
        $scheduleStatus = $scheduleVisible ? $schedule->status : 'unscheduled';
        $potentialAbsence = $sourceRows === [] && $scheduleStatus === 'scheduled' && $windowOver && $approvedLeave === null && ! $absenceConfirmed;
        $conflicts = [];

        if ($approvedLeave && $sourceRows !== []) {
            $conflicts[] = 'approved_leave_with_recorded_attendance';
        }
        if ($unreviewedIndicators->isNotEmpty()) {
            $conflicts[] = 'attendance_review_required';
        }
        if ($pendingCorrections->isNotEmpty()) {
            $conflicts[] = 'pending_attendance_correction';
        }
        if ($potentialAbsence) {
            $conflicts[] = 'potential_absence';
        }

        $unresolvedConflicts = [];
        if ($approvedLeave && $sourceRows !== [] && (! $leaveConflictCase || $leaveConflictCase->status === 'pending')) {
            $unresolvedConflicts[] = 'approved_leave_with_recorded_attendance';
        }
        if ($unreviewedIndicators->isNotEmpty() || $pendingReviews->isNotEmpty()) {
            $unresolvedConflicts[] = 'attendance_review_required';
        }
        if ($pendingCorrections->isNotEmpty()) {
            $unresolvedConflicts[] = 'pending_attendance_correction';
        }
        if ($potentialAbsence) {
            $unresolvedConflicts[] = 'potential_absence';
        }

        $reviewPending = $pendingReviews->isNotEmpty() || $pendingCorrections->isNotEmpty()
            || $unreviewedIndicators->isNotEmpty() || $potentialAbsence;
        $outcome = match (true) {
            $absenceConfirmed && $reconstructionDecisions === [] => 'confirmed_absence_pending_finalization',
            $potentialAbsence => 'potential_absence',
            $sourceRows !== [] && $scheduleStatus !== 'scheduled' => 'exceptional_attendance',
            $sourceRows !== [] => 'present',
            $approvedLeave !== null && ($approvedLeave->details['category'] ?? null) === 'annual' => 'leave',
            $approvedLeave !== null => (string) ($approvedLeave->details['category'] ?? 'permission'),
            default => 'no_recorded_outcome',
        };
        $effectiveFinalization = $latestFinalization
            && ($outletScopeIds === null || in_array((int) $latestFinalization->outlet_id, $outletScopeIds, true))
            ? $latestFinalization
            : null;
        $correctionDecisionIds = collect($sessionRows)->pluck('correction.decision_id')->filter()
            ->concat($reconstructionDecisions)->sort()->values()->all();
        sort($departureDecisionIds);
        $reversalIds = $reversals->filter(function (ApprovalDecision $decision) use ($workDate, $outletScopeIds): bool {
            foreach ([$decision->original_values, $decision->effective_values] as $values) {
                if (($values['work_date'] ?? null) === $workDate
                    && ($outletScopeIds === null || in_array((int) $values['outlet_id'], $outletScopeIds, true))) {
                    return true;
                }
            }

            return false;
        })->pluck('id')->values()->all();
        $snapshotProvenance = $effectiveFinalization?->projection_snapshot['projection_provenance'] ?? [];
        $snapshotCorrectionIds = $snapshotProvenance['correction_decision_ids'] ?? [];
        if ($effectiveFinalization !== null && $outletScopeIds !== null) {
            $snapshot = $effectiveFinalization->projection_snapshot;
            $snapshotCorrectionIds = collect($snapshot['sessions'] ?? [])
                ->whereIn('effective.outlet_id', $outletScopeIds)->pluck('correction.decision_id')
                ->concat(collect($snapshot['sources'] ?? [])->where('source_kind', 'reconstruction')
                    ->whereIn('effective.outlet_id', $outletScopeIds)->pluck('decision_id'))
                ->filter()->all();
        }
        $snapshotReversalIds = $snapshotProvenance['correction_reversal_ids'] ?? [];
        $basisChanged = $effectiveFinalization !== null && (
            array_diff($correctionDecisionIds, $snapshotCorrectionIds) !== []
            || array_diff($snapshotCorrectionIds, $correctionDecisionIds) !== []
            || array_diff($departureDecisionIds, $snapshotProvenance['correction_departure_decision_ids'] ?? []) !== []
            || array_diff($reversalIds, $snapshotReversalIds) !== []
        );
        $reviewBasis = $basisChanged ? hash('sha256', json_encode([
            $effectiveFinalization->getKey(), $correctionDecisionIds, $departureDecisionIds, $reversalIds,
            $outcome, $schedule->toArray(), array_column($sourceRows, 'effective'),
            $approvedLeave?->getKey(), $reviewRequests->pluck('status', 'id')->all(),
        ], JSON_THROW_ON_ERROR)) : null;

        $scheduleData = $schedule->toArray();
        if (! $scheduleVisible) {
            $scheduleData = [
                'employee_id' => (int) $employee->getKey(),
                'tenant_id' => $tenantId,
                'work_date' => $workDate,
                'status' => 'unscheduled',
                'outlet' => null,
                'timezone' => null,
                'shift' => null,
                'scheduled_start' => null,
                'scheduled_end' => null,
                'policy' => null,
                'provenance' => ['source' => 'outside_authorized_outlet_scope'],
                'holiday_references' => null,
                'outlet_operating' => null,
                'conflicts' => [],
            ];
        }

        return [
            'tenant_id' => $tenantId,
            'employee' => ['id' => (int) $employee->getKey(), 'name' => $employee->name],
            'work_date' => $workDate,
            'outlet' => $scheduleVisible && $schedule->outletId !== null
                ? ['id' => $schedule->outletId, 'name' => $schedule->outletName]
                : null,
            'schedule' => $scheduleData,
            'sessions' => $sessionRows,
            'sources' => $sourceRows,
            'original_attendance_references' => collect($sessionRows)->pluck('original.event_ids')->flatten()->values()->all(),
            'actual_duration_seconds' => $this->totalDuration($sessionRows, 'actual_duration_seconds'),
            'effective_duration_seconds' => $this->totalDuration($sourceRows, 'effective.duration_seconds'),
            'approved_leave' => $approvedLeave ? $this->requestData($approvedLeave) : null,
            'leave_requests' => $leaveRequests->map(fn (ApprovalRequest $request): array => $this->requestData($request))->all(),
            'overtime_requests' => $overtimeRequests->map(fn (ApprovalRequest $request): array => $this->requestData($request))->all(),
            'pending_corrections' => $pendingCorrections->map(fn (ApprovalRequest $request): array => $this->requestData($request))->all(),
            'review' => [
                'status' => $reviewPending ? 'pending' : ($reviewRequests->isNotEmpty() ? 'resolved' : 'none'),
                'indicators' => $sessionIndicators->all(),
                'unreviewed_indicators' => $unreviewedIndicators->all(),
                'cases' => $reviewRequests->map(fn (ApprovalRequest $request): array => $this->requestData($request))->all(),
            ],
            'outcome' => $outcome,
            'conflicts' => $conflicts,
            'unresolved_conflicts' => array_values(array_unique($unresolvedConflicts)),
            'is_finalized' => $effectiveFinalization !== null && ! $basisChanged,
            'finalization_review_basis' => $reviewBasis,
            'requires_refinalization' => $basisChanged,
            'finalization' => $effectiveFinalization ? [
                'id' => (int) $effectiveFinalization->getKey(),
                'revision' => (int) $effectiveFinalization->revision,
                'outcome' => $effectiveFinalization->outcome,
                'reason' => $effectiveFinalization->reason,
                'actor_user_id' => (int) $effectiveFinalization->actor_user_id,
                'finalized_at' => $effectiveFinalization->finalized_at->toIso8601String(),
                'projection_snapshot' => $outletScopeIds === null ? $effectiveFinalization->projection_snapshot : null,
            ] : null,
            'projection_provenance' => [
                'correction_decision_ids' => $correctionDecisionIds,
                'correction_reversal_ids' => $reversalIds,
                'correction_departure_decision_ids' => $departureDecisionIds,
                'leave_request_ids' => $leaveRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                'overtime_request_ids' => $overtimeRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                'review_request_ids' => $reviewRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
            ],
        ];
    }

    /** @param Collection<int, int> $sessionIds @return Collection<int, array<string, mixed>> keyed by session id */
    private function approvedCorrections(int $tenantId, Collection $sessionIds): Collection
    {
        if ($sessionIds->isEmpty()) {
            return collect();
        }

        $corrections = AttendanceCorrection::query()->forTenant($tenantId)
            ->whereIn('attendance_session_id', $sessionIds)->get();
        if ($corrections->isEmpty()) {
            return collect();
        }

        $requests = ApprovalRequest::query()->forTenant($tenantId)
            ->whereIn('id', $corrections->pluck('approval_request_id'))
            ->where('status', 'approved')->withoutReversal()->get()->keyBy('id');
        $decisions = ApprovalDecision::query()->forTenant($tenantId)
            ->whereIn('approval_request_id', $requests->keys())
            ->whereIn('action', ['approved', 'routine_applied'])
            ->orderBy('acted_at')->orderBy('id')->get()->keyBy('approval_request_id');
        $mapped = [];

        foreach ($corrections as $correction) {
            $request = $requests->get($correction->approval_request_id);
            $decision = $decisions->get($correction->approval_request_id);
            if (! $request || ! $decision) {
                continue;
            }

            $sessionId = (int) $correction->attendance_session_id;
            $existing = $mapped[$sessionId] ?? null;
            $order = $correction->effectOrder($decision);
            if ($existing && $existing['order'] > $order) {
                continue;
            }

            $mapped[$sessionId] = [
                'order' => $order,
                'request_id' => (int) $request->getKey(),
                'classification' => $correction->classification,
                'original_values' => $correction->original_values,
                'proposed_values' => $correction->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT
                    ? $decision->effective_values
                    : $correction->proposed_values,
                'decision_id' => (int) $decision->getKey(),
                'decided_at' => $decision->acted_at->toIso8601String(),
                'actor_user_id' => (int) $decision->actor_user_id,
                'reason' => $request->reason,
                'revision' => $correction->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT ? [
                    'contract_version' => $correction->contract_version,
                    'correction_id' => (int) $correction->getKey(),
                    'basis_correction_id' => $correction->basis_correction_id,
                ] : [],
            ];
        }

        return collect($mapped);
    }

    private function durationSeconds(?string $checkIn, ?string $checkOut): ?int
    {
        if ($checkIn === null || $checkOut === null) {
            return null;
        }

        $start = CarbonImmutable::parse($checkIn)->utc();
        $end = CarbonImmutable::parse($checkOut)->utc();

        return $end->greaterThanOrEqualTo($start) ? $end->getTimestamp() - $start->getTimestamp() : null;
    }

    /** @param list<array<string, mixed>> $sessions */
    private function totalDuration(array $sessions, string $path): ?int
    {
        if ($sessions === []) {
            return 0;
        }

        $total = 0;
        foreach ($sessions as $session) {
            $value = $path === 'effective.duration_seconds'
                ? ($session['effective']['duration_seconds'] ?? null)
                : ($session['actual_duration_seconds'] ?? null);
            if ($value === null) {
                return null;
            }
            $total += (int) $value;
        }

        return $total;
    }

    /** @return array<string, mixed> */
    private function requestData(ApprovalRequest $request): array
    {
        return [
            'id' => (int) $request->getKey(),
            'type' => $request->request_type,
            'status' => $request->status,
            'category' => $request->details['category'] ?? $request->details['case_type'] ?? null,
            'reason' => $request->reason,
            'details' => $request->details,
            'decision_history' => $request->decisions->map(fn (ApprovalDecision $decision): array => [
                'id' => (int) $decision->getKey(),
                'action' => $decision->action,
                'reason' => $decision->reason,
                'actor_user_id' => (int) $decision->actor_user_id,
                'acted_at' => $decision->acted_at->toIso8601String(),
            ])->all(),
        ];
    }
}
