<?php

namespace App\Services;

use App\Data\ReportingScope;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

final class AuditTrailQueryService
{
    public const SOURCES = [
        'attendance_event',
        'approval_request',
        'approval_decision',
        'attendance_finalization',
        'schedule_change',
        'employee_assignment',
        'management_change',
        'report_export',
    ];

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function page(ReportingScope $scope, array $filters, ?string $source = null): array
    {
        $query = DB::query()->fromSub($this->entries($scope, $filters, $source), 'audit_entries')
            ->orderByDesc('occurred_at')->orderByDesc('source_type')->orderByDesc('source_id');
        $page = $query->paginate($filters['per_page'], ['*'], 'page', $filters['page']);

        return [
            'data' => $page->items(),
            'pagination' => [
                'current_page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'last_page' => max(1, $page->lastPage()),
                'has_more' => $page->hasMorePages(),
            ],
            'provenance' => [
                'tenant_id' => $scope->tenantId,
                'authorized_outlet_ids' => $filters['outlet_ids'],
                'timestamp_semantics' => 'Rentang audit memakai timestamp UTC dari catatan sumber.',
                'historical_coverage' => 'Hanya sumber yang telah merekam aktivitas; histori yang tidak direkam sebelumnya tidak direkonstruksi.',
            ],
        ];
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function find(ReportingScope $scope, array $filters, string $source, int $entry): array
    {
        abort_unless(in_array($source, self::SOURCES, true) && $entry > 0, 404);

        $record = DB::query()->fromSub($this->entries($scope, $filters, $source), 'audit_entries')
            ->where('source_id', $entry)->first();

        abort_if($record === null, 404);

        return [
            ...(array) $record,
            'details' => $this->safeDetails($source, $entry, (int) $record->tenant_id),
        ];
    }

    /** @param array<string, mixed> $filters */
    private function entries(ReportingScope $scope, array $filters, ?string $source): Builder
    {
        $branches = [];
        foreach (self::SOURCES as $candidate) {
            if ($source !== null && $source !== $candidate) {
                continue;
            }
            $branch = match ($candidate) {
                'attendance_event' => $this->attendanceEvents($scope, $filters),
                'approval_request' => $this->approvalRequests($scope, $filters),
                'approval_decision' => $this->approvalDecisions($scope, $filters),
                'attendance_finalization' => $this->finalizations($scope, $filters),
                'schedule_change' => $this->scheduleChanges($scope, $filters),
                'employee_assignment' => $this->employeeAssignments($scope, $filters),
                'management_change' => $this->managementChanges($scope, $filters),
                'report_export' => $this->reportExports($scope, $filters),
            };
            $branches[] = $branch;
        }

        $union = array_shift($branches);
        foreach ($branches as $branch) {
            $union->unionAll($branch);
        }

        return $union;
    }

    /** @param array<string, mixed> $filters */
    private function attendanceEvents(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('attendance_events as e')
            ->leftJoin('kiosk_devices as kd', fn (JoinClause $join) => $join->on('kd.id', '=', 'e.kiosk_device_id')->on('kd.tenant_id', '=', 'e.tenant_id'))
            ->join('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'e.employee_id')->on('emp.tenant_id', '=', 'e.tenant_id'))
            ->join('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'e.outlet_id')->on('o.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('tenant_memberships as m', fn (JoinClause $join) => $join->on('m.id', '=', 'e.tenant_membership_id')->on('m.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('users as u', 'u.id', '=', 'm.user_id')
            ->where('e.tenant_id', $scope->tenantId)->whereBetween('e.recorded_at', $this->utcRange($filters))
            ->whereIn('e.outlet_id', $filters['outlet_ids'])
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('e.employee_id', $filters['employee_id']))
            ->selectRaw("'attendance_event' AS source_type, e.id AS source_id, e.tenant_id, e.recorded_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, emp.id AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, CONCAT('attendance.', e.event_type) AS action, CONCAT(IF(e.origin = 'kiosk', CONCAT('Kiosk #', e.kiosk_device_id, ' · ', COALESCE(kd.name, 'Perangkat kiosk'), ' · '), 'Personal '), IF(e.event_type = 'check_in', 'check-in', 'check-out')) AS summary, NULL AS reason, 'attendance_session' AS resource_type, e.attendance_session_id AS resource_id");

        return $query;
    }

    /** @param array<string, mixed> $filters */
    private function approvalRequests(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('approval_requests as r')
            ->join('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'r.employee_id')->on('emp.tenant_id', '=', 'r.tenant_id'))
            ->leftJoin('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'r.outlet_id')->on('o.tenant_id', '=', 'r.tenant_id'))
            ->leftJoin('users as u', 'u.id', '=', 'r.requester_user_id')
            ->where('r.tenant_id', $scope->tenantId)->whereBetween('r.created_at', $this->utcRange($filters))
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('r.employee_id', $filters['employee_id']))
            ->selectRaw("'approval_request' AS source_type, r.id AS source_id, r.tenant_id, r.created_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, emp.id AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, CONCAT('approval.request.', r.request_type) AS action, CONCAT('Pengajuan ', r.request_type, ' (', r.status, ')') AS summary, NULL AS reason, CONCAT('approval_', r.request_type) AS resource_type, r.id AS resource_id");

        return $this->scopeOutlet($query, 'r.outlet_id', $filters['outlet_ids'], $this->includeTenantLevel($scope, $filters));
    }

    /** @param array<string, mixed> $filters */
    private function approvalDecisions(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('approval_decisions as d')
            ->join('approval_requests as r', fn (JoinClause $join) => $join->on('r.id', '=', 'd.approval_request_id')->on('r.tenant_id', '=', 'd.tenant_id'))
            ->join('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'd.employee_id')->on('emp.tenant_id', '=', 'd.tenant_id'))
            ->leftJoin('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'r.outlet_id')->on('o.tenant_id', '=', 'r.tenant_id'))
            ->join('users as u', 'u.id', '=', 'd.actor_user_id')
            ->where('d.tenant_id', $scope->tenantId)->whereBetween('d.acted_at', $this->utcRange($filters))
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('d.employee_id', $filters['employee_id']))
            ->selectRaw("'approval_decision' AS source_type, d.id AS source_id, d.tenant_id, d.acted_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, emp.id AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, CONCAT('approval.decision.', d.action) AS action, CONCAT('Keputusan ', r.request_type, ': ', d.action) AS summary, CASE WHEN r.request_type = 'leave' THEN NULL ELSE d.reason END AS reason, CONCAT('approval_', r.request_type) AS resource_type, r.id AS resource_id");

        return $this->scopeOutlet($query, 'r.outlet_id', $filters['outlet_ids'], $this->includeTenantLevel($scope, $filters));
    }

    /** @param array<string, mixed> $filters */
    private function finalizations(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('attendance_finalizations as f')
            ->join('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'f.employee_id')->on('emp.tenant_id', '=', 'f.tenant_id'))
            ->leftJoin('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'f.outlet_id')->on('o.tenant_id', '=', 'f.tenant_id'))
            ->join('users as u', 'u.id', '=', 'f.actor_user_id')
            ->where('f.tenant_id', $scope->tenantId)->whereBetween('f.finalized_at', $this->utcRange($filters))
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('f.employee_id', $filters['employee_id']))
            ->selectRaw("'attendance_finalization' AS source_type, f.id AS source_id, f.tenant_id, f.finalized_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, emp.id AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, 'attendance.finalized' AS action, CONCAT('Finalisasi ', f.outcome, ' · revisi ', f.revision) AS summary, f.reason AS reason, 'attendance_finalization' AS resource_type, f.id AS resource_id");

        return $this->scopeOutlet($query, 'f.outlet_id', $filters['outlet_ids'], $this->includeTenantLevel($scope, $filters));
    }

    /** @param array<string, mixed> $filters */
    private function scheduleChanges(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('scheduling_change_events as e')
            ->leftJoin('weekly_schedule_rules as wr', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'weekly_schedule_rule'"))->on('wr.id', '=', 'e.resource_id')->on('wr.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('shift_change_requests as scr', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'shift_change_request'"))->on('scr.id', '=', 'e.resource_id')->on('scr.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('schedule_weeks as sw', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'schedule_week'"))->on('sw.id', '=', 'e.resource_id')->on('sw.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('schedule_exceptions as se', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'schedule_exception'"))->on('se.id', '=', 'e.resource_id')->on('se.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('outlet_attendance_policy_versions as op', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'outlet_policy'"))->on('op.id', '=', 'e.resource_id')->on('op.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('outlet_calendar_versions as cv', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'outlet_calendar'"))->on('cv.id', '=', 'e.resource_id')->on('cv.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('outlet_calendar_exceptions as ce', fn (JoinClause $join) => $join->on('e.resource_type', '=', DB::raw("'calendar_exception'"))->on('ce.id', '=', 'e.resource_id')->on('ce.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', DB::raw('COALESCE(wr.employee_id, se.employee_id, scr.requester_id)'))->on('emp.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', DB::raw('COALESCE(wr.outlet_id, se.outlet_id, op.outlet_id, cv.outlet_id, ce.outlet_id, sw.outlet_id, scr.outlet_id)'))->on('o.tenant_id', '=', 'e.tenant_id'))
            ->join('users as u', 'u.id', '=', 'e.actor_user_id')
            ->where('e.tenant_id', $scope->tenantId)->whereBetween('e.created_at', $this->utcRange($filters))
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->whereRaw('COALESCE(wr.employee_id, se.employee_id, scr.requester_id) = ?', [$filters['employee_id']]))
            ->selectRaw("'schedule_change' AS source_type, e.id AS source_id, e.tenant_id, e.created_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, COALESCE(wr.employee_id, se.employee_id, scr.requester_id) AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, CONCAT('schedule.', e.action) AS action, CONCAT('Perubahan ', REPLACE(e.resource_type, '_', ' '), ': ', e.action) AS summary, e.reason AS reason, e.resource_type AS resource_type, e.resource_id AS resource_id");

        if ($scope->owner) {
            return $this->scopeOutlet($query, 'o.id', $filters['outlet_ids'], $this->includeTenantLevel($scope, $filters));
        }

        if ($filters['outlet_ids'] === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query->whereIn('o.id', $filters['outlet_ids']);
    }

    /** @param array<string, mixed> $filters */
    private function employeeAssignments(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('employee_outlet_assignments as a')
            ->join('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'a.employee_id')->on('emp.tenant_id', '=', 'a.tenant_id'))
            ->join('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'a.outlet_id')->on('o.tenant_id', '=', 'a.tenant_id'))
            ->leftJoin('tenant_memberships as actor_membership', fn (JoinClause $join) => $join->on('actor_membership.id', '=', 'a.created_by_membership_id')->on('actor_membership.tenant_id', '=', 'a.tenant_id'))
            ->leftJoin('users as actor_user', 'actor_user.id', '=', 'actor_membership.user_id')
            ->where('a.tenant_id', $scope->tenantId)->whereBetween('a.created_at', $this->utcRange($filters))
            ->whereIn('a.outlet_id', $filters['outlet_ids'])
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('a.employee_id', $filters['employee_id']))
            ->selectRaw("'employee_assignment' AS source_type, a.id AS source_id, a.tenant_id, a.created_at AS occurred_at, actor_user.id AS actor_user_id, actor_user.name AS actor_name, emp.id AS employee_id, emp.name AS employee_name, o.id AS outlet_id, o.name AS outlet_name, CONCAT('employee.assignment.', a.assignment_type) AS action, CONCAT('Penugasan ', a.assignment_type, ' · berlaku ', a.effective_from, ' s/d ', a.effective_until) AS summary, NULL AS reason, 'employee_outlet_assignment' AS resource_type, a.id AS resource_id");

        return $query;
    }

    /** @param array<string, mixed> $filters */
    private function reportExports(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('report_export_events as e')
            ->join('tenant_memberships as m', fn (JoinClause $join) => $join->on('m.id', '=', 'e.actor_membership_id')->on('m.tenant_id', '=', 'e.tenant_id'))
            ->join('users as u', 'u.id', '=', 'e.actor_user_id')
            ->where('e.tenant_id', $scope->tenantId)->whereBetween('e.generated_at', $this->utcRange($filters))
            ->selectRaw("'report_export' AS source_type, e.id AS source_id, e.tenant_id, e.generated_at AS occurred_at, u.id AS actor_user_id, u.name AS actor_name, NULL AS employee_id, NULL AS employee_name, NULL AS outlet_id, NULL AS outlet_name, CONCAT('report.export.', e.report_type) AS action, CONCAT('Ekspor CSV ', e.report_type, ' (', e.row_count, ' baris)') AS summary, NULL AS reason, e.report_type AS resource_type, e.id AS resource_id");

        if ($scope->owner) {
            return $query;
        }

        if ($filters['outlet_ids'] === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query
            ->whereExists(function (Builder $exists) use ($filters): void {
                $exists->selectRaw('1')->from('report_export_event_outlets as s')
                    ->whereColumn('s.report_export_event_id', 'e.id')->whereColumn('s.tenant_id', 'e.tenant_id')
                    ->whereIn('s.outlet_id', $filters['outlet_ids']);
            })
            ->whereNotExists(function (Builder $outside) use ($filters): void {
                $outside->selectRaw('1')->from('report_export_event_outlets as s')
                    ->whereColumn('s.report_export_event_id', 'e.id')->whereColumn('s.tenant_id', 'e.tenant_id')
                    ->whereNotIn('s.outlet_id', $filters['outlet_ids']);
            });
    }

    /** @param array<string, mixed> $filters */
    private function managementChanges(ReportingScope $scope, array $filters): Builder
    {
        $query = DB::table('management_change_events as e')
            ->leftJoin('employees as emp', fn (JoinClause $join) => $join->on('emp.id', '=', 'e.employee_id')->on('emp.tenant_id', '=', 'e.tenant_id'))
            ->leftJoin('outlets as o', fn (JoinClause $join) => $join->on('o.id', '=', 'e.outlet_id')->on('o.tenant_id', '=', 'e.tenant_id'))
            ->join('users as u', 'u.id', '=', 'e.actor_user_id')
            ->where('e.tenant_id', $scope->tenantId)->whereBetween('e.occurred_at', $this->utcRange($filters))
            ->when($filters['employee_id'] !== null, fn (Builder $q) => $q->where('e.employee_id', $filters['employee_id']))
            ->selectRaw("'management_change' AS source_type, e.id AS source_id, e.tenant_id, e.occurred_at, u.id AS actor_user_id, u.name AS actor_name, e.employee_id AS employee_id, emp.name AS employee_name, e.outlet_id AS outlet_id, o.name AS outlet_name, CONCAT('management.', e.subject_type, '.', e.action) AS action, CONCAT('Perubahan ', REPLACE(e.subject_type, '_', ' '), ': ', e.action) AS summary, NULL AS reason, e.subject_type AS resource_type, e.subject_id AS resource_id");

        return $this->scopeOutlet($query, 'e.outlet_id', $filters['outlet_ids'], $this->includeTenantLevel($scope, $filters));
    }

    private function scopeOutlet(Builder $query, string $column, array $outletIds, bool $allowNull): Builder
    {
        if ($outletIds === []) {
            return $allowNull ? $query->whereNull($column) : $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $scope) use ($column, $outletIds, $allowNull): void {
            $scope->whereIn($column, $outletIds);
            if ($allowNull) {
                $scope->orWhereNull($column);
            }
        });
    }

    /** @param array<string, mixed> $filters @return array{string,string} */
    private function utcRange(array $filters): array
    {
        return [$filters['from'].' 00:00:00', $filters['to'].' 23:59:59'];
    }

    /** @param array<string, mixed> $filters */
    private function includeTenantLevel(ReportingScope $scope, array $filters): bool
    {
        return $scope->owner
            && $filters['business_unit_id'] === null
            && count($filters['outlet_ids']) === count($scope->outletIds)
            && array_diff($scope->outletIds, $filters['outlet_ids']) === [];
    }

    /** @return array<string, mixed> */
    private function safeDetails(string $source, int $id, int $tenantId): array
    {
        if ($source === 'attendance_event') {
            $event = DB::table('attendance_events')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['attendance_session_id', 'event_type', 'origin', 'recorded_at', 'kiosk_device_id']);
            abort_if($event === null, 404);

            return [
                'session_id' => (int) $event->attendance_session_id,
                'event_type' => $event->event_type,
                'origin' => $event->origin,
                'recorded_at' => $event->recorded_at,
                'kiosk_device_id' => $event->kiosk_device_id === null ? null : (int) $event->kiosk_device_id,
            ];
        }

        if ($source === 'approval_decision') {
            $decision = DB::table('approval_decisions as d')->join('approval_requests as r', function (JoinClause $join): void {
                $join->on('r.id', '=', 'd.approval_request_id')->on('r.tenant_id', '=', 'd.tenant_id');
            })->where('d.tenant_id', $tenantId)->where('d.id', $id)
                ->first(['d.approval_request_id', 'd.action', 'd.acted_at', 'r.request_type', 'd.original_values', 'd.proposed_values', 'd.effective_values']);
            abort_if($decision === null, 404);
            $fields = [];
            if ($decision->request_type !== 'leave') {
                foreach (['original_values', 'proposed_values', 'effective_values'] as $column) {
                    $decoded = json_decode((string) $decision->{$column}, true);
                    if (is_array($decoded)) {
                        $fields = [...$fields, ...array_keys($decoded)];
                    }
                }
            }

            return [
                'approval_request_id' => (int) $decision->approval_request_id,
                'request_type' => $decision->request_type,
                'action' => $decision->action,
                'acted_at' => $decision->acted_at,
                'changed_fields' => array_values(array_unique(array_filter($fields, fn ($field): bool => in_array($field, [
                    'work_date', 'outlet_id', 'check_in_at', 'check_out_at', 'outcome',
                ], true)))),
            ];
        }

        if ($source === 'schedule_change') {
            $event = DB::table('scheduling_change_events')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['resource_type', 'resource_id', 'action', 'created_at', 'previous_values', 'new_values']);
            abort_if($event === null, 404);
            $changed = [];
            foreach (['previous_values', 'new_values'] as $column) {
                $decoded = json_decode((string) $event->{$column}, true);
                if (is_array($decoded)) {
                    $changed = [...$changed, ...array_keys($decoded)];
                }
            }

            return [
                'resource_type' => $event->resource_type,
                'resource_id' => (int) $event->resource_id,
                'action' => $event->action,
                'created_at' => $event->created_at,
                'changed_fields' => array_values(array_unique(array_filter($changed, fn ($field): bool => preg_match('/^[a-z][a-z0-9_]{0,63}$/i', (string) $field) === 1))),
            ];
        }

        if ($source === 'attendance_finalization') {
            $finalization = DB::table('attendance_finalizations')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['work_date', 'revision', 'outcome', 'finalized_at']);
            abort_if($finalization === null, 404);

            return (array) $finalization;
        }

        if ($source === 'employee_assignment') {
            $assignment = DB::table('employee_outlet_assignments')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['assignment_type', 'effective_from', 'effective_until', 'created_at']);
            abort_if($assignment === null, 404);

            return (array) $assignment;
        }

        if ($source === 'management_change') {
            $event = DB::table('management_change_events')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['subject_type', 'subject_id', 'action', 'occurred_at', 'changed_fields', 'actor_membership_id', 'outlet_id']);
            abort_if($event === null, 404);
            $fields = json_decode((string) $event->changed_fields, true);
            $kiosk = [];
            if ($event->subject_type === 'kiosk_device') {
                $kiosk = ['kiosk_device_id' => (int) $event->subject_id, 'outcome' => 'succeeded'];
            } elseif ($event->subject_type === 'kiosk_pairing') {
                $pairing = DB::table('kiosk_pairing_codes')->where('tenant_id', $tenantId)->where('id', $event->subject_id)
                    ->first(['device_id', 'renewal_device_id']);
                $kiosk = ['pairing_id' => (int) $event->subject_id,
                    'kiosk_device_id' => ($pairing?->device_id ?? $pairing?->renewal_device_id) === null ? null : (int) ($pairing->device_id ?? $pairing->renewal_device_id),
                    'outcome' => 'succeeded'];
            }

            return [
                'subject_type' => $event->subject_type,
                'subject_id' => (int) $event->subject_id,
                'action' => $event->action,
                'occurred_at' => $event->occurred_at,
                'changed_fields' => is_array($fields) ? array_values(array_filter($fields, fn ($field): bool => is_string($field) && preg_match('/^[a-z][a-z0-9_]{0,63}$/i', $field) === 1)) : [],
                'actor_membership_id' => (int) $event->actor_membership_id,
                'outlet_id' => $event->outlet_id === null ? null : (int) $event->outlet_id,
                ...$kiosk,
            ];
        }

        if ($source === 'report_export') {
            $export = DB::table('report_export_events')->where('tenant_id', $tenantId)->where('id', $id)
                ->first(['report_type', 'filters', 'row_count', 'generated_at']);
            abort_if($export === null, 404);
            $filters = json_decode((string) $export->filters, true);

            return [
                'report_type' => $export->report_type,
                'period' => is_array($filters) ? ['from' => $filters['from'] ?? null, 'to' => $filters['to'] ?? null] : null,
                'row_count' => (int) $export->row_count,
                'generated_at' => $export->generated_at,
            ];
        }

        $request = DB::table('approval_requests')->where('tenant_id', $tenantId)->where('id', $id)
            ->first(['request_type', 'status', 'work_date', 'starts_on', 'ends_on', 'created_at']);
        abort_if($request === null, 404);

        return [
            'request_type' => $request->request_type,
            'status' => $request->status,
            'work_date' => $request->work_date,
            'starts_on' => $request->starts_on,
            'ends_on' => $request->ends_on,
            'created_at' => $request->created_at,
        ];
    }
}
