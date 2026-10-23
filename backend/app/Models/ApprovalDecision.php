<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

#[Fillable([
    'tenant_id', 'approval_request_id', 'employee_id', 'actor_user_id', 'actor_membership_id',
    'action', 'reason', 'original_values', 'proposed_values', 'effective_values', 'idempotency_key', 'acted_at',
])]
class ApprovalDecision extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'original_values' => 'array',
            'proposed_values' => 'array',
            'effective_values' => 'array',
            'acted_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Approval decisions are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Approval decisions are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Approval decisions are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Approval decisions are append-only.');
    }
}
