<?php

namespace App\Models;

use App\Enums\TenantRole;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['tenant_id', 'user_id', 'is_active'])]
class TenantMembership extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'revoked_at' => 'immutable_datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function roles(): HasMany
    {
        return $this->hasMany(TenantRoleAssignment::class);
    }

    public function supervisorScopes(): HasMany
    {
        return $this->hasMany(SupervisorOutletScope::class);
    }

    public function employeeUserLink(): HasOne
    {
        return $this->hasOne(EmployeeUserLink::class);
    }

    public function hasRole(TenantRole $role): bool
    {
        return $this->is_active && $this->roles()->where('role', $role->value)->exists();
    }
}
