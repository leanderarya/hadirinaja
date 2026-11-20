<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

#[Fillable([
    'tenant_id', 'employee_id', 'attendance_session_id', 'approval_request_id', 'classification',
    'original_values', 'proposed_values', 'created_by_user_id', 'created_at',
    'contract_version', 'basis_correction_id',
])]
class AttendanceCorrection extends Model
{
    use BelongsToTenant;

    public const VERSIONED_EFFECT_CONTRACT = 2;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'original_values' => 'array',
            'proposed_values' => 'array',
            'created_at' => 'immutable_datetime',
            'contract_version' => 'integer',
            'basis_correction_id' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Attendance corrections are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Attendance corrections are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Attendance corrections are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Attendance corrections are append-only.');
    }

    /** @return array{int, string, int} */
    public function effectOrder(ApprovalDecision $decision): array
    {
        return [
            $this->contract_version,
            $this->contract_version === self::VERSIONED_EFFECT_CONTRACT ? '' : $decision->acted_at->toIso8601String(),
            (int) $decision->getKey(),
        ];
    }

    public function approvalRequest(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AttendanceSession::class, 'attendance_session_id');
    }
}
