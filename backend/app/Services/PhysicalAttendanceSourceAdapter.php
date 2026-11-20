<?php

namespace App\Services;

use App\Data\PhysicalAttendanceSource;
use App\Models\AttendanceSession;
use Carbon\CarbonImmutable;
use LogicException;

/** Adapts eager-loaded records without querying or applying effective corrections. */
final class PhysicalAttendanceSourceAdapter
{
    public function adapt(AttendanceSession $session): PhysicalAttendanceSource
    {
        if (! $session->relationLoaded('events')) {
            throw new LogicException('Physical attendance requires eager-loaded events.');
        }

        $events = [];
        foreach ($session->events as $event) {
            if (! $event->relationLoaded('evidence')) {
                throw new LogicException('Physical attendance requires eager-loaded evidence.');
            }
            $events[] = [
                'id' => (int) $event->getKey(),
                'type' => $event->event_type,
                'origin' => $event->origin,
                'recorded_at' => CarbonImmutable::instance($event->recorded_at)->utc()->toIso8601String(),
                'has_evidence' => $event->evidence !== null,
                'checkout_destination' => $event->checkout_outlet_id === null ? null : [
                    'id' => (int) $event->checkout_outlet_id,
                    'timezone' => $event->checkout_context['policy']['timezone'] ?? null,
                ],
            ];
        }

        return new PhysicalAttendanceSource(
            tenantId: (int) $session->tenant_id,
            employeeId: (int) $session->employee_id,
            sessionId: (int) $session->getKey(),
            outletId: (int) $session->outlet_id,
            workDate: $session->work_date->toDateString(),
            recordingStatus: $session->status,
            checkInAt: CarbonImmutable::instance($session->check_in_at)->utc(),
            checkOutAt: $session->check_out_at === null ? null : CarbonImmutable::instance($session->check_out_at)->utc(),
            events: $events,
        );
    }
}
