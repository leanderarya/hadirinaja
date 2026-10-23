<?php

namespace App\Services;

use App\Models\SchedulingChangeEvent;

final class SchedulingChangeRecorder
{
    /** @param array<string, mixed>|null $previous @param array<string, mixed>|null $next */
    public function record(
        int $tenantId,
        string $resourceType,
        int $resourceId,
        string $action,
        int $actorUserId,
        ?string $reason,
        ?array $previous,
        ?array $next,
    ): void {
        SchedulingChangeEvent::query()->create([
            'tenant_id' => $tenantId,
            'resource_type' => $resourceType,
            'resource_id' => $resourceId,
            'action' => $action,
            'actor_user_id' => $actorUserId,
            'reason' => $reason,
            'previous_values' => $previous,
            'new_values' => $next,
        ]);
    }
}
