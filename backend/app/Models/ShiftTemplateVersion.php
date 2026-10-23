<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['tenant_id', 'shift_template_id', 'revision', 'start_time', 'end_time', 'crosses_midnight', 'effective_from', 'actor_user_id', 'reason'])]
class ShiftTemplateVersion extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'crosses_midnight' => 'boolean',
            'effective_from' => 'immutable_date',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplate::class, 'shift_template_id');
    }
}
