<?php

namespace App\Data;

final readonly class EffectiveScheduleResult
{
    /**
     * @param  array<string, mixed>|null  $shift
     * @param  array<string, mixed>|null  $policy
     * @param  array<string, mixed>  $provenance
     * @param  list<string>  $conflicts
     */
    public function __construct(
        public int $employeeId,
        public int $tenantId,
        public string $workDate,
        public string $status,
        public ?int $outletId,
        public ?string $outletName,
        public string $timezone,
        public ?array $shift,
        public ?string $scheduledStart,
        public ?string $scheduledEnd,
        public ?int $tenantPolicyVersionId,
        public ?int $outletPolicyVersionId,
        public ?array $policy,
        public array $provenance,
        public ?array $holidayReferences,
        public ?bool $outletOperating,
        public array $conflicts,
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'employee_id' => $this->employeeId,
            'tenant_id' => $this->tenantId,
            'work_date' => $this->workDate,
            'status' => $this->status,
            'outlet' => $this->outletId === null ? null : ['id' => $this->outletId, 'name' => $this->outletName],
            'timezone' => $this->timezone,
            'shift' => $this->shift,
            'scheduled_start' => $this->scheduledStart,
            'scheduled_end' => $this->scheduledEnd,
            'policy' => [
                'tenant_version_id' => $this->tenantPolicyVersionId,
                'outlet_version_id' => $this->outletPolicyVersionId,
                'effective' => $this->policy,
            ],
            'provenance' => $this->provenance,
            'holiday_references' => $this->holidayReferences,
            'outlet_operating' => $this->outletOperating,
            'conflicts' => $this->conflicts,
        ];
    }
}
