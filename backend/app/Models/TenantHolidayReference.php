<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['tenant_id', 'holiday_date', 'name', 'region', 'created_by_user_id'])]
class TenantHolidayReference extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return ['holiday_date' => 'immutable_date', 'created_at' => 'immutable_datetime'];
    }
}
