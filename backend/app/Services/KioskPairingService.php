<?php

namespace App\Services;

use App\Models\KioskDevice;
use App\Models\KioskPairingCode;
use App\Models\Outlet;
use App\Models\TenantMembership;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class KioskPairingService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    /** @return array{code: string, expires_at: string} */
    public function issuePairingCode(TenantMembership $actor, Outlet $outlet, string $deviceName): array
    {
        $owner = $this->authorization->requireOwner($actor);
        $tenantOutlet = Outlet::query()->forTenant((int) $owner->tenant_id)
            ->whereKey($outlet->getKey())->first();

        if (! $tenantOutlet || ! $this->authorization->canManageOutlet($owner, $tenantOutlet)) {
            throw ValidationException::withMessages(['outlet_id' => 'Outlet tidak tersedia.']);
        }

        $deviceName = trim($deviceName);

        if ($deviceName === '') {
            throw ValidationException::withMessages(['name' => 'Nama perangkat wajib diisi.']);
        }

        $code = Str::upper(Str::random(12));
        $expiresAt = now()->addMinutes(5);

        KioskPairingCode::query()->create([
            'tenant_id' => $owner->tenant_id,
            'outlet_id' => $tenantOutlet->getKey(),
            'issued_by_membership_id' => $owner->getKey(),
            'device_name' => $deviceName,
            'code_hash' => $this->codeHash($code),
            'expires_at' => $expiresAt,
        ]);

        return ['code' => $code, 'expires_at' => $expiresAt->toIso8601String()];
    }

    /** @return array{device: KioskDevice, token: string} */
    public function redeemPairingCode(string $code): array
    {
        $normalizedCode = Str::upper(trim($code));

        if (preg_match('/^[A-Z0-9]{12}$/D', $normalizedCode) !== 1) {
            throw ValidationException::withMessages(['code' => 'Kode pemasangan tidak valid atau kedaluwarsa.']);
        }

        return DB::transaction(function () use ($normalizedCode): array {
            $pairing = KioskPairingCode::query()
                ->where('code_hash', $this->codeHash($normalizedCode))
                ->lockForUpdate()->first();

            if (! $pairing || $pairing->redeemed_at !== null || $pairing->expires_at->isPast()) {
                throw ValidationException::withMessages(['code' => 'Kode pemasangan tidak valid atau kedaluwarsa.']);
            }

            $token = Str::random(64);
            $device = KioskDevice::query()->create([
                'tenant_id' => $pairing->tenant_id,
                'outlet_id' => $pairing->outlet_id,
                'name' => $pairing->device_name,
                'credential_hash' => hash('sha256', $token),
                'paired_at' => now(),
            ]);

            $pairing->forceFill([
                'device_id' => $device->getKey(),
                'redeemed_at' => now(),
            ])->save();

            return ['device' => $device, 'token' => $token];
        });
    }

    public function revokeDevice(TenantMembership $actor, int $deviceId): void
    {
        $owner = $this->authorization->requireOwner($actor);
        $device = KioskDevice::query()->forTenant((int) $owner->tenant_id)
            ->whereKey($deviceId)->first();

        if (! $device || ! $this->authorization->canManageOutlet($owner, $device->outlet)) {
            throw ValidationException::withMessages(['device' => 'Perangkat tidak tersedia.']);
        }

        if ($device->revoked_at === null) {
            $device->forceFill(['revoked_at' => now()])->save();
        }
    }

    private function codeHash(string $code): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key'));
    }
}
