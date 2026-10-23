<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['tenant_id', 'employee_id', 'outlet_id', 'issued_by_membership_id', 'code_hash', 'expires_at', 'used_at', 'revoked_at'])]
#[Hidden(['code_hash'])]
class EmployeePinEnrollmentCode extends Model
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'used_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }
}
