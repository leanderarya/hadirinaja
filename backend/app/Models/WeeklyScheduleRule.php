<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['tenant_id', 'employee_id', 'outlet_id', 'weekday', 'shift_template_version_id', 'effective_from', 'effective_until', 'created_by_user_id'])]
class WeeklyScheduleRule extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'weekday' => 'integer',
            'effective_from' => 'immutable_date',
            'effective_until' => 'immutable_date',
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

    public function shiftVersion(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplateVersion::class, 'shift_template_version_id');
    }
}
