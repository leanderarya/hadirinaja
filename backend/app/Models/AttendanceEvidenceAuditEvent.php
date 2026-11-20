<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

#[Fillable([
    'tenant_id', 'actor_type', 'actor_membership_id', 'attendance_event_id', 'attendance_evidence_id',
    'storage_key_hash', 'action', 'outcome', 'occurred_at',
])]
class AttendanceEvidenceAuditEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['occurred_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Attendance evidence audit events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Attendance evidence audit events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Attendance evidence audit events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Attendance evidence audit events are append-only.');
    }

    public function evidence(): BelongsTo
    {
        return $this->belongsTo(AttendanceEvidence::class, 'attendance_evidence_id');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(AttendanceEvent::class, 'attendance_event_id');
    }

    public function actorMembership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'actor_membership_id');
    }
}
