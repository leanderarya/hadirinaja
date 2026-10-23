<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['tenant_id', 'name', 'created_by_user_id'])]
class ShiftTemplate extends Model
{
    use BelongsToTenant;

    public function versions(): HasMany
    {
        return $this->hasMany(ShiftTemplateVersion::class);
    }
}
