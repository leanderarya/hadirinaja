<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\ManagementChangeEvent;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AttendancePolicyService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantAccessService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class AccessManagementTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_owner_invites_and_activates_a_new_employee_once_without_storing_the_token(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Employee access tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan Undangan');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $this->loginAs($ownerUser);

        $usersBefore = User::query()->count();
        $issued = $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'new.employee@example.test', 'role' => 'employee', 'employee_id' => $employee->getKey(),
        ])->assertCreated();
        $token = $issued->json('activation_token');
        $invitationId = (int) $issued->json('invitation.id');

        $this->assertIsString($token);
        $this->assertSame(64, strlen($token));
        $this->assertSame(hash('sha256', $token), DB::table('tenant_access_invitations')->where('id', $invitationId)->value('token_digest'));
        $this->assertNotSame($token, DB::table('tenant_access_invitations')->where('id', $invitationId)->value('token_digest'));
        $this->browserRequest()->getJson('/api/v1/management/access')
            ->assertOk()->assertJsonPath('invitations.0.status', 'pending')
            ->assertJsonPath('employees.0.access_status', 'pending')
            ->assertJsonMissingPath('invitations.0.activation_token')
            ->assertJsonMissingPath('invitations.0.token_digest');

        $this->browserRequest()->postJson('/api/v1/invitations/activate', [
            'token' => $token,
            'name' => 'Rina Karyawan',
            'password' => 'SecurePassword123!',
            'password_confirmation' => 'SecurePassword123!',
        ])->assertCreated()->assertJsonPath('activated', true);

        $this->browserRequest()->getJson('/api/v1/management/access')
            ->assertOk()->assertJsonPath('employees.0.access_status', 'active');

        $user = User::query()->where('email', 'new.employee@example.test')->firstOrFail();
        $membership = TenantMembership::query()->forTenant((int) $owner->tenant_id)->where('user_id', $user->getKey())->firstOrFail();
        $this->assertTrue(Hash::check('SecurePassword123!', $user->password));
        $this->assertTrue($membership->hasRole(TenantRole::Employee));
        $this->assertSame($employee->getKey(), EmployeeUserLink::query()->forTenant((int) $owner->tenant_id)->where('tenant_membership_id', $membership->getKey())->value('employee_id'));
        $this->assertSame($usersBefore + 1, User::query()->count());
        $this->assertSame(1, $employee->assignments()->count());

        $this->browserRequest()->postJson('/api/v1/invitations/activate', [
            'token' => $token, 'name' => 'Duplicate', 'password' => 'SecurePassword123!', 'password_confirmation' => 'SecurePassword123!',
        ])->assertStatus(410);
        $this->assertSame($usersBefore + 1, User::query()->count());

        $audit = ManagementChangeEvent::query()->where('subject_type', 'access_invitation')->get()->toJson();
        $this->assertStringNotContainsString($token, $audit);
        $this->assertStringNotContainsString(hash('sha256', $token), $audit);
    }

    public function test_existing_user_must_authenticate_as_the_intended_identity_and_supervisor_scope_is_live(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Inviting tenant');
        [, $outletA] = $this->unitWithOutlet($owner, 'Ops', 'North');
        [, $outletB] = $this->unitWithOutlet($owner, 'Ops', 'South');
        [, , $foreignOwner] = $this->tenantWithOwner('Existing user tenant');
        [$wrongUser] = $this->membershipFor($foreignOwner, TenantRole::Employee);
        $this->loginAs($ownerUser);

        $issued = $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => $wrongUser->email, 'role' => 'supervisor', 'outlet_ids' => [$outletA->getKey(), $outletB->getKey()],
        ])->assertCreated();
        $rawToken = $issued->json('activation_token');
        $this->assertNotNull($rawToken);
        $this->assertArrayNotHasKey('activation_token', $this->browserRequest()->getJson('/api/v1/management/access')->assertOk()->json('invitations.0'));

        [$unrelatedUser] = $this->tenantWithOwner('Unrelated account tenant');
        $this->loginAs($unrelatedUser);
        $this->browserRequest()->postJson('/api/v1/invitations/accept', ['token' => $rawToken])->assertForbidden();
        $this->assertDatabaseMissing('tenant_memberships', ['tenant_id' => $owner->tenant_id, 'user_id' => $wrongUser->getKey()]);

        $this->loginAs($wrongUser);
        $accepted = $this->browserRequest()->postJson('/api/v1/invitations/accept', ['token' => $rawToken])->assertOk();
        $this->assertSame('Inviting tenant', $accepted->json('tenant_name'));
        $membership = TenantMembership::query()->forTenant((int) $owner->tenant_id)->where('user_id', $wrongUser->getKey())->firstOrFail();
        $this->assertTrue($membership->hasRole(TenantRole::Supervisor));
        $this->assertSame([$outletA->getKey(), $outletB->getKey()], $membership->supervisorScopes()->orderBy('outlet_id')->pluck('outlet_id')->all());
        $supervisorEmployee = app(OrganizationService::class)->registerEmployee($owner, 'Supervisor as employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $supervisorEmployee, $outletA, now()->subDay());
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $supervisorEmployee);

        app(OrganizationService::class)->createOutlet($owner, $outletA->businessUnit, 'New outlet excluded');
        $this->loginAs($wrongUser);
        $selection = $this->browserRequest()->postJson('/api/v1/auth/tenant', ['membership_id' => $membership->getKey()])->assertOk();
        $supervisorCookie = $selection->getCookie(config('session.cookie'))?->getValue();
        $this->assertNotNull($supervisorCookie);
        $this->withCookie(config('session.cookie'), $supervisorCookie);
        Auth::forgetGuards();
        $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'not-owner@example.test', 'role' => 'supervisor', 'outlet_ids' => [$outletA->getKey()],
        ])->assertForbidden();
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk()->assertJsonCount(2, 'outlets');

        app(TenantAccessService::class)->replaceSupervisorScope($owner, (int) $membership->getKey(), [(int) $outletB->getKey()]);
        $this->withCookie(config('session.cookie'), $supervisorCookie);
        Auth::forgetGuards();
        $this->browserRequest()->getJson('/api/v1/management/organization')
            ->assertOk()->assertJsonCount(1, 'outlets')->assertJsonPath('outlets.0.id', $outletB->getKey());
        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('employee.name', 'Supervisor as employee');

        app(TenantAccessService::class)->setMemberActive($owner, (int) $membership->getKey(), false);
        $this->withCookie(config('session.cookie'), $supervisorCookie);
        Auth::forgetGuards();
        $this->browserRequest()->getJson('/api/v1/management/organization')->assertStatus(409);
        $this->assertDatabaseHas('tenant_memberships', ['id' => $membership->getKey(), 'is_active' => 0, 'revoked_at' => null]);
        $this->assertDatabaseHas('tenant_memberships', ['tenant_id' => $foreignOwner->tenant_id, 'user_id' => $wrongUser->getKey(), 'is_active' => 1]);
    }

    public function test_existing_user_without_a_tenant_membership_can_authenticate_only_with_the_invitation(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('First membership tenant');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Existing global user target');
        $existingUser = User::factory()->create(['email' => 'existing.global@example.test']);
        $otherUser = User::factory()->create(['email' => 'wrong.global@example.test']);
        $this->loginAs($ownerUser);

        $issued = $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => $existingUser->email, 'role' => 'employee', 'employee_id' => $employee->getKey(),
        ])->assertCreated();
        $token = $issued->json('activation_token');

        $this->browserRequest()->postJson('/api/v1/invitations/login', [
            'token' => $token, 'identifier' => $otherUser->email, 'password' => 'password',
        ])->assertUnauthorized();
        $authentication = $this->browserRequest()->postJson('/api/v1/invitations/login', [
            'token' => $token, 'identifier' => $existingUser->email, 'password' => 'password',
        ])->assertOk()->assertJsonPath('authenticated_for_invitation', true);
        $cookie = $authentication->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
        $this->browserRequest()->postJson('/api/v1/invitations/accept', ['token' => $token])->assertOk();

        $this->assertDatabaseHas('tenant_memberships', [
            'tenant_id' => $owner->tenant_id, 'user_id' => $existingUser->getKey(), 'is_active' => 1,
        ]);
        $this->assertDatabaseMissing('tenant_memberships', ['user_id' => $otherUser->getKey(), 'tenant_id' => $owner->tenant_id]);
    }

    public function test_duplicate_cross_tenant_cancelled_expired_and_reissued_invitations_are_safe(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Invitation lifecycle tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign outlet tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $this->loginAs($ownerUser);

        $payload = ['email' => 'supervisor@example.test', 'role' => 'supervisor', 'outlet_ids' => [$outlet->getKey()]];
        $first = $this->browserRequest()->postJson('/api/v1/management/access/invitations', $payload)->assertCreated();
        $invitationId = (int) $first->json('invitation.id');
        $this->browserRequest()->postJson('/api/v1/management/access/invitations', $payload)->assertUnprocessable();
        $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            ...$payload, 'email' => 'foreign@example.test', 'outlet_ids' => [$foreignOutlet->getKey()],
        ])->assertUnprocessable();
        $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'owner-role@example.test', 'role' => 'owner', 'outlet_ids' => [$outlet->getKey()],
        ])->assertUnprocessable();
        $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'invalid-employee@example.test', 'role' => 'employee', 'employee_id' => 999999,
        ])->assertUnprocessable();

        $oldToken = $first->json('activation_token');
        $this->browserRequest()->postJson('/api/v1/management/access/invitations/'.$invitationId.'/cancel')->assertOk();
        $this->browserRequest()->postJson('/api/v1/invitations/activate', [
            'token' => $oldToken, 'name' => 'Cannot join', 'password' => 'SecurePassword123!', 'password_confirmation' => 'SecurePassword123!',
        ])->assertStatus(410);
        $this->assertDatabaseMissing('users', ['email' => 'supervisor@example.test']);

        $issued = $this->browserRequest()->postJson('/api/v1/management/access/invitations', [
            'email' => 'reissue@example.test', 'role' => 'supervisor', 'outlet_ids' => [$outlet->getKey()],
        ])->assertCreated();
        $reissuable = TenantAccessInvitation::query()->where('invitee_email', 'reissue@example.test')->firstOrFail();
        $expiredToken = $issued->json('activation_token');
        CarbonImmutable::setTestNow(CarbonImmutable::parse($reissuable->expires_at)->addMinute());
        $this->browserRequest()->postJson('/api/v1/invitations/inspect', ['token' => $expiredToken])
            ->assertOk()->assertJsonPath('status', 'expired');
        $reissued = $this->browserRequest()->postJson('/api/v1/management/access/invitations/'.$reissuable->getKey().'/reissue')->assertOk();
        $newToken = $reissued->json('activation_token');
        $this->assertNotSame($expiredToken, $newToken);
        $this->assertSame(hash('sha256', $newToken), $reissuable->fresh()->token_digest);
        $this->browserRequest()->postJson('/api/v1/invitations/inspect', ['token' => $expiredToken])->assertNotFound();
        $this->browserRequest()->postJson('/api/v1/invitations/inspect', ['token' => $newToken])->assertOk()->assertJsonPath('status', 'pending');
    }

    public function test_owner_can_link_their_own_employee_identity_without_losing_management_access(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Owner employee tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Owner as employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        app(AttendancePolicyService::class)->createOutletVersion($owner, $outlet, now()->toDateString(), [
            'attendance_mode' => 'hybrid',
            'personal_location_validation' => ['required' => false, 'radius_meters' => 100, 'latitude' => -6.2, 'longitude' => 106.816666],
        ], 'Owner employee identity test');
        $this->loginAs($ownerUser);

        $this->browserRequest()->postJson('/api/v1/management/access/members/'.$owner->getKey().'/employee-link', [
            'employee_id' => $employee->getKey(),
        ])->assertOk();
        $this->assertTrue($owner->fresh()->hasRole(TenantRole::Owner));
        $this->assertTrue($owner->fresh()->hasRole(TenantRole::Employee));
        $this->assertSame($employee->getKey(), EmployeeUserLink::query()->where('tenant_membership_id', $owner->getKey())->value('employee_id'));
        $this->browserRequest()->getJson('/api/v1/management/access')->assertOk();
        $this->browserRequest()->getJson('/api/v1/attendance/me')->assertOk()->assertJsonPath('employee.name', 'Owner as employee');
        $this->browserRequest()->patchJson('/api/v1/management/access/members/'.$owner->getKey(), ['is_active' => false])->assertUnprocessable();
        $this->browserRequest()->deleteJson('/api/v1/management/access/members/'.$owner->getKey())->assertUnprocessable();
    }

    public function test_revocation_removes_only_tenant_privileges_and_preserves_global_and_employee_records(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Revocation tenant');
        [, , $otherOwner] = $this->tenantWithOwner('Other tenant');
        [$memberUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $otherMembership = app(TenantMembershipService::class)->addMembership($otherOwner, $memberUser);
        app(TenantMembershipService::class)->assignRole($otherOwner, $otherMembership, TenantRole::Employee);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Employee history stays');
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        $this->loginAs($ownerUser);

        $this->browserRequest()->deleteJson('/api/v1/management/access/members/'.$membership->getKey())->assertOk();

        $this->assertDatabaseHas('tenant_memberships', [
            'id' => $membership->getKey(), 'tenant_id' => $owner->tenant_id, 'user_id' => $memberUser->getKey(), 'is_active' => 0,
        ]);
        $this->assertNotNull($membership->fresh()->revoked_at);
        $this->assertDatabaseHas('tenant_memberships', [
            'id' => $otherMembership->getKey(), 'tenant_id' => $otherOwner->tenant_id, 'user_id' => $memberUser->getKey(), 'is_active' => 1,
        ]);
        $this->assertDatabaseHas('users', ['id' => $memberUser->getKey(), 'email' => $memberUser->email]);
        $this->assertDatabaseHas('employees', ['id' => $employee->getKey(), 'tenant_id' => $owner->tenant_id]);
        $this->assertDatabaseMissing('employee_user_links', ['tenant_id' => $owner->tenant_id, 'tenant_membership_id' => $membership->getKey()]);
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $owner->tenant_id, 'subject_type' => 'membership', 'subject_id' => $membership->getKey(), 'action' => 'revoked',
        ]);
    }

    private function loginAs(User $user): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }
}
