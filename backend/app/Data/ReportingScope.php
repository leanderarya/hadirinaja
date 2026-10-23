<?php

namespace App\Data;

use App\Models\TenantMembership;

final readonly class ReportingScope
{
    /**
     * @param  list<int>  $outletIds
     * @param  list<int>  $businessUnitIds
     * @param  list<array{id:int,name:string,business_unit_id:int,business_unit_name:string}>  $outlets
     * @param  list<array{id:int,name:string}>  $businessUnits
     */
    public function __construct(
        public TenantMembership $membership,
        public int $tenantId,
        public int $userId,
        public bool $owner,
        public array $outletIds,
        public array $businessUnitIds,
        public array $outlets,
        public array $businessUnits,
    ) {}
}
