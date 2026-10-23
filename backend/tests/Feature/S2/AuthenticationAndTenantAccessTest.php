<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class AuthenticationAndTenantAccessTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_email_and_phone_login_create_a_session_and_invalid_credentials_are_generic(): void
    {
        [$emailUser, , $emailMembership] = $this->tenantWithOwner('Email tenant');
        $csrf = $this->browserRequest()->get('/sanctum/csrf-cookie');
        $oldSessionId = $csrf->getCookie(config('session.cookie'))?->getValue();
        $this->captureSessionCookie($csrf);
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => strtoupper($emailUser->email),
            'password' => 'password',
        ])->assertOk()->assertJsonPath('active_membership.id', $emailMembership->getKey());
        $newSessionId = $login->getCookie(config('session.cookie'))?->getValue();
        $this->assertNotSame($oldSessionId, $newSessionId, 'Login must regenerate the session identifier.');
        $this->captureSessionCookie($login);
        $this->assertAuthenticatedAs($emailUser, 'web');
        $login->assertSessionHas('active_membership_id', $emailMembership->getKey());

        $phoneUser = User::factory()->create(['phone' => '+6281234567890']);
        app(OrganizationService::class)->createTenant($phoneUser, 'Phone tenant');
        $phoneLogin = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => '+62 (812) 3456-7890',
            'password' => 'password',
        ])->assertOk()->assertJsonPath('user.id', $phoneUser->getKey());
        $this->captureSessionCookie($phoneLogin);
        $this->assertAuthenticatedAs($phoneUser, 'web');

        $wrongPassword = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $emailUser->email,
            'password' => 'wrong-password',
        ])->assertUnauthorized();
        $unknownAccount = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => 'unknown@example.test',
            'password' => 'wrong-password',
        ])->assertUnauthorized();

        $this->assertSame($wrongPassword->json(), $unknownAccount->json());
        $this->assertSame('Email/nomor telepon atau kata sandi tidak valid.', $wrongPassword->json('message'));
    }

    public function test_logout_invalidates_the_session_and_login_is_rate_limited(): void
    {
        [$user] = $this->tenantWithOwner('Logout tenant');
        $this->loginAs($user);

        $logout = $this->browserRequest()->postJson('/api/v1/auth/logout')->assertOk()->assertJson(['logged_out' => true]);
        $this->captureSessionCookie($logout);
        $this->assertGuest('web');
        $this->browserRequest()->getJson('/api/v1/auth/me')->assertUnauthorized();

        foreach (range(1, 5) as $_) {
            $this->browserRequest()->postJson('/api/v1/auth/login', [
                'identifier' => 'throttle@example.test',
                'password' => 'wrong-password',
            ])->assertUnauthorized();
        }

        $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => 'throttle@example.test',
            'password' => 'wrong-password',
        ])->assertTooManyRequests();
    }

    public function test_membership_selection_is_user_bound_and_switching_tenant_scopes_results(): void
    {
        [$user, $tenantA, $ownerA] = $this->tenantWithOwner('Tenant A');
        [$unitA] = $this->unitWithOutlet($ownerA, 'A unit', 'A outlet');
        [, $tenantB, $ownerB] = $this->tenantWithOwner('Tenant B');
        [$unitB, $outletB] = $this->unitWithOutlet($ownerB, 'B unit', 'B outlet');
        $memberships = app(TenantMembershipService::class);
        $membershipB = $memberships->addMembership($ownerB, $user);
        $memberships->assignRole($ownerB, $membershipB, TenantRole::Supervisor);
        $memberships->assignSupervisorOutletScope($ownerB, $membershipB, $outletB);

        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk()->assertJsonPath('active_membership', null);
        $this->captureSessionCookie($login);

        $selectedA = $this->browserRequest()->postJson('/api/v1/auth/tenant', ['membership_id' => $ownerA->getKey()])->assertOk();
        $this->captureSessionCookie($selectedA);
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk()
            ->assertJsonPath('tenant.id', $tenantA->getKey())
            ->assertJsonPath('business_units.0.id', $unitA->getKey())
            ->assertJsonMissing(['name' => 'B unit']);
        $this->browserRequest()->postJson('/api/v1/management/business-units', [
            'name' => 'A only unit',
            'tenant_id' => $tenantB->getKey(),
        ])->assertCreated();
        $this->assertDatabaseHas('business_units', [
            'tenant_id' => $tenantA->getKey(),
            'name' => 'A only unit',
        ]);

        $selectedB = $this->browserRequest()->postJson('/api/v1/auth/tenant', ['membership_id' => $membershipB->getKey()])->assertOk();
        $this->captureSessionCookie($selectedB);
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk()
            ->assertJsonPath('tenant.id', $tenantB->getKey())
            ->assertJsonPath('business_units.0.id', $unitB->getKey())
            ->assertJsonMissing(['name' => 'A unit']);

        $foreignUser = User::factory()->create();
        $foreignMembership = app(TenantMembershipService::class)->addMembership($ownerB, $foreignUser);
        $this->browserRequest()->postJson('/api/v1/auth/tenant', ['membership_id' => $foreignMembership->getKey()])->assertNotFound();

        $membershipB->forceFill(['is_active' => false])->save();
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertStatus(409);
    }

    public function test_owner_can_view_a_business_unit_before_its_first_outlet_exists(): void
    {
        [$user, , $owner] = $this->tenantWithOwner('Empty business unit tenant');
        $unit = app(OrganizationService::class)->createBusinessUnit($owner, 'New unit');

        $this->loginAs($user);
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk()
            ->assertJsonPath('business_units.0.id', $unit->getKey())
            ->assertJsonCount(0, 'outlets');
    }

    public function test_supervisor_and_employee_access_stays_with_explicit_outlet_and_identity_scope(): void
    {
        [, , $owner] = $this->tenantWithOwner('Scoped tenant');
        [, $outletA] = $this->unitWithOutlet($owner, 'Operations A', 'Outlet A');
        [, $outletB] = $this->unitWithOutlet($owner, 'Operations B', 'Outlet B');
        $organization = app(OrganizationService::class);
        $assignments = app(EmployeeOutletAssignmentService::class);
        $employeeA = $organization->registerEmployee($owner, 'Employee A');
        $employeeB = $organization->registerEmployee($owner, 'Employee B');
        $assignments->assignPrimaryOutlet($owner, $employeeA, $outletA, now()->subDay());
        $assignments->assignPrimaryOutlet($owner, $employeeB, $outletB, now()->subDay());

        [$supervisor, $supervisorMembership] = $this->membershipFor($owner, TenantRole::Supervisor);
        $membershipService = app(TenantMembershipService::class);
        $membershipService->assignSupervisorOutletScope($owner, $supervisorMembership, $outletA);
        $this->loginAs($supervisor);
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk()
            ->assertJsonCount(1, 'outlets')->assertJsonCount(1, 'business_units')
            ->assertJsonPath('employee_count', 1);
        $this->browserRequest()->getJson('/api/v1/management/employees')->assertOk()
            ->assertJsonCount(1, 'employees')->assertJsonPath('employees.0.id', $employeeA->getKey());
        $this->browserRequest()->getJson('/api/v1/management/employees/'.$employeeB->getKey())->assertNotFound();
        $this->browserRequest()->postJson('/api/v1/management/business-units', ['name' => 'Forbidden'])
            ->assertForbidden();

        [$employeeUser, $employeeMembership] = $this->membershipFor($owner, TenantRole::Employee);
        $membershipService->linkEmployee($owner, $employeeMembership, $employeeA);
        $this->loginAs($employeeUser);
        $this->browserRequest()->getJson('/api/v1/management/employees')->assertOk()
            ->assertJsonCount(1, 'employees')->assertJsonPath('employees.0.id', $employeeA->getKey());
        $this->browserRequest()->getJson('/api/v1/management/employees/'.$employeeB->getKey())->assertNotFound();
        $this->browserRequest()->postJson('/api/v1/management/business-units', ['name' => 'Forbidden'])
            ->assertForbidden();
    }

    public function test_unlinked_employee_assignment_does_not_grant_employee_management_access(): void
    {
        [, , $owner] = $this->tenantWithOwner('No implicit access');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Unlinked employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$user] = $this->membershipFor($owner, TenantRole::Employee);

        $this->loginAs($user);
        $this->browserRequest()->getJson('/api/v1/management/employees')->assertOk()->assertJsonCount(0, 'employees');
    }

    private function loginAs(User $user): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $this->captureSessionCookie($response);
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }

    private function captureSessionCookie(TestResponse $response): void
    {
        $sessionCookie = $response->getCookie(config('session.cookie'));

        if ($sessionCookie !== null) {
            $this->withCookie(config('session.cookie'), $sessionCookie->getValue());
        }

        Auth::forgetGuards();
    }
}
