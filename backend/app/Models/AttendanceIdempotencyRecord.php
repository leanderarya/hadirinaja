<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'tenant_id', 'employee_id', 'tenant_membership_id', 'kiosk_device_id', 'operation',
    'idempotency_key', 'request_hash', 'status', 'response_status', 'response_body',
    'contract_version', 'checkout_session_id', 'checkout_outlet_id',
])]
class AttendanceIdempotencyRecord extends Model
{
    use BelongsToTenant;

    public const LEGACY_CONTRACT = 1;

    public const DESTINATION_BOUND_CONTRACT = 2;

    public const VERIFIED_PERSONAL_CHECKOUT_CONTRACT = 3;

    public const VERIFIED_KIOSK_CHECKOUT_CONTRACT = 4;

    protected function casts(): array
    {
        return [
            'contract_version' => 'integer',
            'checkout_session_id' => 'integer',
            'checkout_outlet_id' => 'integer',
            'response_status' => 'integer',
            'response_body' => 'array',
        ];
    }
}
