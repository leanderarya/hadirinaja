<?php

namespace App\Data;

use App\Models\KioskDevice;
use App\Models\TenantMembership;

final readonly class AttendanceActor
{
    private function __construct(
        public string $origin,
        public int $tenantId,
        public ?int $tenantMembershipId,
        public ?int $kioskDeviceId,
        public ?string $kioskCredentialHash = null,
        public ?int $kioskOutletId = null,
    ) {}

    public static function personal(TenantMembership $membership): self
    {
        return new self('personal', (int) $membership->tenant_id, (int) $membership->getKey(), null);
    }

    public static function kiosk(KioskDevice $device): self
    {
        return new self(
            'kiosk', (int) $device->tenant_id, null, (int) $device->getKey(),
            $device->credential_hash, (int) $device->outlet_id,
        );
    }

    /** @return array{tenant_membership_id: int|null, kiosk_device_id: int|null} */
    public function eventColumns(): array
    {
        return [
            'tenant_membership_id' => $this->tenantMembershipId,
            'kiosk_device_id' => $this->kioskDeviceId,
        ];
    }
}
