<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

#[Fillable(['tenant_id', 'actor_user_id', 'actor_membership_id', 'report_type', 'filters', 'row_count', 'generated_at'])]
class ReportExportEvent extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['filters' => 'array', 'generated_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::updating(static fn (): never => throw new LogicException('Report export audit events are append-only.'));
        static::deleting(static fn (): never => throw new LogicException('Report export audit events are append-only.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        throw new LogicException('Report export audit events are append-only.');
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Report export audit events are append-only.');
    }
}
