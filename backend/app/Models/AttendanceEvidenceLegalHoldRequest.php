<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'tenant_id', 'attendance_evidence_id', 'attendance_event_id', 'hold_reference', 'request_type',
    'status', 'justification', 'requested_duration_days', 'requested_expires_at', 'lease_expires_at', 'preservation_lease_granted',
    'requested_by_membership_id', 'decided_by_membership_id', 'decision_reason', 'created_at', 'decided_at',
])]
class AttendanceEvidenceLegalHoldRequest extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'requested_duration_days' => 'integer',
            'preservation_lease_granted' => 'boolean',
            'requested_expires_at' => 'immutable_datetime',
            'lease_expires_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(AttendanceEvent::class, 'attendance_event_id');
    }
}
