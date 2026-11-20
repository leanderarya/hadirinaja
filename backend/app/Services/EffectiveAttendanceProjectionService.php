<?php

namespace App\Services;

/** Compatibility entry point for existing projection and finalization callers. */
final class EffectiveAttendanceProjectionService
{
    public function __construct(private readonly EffectiveAttendanceReader $reader) {}

    /** @return array<string, mixed> */
    public function project(int $tenantId, int $employeeId, string $workDate, ?array $outletScopeIds = null, ?int $outletContext = null): array
    {
        return $this->reader->project($tenantId, $employeeId, $workDate, $outletScopeIds, $outletContext);
    }

    /**
     * @param  list<array{employee_id:int, work_date:string}>  $pairs
     * @param  list<int>|null  $outletScopeIds
     * @return array<string, array<string, mixed>>
     */
    public function projectPairs(int $tenantId, array $pairs, ?array $outletScopeIds = null, ?int $outletContext = null): array
    {
        return $this->reader->projectPairs($tenantId, $pairs, $outletScopeIds, $outletContext);
    }

    /** @return list<array<string, mixed>> */
    public function range(int $tenantId, int $employeeId, string $from, string $to): array
    {
        return $this->reader->range($tenantId, $employeeId, $from, $to);
    }
}
