<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['tenant_id', 'name'])]
class Employee extends Model
{
    use BelongsToTenant;

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeOutletAssignment::class);
    }

    public function userLink(): HasOne
    {
        return $this->hasOne(EmployeeUserLink::class);
    }
}
