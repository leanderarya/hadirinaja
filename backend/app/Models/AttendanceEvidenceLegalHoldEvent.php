<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

#[Fillable([
    'tenant_id', 'attendance_evidence_id', 'attendance_event_id', 'hold_reference',
    'action', 'expires_at', 'legal_hold_request_id', 'actor_membership_id', 'occurred_at',
])]
class AttendanceEvidenceLegalHoldEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['expires_at' => 'immutable_datetime', 'occurred_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Attendance evidence legal hold events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Attendance evidence legal hold events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Attendance evidence legal hold events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Attendance evidence legal hold events are append-only.');
    }

    public function evidence(): BelongsTo
    {
        return $this->belongsTo(AttendanceEvidence::class, 'attendance_evidence_id');
    }
}
