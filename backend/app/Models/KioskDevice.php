<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['tenant_id', 'outlet_id', 'name', 'credential_hash', 'credential_expires_at', 'paired_at', 'revoked_at', 'last_seen_at'])]
#[Hidden(['credential_hash'])]
class KioskDevice extends Model
{
    use BelongsToTenant;

    public const CREDENTIAL_LIFETIME_DAYS = 30;

    public function credentialExpired(): bool
    {
        return $this->credential_expires_at === null || $this->credential_expires_at->lessThanOrEqualTo(now());
    }

    protected function casts(): array
    {
        return [
            'paired_at' => 'immutable_datetime',
            'credential_expires_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
            'last_seen_at' => 'immutable_datetime',
        ];
    }

    public function outlet(): BelongsTo
    {
        return $this->belongsTo(Outlet::class);
    }
}
