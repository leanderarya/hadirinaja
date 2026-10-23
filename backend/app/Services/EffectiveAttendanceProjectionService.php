<?php

namespace App\Services;

use App\Models\ApprovalDecision;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceFinalization;
use App\Models\AttendanceSession;
use App\Models\Employee;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

final class EffectiveAttendanceProjectionService
{
    public function __construct(private readonly EffectiveScheduleResolver $schedules) {}

    /** @return array<string, mixed> */
    public function project(int $tenantId, int $employeeId, string $workDate): array
    {
        $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->first();

        if (! $employee) {
            throw ValidationException::withMessages(['employee_id' => 'Karyawan tidak tersedia pada organisasi aktif.']);
        }

        $schedule = $this->schedules->resolve($tenantId, $employeeId, $workDate);
        $sessions = AttendanceSession::query()->forTenant($tenantId)->with(['outlet', 'events.evidence'])
            ->where('employee_id', $employeeId)->orderBy('check_in_at')->get();
        $approvedCorrections = $this->approvedCorrections($tenantId, $employeeId);
        $sessionRows = [];
        $effectiveSessionIds = [];

        foreach ($sessions as $session) {
            $correction = $approvedCorrections->get((int) $session->getKey());
            $originalWorkDate = $session->work_date->toDateString();
            $effectiveValues = $correction['proposed_values'] ?? [];
            $effectiveWorkDate = (string) ($effectiveValues['work_date'] ?? $originalWorkDate);

            if ($effectiveWorkDate !== $workDate) {
                continue;
            }

            $effectiveCheckIn = $effectiveValues['check_in_at'] ?? $session->check_in_at?->utc()->toIso8601String();
            $effectiveCheckOut = $effectiveValues['check_out_at'] ?? $session->check_out_at?->utc()->toIso8601String();
            $effectiveOutletId = isset($effectiveValues['outlet_id']) ? (int) $effectiveValues['outlet_id'] : (int) $session->outlet_id;
            $durationSeconds = $this->durationSeconds($effectiveCheckIn, $effectiveCheckOut);
            $actualDurationSeconds = $this->durationSeconds(
                $session->check_in_at?->utc()->toIso8601String(),
                $session->check_out_at?->utc()->toIso8601String(),
            );
            $effectiveSessionIds[] = (int) $session->getKey();
            $sessionRows[] = [
                'id' => (int) $session->getKey(),
                'outlet' => ['id' => $effectiveOutletId, 'name' => $session->outlet?->name],
                'recording_status' => $session->status,
                'original' => [
                    'work_date' => $originalWorkDate,
                    'check_in_at' => $session->check_in_at?->utc()->toIso8601String(),
                    'check_out_at' => $session->check_out_at?->utc()->toIso8601String(),
                    'event_ids' => $session->events->pluck('id')->map(fn ($id): int => (int) $id)->values()->all(),
                    'events' => $session->events->map(fn ($event): array => [
                        'id' => (int) $event->getKey(),
                        'type' => $event->event_type,
                        'origin' => $event->origin,
                        'recorded_at' => $event->recorded_at->utc()->toIso8601String(),
                        'has_evidence' => $event->evidence !== null,
                    ])->values()->all(),
                ],
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
                ] : null,
            ];
        }

