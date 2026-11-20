<?php

namespace App\Services;

use App\Models\ManagementChangeEvent;
use App\Models\TenantMembership;

class ManagementChangeRecorder
{
    /** @param list<string> $fields */
    public function record(
        TenantMembership $actor,
        string $type,
        int $subjectId,
        string $action,
        array $fields,
        ?int $employeeId = null,
        ?int $outletId = null,
    ): ManagementChangeEvent {
        return ManagementChangeEvent::query()->create([
            'tenant_id' => $actor->tenant_id,
            'actor_user_id' => $actor->user_id,
            'actor_membership_id' => $actor->getKey(),
            'employee_id' => $employeeId,
            'outlet_id' => $outletId,
            'subject_type' => $type,
            'subject_id' => $subjectId,
            'action' => $action,
            'changed_fields' => $fields,
            'occurred_at' => now(),
        ]);
    }
}
