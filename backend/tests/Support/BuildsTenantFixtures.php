<?php

namespace Tests\Support;

use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\Outlet;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;

trait BuildsTenantFixtures
{
    /** @return array{User, Tenant, TenantMembership} */
    protected function tenantWithOwner(string $name = 'Test tenant'): array
    {
        $user = User::factory()->create();
        $tenant = app(OrganizationService::class)->createTenant($user, $name);

        return [$user, $tenant, $tenant->memberships()->firstOrFail()];
    }

    protected function membershipFor(TenantMembership $owner, ?TenantRole $role = null): array
    {
        $user = User::factory()->create();
        $service = app(TenantMembershipService::class);
        $membership = $service->addMembership($owner, $user);

        if ($role) {
            $service->assignRole($owner, $membership, $role);
        }

        return [$user, $membership];
    }

    /** @return array{BusinessUnit, Outlet} */
    protected function unitWithOutlet(TenantMembership $owner, string $unitName = 'Operations', string $outletName = 'Central'): array
    {
        $service = app(OrganizationService::class);
        $unit = $service->createBusinessUnit($owner, $unitName);

        return [$unit, $service->createOutlet($owner, $unit, $outletName)];
    }
}
