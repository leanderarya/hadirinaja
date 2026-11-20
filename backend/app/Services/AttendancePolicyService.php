<?php

namespace App\Services;

use App\Models\Outlet;
use App\Models\OutletAttendancePolicyVersion;
use App\Models\Tenant;
use App\Models\TenantAttendancePolicyVersion;
use App\Models\TenantMembership;
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

    private function assertForwardDate(string $date): void
    {
        $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'UTC');

        if (! $parsed || $parsed->toDateString() !== $date) {
            throw ValidationException::withMessages(['effective_from' => 'Tanggal berlaku tidak valid.']);
        }

        if ($parsed->lessThan(CarbonImmutable::today('UTC'))) {
            throw ValidationException::withMessages(['effective_from' => 'Perubahan kebijakan tidak boleh berlaku surut.']);
        }
    }
}
