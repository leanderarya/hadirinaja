<?php

namespace App\Services;

use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceEvidenceAuditEvent;
use App\Models\TenantMembership;

class AttendanceEvidenceAuditLogger
{
    public function record(
        TenantMembership $actor,
        AttendanceEvent $event,
        AttendanceEvidence $evidence,
        string $action,
        string $outcome,
    ): void {
        AttendanceEvidenceAuditEvent::query()->create([
            'tenant_id' => $actor->tenant_id,
            'actor_type' => 'membership',
            'actor_membership_id' => $actor->getKey(),
            'attendance_event_id' => $event->getKey(),
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => $action,
            'outcome' => $outcome,
            'occurred_at' => now('UTC'),
        ]);
    }

    public function recordSystem(
        int $tenantId,
        ?AttendanceEvent $event,
        ?AttendanceEvidence $evidence,
        string $action,
        string $outcome,
        ?string $storageKeyHash = null,
    ): void {
        AttendanceEvidenceAuditEvent::query()->create([
            'tenant_id' => $tenantId,
            'actor_type' => 'system',
            'actor_membership_id' => null,
            'attendance_event_id' => $event?->getKey(),
            'attendance_evidence_id' => $evidence?->getKey(),
            'storage_key_hash' => $storageKeyHash,
            'action' => $action,
            'outcome' => $outcome,
            'occurred_at' => now('UTC'),
        ]);
    }
}
