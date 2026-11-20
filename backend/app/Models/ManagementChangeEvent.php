<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

#[Fillable([
    'tenant_id', 'actor_user_id', 'actor_membership_id', 'employee_id', 'outlet_id',
    'subject_type', 'subject_id', 'action', 'changed_fields', 'details', 'occurred_at',
])]
class ManagementChangeEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['details' => 'array', 'changed_fields' => 'array', 'occurred_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Management change audit events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Management change audit events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Management change audit events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Management change audit events are append-only.');
    }
}
