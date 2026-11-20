<?php

namespace App\Services;

use App\Models\AttendanceSession;
use App\Models\Outlet;
use App\Models\OutletAttendancePolicyVersion;
use App\Models\Tenant;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantMembership;
use App\Support\SchedulingDefaults;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class AttendancePolicyService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly SchedulingChangeRecorder $changes,
    ) {}

    public function createTenantVersion(TenantMembership $actor, string $effectiveFrom, array $configuration, string $reason): TenantAttendancePolicyVersion
    {
        $actor = $this->authorization->requireOwner($actor);
        $this->assertForwardDate($effectiveFrom);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $effectiveFrom, $configuration, $reason, $tenantId): TenantAttendancePolicyVersion {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();

            if (TenantAttendancePolicyVersion::query()->forTenant($tenantId)->where('effective_from', $effectiveFrom)->exists()) {
                throw ValidationException::withMessages(['effective_from' => 'Versi kebijakan sudah ada pada tanggal tersebut.']);
            }
            $version = TenantAttendancePolicyVersion::query()->create([
                'tenant_id' => $tenantId,
                'effective_from' => $effectiveFrom,
                'configuration' => $configuration,
                'actor_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'tenant_policy', (int) $version->getKey(), 'created', (int) $actor->user_id, $reason, null, [
                'effective_from' => $effectiveFrom,
                'configuration' => $configuration,
            ]);

            return $version;
        });
    }

    /**
     * Revise the version that is already in force for a date without inserting a second
     * row for that date (the unique key forbids it) and without touching attendance,
     * which keeps its own policy snapshot taken at check-in.
     */
    public function reviseTenantVersion(TenantMembership $actor, string $effectiveFrom, array $configuration, string $reason): TenantAttendancePolicyVersion
    {
        $actor = $this->authorization->requireOwner($actor);
        $this->assertForwardDate($effectiveFrom);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $effectiveFrom, $configuration, $reason, $tenantId): TenantAttendancePolicyVersion {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();

            $version = TenantAttendancePolicyVersion::query()->forTenant($tenantId)
                ->where('effective_from', $effectiveFrom)->lockForUpdate()->first();

            if (! $version) {
                throw ValidationException::withMessages(['effective_from' => 'Tidak ada versi kebijakan pada tanggal tersebut untuk direvisi.']);
            }

            $previous = [
                'effective_from' => $effectiveFrom,
                'configuration' => $version->configuration,
            ];
            $this->assertModeChangeHasNoActiveSessions(
                $tenantId,
                null,
                $version->configuration['attendance_mode'] ?? null,
                $configuration['attendance_mode'] ?? null,
            );
            $version->configuration = $configuration;
            $version->actor_user_id = $actor->user_id;
            $version->reason = $reason;
            $version->save();

            $this->changes->record($tenantId, 'tenant_policy', (int) $version->getKey(), 'revised', (int) $actor->user_id, $reason, $previous, [
                'effective_from' => $effectiveFrom,
                'configuration' => $configuration,
            ]);

            return $version;
        });
    }

    public function createOutletVersion(TenantMembership $actor, Outlet $outlet, string $effectiveFrom, array $overrides, string $reason): OutletAttendancePolicyVersion
    {
        $actor = $this->authorization->requireOwner($actor);
        $this->assertForwardDate($effectiveFrom);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $outlet, $effectiveFrom, $overrides, $reason, $tenantId): OutletAttendancePolicyVersion {
            $tenantOutlet = Outlet::query()->forTenant($tenantId)->whereKey($outlet->getKey())->lockForUpdate()->first();

            if (! $tenantOutlet) {
                throw ValidationException::withMessages(['outlet_id' => 'Outlet tidak tersedia pada organisasi aktif.']);
            }

            if (OutletAttendancePolicyVersion::query()->forTenant($tenantId)->where('outlet_id', $tenantOutlet->getKey())
                ->where('effective_from', $effectiveFrom)->exists()) {
                throw ValidationException::withMessages(['effective_from' => 'Versi kebijakan outlet sudah ada pada tanggal tersebut.']);
            }

            $version = OutletAttendancePolicyVersion::query()->create([
                'tenant_id' => $tenantId,
                'outlet_id' => $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'overrides' => $overrides,
                'actor_user_id' => $actor->user_id,
                'reason' => $reason,
            ]);
            $this->changes->record($tenantId, 'outlet_policy', (int) $version->getKey(), 'created', (int) $actor->user_id, $reason, null, [
                'outlet_id' => (int) $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'overrides' => $overrides,
            ]);

            return $version;
        });
    }

    /** Revise the Outlet override already in force for a date, recording the previous overrides. */
    public function reviseOutletVersion(TenantMembership $actor, Outlet $outlet, string $effectiveFrom, array $overrides, string $reason): OutletAttendancePolicyVersion
    {
        $actor = $this->authorization->requireOwner($actor);
        $this->assertForwardDate($effectiveFrom);
        $tenantId = (int) $actor->tenant_id;

        return DB::transaction(function () use ($actor, $outlet, $effectiveFrom, $overrides, $reason, $tenantId): OutletAttendancePolicyVersion {
            $tenantOutlet = Outlet::query()->forTenant($tenantId)->whereKey($outlet->getKey())->lockForUpdate()->first();

            if (! $tenantOutlet) {
                throw ValidationException::withMessages(['outlet_id' => 'Outlet tidak tersedia pada organisasi aktif.']);
            }

            $version = OutletAttendancePolicyVersion::query()->forTenant($tenantId)
                ->where('outlet_id', $tenantOutlet->getKey())
                ->where('effective_from', $effectiveFrom)->lockForUpdate()->first();

            if (! $version) {
                throw ValidationException::withMessages(['effective_from' => 'Tidak ada versi kebijakan outlet pada tanggal tersebut untuk direvisi.']);
            }

            $previous = [
                'outlet_id' => (int) $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'overrides' => $version->overrides,
            ];
            if (array_key_exists('attendance_mode', $overrides)) {
                $this->assertModeChangeHasNoActiveSessions(
                    $tenantId,
                    (int) $tenantOutlet->getKey(),
                    $version->overrides['attendance_mode'] ?? null,
                    $overrides['attendance_mode'],
                );
            }
            $version->overrides = $overrides;
            $version->actor_user_id = $actor->user_id;
            $version->reason = $reason;
            $version->save();

            $this->changes->record($tenantId, 'outlet_policy', (int) $version->getKey(), 'revised', (int) $actor->user_id, $reason, $previous, [
                'outlet_id' => (int) $tenantOutlet->getKey(),
                'effective_from' => $effectiveFrom,
                'overrides' => $overrides,
            ]);

            return $version;
        });
    }

    /** @return array<string, mixed> */
    public function effective(int $tenantId, ?int $outletId, string $date, bool $currentRead = false): array
    {
        $tenantVersion = TenantAttendancePolicyVersion::query()->forTenant($tenantId)
            ->where('effective_from', '<=', $date)->orderByDesc('effective_from')
            ->when($currentRead, fn ($query) => $query->sharedLock())->first();
        $outletVersion = $outletId === null ? null : OutletAttendancePolicyVersion::query()->forTenant($tenantId)
            ->where('outlet_id', $outletId)->where('effective_from', '<=', $date)->orderByDesc('effective_from')
            ->when($currentRead, fn ($query) => $query->sharedLock())->first();
        $policy = $tenantVersion?->configuration;

        if ($policy !== null && $outletVersion !== null) {
            $policy = array_replace_recursive($policy, $outletVersion->overrides);
        }

        return [
            'effective_from' => $tenantVersion?->effective_from?->toDateString(),
            'configuration' => $policy,
            'tenant_default' => $tenantVersion?->configuration,
            'outlet_overrides' => $outletVersion?->overrides ?? [],
            'tenant_version_id' => $tenantVersion ? (int) $tenantVersion->getKey() : null,
            'outlet_version_id' => $outletVersion ? (int) $outletVersion->getKey() : null,
        ];
    }

    /**
     * Checkout re-resolves the live policy, so flipping the mode while a session is still
     * open would reject that employee's checkout and strand the session. Block only the
     * mode change; every other field stays revisable.
     */
    private function assertModeChangeHasNoActiveSessions(int $tenantId, ?int $outletId, mixed $currentMode, mixed $nextMode): void
    {
        if ($currentMode === $nextMode) {
            return;
        }

        $active = AttendanceSession::query()->forTenant($tenantId)
            ->where('status', 'active')
            ->when($outletId !== null, fn ($query) => $query->where('outlet_id', $outletId))
            ->exists();

        if ($active) {
            throw ValidationException::withMessages([
                'attendance_mode' => 'Tutup sesi presensi yang masih aktif sebelum mengubah mode presensi.',
            ]);
        }
    }

    private function assertForwardDate(string $date): void
    {
        $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'UTC');

        if (! $parsed || $parsed->toDateString() !== $date) {
            throw ValidationException::withMessages(['effective_from' => 'Tanggal berlaku tidak valid.']);
        }

        // Compare against the business timezone, not UTC: attendance resolves its
        // work_date in the Outlet timezone, so a UTC comparison can reject "today".
        $localToday = CarbonImmutable::now(SchedulingDefaults::TIMEZONE)->toDateString();

        if ($parsed->toDateString() < $localToday) {
            throw ValidationException::withMessages(['effective_from' => 'Perubahan kebijakan tidak boleh berlaku surut.']);
        }
    }
}
