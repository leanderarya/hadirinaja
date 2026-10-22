<?php

namespace Tests\Feature\S1;

use App\Enums\TenantRole;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantAuthorization;
use App\Services\TenantMembershipService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class TenantAuthorizationTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_owner_and_supervisor_queries_are_limited_to_membership_and_explicit_outlet_scope(): void
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Tenant A');
        [, $foreignTenant, $foreignOwner] = $this->tenantWithOwner('Tenant B');
        [$unitA, $outletA] = $this->unitWithOutlet($owner, 'Coffee', 'South');
        [, $outletB] = $this->unitWithOutlet($owner, 'Retail', 'Market');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner, 'Coffee', 'Other tenant');
        [$supervisorUser, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisor, $outletA);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Worker');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outletA, now()->subDay());
        $authorization = app(TenantAuthorization::class);

        $this->assertSame([$outletA->getKey()], $authorization->outletsFor($supervisorUser, (int) $tenant->getKey())->modelKeys());
        $this->assertSame([$unitA->getKey()], $authorization->businessUnitsFor($supervisorUser, (int) $tenant->getKey())->modelKeys());
        $this->assertTrue($authorization->canManageOutlet($supervisor, $outletA));
        $this->assertFalse($authorization->canManageOutlet($supervisor, $outletB));
        $this->assertTrue($authorization->canManageEmployee($supervisor, $employee));
        $this->assertSame(2, $authorization->outletsFor($ownerUser, (int) $tenant->getKey())->count());

        $foreignEmployee = app(OrganizationService::class)->registerEmployee($foreignOwner, 'Foreign worker');
        $foreignOutlet->setAttribute('tenant_id', $tenant->getKey());
        $foreignEmployee->setAttribute('tenant_id', $tenant->getKey());
        $this->assertFalse($authorization->canManageOutlet($owner, $foreignOutlet));
        $this->assertFalse($authorization->canManageEmployee($owner, $foreignEmployee));

        $this->expectException(AuthorizationException::class);
        $authorization->outletsFor($ownerUser, (int) $foreignTenant->getKey());
    }

    public function test_employee_role_and_work_assignment_never_grant_management_or_another_employee_context(): void
    {
        [, $tenant, $owner] = $this->tenantWithOwner();
        [$unit, $outlet] = $this->unitWithOutlet($owner);
        $organization = app(OrganizationService::class);
        $membershipService = app(TenantMembershipService::class);
        $employee = $organization->registerEmployee($owner, 'Linked worker');
        $otherEmployee = $organization->registerEmployee($owner, 'Unlinked worker');
        $assignment = app(EmployeeOutletAssignmentService::class);
        $assignment->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $membershipService->linkEmployee($owner, $membership, $employee);
        $authorization = app(TenantAuthorization::class);

        $this->assertTrue($authorization->canAccessEmployee($user, (int) $tenant->getKey(), (int) $employee->getKey()));
        $this->assertFalse($authorization->canAccessEmployee($user, (int) $tenant->getKey(), (int) $otherEmployee->getKey()));
        $this->assertFalse($authorization->canManageOutlet($membership, $outlet));
        $this->assertSame([$outlet->getKey()], $authorization->outletsFor($user, (int) $tenant->getKey())->modelKeys());
        $this->assertSame([$employee->getKey()], $authorization->employeesFor($user, (int) $tenant->getKey())->pluck('id')->all());
        $this->assertSame($unit->getKey(), $outlet->business_unit_id);

        $this->expectException(AuthorizationException::class);
        $assignment->assignTemporaryOutlet($membership, $otherEmployee, $outlet, now(), now()->addDay());
    }

    public function test_membership_roles_do_not_carry_between_tenants_and_last_owner_cannot_be_removed(): void
    {
        [, , $ownerA] = $this->tenantWithOwner('Tenant A');
        [, , $ownerB] = $this->tenantWithOwner('Tenant B');
        [$user, $membershipA] = $this->membershipFor($ownerA);
        $membershipB = app(TenantMembershipService::class)->addMembership($ownerB, $user);
        $service = app(TenantMembershipService::class);
        $service->assignRole($ownerA, $membershipA, TenantRole::Supervisor);

        $this->assertTrue($membershipA->fresh()->hasRole(TenantRole::Supervisor));
        $this->assertFalse($membershipB->fresh()->hasRole(TenantRole::Supervisor));

        [$secondOwnerUser, $secondOwner] = $this->membershipFor($ownerA);
        $service->assignRole($ownerA, $secondOwner, TenantRole::Owner);
        $service->revokeRole($ownerA, $ownerA, TenantRole::Owner);

        try {
            $service->revokeRole($secondOwner, $secondOwner, TenantRole::Owner);
            $this->fail('The final active Owner role must be retained.');
        } catch (ValidationException) {
            $this->assertTrue(true);
        }

        $this->assertSame($secondOwnerUser->getKey(), $secondOwner->fresh()->user_id);
    }
}
