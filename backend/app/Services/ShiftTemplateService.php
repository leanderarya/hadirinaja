<?php

namespace App\Services;

use App\Models\ShiftTemplate;
use App\Models\ShiftTemplateVersion;
use App\Models\Tenant;
use App\Models\TenantMembership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ShiftTemplateService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly SchedulingChangeRecorder $changes,
    ) {}

    public function create(TenantMembership $actor, string $name, string $start, string $end, bool $crossesMidnight, string $effectiveFrom, string $reason): ShiftTemplate
    {
        $actor = $this->authorization->requireOwner($actor);
        $tenantId = (int) $actor->tenant_id;
        $this->assertShift($start, $end, $crossesMidnight);
        $this->assertForwardDate($effectiveFrom);
        $name = trim($name);

        return DB::transaction(function () use ($actor, $tenantId, $name, $start, $end, $crossesMidnight, $effectiveFrom, $reason): ShiftTemplate {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();

            if (ShiftTemplate::query()->forTenant($tenantId)->where('name', $name)->exists()) {
                throw ValidationException::withMessages(['name' => 'Nama shift tersebut sudah digunakan pada organisasi ini.']);
            }

            $template = ShiftTemplate::query()->create([
                'tenant_id' => $tenantId,
                'name' => $name,
                'created_by_user_id' => $actor->user_id,
            ]);
            $version = $template->versions()->create([
                'tenant_id' => $tenantId,
                'revision' => 1,
                'start_time' => $start,
                'end_time' => $end,
                'crosses_midnight' => $crossesMidnight,
                'effective_from' => $effectiveFrom,
                'actor_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'shift_template_version', (int) $version->getKey(), 'created', (int) $actor->user_id, $reason, null, [
                'template_id' => (int) $template->getKey(),
                'name' => $template->name,
                'revision' => 1,
                'start_time' => $start,
                'end_time' => $end,
                'crosses_midnight' => $crossesMidnight,
                'effective_from' => $effectiveFrom,
            ]);

            return $template->load('versions');
        });
    }

    public function revise(
        TenantMembership $actor,
        int $templateId,
        string $start,
        string $end,
        bool $crossesMidnight,
        string $effectiveFrom,
        string $reason,
    ): ShiftTemplateVersion {
        $actor = $this->authorization->requireOwner($actor);
        $tenantId = (int) $actor->tenant_id;
        $this->assertShift($start, $end, $crossesMidnight);
        $this->assertForwardDate($effectiveFrom);

        return DB::transaction(function () use ($actor, $tenantId, $templateId, $start, $end, $crossesMidnight, $effectiveFrom, $reason): ShiftTemplateVersion {
            $template = ShiftTemplate::query()->forTenant($tenantId)->whereKey($templateId)->lockForUpdate()->first();

            if (! $template) {
                throw ValidationException::withMessages(['template_id' => 'Template shift tidak tersedia pada organisasi aktif.']);
            }

            if ($template->versions()->where('effective_from', $effectiveFrom)->exists()) {
                throw ValidationException::withMessages(['effective_from' => 'Revisi shift sudah ada pada tanggal tersebut.']);
            }

            $latest = $template->versions()->orderByDesc('revision')->firstOrFail();
            $version = $template->versions()->create([
                'tenant_id' => $tenantId,
                'revision' => (int) $latest->revision + 1,
                'start_time' => $start,
                'end_time' => $end,
                'crosses_midnight' => $crossesMidnight,
                'effective_from' => $effectiveFrom,
                'actor_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'shift_template_version', (int) $version->getKey(), 'revision_created', (int) $actor->user_id, $reason, [
                'template_id' => (int) $template->getKey(),
                'revision' => (int) $latest->revision,
                'start_time' => $latest->start_time,
                'end_time' => $latest->end_time,
                'crosses_midnight' => (bool) $latest->crosses_midnight,
            ], [
                'template_id' => (int) $template->getKey(),
                'revision' => (int) $version->revision,
                'start_time' => $start,
                'end_time' => $end,
                'crosses_midnight' => $crossesMidnight,
                'effective_from' => $effectiveFrom,
            ]);

            return $version;
        });
    }

    private function assertShift(string $start, string $end, bool $crossesMidnight): void
    {
        if (! preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $start)
            || ! preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $end)) {
            throw ValidationException::withMessages(['start_time' => 'Jam shift harus memakai format 24 jam.']);
        }

        $startMinute = $this->minutes($start);
        $endMinute = $this->minutes($end);
        $duration = $endMinute - $startMinute;

        if ($crossesMidnight) {
            $duration = ($duration + 1440) % 1440;
        }

        if ($duration < 15 || $duration > 1080 || (! $crossesMidnight && $endMinute <= $startMinute)
            || ($crossesMidnight && $endMinute >= $startMinute)) {
            throw ValidationException::withMessages(['end_time' => 'Shift harus berdurasi 15 menit sampai 18 jam dengan penanda lintas tengah malam yang sesuai.']);
        }
    }

    private function minutes(string $time): int
    {
        [$hour, $minute] = array_map('intval', explode(':', $time));

        return ($hour * 60) + $minute;
    }

    private function assertForwardDate(string $date): void
    {
        $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'UTC');

        if (! $parsed || $parsed->toDateString() !== $date || $date < CarbonImmutable::today('UTC')->toDateString()) {
            throw ValidationException::withMessages(['effective_from' => 'Revisi shift hanya boleh berlaku mulai hari ini atau tanggal mendatang.']);
        }
    }
}
