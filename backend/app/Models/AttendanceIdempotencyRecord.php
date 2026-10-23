<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'tenant_id', 'employee_id', 'tenant_membership_id', 'kiosk_device_id', 'operation',
    'idempotency_key', 'request_hash', 'status', 'response_status', 'response_body',
])]
class AttendanceIdempotencyRecord extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'response_status' => 'integer',
            'response_body' => 'array',
        ];
    }
}
