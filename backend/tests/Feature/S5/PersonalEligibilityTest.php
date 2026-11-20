<?php

namespace Tests\Feature\S5;

use App\Enums\TenantRole;
use App\Models\User;
use App\Services\AttendancePolicyService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class PersonalEligibilityTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_missing_employee_link_is_reported_without_exposing_another_tenant_request(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Personal eligibility tenant');
        [$foreignOwnerUser, , $foreignOwner] = $this->tenantWithOwner('Foreign request tenant');
        $foreignEmployee = app(OrganizationService::class)->registerEmployee($foreignOwner, 'Synthetic employee');
        app(TenantMembershipService::class)->linkEmployee($foreignOwner, $foreignOwner, $foreignEmployee);

        $this->loginAs($foreignOwnerUser);
        $foreignRequest = $this->browserRequest()
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => CarbonImmutable::today('Asia/Jakarta')->toDateString(),
                'ends_on' => CarbonImmutable::today('Asia/Jakarta')->toDateString(),
                'reason' => 'Permintaan sintetis untuk uji isolasi tenant.',
            ])->assertCreated();

        $this->loginAs($ownerUser);
        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('eligibility.status', 'employee_link_required')
            ->assertJsonPath('employee', null);
        $this->browserRequest()->getJson('/api/v1/attendance/me/requests')
            ->assertOk()->assertJsonPath('request_access.status', 'employee_link_required')
            ->assertJsonPath('request_access.can_submit', false)
            ->assertJsonMissingPath('requests.0');
        $today = CarbonImmutable::today('Asia/Jakarta')->toDateString();
        $this->browserRequest()->getJson("/api/v1/attendance/me/effective?from={$today}&to={$today}")
            ->assertForbidden()->assertJsonPath('code', 'employee_link_required');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => CarbonImmutable::today('Asia/Jakarta')->toDateString(),
                'ends_on' => CarbonImmutable::today('Asia/Jakarta')->toDateString(),
                'reason' => 'Permintaan tanpa identitas tertaut.',
            ])->assertForbidden();

        $this->assertDatabaseHas('approval_requests', [
            'id' => $foreignRequest->json('request.id'),
            'tenant_id' => $foreignOwner->tenant_id,
        ]);
        $this->assertDatabaseMissing('approval_requests', [
            'id' => $foreignRequest->json('request.id'),
            'tenant_id' => $owner->tenant_id,
        ]);
    }

    public function test_linked_owner_keeps_management_access_and_can_request_without_assignment_or_schedule(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Owner employee tenant');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Synthetic owner employee');
        app(TenantMembershipService::class)->linkEmployee($owner, $owner, $employee);
        $this->loginAs($ownerUser);

        $this->browserRequest()->getJson('/api/v1/management/organization')->assertOk();
        $this->assertTrue($owner->fresh()->hasRole(TenantRole::Owner));
        $this->assertTrue($owner->fresh()->hasRole(TenantRole::Employee));
        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('employee.name', 'Synthetic owner employee')
            ->assertJsonPath('eligibility.status', 'assignment_unavailable')
            ->assertJsonPath('allowed_next_operation', null);
        $this->browserRequest()->getJson('/api/v1/attendance/me/requests')
            ->assertOk()->assertJsonPath('request_access.status', 'available')
            ->assertJsonPath('request_access.can_submit', true);

        $date = CarbonImmutable::today('Asia/Jakarta')->addDay()->toDateString();
        $request = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => $date,
                'ends_on' => $date,
                'reason' => 'Permintaan tanpa jadwal hari ini.',
            ])->assertCreated();

        $this->assertDatabaseHas('approval_requests', [
            'id' => $request->json('request.id'),
            'employee_id' => $employee->getKey(),
            'outlet_id' => null,
        ]);
    }

    public function test_kiosk_only_policy_restricts_personal_attendance_without_blocking_requests(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Kiosk-only employee tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Synthetic kiosk employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $owner, $employee, $outlet, now()->subDay(),
        );
        app(TenantMembershipService::class)->linkEmployee($owner, $owner, $employee);
        $today = CarbonImmutable::today('UTC')->toDateString();
        app(AttendancePolicyService::class)->createOutletVersion(
            $owner, $outlet, $today, ['attendance_mode' => 'kiosk'], 'Synthetic kiosk-only policy.',
        );
        $this->loginAs($ownerUser);

        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('eligibility.status', 'kiosk_only')
            ->assertJsonPath('allowed_next_operation', null);
        $this->browserRequest()->getJson('/api/v1/attendance/me/requests')
            ->assertOk()->assertJsonPath('request_access.status', 'available')
            ->assertJsonPath('request_access.can_submit', true);
    }

    public function test_request_validation_failure_returns_field_errors_without_creating_a_request(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Request validation tenant');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Synthetic validation employee');
        $employeeUser = User::factory()->create();
        $membership = app(TenantMembershipService::class)->addMembership($owner, $employeeUser);
        app(TenantMembershipService::class)->assignRole($owner, $membership, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        $this->loginAs($employeeUser);

        $this->browserRequest()->getJson('/api/v1/attendance/me/requests')
            ->assertOk()->assertJsonPath('request_access.can_submit', true);
        $date = CarbonImmutable::today('Asia/Jakarta')->toDateString();
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => $date,
                'ends_on' => $date,
            ])->assertUnprocessable()->assertJsonValidationErrors(['reason']);

        $this->assertDatabaseCount('approval_requests', 0);
    }

    public function test_employee_link_does_not_grant_personal_attendance_without_employee_role(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Attendance role-required tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Synthetic linked employee');
        $employeeUser = User::factory()->create();
        $membership = app(TenantMembershipService::class)->addMembership($owner, $employeeUser);
        app(TenantMembershipService::class)->assignRole($owner, $membership, TenantRole::Owner);
        app(TenantMembershipService::class)->assignRole($owner, $membership, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(TenantMembershipService::class)->revokeRole($owner, $membership, TenantRole::Employee);
        $this->loginAs($employeeUser);

        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('eligibility.status', 'employee_role_required')
            ->assertJsonPath('employee', null);
        $this->browserRequest()->getJson('/api/v1/attendance/me/requests')
            ->assertOk()->assertJsonPath('request_access.status', 'employee_role_required')
            ->assertJsonPath('request_access.can_submit', false);
        $today = CarbonImmutable::today('Asia/Jakarta')->toDateString();
        $this->browserRequest()->getJson("/api/v1/attendance/me/effective?from={$today}&to={$today}")
            ->assertForbidden()->assertJsonPath('code', 'employee_role_required');
        $this->browserRequest()->postJson('/api/v1/attendance/me/check-in', [
            'outlet_id' => $outlet->getKey(),
        ])->assertForbidden()->assertJsonPath('code', 'employee_role_required');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/requests', [
                'type' => 'leave',
                'category' => 'permission',
                'starts_on' => $today,
                'ends_on' => $today,
                'reason' => 'Permintaan tanpa role karyawan.',
            ])->assertForbidden()->assertJsonPath('code', 'employee_role_required');

        $this->assertDatabaseCount('approval_requests', 0);
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $this->captureSessionCookie($login);
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
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }
}
