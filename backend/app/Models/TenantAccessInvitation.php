<?php

namespace App\Models;

use App\Enums\TenantRole;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'tenant_id', 'created_by_membership_id', 'intended_user_id', 'employee_id', 'invitee_email',
    'role', 'token_digest', 'expires_at', 'accepted_at', 'accepted_by_user_id', 'revoked_at',
])]
class TenantAccessInvitation extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'role' => TenantRole::class,
            'expires_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function creatorMembership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'created_by_membership_id');
    }

    public function intendedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'intended_user_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function acceptedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_by_user_id');
    }

    public function state(): string
    {
        if ($this->accepted_at !== null) {
            return 'accepted';
        }

        if ($this->revoked_at !== null) {
            return 'revoked';
        }

        return $this->expires_at->lessThanOrEqualTo(now()) ? 'expired' : 'pending';
    }
}
