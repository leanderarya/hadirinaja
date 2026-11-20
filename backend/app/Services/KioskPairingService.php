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
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly ManagementChangeRecorder $changes,
    ) {}

    /** @return array{code: string, expires_at: string} */
    public function issuePairingCode(TenantMembership $actor, Outlet $outlet, string $deviceName, ?int $renewalDeviceId = null): array
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

        return DB::transaction(function () use ($owner, $tenantOutlet, $deviceName, $code, $expiresAt, $renewalDeviceId): array {
            if ($renewalDeviceId !== null) {
                $device = KioskDevice::query()->forTenant((int) $owner->tenant_id)
                    ->whereKey($renewalDeviceId)->where('outlet_id', $tenantOutlet->getKey())->lockForUpdate()->first();
                if (! $device || $device->revoked_at !== null) {
                    throw ValidationException::withMessages(['device_id' => 'Perangkat tidak tersedia untuk diperbarui.']);
                }
                KioskPairingCode::query()->forTenant((int) $owner->tenant_id)
                    ->where('renewal_device_id', $renewalDeviceId)->whereNull('redeemed_at')
                    ->where('expires_at', '>', now())->update(['expires_at' => now()]);
            }
            $pairing = KioskPairingCode::query()->create([
                'tenant_id' => $owner->tenant_id,
                'outlet_id' => $tenantOutlet->getKey(),
                'issued_by_membership_id' => $owner->getKey(),
                'renewal_device_id' => $renewalDeviceId,
                'device_name' => $deviceName,
                'code_hash' => $this->codeHash($code),
                'expires_at' => $expiresAt,
            ]);

            $this->changes->record($owner, 'kiosk_pairing', (int) $pairing->getKey(), $renewalDeviceId === null ? 'issued' : 'renewal_issued',
                ['outlet_id', 'device_name', 'expires_at'], null, (int) $tenantOutlet->getKey());

            return ['code' => $code, 'expires_at' => $expiresAt->toIso8601String()];
        }, attempts: 3);
    }

    /** @return array{device: KioskDevice, token: string} */
    public function redeemPairingCode(string $code, ?string $previousCredential = null): array
    {
        $normalizedCode = Str::upper(trim($code));

        if (preg_match('/^[A-Z0-9]{12}$/D', $normalizedCode) !== 1) {
            throw ValidationException::withMessages(['code' => 'Kode pemasangan tidak valid atau kedaluwarsa.']);
        }

        return DB::transaction(function () use ($normalizedCode, $previousCredential): array {
            $candidate = KioskPairingCode::query()->where('code_hash', $this->codeHash($normalizedCode))->first();
            $device = null;
            if ($candidate?->renewal_device_id !== null) {
                $device = KioskDevice::query()->forTenant((int) $candidate->tenant_id)
                    ->whereKey($candidate->renewal_device_id)->where('outlet_id', $candidate->outlet_id)
                    ->lockForUpdate()->first();
                if (! $device || $device->revoked_at !== null) {
                    throw ValidationException::withMessages(['code' => 'Kode pemasangan tidak valid atau kedaluwarsa.']);
                }
            }
            $pairing = $candidate === null ? null : KioskPairingCode::query()->whereKey($candidate->getKey())
                ->where('code_hash', $this->codeHash($normalizedCode))->lockForUpdate()->first();
            if (! $pairing || $pairing->redeemed_at !== null || $pairing->expires_at->lessThanOrEqualTo(now())) {
                throw ValidationException::withMessages(['code' => 'Kode pemasangan tidak valid atau kedaluwarsa.']);
            }
            $previous = $previousCredential === null ? null : KioskDevice::query()
                ->where('credential_hash', hash('sha256', $previousCredential))->first();
            if ($previous !== null && $previous->revoked_at === null && ! $previous->credentialExpired()
                && (int) $pairing->renewal_device_id !== (int) $previous->getKey()) {
                throw ValidationException::withMessages(['device' => 'Perangkat masih terdaftar. Gunakan kode pembaruan untuk perangkat ini atau minta Owner mencabut akses lama sebelum memasangkan ulang.']);
            }
            $token = Str::random(64);
            $credential = ['credential_hash' => hash('sha256', $token),
                'credential_expires_at' => now()->addDays(KioskDevice::CREDENTIAL_LIFETIME_DAYS)];
            if ($device !== null) {
                $device->forceFill($credential)->save();
            } else {
                $device = KioskDevice::query()->create([
                    'tenant_id' => $pairing->tenant_id,
                    'outlet_id' => $pairing->outlet_id,
                    'name' => $pairing->device_name,
                    'paired_at' => now(),
                    ...$credential,
                ]);
            }

            $pairing->forceFill([
                'device_id' => $device->getKey(),
                'redeemed_at' => now(),
            ])->save();

            return ['device' => $device, 'token' => $token];
        }, attempts: 3);
    }

    public function revokeDevice(TenantMembership $actor, int $deviceId): void
    {
        $owner = $this->authorization->requireOwner($actor);
        DB::transaction(function () use ($owner, $deviceId): void {
            $device = KioskDevice::query()->forTenant((int) $owner->tenant_id)
                ->whereKey($deviceId)->lockForUpdate()->first();

            if (! $device || ! $this->authorization->canManageOutlet($owner, $device->outlet)) {
                throw ValidationException::withMessages(['device' => 'Perangkat tidak tersedia.']);
            }

            if ($device->revoked_at === null) {
                $device->forceFill(['revoked_at' => now()])->save();
                $this->changes->record($owner, 'kiosk_device', $deviceId, 'revoked',
                    ['revoked_at'], null, (int) $device->outlet_id);
            }
        }, attempts: 3);
    }

    private function codeHash(string $code): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key'));
    }
}
