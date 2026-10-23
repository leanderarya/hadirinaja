<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['tenant_id', 'outlet_id', 'effective_from', 'timezone', 'operating_weekdays', 'actor_user_id', 'reason'])]
class OutletCalendarVersion extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'effective_from' => 'immutable_date',
            'operating_weekdays' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
