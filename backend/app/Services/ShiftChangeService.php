<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\Tenant;
use App\Models\TenantMembership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class ShiftChangeService
{
    public function __construct(private readonly TenantAuthorization $authorization, private readonly WeeklyPlannerService $planner, private readonly SchedulingChangeRecorder $audit, private readonly PlannerNotificationService $notifications) {}

    private function employee(TenantMembership $actor): int
    {
        abort_unless($this->authorization->hasRole($actor, TenantRole::Employee), 403);
        $id = EmployeeUserLink::query()->forTenant($actor->tenant_id)->where('tenant_membership_id', $actor->id)->value('employee_id');
        abort_unless($id, 403, 'Akun belum terhubung ke karyawan.');

        return (int) $id;
    }

    private function lock(TenantMembership $actor): int
    {
        Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
        Outlet::query()->forTenant($actor->tenant_id)->orderBy('id')->lockForUpdate()->get();
        Employee::query()->forTenant($actor->tenant_id)->orderBy('id')->lockForUpdate()->get();

        return $this->employee($actor);
    }

    private function entry(int $tenant, int $id): object
    {
        $entry = DB::table('schedule_entries as e')->join('schedule_weeks as w', function ($join): void {
            $join->on('e.tenant_id', '=', 'w.tenant_id')->on('e.revision_id', '=', 'w.published_revision_id');
        })->where('e.tenant_id', $tenant)->where('e.id', $id)->select('e.*', 'w.id as week_id', 'w.outlet_id', 'w.week_start', 'w.lock_version')->first();
        abort_unless($entry, 409, 'Shift published berubah atau tidak tersedia. Muat ulang jadwal.');
        $outlet = Outlet::query()->forTenant($tenant)->findOrFail($entry->outlet_id);
        abort_unless($outlet->weekly_planner_start_on && $entry->work_date >= $outlet->weekly_planner_start_on, 409, 'Roster belum menjadi jadwal aktif.');
        $snapshot = json_decode($entry->schedule_snapshot ?? 'null', true, flags: JSON_THROW_ON_ERROR);
        abort_unless($entry->status === 'work' && $snapshot && CarbonImmutable::parse($snapshot['scheduled_start'])->isFuture(), 409, 'Hanya shift published yang belum dimulai dapat diubah.');
        $entry->snapshot = $snapshot;

        return $entry;
    }

    private function eligible(int $tenant, int $employee, object $entry): void
    {
        $linked = EmployeeUserLink::query()->forTenant($tenant)->where('employee_id', $employee)->whereHas('membership', fn ($q) => $q->where('is_active', true)->whereHas('roles', fn ($roles) => $roles->where('role', 'employee')))->exists();
        $assigned = EmployeeOutletAssignment::query()->forTenant($tenant)->where('employee_id', $employee)->where('outlet_id', $entry->outlet_id)
            ->where('effective_from', '<=', CarbonImmutable::parse($entry->snapshot['scheduled_start'])->utc())->where('effective_until', '>=', CarbonImmutable::parse($entry->snapshot['scheduled_end'])->utc())->exists();
        abort_unless($linked && $assigned, 422, 'Karyawan tidak memenuhi penugasan Outlet untuk seluruh shift.');
    }

    public function options(TenantMembership $actor, int $entryId): array
    {
        $employee = $this->employee($actor);
        $source = $this->entry($actor->tenant_id, $entryId);
        abort_unless($source->employee_id === $employee, 403);
        $people = [];
        foreach (Employee::query()->forTenant($actor->tenant_id)->where('id', '!=', $employee)->orderBy('name')->get() as $person) {
            try {
                $this->eligible($actor->tenant_id, $person->id, $source);
            } catch (HttpException $error) {
                if ($error->getStatusCode() !== 422) {
                    throw $error;
                }

                continue;
            }
            $shifts = DB::table('schedule_entries as e')->join('schedule_weeks as w', 'w.published_revision_id', '=', 'e.revision_id')
                ->where('e.tenant_id', $actor->tenant_id)->where('w.tenant_id', $actor->tenant_id)->where('w.outlet_id', $source->outlet_id)->where('e.employee_id', $person->id)->where('e.status', 'work')->where('e.work_date', '>=', CarbonImmutable::now('UTC')->subDay()->toDateString())->orderBy('e.work_date')->limit(60)->get(['e.id', 'e.work_date', 'e.schedule_snapshot']);
            $future = $shifts->filter(fn ($shift) => CarbonImmutable::parse(json_decode($shift->schedule_snapshot, true)['scheduled_start'])->isFuture())->map(fn ($shift) => ['entry_id' => $shift->id, 'date' => $shift->work_date, 'shift' => json_decode($shift->schedule_snapshot, true)['shift']])->values();
            $people[] = ['id' => $person->id, 'name' => $person->name, 'shifts' => $future];
        }

        return ['recipients' => $people];
    }

    public function create(TenantMembership $actor, array $data, string $key): array
    {
        $data['reason'] = is_string($data['reason'] ?? null) ? trim($data['reason']) : null;
        $data = Validator::make($data, [
            'kind' => ['required', Rule::in(['swap', 'replacement'])], 'source_entry_id' => ['required', 'integer', 'min:1'],
            'recipient_id' => ['required', 'integer', 'min:1'], 'target_entry_id' => ['nullable', 'required_if:kind,swap', 'prohibited_if:kind,replacement', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
        ])->validate();
        Validator::make(['key' => $key], ['key' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/']])->validate();
        ksort($data);
        $hash = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($actor, $data, $key, $hash): array {
            $employee = $this->lock($actor);
            $prior = DB::table('shift_change_requests')->where('tenant_id', $actor->tenant_id)->where('actor_membership_id', $actor->id)->where('idempotency_key', $key)->first();
            if ($prior) {
                abort_unless(hash_equals($prior->request_hash, $hash), 409, 'Kunci permintaan sudah dipakai untuk data berbeda.');

                return $this->present($this->expire($actor, $prior));
            }
            $source = $this->entry($actor->tenant_id, (int) $data['source_entry_id']);
            abort_unless($source->employee_id === $employee, 403);
            abort_if($employee === (int) $data['recipient_id'], 422, 'Pilih karyawan lain.');
            $target = $data['kind'] === 'swap' ? $this->entry($actor->tenant_id, (int) $data['target_entry_id']) : null;
            $this->validatePair($actor, $source, $target, (int) $data['recipient_id']);
            $versions = [$source->week_id => ['version' => $source->lock_version, 'revision' => $source->revision_id]];
            if ($target) {
                $versions[$target->week_id] = ['version' => $target->lock_version, 'revision' => $target->revision_id];
            }
            $expires = CarbonImmutable::parse($source->snapshot['scheduled_start']);
            if ($target) {
                $expires = $expires->min(CarbonImmutable::parse($target->snapshot['scheduled_start']));
            }
            $id = DB::table('shift_change_requests')->insertGetId([
                'tenant_id' => $actor->tenant_id, 'outlet_id' => $source->outlet_id, 'actor_membership_id' => $actor->id,
                'requester_id' => $employee, 'recipient_id' => $data['recipient_id'], 'source_entry_id' => $source->id, 'target_entry_id' => $target?->id,
                'kind' => $data['kind'], 'reason' => $data['reason'], 'versions' => json_encode($versions, JSON_THROW_ON_ERROR), 'idempotency_key' => $key, 'request_hash' => $hash,
                'expires_at' => $expires->utc(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->record($actor, $id, 'requested', $data['reason'], ['requester_id' => $employee, 'recipient_id' => $data['recipient_id'], 'versions' => $versions]);

            return $this->present(DB::table('shift_change_requests')->find($id));
        }, attempts: 3);
    }

    private function validatePair(TenantMembership $actor, object $source, ?object $target, int $recipient): void
    {
        abort_if($target && ($target->outlet_id !== $source->outlet_id || $target->employee_id !== $recipient), 422, 'Pertukaran harus dengan penerima pada Outlet yang sama.');
        $this->eligible($actor->tenant_id, $source->employee_id, $source);
        $this->eligible($actor->tenant_id, $recipient, $source);
        if ($target) {
            $this->eligible($actor->tenant_id, $recipient, $target);
            $this->eligible($actor->tenant_id, $source->employee_id, $target);
        }
        foreach ([[$recipient, $source, $target], ...($target ? [[$source->employee_id, $target, $source]] : [])] as [$person, $destination, $vacated]) {
            $work = DB::table('schedule_entries')->where('revision_id', $destination->revision_id)->where('employee_id', $person)->where('work_date', $destination->work_date)->where('status', 'work')->first();
            abort_if($work && (! $vacated || $work->id !== $vacated->id), 409, 'Penerima sudah memiliki shift pada tanggal tujuan.');
        }
        foreach (array_unique([$source->work_date, $target?->work_date ?? $source->work_date]) as $date) {
            abort_if(DB::table('attendance_sessions')->where('tenant_id', $actor->tenant_id)->whereIn('employee_id', [$source->employee_id, $recipient])->where(function ($q) use ($date): void {
                $q->where('work_date', $date)->orWhere('status', 'active');
            })->exists(), 409, 'Absensi sudah ada atau masih aktif. Jadwal tidak dapat diubah.');
        }
    }

    public function respond(TenantMembership $actor, int $id, string $action): array
    {
        abort_unless(in_array($action, ['accept', 'reject', 'cancel'], true), 422);

        return DB::transaction(function () use ($actor, $id, $action): array {
            $employee = $this->lock($actor);
            $row = DB::table('shift_change_requests')->where('tenant_id', $actor->tenant_id)->where('id', $id)->lockForUpdate()->first();
            abort_unless($row, 404);
            abort_unless($employee === (int) ($action === 'cancel' ? $row->requester_id : $row->recipient_id), 403);
            $desired = ['accept' => 'accepted', 'reject' => 'rejected', 'cancel' => 'cancelled'][$action];
            $row = $this->expire($actor, $row);
            if ($row->status === $desired) {
                return $this->present($row);
            }
            // Expiry must commit even when a recipient attempts acceptance after the cutoff.
            if ($row->status === 'expired') {
                return $this->present($row);
            }
            abort_unless($row->status === 'pending', 409, 'Permintaan sudah selesai.');
            $result = null;
            if ($action === 'accept') {
                $requesterMembership = TenantMembership::query()->forTenant($actor->tenant_id)->findOrFail($row->actor_membership_id);
                abort_unless($this->employee($requesterMembership) === (int) $row->requester_id, 409, 'Identitas pemohon berubah.');
                $source = $this->entry($actor->tenant_id, $row->source_entry_id);
                $target = $row->target_entry_id ? $this->entry($actor->tenant_id, $row->target_entry_id) : null;
                $versions = json_decode($row->versions, true, flags: JSON_THROW_ON_ERROR);
                $weeks = DB::table('schedule_weeks')->where('tenant_id', $actor->tenant_id)->whereIn('id', array_keys($versions))->orderBy('id')->lockForUpdate()->get();
                abort_unless($weeks->count() === count($versions), 409);
                foreach ($weeks as $week) {
                    abort_unless($week->lock_version === $versions[$week->id]['version'] && $week->published_revision_id === $versions[$week->id]['revision'], 409, 'Revisi roster berubah. Batalkan dan buat permintaan baru.');
                }
                $this->validatePair($actor, $source, $target, $row->recipient_id);
                $changes = [];
                $put = function (int $person, object $entry, bool $work) use (&$changes): void {
                    $changes[$person.'|'.$entry->work_date] = ['employee_id' => $person, 'work_date' => $entry->work_date, 'status' => $work ? 'work' : 'rest', 'shift_template_version_id' => $work ? $entry->shift_template_version_id : null];
                };
                $put($row->requester_id, $source, false);
                if ($target) {
                    $put($row->recipient_id, $target, false);
                }
                $put($row->recipient_id, $source, true);
                if ($target) {
                    $put($row->requester_id, $target, true);
                }
                $outlet = Outlet::query()->forTenant($actor->tenant_id)->findOrFail($row->outlet_id);
                $result = $this->planner->publishEmployeeChange($actor, $outlet, $weeks->all(), array_values($changes), $row->reason, $row->id);
            }
            DB::table('shift_change_requests')->where('id', $row->id)->update(['status' => $desired, 'result' => $result ? json_encode($result, JSON_THROW_ON_ERROR) : null, 'responded_at' => now(), 'updated_at' => now()]);
            $this->record($actor, $row->id, $desired, $row->reason, ['revisions' => $result]);

            return $this->present(DB::table('shift_change_requests')->find($row->id));
        }, attempts: 3);
    }

    public function listing(TenantMembership $actor): array
    {
        return DB::transaction(function () use ($actor): array {
            $employee = $this->lock($actor);
            $rows = DB::table('shift_change_requests')->where('tenant_id', $actor->tenant_id)->where(fn ($q) => $q->where('requester_id', $employee)->orWhere('recipient_id', $employee))->orderByDesc('id')->limit(100)->get();

            return ['requests' => $rows->map(fn ($row) => $this->present($this->expire($actor, $row)))->all(), 'server_now' => CarbonImmutable::now('UTC')->toIso8601String()];
        });
    }

    private function expire(TenantMembership $actor, object $row): object
    {
        if ($row->status === 'pending' && CarbonImmutable::parse($row->expires_at, 'UTC')->lessThanOrEqualTo(now('UTC'))) {
            DB::table('shift_change_requests')->where('id', $row->id)->update(['status' => 'expired', 'responded_at' => now(), 'updated_at' => now()]);
            $row->status = 'expired';
            $this->record($actor, $row->id, 'expired', $row->reason, ['cutoff' => $row->expires_at]);
        }

        return $row;
    }

    private function present(object $row): array
    {
        return [
            'id' => $row->id, 'kind' => $row->kind, 'status' => $row->status, 'outlet_id' => $row->outlet_id,
            'requester_id' => $row->requester_id, 'recipient_id' => $row->recipient_id,
            'requester_name' => Employee::query()->forTenant($row->tenant_id)->whereKey($row->requester_id)->value('name'),
            'recipient_name' => Employee::query()->forTenant($row->tenant_id)->whereKey($row->recipient_id)->value('name'),
            'source_date' => DB::table('schedule_entries')->where('id', $row->source_entry_id)->value('work_date'),
            'target_date' => $row->target_entry_id ? DB::table('schedule_entries')->where('id', $row->target_entry_id)->value('work_date') : null,
            'outlet_name' => Outlet::query()->forTenant($row->tenant_id)->whereKey($row->outlet_id)->value('name'),
            'source_shift' => json_decode(DB::table('schedule_entries')->where('id', $row->source_entry_id)->value('schedule_snapshot'), true)['shift'],
            'target_shift' => $row->target_entry_id ? json_decode(DB::table('schedule_entries')->where('id', $row->target_entry_id)->value('schedule_snapshot'), true)['shift'] : null,
            'reason' => $row->reason, 'expires_at' => CarbonImmutable::parse($row->expires_at, 'UTC')->toIso8601String(),
            'result' => $row->result ? json_decode($row->result, true, flags: JSON_THROW_ON_ERROR) : null,
        ];
    }

    private function record(TenantMembership $actor, int $id, string $action, string $reason, array $values): void
    {
        $this->notifications->shiftRequest(DB::table('shift_change_requests')->where('tenant_id', $actor->tenant_id)->find($id), $action);
        $this->audit->record($actor->tenant_id, 'shift_change_request', $id, $action, $actor->user_id, $reason, null, $values + ['actor_membership_id' => $actor->id]);
    }
}