        $requests = ApprovalRequest::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->where(function ($query) use ($workDate): void {
                $query->where('work_date', $workDate)
                    ->orWhere(fn ($range) => $range->where('starts_on', '<=', $workDate)->where('ends_on', '>=', $workDate));
            })->with('decisions')->orderBy('id')->get();
        $leaveRequests = $requests->where('request_type', 'leave')->values();
        $approvedLeave = $leaveRequests->first(fn (ApprovalRequest $request): bool => $request->status === 'approved');
        $overtimeRequests = $requests->where('request_type', 'overtime')->values();
        $pendingCorrections = $requests->where('request_type', 'attendance_correction')
            ->where('status', 'pending')->values();
        $reviewRequests = ApprovalRequest::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->where('request_type', 'attendance_review')->orderBy('id')->get()
            ->filter(function (ApprovalRequest $request) use ($workDate, $effectiveSessionIds): bool {
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
        $scheduledEnd = $schedule->scheduledEnd ? CarbonImmutable::parse($schedule->scheduledEnd)->utc() : null;
        $windowOver = $scheduledEnd !== null
            ? CarbonImmutable::now('UTC')->greaterThanOrEqualTo($scheduledEnd)
            : false;
        $absenceReview = $reviewRequests->first(fn (ApprovalRequest $request): bool => ($request->details['case_type'] ?? null) === 'potential_absence');
        $absenceConfirmed = $absenceReview?->status === 'approved';
        $potentialAbsence = $sessionRows === [] && $schedule->status === 'scheduled' && $windowOver && $approvedLeave === null && ! $absenceConfirmed;
        $conflicts = [];

        if ($approvedLeave && $sessionRows !== []) {
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
        if ($approvedLeave && $sessionRows !== [] && (! $leaveConflictCase || $leaveConflictCase->status === 'pending')) {
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

        $latestFinalization = AttendanceFinalization::query()->forTenant($tenantId)
            ->where('employee_id', $employeeId)->where('work_date', $workDate)
            ->orderByDesc('revision')->first();
        $reviewPending = $pendingReviews->isNotEmpty() || $pendingCorrections->isNotEmpty()
            || $unreviewedIndicators->isNotEmpty() || $potentialAbsence;
        $outcome = match (true) {
            $absenceConfirmed => 'confirmed_absence_pending_finalization',
            $potentialAbsence => 'potential_absence',
            $sessionRows !== [] && $schedule->status !== 'scheduled' => 'exceptional_attendance',
            $sessionRows !== [] => 'present',
            $approvedLeave !== null && ($approvedLeave->details['category'] ?? null) === 'annual' => 'leave',
            $approvedLeave !== null => (string) ($approvedLeave->details['category'] ?? 'permission'),
            default => 'no_recorded_outcome',
        };

        $actualDurationSeconds = $this->totalDuration($sessionRows, 'actual_duration_seconds');
        $effectiveDurationSeconds = $this->totalDuration($sessionRows, 'effective.duration_seconds');

        return [
            'tenant_id' => $tenantId,
            'employee' => ['id' => $employeeId, 'name' => $employee->name],
            'work_date' => $workDate,
            'outlet' => $schedule->outletId === null ? null : ['id' => $schedule->outletId, 'name' => $schedule->outletName],
            'schedule' => $schedule->toArray(),
            'sessions' => $sessionRows,
            'original_attendance_references' => collect($sessionRows)->pluck('original.event_ids')->flatten()->values()->all(),
            'actual_duration_seconds' => $actualDurationSeconds,
            'effective_duration_seconds' => $effectiveDurationSeconds,
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
            'is_finalized' => $latestFinalization !== null,
            'finalization' => $latestFinalization ? [
                'id' => (int) $latestFinalization->getKey(),
                'revision' => (int) $latestFinalization->revision,
                'outcome' => $latestFinalization->outcome,
                'reason' => $latestFinalization->reason,
                'actor_user_id' => (int) $latestFinalization->actor_user_id,
                'finalized_at' => $latestFinalization->finalized_at->toIso8601String(),
                'projection_snapshot' => $latestFinalization->projection_snapshot,
            ] : null,
            'projection_provenance' => [
                'correction_decision_ids' => collect($sessionRows)->pluck('correction.decision_id')->filter()->values()->all(),
                'leave_request_ids' => $leaveRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                'overtime_request_ids' => $overtimeRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                'review_request_ids' => $reviewRequests->pluck('id')->map(fn ($id): int => (int) $id)->all(),
            ],
        ];
    }

    /** @return list<array<string, mixed>> */
    public function range(int $tenantId, int $employeeId, string $from, string $to): array
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $to, 'UTC');

        if (! $start || ! $end || $end->lessThan($start) || $start->diffInDays($end) > 30) {
            throw ValidationException::withMessages(['to' => 'Rentang proyeksi harus mencakup 1 sampai 31 hari.']);
        }

        $results = [];

        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $results[] = $this->project($tenantId, $employeeId, $date->toDateString());
        }

        return $results;
    }

    /** @return Collection<int, array<string, mixed>> keyed by session id */
    private function approvedCorrections(int $tenantId, int $employeeId): Collection
    {
        $corrections = AttendanceCorrection::query()->forTenant($tenantId)->where('employee_id', $employeeId)->get();
        if ($corrections->isEmpty()) {
            return collect();
        }

        $requests = ApprovalRequest::query()->forTenant($tenantId)
            ->whereIn('id', $corrections->pluck('approval_request_id'))
            ->where('status', 'approved')->get()->keyBy('id');
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
            if ($existing && [$existing['decided_at'], $existing['decision_id']] > [$decision->acted_at->toIso8601String(), (int) $decision->getKey()]) {
                continue;
            }

            $mapped[$sessionId] = [
                'request_id' => (int) $request->getKey(),
                'classification' => $correction->classification,
                'original_values' => $correction->original_values,
                'proposed_values' => $correction->proposed_values,
                'decision_id' => (int) $decision->getKey(),
                'decided_at' => $decision->acted_at->toIso8601String(),
                'actor_user_id' => (int) $decision->actor_user_id,
                'reason' => $request->reason,
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
