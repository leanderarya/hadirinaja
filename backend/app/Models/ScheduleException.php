<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['tenant_id', 'employee_id', 'work_date', 'revision', 'status', 'outlet_id', 'shift_template_version_id', 'created_by_user_id', 'reason', 'superseded_at'])]
class ScheduleException extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'work_date' => 'immutable_date',
            'revision' => 'integer',
            'superseded_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function shiftVersion(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplateVersion::class, 'shift_template_version_id');
    }
}
