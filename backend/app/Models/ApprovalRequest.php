<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

#[Fillable([
    'tenant_id', 'employee_id', 'outlet_id', 'requester_user_id', 'requester_membership_id',
    'request_type', 'status', 'work_date', 'starts_on', 'ends_on', 'reason', 'details',
    'submission_key', 'submission_hash', 'review_key',
])]
class ApprovalRequest extends Model
{
    use BelongsToTenant;

    protected static function booted(): void
    {
        static::updating(static function (self $request): void {
            $immutableChanges = array_diff(array_keys($request->getDirty()), ['status', 'updated_at']);
            if ($immutableChanges !== []) {
                throw new LogicException('Approval request details are immutable after submission.');
            }
        });
        static::deleting(static fn (): never => throw new LogicException('Approval request history cannot be deleted.'));
    }

    protected function performUpdate(Builder $query): bool
    {
        $immutableChanges = array_diff(array_keys($this->getDirty()), ['status', 'updated_at']);
        if ($immutableChanges !== []) {
            throw new LogicException('Approval request details are immutable after submission.');
        }

        return parent::performUpdate($query);
    }

    protected function performDeleteOnModel(): void
    {
        throw new LogicException('Approval request history cannot be deleted.');
    }

    protected function casts(): array
    {
        return [
            'work_date' => 'immutable_date',
            'starts_on' => 'immutable_date',
            'ends_on' => 'immutable_date',
            'details' => 'array',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function outlet(): BelongsTo
    {
        return $this->belongsTo(Outlet::class);
    }

    public function decisions(): HasMany
    {
        return $this->hasMany(ApprovalDecision::class)->orderBy('id');
    }

    public function scopeWithoutReversal(Builder $query, bool $lock = false): Builder
    {
        return $query->whereDoesntHave('decisions', fn (Builder $decision) => $decision
            ->whereColumn('approval_decisions.tenant_id', 'approval_requests.tenant_id')
            ->where('action', 'reversed')
            ->when($lock, fn (Builder $rows) => $rows->lockForUpdate()));
    }

    public function correction(): HasOne
    {
        return $this->hasOne(AttendanceCorrection::class);
    }
}
