<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\Tenant;
use App\Models\TenantMembership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

final class PlannerNotificationService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    private function enqueue(int $tenant, int $membership, ?int $employee, string $kind, string $key, array $data): void
    {
        // The producer's transaction commits the event and business mutation together.
        DB::table('planner_notifications')->upsert([[
            'tenant_id' => $tenant, 'membership_id' => $membership, 'employee_id' => $employee,
            'kind' => $kind, 'event_key' => $key, 'data' => json_encode($data, JSON_THROW_ON_ERROR), 'created_at' => now('UTC'),
        ]], ['tenant_id', 'membership_id', 'event_key'], ['event_key']);
    }

    public function employees(int $tenant, array $employees, string $kind, string $key, array $data): void
    {
        foreach (EmployeeUserLink::query()->forTenant($tenant)->whereIn('employee_id', $employees)->whereHas('membership', fn ($q) => $q->where('is_active', true)->whereHas('roles', fn ($roles) => $roles->where('role', 'employee')))->get() as $link) {
            $this->enqueue($tenant, $link->tenant_membership_id, $link->employee_id, $kind, $key, $data);
        }
    }

    public function published(int $tenant, object $week, int $revision, string $kind): void
    {
        $entries = DB::table('schedule_entries')->where('tenant_id', $tenant)->whereIn('revision_id', array_filter([$week->published_revision_id, $revision]))->orderBy('work_date')->get();
        $people = $entries->pluck('employee_id')->unique()->filter(function ($person) use ($entries, $week, $revision): bool {
            $signature = fn ($id) => $entries->where('revision_id', $id)->where('employee_id', $person)->map(fn ($row) => [$row->work_date, $row->status, $row->shift_template_version_id, $row->schedule_snapshot])->values()->all();

            return $signature($week->published_revision_id) !== $signature($revision);
        })->all();
        $this->employees($tenant, $people, $kind, 'published:'.$revision, ['week_start' => $week->week_start, 'revision_id' => $revision]);
    }

    public function shiftRequest(object $request, string $status): void
    {
        $recipients = $status === 'requested' ? [$request->recipient_id] : [$request->requester_id, $request->recipient_id];
        $date = DB::table('schedule_entries')->where('tenant_id', $request->tenant_id)->where('id', $request->source_entry_id)->value('work_date');
        $this->employees($request->tenant_id, $recipients, $status === 'requested' ? 'shift_requested' : 'shift_outcome', 'shift:'.$request->id.':'.$status, ['request_id' => $request->id, 'status' => $status, 'week_start' => CarbonImmutable::parse($date)->startOfWeek()->toDateString()]);
    }

    public function remindDue(?CarbonImmutable $at = null): int
    {
        $local = ($at ?? CarbonImmutable::now('UTC'))->setTimezone('Asia/Jakarta');
        // A failed 09:00 run can catch up later on Friday, but never send before the boundary.
        if ($local->isoWeekday() !== 5 || $local->format('H:i') < '09:00') {
            return 0;
        }
        $week = $local->startOfWeek()->addWeek()->toDateString();
        $count = 0;
        foreach (Tenant::query()->orderBy('id')->cursor() as $tenant) {
            $count += DB::transaction(function () use ($tenant, $week): int {
                Tenant::query()->whereKey($tenant->id)->lockForUpdate()->firstOrFail();
                $added = 0;
                $supervisors = TenantMembership::query()->forTenant($tenant->id)->where('is_active', true)->whereHas('roles', fn ($q) => $q->where('role', 'supervisor'))->get();
                foreach ($supervisors as $membership) {
                    $ids = $membership->supervisorScopes()->where('tenant_id', $tenant->id)->pluck('outlet_id');
                    $missing = Outlet::query()->forTenant($tenant->id)->whereIn('id', $ids)->whereNotExists(fn ($q) => $q->selectRaw('1')->from('schedule_weeks as w')->whereColumn('w.tenant_id', 'outlets.tenant_id')->whereColumn('w.outlet_id', 'outlets.id')->where('w.week_start', $week)->whereNotNull('w.published_revision_id'))->orderBy('id')->pluck('id')->all();
                    if ($missing !== []) {
                        $before = DB::table('planner_notifications')->where('tenant_id', $tenant->id)->where('membership_id', $membership->id)->where('event_key', 'reminder:'.$week)->exists();
                        $this->enqueue($tenant->id, $membership->id, null, 'roster_reminder', 'reminder:'.$week, ['week_start' => $week, 'outlet_ids' => $missing]);
                        $added += $before ? 0 : 1;
                    }
                }

                return $added;
            }, attempts: 3);
        }

        return $count;
    }

    public function queueExpired(): void
    {
        DB::table('shift_change_requests')->where('status', 'pending')->where('expires_at', '<=', now('UTC'))->orderBy('id')->chunkById(100, function ($requests): void {
            foreach ($requests as $request) {
                DB::transaction(function () use ($request): void {
                    Tenant::query()->whereKey($request->tenant_id)->lockForUpdate()->firstOrFail();
                    $current = DB::table('shift_change_requests')->where('id', $request->id)->where('status', 'pending')->where('expires_at', '<=', now('UTC'))->first();
                    if ($current) {
                        $this->shiftRequest($current, 'expired');
                    }
                }, attempts: 3);
            }
        });
    }

    public function dispatch(int $limit = 100): int
    {
        abort_unless($limit >= 1 && $limit <= 1000, 422);

        return DB::transaction(function () use ($limit): int {
            $ids = DB::table('planner_notifications')->whereNull('delivered_at')->orderBy('id')->limit($limit)->lockForUpdate()->pluck('id');

            return DB::table('planner_notifications')->whereIn('id', $ids)->whereNull('delivered_at')->update(['delivered_at' => now('UTC')]);
        }, attempts: 3);
    }

    private function membership(TenantMembership $actor): TenantMembership
    {
        $current = TenantMembership::query()->forTenant($actor->tenant_id)->whereKey($actor->id)->where('user_id', $actor->user_id)->where('is_active', true)->first();
        abort_unless($current && $current->roles()->exists(), 403);

        return $current;
    }

    private function present(TenantMembership $actor, object $row): ?array
    {
        $data = json_decode($row->data, true, flags: JSON_THROW_ON_ERROR);
        $href = '/scheduling';
        if ($row->employee_id !== null) {
            if (! $this->authorization->hasRole($actor, TenantRole::Employee) || ! EmployeeUserLink::query()->forTenant($actor->tenant_id)->where('tenant_membership_id', $actor->id)->where('employee_id', $row->employee_id)->exists()) {
                return null;
            }
        }
        if ($row->employee_id !== null && isset($data['week_start'])) {
            $href .= '?week='.$data['week_start'];
        }
        $body = match ($row->kind) {
            'schedule_published' => 'Jadwal minggu '.$data['week_start'].' sudah dipublikasikan.',
            'assignment_changed' => 'Penugasan minggu '.$data['week_start'].' berubah. Periksa jadwal terbaru.',
            'shift_requested' => 'Ada permintaan tukar atau penggantian shift untuk Anda.',
            'shift_outcome' => 'Status permintaan shift: '.(['accepted' => 'diterima', 'rejected' => 'ditolak', 'cancelled' => 'dibatalkan', 'expired' => 'kedaluwarsa'][$data['status']] ?? $data['status']).'.',
            default => '',
        };
        if ($row->kind === 'roster_reminder') {
            if (! $this->authorization->hasRole($actor, TenantRole::Supervisor)) {
                return null;
            }
            $ids = $actor->supervisorScopes()->where('tenant_id', $actor->tenant_id)->whereIn('outlet_id', $data['outlet_ids'])->pluck('outlet_id');
            $outlets = Outlet::query()->forTenant($actor->tenant_id)->whereIn('id', $ids)->orderBy('id')->get();
            if ($outlets->isEmpty()) {
                return null;
            }
            $body = 'Tinjau publikasi minggu '.$data['week_start'].': '.$outlets->pluck('name')->implode(', ').'.';
            $href .= '?outletId='.$outlets->first()->id.'&week='.$data['week_start'];
        }

        return ['id' => $row->id, 'kind' => $row->kind, 'body' => $body, 'href' => $href, 'created_at' => CarbonImmutable::parse($row->created_at, 'UTC')->toIso8601String(), 'read_at' => $row->read_at ? CarbonImmutable::parse($row->read_at, 'UTC')->toIso8601String() : null];
    }

    public function inbox(TenantMembership $actor, ?int $before = null): array
    {
        $actor = $this->membership($actor);
        $rows = $this->query($actor)->when($before, fn ($q) => $q->where('id', '<', $before))->orderByDesc('id')->limit(100)->get();

        return ['notifications' => $rows->map(fn ($row) => $this->present($actor, $row))->filter()->values()->all(), 'next_before' => $rows->count() === 100 ? $rows->last()->id : null];
    }

    public function read(TenantMembership $actor, int $id): array
    {
        $actor = $this->membership($actor);
        $row = $this->query($actor)->where('id', $id)->first();
        abort_unless($row && $this->present($actor, $row), 404);
        $this->query($actor)->where('id', $id)->whereNull('read_at')->update(['read_at' => now('UTC')]);

        return $this->present($actor, $this->query($actor)->where('id', $id)->first());
    }

    private function query(TenantMembership $actor)
    {
        return DB::table('planner_notifications')->where('tenant_id', $actor->tenant_id)->where('membership_id', $actor->id)->whereNotNull('delivered_at');
    }
}
