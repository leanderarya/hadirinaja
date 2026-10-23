<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['tenant_id', 'outlet_id', 'calendar_date', 'revision', 'status', 'holiday_reference_id', 'created_by_user_id', 'reason', 'superseded_at'])]
class OutletCalendarException extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'calendar_date' => 'immutable_date',
            'revision' => 'integer',
            'superseded_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
