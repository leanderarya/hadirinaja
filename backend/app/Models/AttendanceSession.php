<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'tenant_id', 'employee_id', 'outlet_id', 'work_date', 'status', 'check_in_at', 'check_out_at',
    'schedule_snapshot', 'policy_snapshot', 'assignment_snapshot', 'review_indicators',
])]
class AttendanceSession extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'work_date' => 'immutable_date',
            'check_in_at' => 'immutable_datetime',
            'check_out_at' => 'immutable_datetime',
            'schedule_snapshot' => 'array',
            'policy_snapshot' => 'array',
            'assignment_snapshot' => 'array',
            'review_indicators' => 'array',
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

    public function events(): HasMany
    {
        return $this->hasMany(AttendanceEvent::class);
    }
}
