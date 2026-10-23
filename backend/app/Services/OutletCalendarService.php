<?php

namespace App\Services;

use App\Models\Outlet;
use App\Models\OutletCalendarException;
use App\Models\OutletCalendarVersion;
use App\Models\Tenant;
use App\Models\TenantHolidayReference;
use App\Models\TenantMembership;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class OutletCalendarService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly SchedulingChangeRecorder $changes,
    ) {}

    public function createVersion(TenantMembership $actor, Outlet $outlet, string $effectiveFrom, string $timezone, array $weekdays, string $reason): OutletCalendarVersion
    {
        $actor = $this->authorization->requireOwner($actor);
        $this->assertForwardDate($effectiveFrom, 'effective_from');
        $this->assertTimezone($timezone);
        $weekdays = $this->normalizeWeekdays($weekdays);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $outlet, $effectiveFrom, $timezone, $weekdays, $reason, $tenantId): OutletCalendarVersion {
            $tenantOutlet = Outlet::query()->forTenant($tenantId)->whereKey($outlet->getKey())->lockForUpdate()->first();

            if (! $tenantOutlet) {
                throw ValidationException::withMessages(['outlet_id' => 'Outlet tidak tersedia pada organisasi aktif.']);
            }

            if (OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $tenantOutlet->getKey())
                ->where('effective_from', $effectiveFrom)->exists()) {
                throw ValidationException::withMessages(['effective_from' => 'Versi kalender outlet sudah ada pada tanggal tersebut.']);
            }

            $version = OutletCalendarVersion::query()->create([
                'tenant_id' => $tenantId,
                'outlet_id' => $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'timezone' => $timezone,
                'operating_weekdays' => $weekdays,
                'actor_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'outlet_calendar', (int) $version->getKey(), 'version_created', (int) $actor->user_id, $reason, null, [
                'outlet_id' => (int) $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'timezone' => $timezone,
                'operating_weekdays' => $weekdays,
            ]);

            return $version;
        });
    }

    public function createDateException(
        TenantMembership $actor,
        Outlet $outlet,
        string $date,
        string $status,
        ?int $holidayReferenceId,
        string $reason,
    ): OutletCalendarException {
        $actor = $this->authorization->requireOwner($actor);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $outlet, $date, $status, $holidayReferenceId, $reason, $tenantId): OutletCalendarException {
            $tenantOutlet = Outlet::query()->forTenant($tenantId)->whereKey($outlet->getKey())->lockForUpdate()->first();

            if (! $tenantOutlet) {
                throw ValidationException::withMessages(['outlet_id' => 'Outlet tidak tersedia pada organisasi aktif.']);
            }

            $this->assertForwardDate($date, 'calendar_date');
            $activeCalendar = OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $tenantOutlet->getKey())
                ->where('effective_from', '<=', now()->toDateString())->orderByDesc('effective_from')->first();
            $timezone = $activeCalendar?->timezone ?? SchedulingDefaults::TIMEZONE;
            $localToday = CarbonImmutable::now($timezone)->toDateString();

            if ($date < $localToday) {
                throw ValidationException::withMessages(['calendar_date' => 'Perubahan kalender tidak boleh berlaku surut.']);
            }

            $holiday = null;
            if ($holidayReferenceId !== null) {
                $holiday = TenantHolidayReference::query()->forTenant($tenantId)->whereKey($holidayReferenceId)->first();
                if (! $holiday || $holiday->holiday_date->toDateString() !== $date) {
                    throw ValidationException::withMessages(['holiday_reference_id' => 'Referensi libur harus berasal dari tenant dan tanggal yang sama.']);
                }
            }

            $previous = OutletCalendarException::query()->forTenant($tenantId)->where('outlet_id', $tenantOutlet->getKey())
                ->where('calendar_date', $date)->whereNull('superseded_at')->lockForUpdate()->first();
            $revision = (int) (OutletCalendarException::query()->forTenant($tenantId)->where('outlet_id', $tenantOutlet->getKey())
                ->where('calendar_date', $date)->max('revision') ?? 0) + 1;
            $previousValues = $previous ? ['status' => $previous->status, 'holiday_reference_id' => $previous->holiday_reference_id] : null;

            if ($previous) {
                $previous->forceFill(['superseded_at' => now()])->save();
            }

            $exception = OutletCalendarException::query()->create([
                'tenant_id' => $tenantId,
                'outlet_id' => $tenantOutlet->getKey(),
                'calendar_date' => $date,
                'revision' => $revision,
                'status' => $status,
                'holiday_reference_id' => $holiday?->getKey(),
                'created_by_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'calendar_exception', (int) $exception->getKey(), $previous ? 'revised' : 'created', (int) $actor->user_id, $reason, $previousValues, [
                'outlet_id' => (int) $tenantOutlet->getKey(),
                'calendar_date' => $date,
                'status' => $status,
                'holiday_reference_id' => $holiday?->getKey(),
            ]);

            return $exception;
        });
    }

    public function createHolidayReference(TenantMembership $actor, string $date, string $name, ?string $region): TenantHolidayReference
    {
        $actor = $this->authorization->requireOwner($actor);
        $tenantId = (int) $actor->tenant_id;
        $this->assertDate($date, 'holiday_date');

        return DB::transaction(function () use ($actor, $date, $name, $region, $tenantId): TenantHolidayReference {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $duplicate = TenantHolidayReference::query()->forTenant($tenantId)
                ->where('holiday_date', $date)->where('name', $name)->exists();

            if ($duplicate) {
                throw ValidationException::withMessages(['name' => 'Referensi libur tersebut sudah tercatat.']);
            }

            $holiday = TenantHolidayReference::query()->create([
                'tenant_id' => $tenantId,
                'holiday_date' => $date,
                'name' => trim($name),
                'region' => $region === null ? null : trim($region),
                'created_by_user_id' => $actor->user_id,
            ]);
            $this->changes->record($tenantId, 'holiday_reference', (int) $holiday->getKey(), 'created', (int) $actor->user_id, null, null, [
                'holiday_date' => $date,
                'name' => $holiday->name,
                'region' => $holiday->region,
                'automatically_closes_outlet' => false,
            ]);

            return $holiday;
        });
    }

    /** @param array<mixed> $weekdays @return list<int> */
    private function normalizeWeekdays(array $weekdays): array
    {
        $normalized = array_values(array_unique(array_map('intval', $weekdays)));
        sort($normalized);

        if (count($normalized) !== count($weekdays) || array_diff($normalized, [1, 2, 3, 4, 5, 6, 7]) !== []) {
            throw ValidationException::withMessages(['operating_weekdays' => 'Pilih hari operasional antara Senin sampai Minggu tanpa duplikasi.']);
        }

        return $normalized;
    }

    private function assertTimezone(string $timezone): void
    {
        if (! in_array($timezone, timezone_identifiers_list(), true)) {
            throw ValidationException::withMessages(['timezone' => 'Zona waktu harus memakai pengenal IANA yang valid.']);
        }
    }

    private function assertForwardDate(string $date, string $field): void
    {
        $this->assertDate($date, $field);

        if ($date < CarbonImmutable::today('UTC')->toDateString()) {
            throw ValidationException::withMessages([$field => 'Perubahan kalender tidak boleh berlaku surut.']);
        }
    }

    private function assertDate(string $date, string $field): void
    {
        $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'UTC');

        if (! $parsed || $parsed->toDateString() !== $date) {
            throw ValidationException::withMessages([$field => 'Tanggal tidak valid.']);
        }
    }
}
