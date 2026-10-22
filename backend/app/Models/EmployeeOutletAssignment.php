<?php

namespace App\Models;

use App\Enums\EmployeeOutletAssignmentType;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['tenant_id', 'employee_id', 'outlet_id', 'assignment_type', 'effective_from', 'effective_until'])]
class EmployeeOutletAssignment extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'assignment_type' => EmployeeOutletAssignmentType::class,
            'effective_from' => 'immutable_datetime',
            'effective_until' => 'immutable_datetime',
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
}
