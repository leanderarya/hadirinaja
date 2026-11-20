<?php

namespace App\Data;

use App\Contracts\AttendanceSource;
use Carbon\CarbonImmutable;

/** Recorded physical facts only. Approval overlays must never modify this value. */
final readonly class PhysicalAttendanceSource implements AttendanceSource
{
    /** @param list<array{id:int, type:string, origin:string, recorded_at:string, has_evidence:bool, checkout_destination:array{id:int, timezone:string|null}|null}> $events */
    public function __construct(
        public int $tenantId,
        public int $employeeId,
        public int $sessionId,
        public int $outletId,
        public string $workDate,
        public string $recordingStatus,
        public CarbonImmutable $checkInAt,
        public ?CarbonImmutable $checkOutAt,
        public array $events,
    ) {}

    public function kind(): string
    {
        return 'physical_session';
    }

    public function durationSeconds(): ?int
    {
        if ($this->checkOutAt === null || $this->checkOutAt->lessThan($this->checkInAt)) {
            return null;
        }

        return $this->checkOutAt->getTimestamp() - $this->checkInAt->getTimestamp();
    }

    /** Existing session response shape, also safe for historical snapshot consumers. */
    public function original(): array
    {
        return [
            'work_date' => $this->workDate,
            'outlet_id' => $this->outletId,
            'check_in_at' => $this->checkInAt->toIso8601String(),
            'check_out_at' => $this->checkOutAt?->toIso8601String(),
            'event_ids' => array_column($this->events, 'id'),
            'events' => $this->events,
        ];
    }

    /** @return array<string, mixed> */
    public function facts(): array
    {
        return [
            'tenant_id' => $this->tenantId,
            'employee_id' => $this->employeeId,
            'outlet_id' => $this->outletId,
            'recording_status' => $this->recordingStatus,
            ...$this->original(),
            'duration_seconds' => $this->durationSeconds(),
        ];
    }
}
