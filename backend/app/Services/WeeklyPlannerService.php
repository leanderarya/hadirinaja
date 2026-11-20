<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Models\ShiftTemplateVersion;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class WeeklyPlannerService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly LocalTimeResolver $localTime,
        private readonly EffectiveScheduleResolver $resolver,
        private readonly SchedulingChangeRecorder $audit,
        private readonly PlannerStaffingService $staffing,
        private readonly PlannerNotificationService $notifications,
    ) {}

    public function read(TenantMembership $actor, int $outletId, string $start): array
    {
        $outlet = $this->outlet($actor, $outletId);
        $this->monday($start);
        $week = $this->weekQuery($actor->tenant_id, $outletId, $start)->first();

        $result = $this->result($week);
        $timezone = $this->timezone($actor->tenant_id, $outletId, $start);
        $from = CarbonImmutable::parse($start, $timezone)->utc();
        $until = CarbonImmutable::parse($start, $timezone)->addDays(7)->utc();
        $employees = Employee::query()->forTenant($actor->tenant_id)->whereHas('assignments', fn ($query) => $query->where('tenant_id', $actor->tenant_id)->where('outlet_id', $outletId)
            ->where('effective_from', '<', $until)->where('effective_until', '>', $from))->orderBy('name')->get(['id', 'name']);

        return $result + [
            'outlet' => ['id' => $outlet->id, 'name' => $outlet->name, 'weekly_planner_start_on' => $outlet->weekly_planner_start_on],
            'week_start' => $start, 'employees' => $employees->toArray(),
            'published_weeks' => $this->publishedWeeks($actor->tenant_id, $outletId, $start),
        ];
    }

    public function save(TenantMembership $actor, int $outletId, string $start, array $data, string $key): array
    {
        if (isset($data['reason']) && is_string($data['reason'])) {
            $data['reason'] = trim($data['reason']);
        }
        $data = Validator::make($data, [
            'expected_version' => ['required', 'integer', 'min:0'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
            'staffing' => ['sometimes', 'array:morning,middle,evening'],
            'entries' => ['present', 'array', 'max:3500'],
            'entries.*' => ['required', 'array:employee_id,work_date,status,shift_template_version_id'],
            'entries.*.employee_id' => ['required', 'integer', 'min:1'],
            'entries.*.work_date' => ['required', 'date_format:Y-m-d'],
            'entries.*.status' => ['required', Rule::in(['work', 'rest', 'unscheduled'])],
            'entries.*.shift_template_version_id' => ['nullable', 'integer', 'min:1'],
        ])->validate();

        return $this->mutate($actor, $outletId, $start, $data, $key, 'save', function ($outlet, $week) use ($actor, $start, $data): array {
            $this->version($week, (int) $data['expected_version']);
            $rows = $this->draftRows($actor->tenant_id, $outlet->id, $start, $data['entries']);
            if (! $week) {
                $id = DB::table('schedule_weeks')->insertGetId(['tenant_id' => $actor->tenant_id, 'outlet_id' => $outlet->id, 'week_start' => $start]);
                $week = DB::table('schedule_weeks')->where('id', $id)->first();
            }
            $sourceRevision = $week->draft_revision_id ?? $week->published_revision_id;
            $inherited = $sourceRevision ? DB::table('schedule_revisions')->where('id', $sourceRevision)->value('staffing') : null;
            $configuration = array_key_exists('staffing', $data) ? $this->staffing->normalize($actor->tenant_id, $data['staffing']) : ($inherited ? json_decode($inherited, true, flags: JSON_THROW_ON_ERROR) : null);
            $revisionId = $week->draft_revision_id;
            if (! $revisionId) {
                $revisionId = DB::table('schedule_revisions')->insertGetId([
                    'tenant_id' => $actor->tenant_id, 'week_id' => $week->id,
                    'revision' => (int) DB::table('schedule_revisions')->where('week_id', $week->id)->max('revision') + 1,
                    'base_published_revision_id' => $week->published_revision_id,
                    'actor_membership_id' => $actor->id,
                ]);
            }
            abort_unless(DB::table('schedule_revisions')->where('id', $revisionId)->whereNull('published_at')->exists(), 409, 'Revisi sudah dipublikasikan.');
            DB::table('schedule_revisions')->where('id', $revisionId)->whereNull('published_at')->update(['staffing' => $configuration ? json_encode($configuration, JSON_THROW_ON_ERROR) : null]);
            DB::table('schedule_entries')->where('revision_id', $revisionId)->delete();
            foreach ($rows as $row) {
                DB::table('schedule_entries')->insert($row + ['tenant_id' => $actor->tenant_id, 'revision_id' => $revisionId]);
            }
            DB::table('schedule_weeks')->where('id', $week->id)->update(['draft_revision_id' => $revisionId, 'lock_version' => $week->lock_version + 1]);
            $this->record($actor, $week->id, 'draft_saved', $data['reason'], ['revision_id' => $revisionId, 'base_revision_id' => $week->published_revision_id]);

            return $this->result(DB::table('schedule_weeks')->where('id', $week->id)->first());
        });
    }

    public function validate(TenantMembership $actor, int $outletId, string $start, int $version): array
    {
        return DB::transaction(function () use ($actor, $outletId, $start, $version): array {
            [$outlet, $week] = $this->lock($actor, $outletId, $start);
            $this->version($week, $version);
            $rows = $this->publicationRows($actor, $outlet, $week);

            return ['valid' => true, 'version' => $week->lock_version, 'entry_count' => count($rows), 'staffing_report' => $this->staffingReport($week)];
        });
    }

    public function publish(TenantMembership $actor, int $outletId, string $start, array $data, string $key): array
    {
        if (isset($data['reason']) && is_string($data['reason'])) {
            $data['reason'] = trim($data['reason']);
        }
        $data = Validator::make($data, [
            'expected_version' => ['required', 'integer', 'min:1'],
            'expected_published_revision_id' => ['present', 'nullable', 'integer', 'min:1'],
            'activate_cutover' => ['sometimes', 'boolean'],
            'warnings_checksum' => ['sometimes', 'nullable', 'string', 'size:64'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ])->validate();

        return $this->mutate($actor, $outletId, $start, $data, $key, 'publish', function ($outlet, $week) use ($actor, $start, $data): array {
            $this->version($week, (int) $data['expected_version']);
            abort_unless($week && $week->published_revision_id == $data['expected_published_revision_id'], 409, 'Revisi dasar berubah.');
            if ($data['activate_cutover'] ?? false) {
                $this->authorization->requireOwner($actor);
                $timezone = $this->timezone($actor->tenant_id, $outlet->id, $start);
                abort_if($outlet->weekly_planner_start_on !== null || $start <= CarbonImmutable::today($timezone)->toDateString(), 409, 'Cutover harus pada Senin mendatang dan belum pernah diaktifkan.');
            }
            $rows = $this->publicationRows($actor, $outlet, $week);
            $staffing = $this->staffingReport($week);
            abort_if($staffing['deficits'] !== [] && (! isset($data['warnings_checksum']) || ! hash_equals($staffing['checksum'], $data['warnings_checksum'])), 409, 'Tinjau dan akui peringatan kekurangan staf pada versi terbaru.');
            foreach ($rows as $id => $snapshot) {
                DB::table('schedule_entries')->where('revision_id', $week->draft_revision_id)->where('id', $id)->update(['schedule_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR)]);
            }
            $updated = DB::table('schedule_revisions')->where('id', $week->draft_revision_id)->whereNull('published_at')->update(['published_at' => CarbonImmutable::now('UTC'), 'publication_warnings' => json_encode($staffing['deficits'], JSON_THROW_ON_ERROR)]);
            abort_unless($updated === 1, 409, 'Revisi sudah dipublikasikan.');
            DB::table('schedule_weeks')->where('id', $week->id)->update([
                'published_revision_id' => $week->draft_revision_id, 'draft_revision_id' => null, 'lock_version' => $week->lock_version + 1,
            ]);
            if ($data['activate_cutover'] ?? false) {
                DB::table('outlets')->where('id', $outlet->id)->where('tenant_id', $actor->tenant_id)->update(['weekly_planner_start_on' => $start]);
                $this->record($actor, $week->id, 'cutover_activated', $data['reason'], ['start_on' => $start]);
            }
            $this->notifications->published($actor->tenant_id, $week, $week->draft_revision_id, $week->published_revision_id ? 'assignment_changed' : 'schedule_published');
            $this->record($actor, $week->id, 'published', $data['reason'], ['revision_id' => $week->draft_revision_id, 'previous_revision_id' => $week->published_revision_id, 'understaffing' => $staffing['deficits'], 'warnings_checksum' => $staffing['checksum']]);

            return $this->result(DB::table('schedule_weeks')->where('id', $week->id)->first());
        });
    }

    public function copy(TenantMembership $actor, int $outletId, string $start, array $data, string $key): array
    {
        $data = Validator::make($data, [
            'source_week_start' => ['required', 'date_format:Y-m-d'],
            'source_revision_id' => ['required', 'integer', 'min:1'],
            'expected_version' => ['required', 'integer', 'min:0'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
            'staffing' => ['sometimes', 'array:morning,middle,evening'],
        ])->validate();

        return $this->mutate($actor, $outletId, $start, $data, $key, 'copy', function ($outlet, $week) use ($actor, $outletId, $start, $data, $key): array {
            $this->version($week, (int) $data['expected_version']);
            $this->monday($data['source_week_start']);
            abort_unless($data['source_week_start'] < $start, 422, 'Pilih minggu published sebelum minggu tujuan.');
            $source = $this->weekQuery($actor->tenant_id, $outletId, $data['source_week_start'])->first();
            abort_unless($source && $source->published_revision_id === (int) $data['source_revision_id'], 409, 'Revisi sumber berubah atau tidak tersedia.');
            $sourceData = $this->result($source)['published'];
            $entries = array_map(function ($entry) use ($start, $data): array {
                $offset = (int) CarbonImmutable::parse($data['source_week_start'])->diffInDays(CarbonImmutable::parse($entry['work_date']));
                $entry['work_date'] = CarbonImmutable::parse($start)->addDays($offset)->toDateString();

                return $entry;
            }, $sourceData['entries']);
            $payload = ['expected_version' => $data['expected_version'], 'reason' => $data['reason'], 'entries' => $entries];
            if ($configuration = ($data['staffing'] ?? $sourceData['staffing'])) {
                $payload['staffing'] = $configuration;
            }
            // The nested save shares this transaction; a copy is a draft, never a publication.
            $result = $this->save($actor, $outletId, $start, $payload, 'copy-save:'.substr(hash('sha256', $key), 0, 64));
            $this->record($actor, $result['week_id'], 'draft_copied', $data['reason'], ['source_week_start' => $data['source_week_start'], 'source_revision_id' => $data['source_revision_id']]);

            return $result;
        });
    }

    /** Called only by ShiftChangeService inside its tenant/outlet/employee/week lock transaction. */
    public function publishEmployeeChange(TenantMembership $actor, Outlet $outlet, array $weeks, array $changes, string $reason, int $requestId): array
    {
        abort_unless(DB::transactionLevel() > 0, 500);
        $prepared = [];
        foreach ($weeks as $week) {
            // ponytail: A published change must not strand an existing Supervisor draft on an unrecoverable old base.
            abort_if($week->draft_revision_id !== null, 409, 'Selesaikan draf roster sebelum menerima perubahan shift.');
            $prior = DB::table('schedule_revisions')->where('id', $week->published_revision_id)->first();
            $revision = DB::table('schedule_revisions')->insertGetId([
                'tenant_id' => $actor->tenant_id, 'week_id' => $week->id,
                'revision' => (int) DB::table('schedule_revisions')->where('week_id', $week->id)->max('revision') + 1,
                'base_published_revision_id' => $week->published_revision_id, 'actor_membership_id' => $actor->id, 'staffing' => $prior->staffing,
            ]);
            $entries = DB::table('schedule_entries')->where('revision_id', $week->published_revision_id)->get();
            $keyed = [];
            foreach ($entries as $entry) {
                $keyed[$entry->employee_id.'|'.$entry->work_date] = ['employee_id' => $entry->employee_id, 'work_date' => $entry->work_date, 'status' => $entry->status, 'shift_template_version_id' => $entry->shift_template_version_id];
            }
            foreach ($changes as $change) {
                if ($change['work_date'] >= $week->week_start && $change['work_date'] < CarbonImmutable::parse($week->week_start)->addWeek()->toDateString()) {
                    $keyed[$change['employee_id'].'|'.$change['work_date']] = $change;
                }
            }
            foreach ($this->draftRows($actor->tenant_id, $outlet->id, $week->week_start, array_values($keyed)) as $row) {
                DB::table('schedule_entries')->insert($row + ['tenant_id' => $actor->tenant_id, 'revision_id' => $revision]);
            }
            $candidate = clone $week;
            $candidate->draft_revision_id = $revision;
            $rows = $this->publicationRows($actor, $outlet, $candidate, false);
            foreach ($rows as $id => $snapshot) {
                DB::table('schedule_entries')->where('id', $id)->update(['schedule_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR)]);
            }
            $report = $this->staffingReport($candidate);
            DB::table('schedule_revisions')->where('id', $revision)->update(['published_at' => CarbonImmutable::now('UTC'), 'publication_warnings' => json_encode($report['deficits'], JSON_THROW_ON_ERROR)]);
            DB::table('schedule_weeks')->where('id', $week->id)->update(['published_revision_id' => $revision, 'lock_version' => $week->lock_version + 1]);
            $prepared[] = ['week' => $week, 'revision' => $revision, 'rows' => $rows];
        }
        // All affected weeks must be visible together when checking adjacent/midnight intervals.
        foreach ($prepared as $item) {
            $entries = DB::table('schedule_entries')->where('revision_id', $item['revision'])->get();
            $this->conflicts($actor->tenant_id, $outlet->id, $item['week']->week_start, $entries, $item['rows']);
            $this->notifications->published($actor->tenant_id, $item['week'], $item['revision'], 'assignment_changed');
            $this->record($actor, $item['week']->id, 'employee_shift_changed', $reason, ['request_id' => $requestId, 'revision_id' => $item['revision'], 'previous_revision_id' => $item['week']->published_revision_id]);
        }

        return array_map(fn ($item) => ['week_id' => $item['week']->id, 'revision_id' => $item['revision']], $prepared);
    }

    private function publishedWeeks(int $tenant, int $outlet, string $start): array
    {
        return DB::table('schedule_weeks')->where('tenant_id', $tenant)->where('outlet_id', $outlet)->where('week_start', '<', $start)
            ->whereNotNull('published_revision_id')->orderByDesc('week_start')->limit(12)->get(['week_start', 'published_revision_id'])->toArray();
    }

    private function staffingReport(object $week): array
    {
        $revisionId = $week->draft_revision_id ?? $week->published_revision_id;
        $configuration = $revisionId ? DB::table('schedule_revisions')->where('id', $revisionId)->value('staffing') : null;
        $entries = $revisionId ? DB::table('schedule_entries')->where('revision_id', $revisionId)->orderBy('employee_id')->orderBy('work_date')
            ->get(['employee_id', 'work_date', 'status', 'shift_template_version_id'])->map(fn ($entry) => (array) $entry)->all() : [];

        return $this->staffing->report($configuration ? json_decode($configuration, true, flags: JSON_THROW_ON_ERROR) : null, $entries, $week->week_start, $week->lock_version, $revisionId);
    }

    private function mutate(TenantMembership $actor, int $outletId, string $start, array $data, string $key, string $operation, callable $write): array
    {
        Validator::make(['key' => $key], ['key' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/']])->validate();

        return DB::transaction(function () use ($actor, $outletId, $start, $data, $key, $operation, $write): array {
            [$outlet, $week] = $this->lock($actor, $outletId, $start);
            $hash = hash('sha256', json_encode($this->canonical([$operation, $outletId, $start, $data]), JSON_THROW_ON_ERROR));
            $query = DB::table('scheduling_operations')->where('tenant_id', $actor->tenant_id)->where('actor_membership_id', $actor->id)->where('idempotency_key', $key);
            if ($prior = $query->first()) {
                abort_unless(hash_equals($prior->request_hash, $hash), 409, 'Kunci idempotensi sudah digunakan dengan payload berbeda.');

                return json_decode($prior->response, true, flags: JSON_THROW_ON_ERROR);
            }
            $result = $write($outlet, $week);
            DB::table('scheduling_operations')->insert([
                'tenant_id' => $actor->tenant_id, 'actor_membership_id' => $actor->id, 'idempotency_key' => $key,
                'request_hash' => $hash, 'response' => json_encode($result, JSON_THROW_ON_ERROR),
            ]);

            return $result;
        }, attempts: 3);
    }

    private function lock(TenantMembership $actor, int $outletId, string $start): array
    {
        $this->monday($start);
        Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
        $outlet = $this->outlet($actor, $outletId, true);
        // ponytail: Include removed roster members; check-in uses this same Employee lock.
        Employee::query()->forTenant($actor->tenant_id)->orderBy('id')->lockForUpdate()->get();
        $week = $this->weekQuery($actor->tenant_id, $outletId, $start)->lockForUpdate()->first();

        return [$outlet, $week];
    }

    private function outlet(TenantMembership $actor, int $id, bool $lock = false): Outlet
    {
        $query = Outlet::query()->forTenant($actor->tenant_id)->whereKey($id);
        $outlet = ($lock ? $query->lockForUpdate() : $query)->first();
        abort_unless($outlet, 404);
        abort_unless($this->authorization->canManageOutlet($actor, $outlet), 403);

        return $outlet;
    }

    private function monday(string $start): void
    {
        Validator::make(['week_start' => $start], ['week_start' => ['required', 'date_format:Y-m-d']])->validate();
        if (CarbonImmutable::parse($start)->isoWeekday() !== 1) {
            throw ValidationException::withMessages(['week_start' => 'Minggu roster harus dimulai pada Senin.']);
        }
    }

    private function weekQuery(int $tenant, int $outlet, string $start)
    {
        return DB::table('schedule_weeks')->where('tenant_id', $tenant)->where('outlet_id', $outlet)->where('week_start', $start);
    }

    private function version(?object $week, int $expected): void
    {
        abort_unless((int) ($week?->lock_version ?? 0) === $expected, 409, 'Versi roster berubah. Muat ulang data.');
    }

    private function result(?object $week): array
    {
        if (! $week) {
            return ['version' => 0, 'draft' => null, 'published' => null];
        }
        $result = ['week_id' => $week->id, 'week_start' => $week->week_start, 'version' => $week->lock_version];
        foreach (['draft', 'published'] as $kind) {
            $id = $week->{$kind.'_revision_id'};
            $revision = $id ? DB::table('schedule_revisions')->where('id', $id)->first() : null;
            $result[$kind] = $id ? [
                'staffing' => $revision->staffing ? json_decode($revision->staffing, true, flags: JSON_THROW_ON_ERROR) : null,
                'publication_warnings' => $revision->publication_warnings ? json_decode($revision->publication_warnings, true, flags: JSON_THROW_ON_ERROR) : [],
                'revision_id' => $id,
                'entries' => DB::table('schedule_entries')->where('tenant_id', $week->tenant_id)->where('revision_id', $id)
                    ->orderBy('employee_id')->orderBy('work_date')->get()->map(fn ($row) => [
                        'employee_id' => $row->employee_id, 'work_date' => $row->work_date, 'status' => $row->status,
                        'shift_template_version_id' => $row->shift_template_version_id,
                    ])->all(),
            ] : null;
        }

        $result['staffing_report'] = $this->staffingReport($week);

        return $result;
    }

    private function draftRows(int $tenant, int $outletId, string $start, array $entries): array
    {
        $rows = [];
        $end = CarbonImmutable::parse($start)->addDays(7)->toDateString();
        foreach ($entries as $entry) {
            $entry['employee_id'] = (int) $entry['employee_id'];
            $employee = Employee::query()->forTenant($tenant)->whereKey($entry['employee_id'])->exists();
            $shiftId = isset($entry['shift_template_version_id']) ? (int) $entry['shift_template_version_id'] : null;
            $shift = $shiftId ? ShiftTemplateVersion::query()->forTenant($tenant)->whereKey($shiftId)->exists() : false;
            $timezone = $this->timezone($tenant, $outletId, $entry['work_date']);
            $dayStart = $this->localTime->instant($entry['work_date'], '00:00:00', $timezone);
            $dayEnd = $this->localTime->instant(CarbonImmutable::parse($entry['work_date'])->addDay()->toDateString(), '00:00:00', $timezone);
            $assigned = EmployeeOutletAssignment::query()->forTenant($tenant)->where('employee_id', $entry['employee_id'])->where('outlet_id', $outletId)
                ->where('effective_from', '<', $dayEnd->setTimezone(new \DateTimeZone('UTC')))->where('effective_until', '>', $dayStart->setTimezone(new \DateTimeZone('UTC')))->exists();
            $key = $entry['employee_id'].'|'.$entry['work_date'];
            if (! $employee || ! $assigned || $entry['work_date'] < $start || $entry['work_date'] >= $end || isset($rows[$key])
                || ($entry['status'] === 'work' ? ! $shift : $shiftId !== null)) {
                throw ValidationException::withMessages(['entries' => 'Karyawan, tanggal, shift, atau duplikasi entri tidak valid.']);
            }
            $rows[$key] = ['employee_id' => $entry['employee_id'], 'work_date' => $entry['work_date'], 'status' => $entry['status'], 'shift_template_version_id' => $shiftId];
        }

        return array_values($rows);
    }

    private function publicationRows(TenantMembership $actor, Outlet $outlet, ?object $week, bool $checkConflicts = true): array
    {
        abort_unless($week?->draft_revision_id, 409, 'Draf belum tersedia.');
        $revision = DB::table('schedule_revisions')->where('id', $week->draft_revision_id)->whereNull('published_at')->first();
        abort_unless($revision && $revision->base_published_revision_id == $week->published_revision_id, 409, 'Draf memakai revisi dasar lama.');
        $entries = DB::table('schedule_entries')->where('revision_id', $revision->id)->get();
        $prior = DB::table('schedule_entries')->where('revision_id', $week->published_revision_id)->get()->keyBy(fn ($row) => $row->employee_id.'|'.$row->work_date);
        $now = CarbonImmutable::now('UTC');
        $rows = [];
        foreach ($entries as $entry) {
            $timezone = $this->timezone($actor->tenant_id, $outlet->id, $entry->work_date);
            $old = $prior->get($entry->employee_id.'|'.$entry->work_date);
            $snapshot = $old?->schedule_snapshot ? json_decode($old->schedule_snapshot, true, flags: JSON_THROW_ON_ERROR) : null;
            $started = $entry->work_date < $now->setTimezone($timezone)->toDateString()
                || ($snapshot && $snapshot['scheduled_start'] && CarbonImmutable::parse($snapshot['scheduled_start'])->lessThanOrEqualTo($now));
            if ($started) {
                abort_unless($old && $old->status === $entry->status && $old->shift_template_version_id == $entry->shift_template_version_id, 409, 'Jadwal yang telah dimulai tidak boleh diubah.');
                $rows[$entry->id] = $snapshot;

                continue;
            }
            $shift = $entry->shift_template_version_id ? ShiftTemplateVersion::query()->forTenant($actor->tenant_id)->with('template')->find($entry->shift_template_version_id) : null;
            $start = $end = null;
            if ($entry->status !== 'work') {
                $dayStart = $this->localTime->instant($entry->work_date, '00:00:00', $timezone);
                $dayEnd = $this->localTime->instant(CarbonImmutable::parse($entry->work_date)->addDay()->toDateString(), '00:00:00', $timezone);
                $assigned = EmployeeOutletAssignment::query()->forTenant($actor->tenant_id)->where('employee_id', $entry->employee_id)->where('outlet_id', $outlet->id)
                    ->where('effective_from', '<', $dayEnd->setTimezone(new \DateTimeZone('UTC')))->where('effective_until', '>', $dayStart->setTimezone(new \DateTimeZone('UTC')))->exists();
                if (! $assigned) {
                    throw ValidationException::withMessages(['entries' => 'Karyawan tidak memiliki penugasan Outlet pada tanggal ini.']);
                }
            }
            if ($entry->status === 'work') {
                if (! $shift || $shift->effective_from->toDateString() > $entry->work_date) {
                    throw ValidationException::withMessages(['entries' => 'Versi shift belum berlaku.']);
                }
                if (CarbonImmutable::parse($entry->work_date)->isoWeekday() >= 6 && $shift->start_time === '11:00:00' && $shift->end_time === '19:00:00') {
                    throw ValidationException::withMessages(['entries' => 'Shift tengah tidak diperbolehkan pada akhir pekan.']);
                }
                $endDate = $shift->crosses_midnight ? CarbonImmutable::parse($entry->work_date)->addDay()->toDateString() : $entry->work_date;
                $start = $this->localTime->instant($entry->work_date, $shift->start_time, $timezone);
                $end = $this->localTime->instant($endDate, $shift->end_time, $timezone);
                $assigned = EmployeeOutletAssignment::query()->forTenant($actor->tenant_id)->where('employee_id', $entry->employee_id)->where('outlet_id', $outlet->id)
                    ->where('effective_from', '<=', $start->setTimezone(new \DateTimeZone('UTC')))->where('effective_until', '>=', $end->setTimezone(new \DateTimeZone('UTC')))->exists();
                if (! $assigned || $end <= $start || CarbonImmutable::instance($start)->lessThanOrEqualTo($now)) {
                    throw ValidationException::withMessages(['entries' => 'Penugasan atau interval shift tidak valid atau shift sudah dimulai.']);
                }
            }
            $rows[$entry->id] = [
                'timezone' => $timezone, 'status' => $entry->status,
                'calendar_version_id' => OutletCalendarVersion::query()->forTenant($actor->tenant_id)->where('outlet_id', $outlet->id)->where('effective_from', '<=', $entry->work_date)->orderByDesc('effective_from')->value('id'),
                'scheduled_start' => $start?->format(DATE_ATOM), 'scheduled_end' => $end?->format(DATE_ATOM),
                'shift' => $shift ? ['template_id' => $shift->shift_template_id, 'version_id' => $shift->id, 'revision' => $shift->revision, 'name' => $shift->template->name,
                    'start_time' => $shift->start_time, 'end_time' => $shift->end_time, 'crosses_midnight' => (bool) $shift->crosses_midnight] : null,
            ];
        }
        foreach ($prior as $old) {
            $snapshot = json_decode($old->schedule_snapshot, true, flags: JSON_THROW_ON_ERROR);
            if ($old->work_date < $now->setTimezone($snapshot['timezone'])->toDateString()
                || ($snapshot['scheduled_start'] && CarbonImmutable::parse($snapshot['scheduled_start'])->lessThanOrEqualTo($now))) {
                abort_unless($entries->contains(fn ($entry) => $entry->employee_id === $old->employee_id && $entry->work_date === $old->work_date), 409, 'Entri historis tidak boleh dihapus.');
            }
        }
        $staffing = $this->staffingReport($week);
        if (! $staffing['enabled']) {
            throw ValidationException::withMessages(['staffing' => 'Konfigurasikan shift pagi, tengah, dan sore sebelum publikasi.']);
        }
        if ($staffing['conflicts'] !== []) {
            throw ValidationException::withMessages(['entries' => $staffing['conflicts']]);
        }
        if ($checkConflicts) {
            $this->conflicts($actor->tenant_id, $outlet->id, $week->week_start, $entries, $rows);
        }

        return $rows;
    }

    private function conflicts(int $tenant, int $outletId, string $weekStart, $entries, array $rows): void
    {
        $outlets = Outlet::query()->forTenant($tenant)->pluck('id');
        foreach ($entries->groupBy('employee_id') as $employeeId => $employeeEntries) {
            $intervals = [];
            foreach ($employeeEntries as $entry) {
                if ($rows[$entry->id]['status'] === 'work') {
                    $intervals[] = $rows[$entry->id] + ['work_date' => $entry->work_date, 'outlet_id' => $outletId];
                }
            }
            if ($intervals === []) {
                continue;
            }
            foreach ($outlets as $otherId) {
                foreach ($this->resolver->resolveWeek($tenant, [(int) $employeeId], CarbonImmutable::parse($weekStart)->subDays(3)->toDateString(), 13, (int) $otherId, [(int) $otherId]) as $resolved) {
                    if ((int) $otherId === $outletId && $resolved->workDate >= $weekStart && $resolved->workDate < CarbonImmutable::parse($weekStart)->addDays(7)->toDateString()) {
                        continue;
                    }
                    if (in_array('contradictory_schedule_rules', $resolved->conflicts, true)) {
                        throw ValidationException::withMessages(['entries' => 'Jadwal aktif karyawan memiliki konflik yang belum terselesaikan.']);
                    }
                    if ($resolved->status === 'scheduled' && $resolved->outletId === (int) $otherId) {
                        $intervals[] = ['scheduled_start' => $resolved->scheduledStart, 'scheduled_end' => $resolved->scheduledEnd, 'work_date' => $resolved->workDate, 'outlet_id' => (int) $otherId];
                    }
                }
            }
            foreach ($intervals as $index => $left) {
                foreach (array_slice($intervals, $index + 1) as $right) {
                    if (! $left['scheduled_start'] || ! $left['scheduled_end'] || ! $right['scheduled_start'] || ! $right['scheduled_end']
                        || ($left['work_date'] === $right['work_date'] && $left['outlet_id'] !== $right['outlet_id'])
                        || (CarbonImmutable::parse($left['scheduled_start'])->lessThan(CarbonImmutable::parse($right['scheduled_end'])) && CarbonImmutable::parse($right['scheduled_start'])->lessThan(CarbonImmutable::parse($left['scheduled_end'])))) {
                        throw ValidationException::withMessages(['entries' => 'Jadwal bertabrakan dengan shift karyawan yang sudah aktif.']);
                    }
                }
            }
        }
    }

    private function timezone(int $tenant, int $outlet, string $date): string
    {
        return OutletCalendarVersion::query()->forTenant($tenant)->where('outlet_id', $outlet)->where('effective_from', '<=', $date)->orderByDesc('effective_from')->value('timezone') ?? SchedulingDefaults::TIMEZONE;
    }

    private function canonical(array $value): array
    {
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(fn ($item) => is_array($item) ? $this->canonical($item) : $item, $value);
    }

    private function record(TenantMembership $actor, int $week, string $action, string $reason, array $values): void
    {
        $this->audit->record($actor->tenant_id, 'schedule_week', $week, $action, $actor->user_id, $reason, null, $values + ['actor_membership_id' => $actor->id]);
    }
}
