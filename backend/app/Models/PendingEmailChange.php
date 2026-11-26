<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'tenant_id', 'membership_id', 'user_id', 'issued_by_membership_id', 'old_email', 'new_email',
    'token_digest', 'expires_at', 'confirmed_at', 'revoked_at',
])]
class PendingEmailChange extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    public function membership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function issuerMembership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'issued_by_membership_id');
    }
}
