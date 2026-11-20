<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

#[Fillable([
    'tenant_id', 'employee_id', 'attendance_session_id', 'idempotency_record_id', 'outlet_id',
    'tenant_membership_id', 'kiosk_device_id', 'event_type', 'origin', 'recorded_at',
    'location_capture_status', 'location_verdict', 'location_latitude', 'location_longitude',
    'location_accuracy_meters', 'context_snapshot', 'created_at',
    'checkout_outlet_id', 'authenticated_kiosk_outlet_id', 'checkout_context',
])]
class AttendanceEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $hidden = ['kiosk_binding_outlet_id'];

    protected function casts(): array
    {
        return [
            'recorded_at' => 'immutable_datetime',
            'location_latitude' => 'decimal:7',
            'location_longitude' => 'decimal:7',
            'location_accuracy_meters' => 'decimal:2',
            'context_snapshot' => 'array',
            'checkout_outlet_id' => 'integer',
            'authenticated_kiosk_outlet_id' => 'integer',
            'checkout_context' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Attendance events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Attendance events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Attendance events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Attendance events are append-only.');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AttendanceSession::class, 'attendance_session_id');
    }

    public function evidence(): HasOne
    {
        return $this->hasOne(AttendanceEvidence::class);
    }

    public function checkoutOutlet(): BelongsTo
    {
        return $this->belongsTo(Outlet::class, 'checkout_outlet_id');
    }
}
