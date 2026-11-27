<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['tenant_id', 'business_unit_id', 'name', 'address'])]
class Outlet extends Model
{
    use BelongsToTenant;

    public function businessUnit(): BelongsTo
    {
        return $this->belongsTo(BusinessUnit::class);
    }

    public function supervisorScopes(): HasMany
    {
        return $this->hasMany(SupervisorOutletScope::class);
    }

    public function employeeAssignments(): HasMany
    {
        return $this->hasMany(EmployeeOutletAssignment::class);
    }
}
