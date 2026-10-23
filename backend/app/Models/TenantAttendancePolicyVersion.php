<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['tenant_id', 'effective_from', 'configuration', 'actor_user_id', 'reason'])]
class TenantAttendancePolicyVersion extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['effective_from' => 'immutable_date', 'configuration' => 'array', 'created_at' => 'immutable_datetime'];
    }
}
