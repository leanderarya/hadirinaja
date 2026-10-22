<?php

namespace Tests\Feature\S1;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class OrganizationIdentityTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_tenant_can_have_multiple_business_units_and_outlets_with_duplicate_names_in_another_tenant(): void
    {
        [, $tenantA, $ownerA] = $this->tenantWithOwner('Owner A');
        [, $tenantB, $ownerB] = $this->tenantWithOwner('Owner B');
        $organization = app(OrganizationService::class);

        $unitA = $organization->createBusinessUnit($ownerA, 'Coffee');
        $organization->createOutlet($ownerA, $unitA, 'South');
        $organization->createOutlet($ownerA, $unitA, 'North');
        $unitA2 = $organization->createBusinessUnit($ownerA, 'Retail');
        $organization->createOutlet($ownerA, $unitA2, 'Market');
        $unitB = $organization->createBusinessUnit($ownerB, 'Coffee');

        $this->assertSame(2, $tenantA->businessUnits()->count());
        $this->assertSame(2, $unitA->outlets()->count());
        $this->assertSame(1, $tenantB->businessUnits()->count());
        $this->assertSame('Coffee', $unitB->name);

        try {
            $organization->createOutlet($ownerA, $unitB, 'Invalid');
            $this->fail('A tenant must not use another tenant Business Unit.');
        } catch (ValidationException) {
            $this->assertTrue(true);
        }
    }

    public function test_employee_can_exist_without_a_user_and_user_memberships_are_explicit_per_tenant(): void
    {
        [$person, $tenantA, $ownerA] = $this->tenantWithOwner('Tenant A');
        [, $tenantB, $ownerB] = $this->tenantWithOwner('Tenant B');
        $membershipService = app(TenantMembershipService::class);
        $user = User::factory()->create();
        $membershipA = $membershipService->addMembership($ownerA, $user);
        $membershipB = $membershipService->addMembership($ownerB, $user);
        $membershipService->assignRole($ownerA, $membershipA, TenantRole::Employee);
        $employee = app(OrganizationService::class)->registerEmployee($ownerA, 'No account required');

        $this->assertSame($person->getKey(), $tenantA->memberships()->where('id', $ownerA->getKey())->value('user_id'));
        $this->assertSame(2, $user->memberships()->count());
        $this->assertSame($tenantA->getKey(), $membershipA->tenant_id);
        $this->assertSame($tenantB->getKey(), $membershipB->tenant_id);
        $this->assertTrue($membershipA->fresh()->hasRole(TenantRole::Employee));
        $this->assertFalse($membershipB->fresh()->hasRole(TenantRole::Employee));
        $this->assertSame(0, EmployeeUserLink::query()->where('employee_id', $employee->getKey())->count());
    }

    public function test_user_employee_linking_is_explicit_tenant_bound_and_one_to_one(): void
    {
        [, , $ownerA] = $this->tenantWithOwner('Tenant A');
        [, , $ownerB] = $this->tenantWithOwner('Tenant B');
        $organization = app(OrganizationService::class);
        $membershipService = app(TenantMembershipService::class);
        [$userA, $membershipA] = $this->membershipFor($ownerA, TenantRole::Employee);
        [$userB, $membershipB] = $this->membershipFor($ownerA, TenantRole::Employee);
        [, $foreignMembership] = $this->membershipFor($ownerB, TenantRole::Employee);
        $employeeA = $organization->registerEmployee($ownerA, 'Employee A');
        $employeeB = $organization->registerEmployee($ownerA, 'Employee B');
        $foreignEmployee = $organization->registerEmployee($ownerB, 'Foreign Employee');

        $link = $membershipService->linkEmployee($ownerA, $membershipA, $employeeA);

        $this->assertSame($membershipA->getKey(), $link->tenant_membership_id);
        $this->assertSame($employeeA->getKey(), $link->employee_id);
        $this->assertSame($userA->getKey(), $link->membership->user_id);

        foreach ([
            fn () => $membershipService->linkEmployee($ownerA, $membershipA, $employeeB),
            fn () => $membershipService->linkEmployee($ownerA, $membershipB, $employeeA),
            fn () => $membershipService->linkEmployee($ownerA, $foreignMembership, $employeeA),
            fn () => $membershipService->linkEmployee($ownerA, $membershipA, $foreignEmployee),
        ] as $conflictingLink) {
            try {
                $conflictingLink();
                $this->fail('A conflicting or cross-tenant employee link must be rejected.');
            } catch (ValidationException) {
                $this->assertTrue(true);
            }
        }

        $this->assertSame(1, EmployeeUserLink::query()->where('employee_id', $employeeA->getKey())->count());
        $this->assertNotSame($userB->getKey(), $link->membership->user_id);
    }

    public function test_database_rejects_cross_tenant_organization_identity_and_assignment_links(): void
    {
        [, , $ownerA] = $this->tenantWithOwner('Tenant A');
        [, , $ownerB] = $this->tenantWithOwner('Tenant B');
        [, $unitA, $outletA] = [$ownerA->tenant, ...$this->unitWithOutlet($ownerA, 'A', 'A outlet')];
        [, $unitB, $outletB] = [$ownerB->tenant, ...$this->unitWithOutlet($ownerB, 'B', 'B outlet')];
        $membershipService = app(TenantMembershipService::class);
        [, $memberA] = $this->membershipFor($ownerA, TenantRole::Supervisor);
        [, $memberB] = $this->membershipFor($ownerB, TenantRole::Employee);
        $employeeA = app(OrganizationService::class)->registerEmployee($ownerA, 'A employee');
        $employeeB = app(OrganizationService::class)->registerEmployee($ownerB, 'B employee');
        $now = now();

        $this->assertSame($ownerA->tenant_id, $employeeA->tenant_id);
        $this->assertSame($ownerB->tenant_id, $outletB->tenant_id);
        $this->assertNotSame($employeeA->tenant_id, $outletB->tenant_id);
        $this->assertSame(0, DB::table('outlets')
            ->where('tenant_id', $ownerA->tenant_id)->where('id', $outletB->getKey())->count());

        $this->assertConstraintRejects(fn () => DB::table('employee_outlet_assignments')->insert([
            'tenant_id' => $ownerA->tenant_id,
            'employee_id' => $employeeA->getKey(),
            'outlet_id' => $outletB->getKey(),
            'assignment_type' => 'primary',
            'effective_from' => $now,
            'effective_until' => '9999-12-31 23:59:59',
            'created_at' => $now,
            'updated_at' => $now,
        ]));
        $this->assertConstraintRejects(fn () => DB::table('outlets')->insert([
            'tenant_id' => $ownerA->tenant_id,
            'business_unit_id' => $unitB->getKey(),
            'name' => 'Cross tenant outlet',
            'created_at' => $now,
            'updated_at' => $now,
        ]));
        $this->assertConstraintRejects(fn () => TenantRoleAssignment::query()->create([
            'tenant_id' => $ownerA->tenant_id,
            'tenant_membership_id' => $memberB->getKey(),
            'role' => TenantRole::Supervisor->value,
        ]));
        $this->assertConstraintRejects(fn () => DB::table('supervisor_outlet_scopes')->insert([
            'tenant_id' => $ownerA->tenant_id,
            'tenant_membership_id' => $memberA->getKey(),
            'outlet_id' => $outletB->getKey(),
            'created_at' => $now,
            'updated_at' => $now,
        ]));
        $this->assertConstraintRejects(fn () => DB::table('employee_user_links')->insert([
            'tenant_id' => $ownerA->tenant_id,
            'tenant_membership_id' => $ownerA->getKey(),
            'employee_id' => $employeeB->getKey(),
            'created_at' => $now,
            'updated_at' => $now,
        ]));
        $this->assertSame($unitA->getKey(), $outletA->business_unit_id);
        $this->assertNotSame($employeeA->getKey(), $employeeB->getKey());
    }

    public function test_user_email_and_phone_are_normalized_before_unique_storage(): void
    {
        $user = User::factory()->create([
            'email' => '  Person@Example.COM ',
            'phone' => ' +62 (812) 3456-7890 ',
        ]);

        $this->assertSame('person@example.com', $user->email);
        $this->assertSame('+6281234567890', $user->phone);
        $this->assertDatabaseHas('users', ['id' => $user->getKey(), 'phone' => '+6281234567890']);

        $this->expectException(QueryException::class);
        User::factory()->create(['phone' => '+6281234567890']);
    }

    public function test_organization_deletion_is_restricted_when_it_would_destroy_employee_history(): void
    {
        [, $tenant, $owner] = $this->tenantWithOwner();
        app(OrganizationService::class)->registerEmployee($owner, 'Retained employee');

        $this->expectException(QueryException::class);
        $tenant->delete();
    }

    private function assertConstraintRejects(callable $operation): void
    {
        try {
            $operation();
            $this->fail('MySQL must reject this cross-tenant relationship.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
    }
}
