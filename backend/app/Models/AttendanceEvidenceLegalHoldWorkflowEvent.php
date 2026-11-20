<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

#[Fillable([
    'tenant_id', 'attendance_evidence_id', 'attendance_event_id', 'request_id', 'hold_reference',
    'action', 'actor_membership_id', 'reason', 'lease_expires_at', 'effective_expires_at', 'occurred_at',
])]
class AttendanceEvidenceLegalHoldWorkflowEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'lease_expires_at' => 'immutable_datetime',
            'effective_expires_at' => 'immutable_datetime',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Legal hold workflow events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Legal hold workflow events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Legal hold workflow events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Legal hold workflow events are append-only.');
    }
}
