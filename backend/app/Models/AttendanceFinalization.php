<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

#[Fillable([
    'tenant_id', 'employee_id', 'outlet_id', 'work_date', 'revision', 'outcome', 'reason',
    'projection_snapshot', 'actor_user_id', 'finalized_at',
])]
class AttendanceFinalization extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'work_date' => 'immutable_date',
            'projection_snapshot' => 'array',
            'finalized_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Attendance finalizations are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Attendance finalizations are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Attendance finalizations are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Attendance finalizations are append-only.');
    }
}
