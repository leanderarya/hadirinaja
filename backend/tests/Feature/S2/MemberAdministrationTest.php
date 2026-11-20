<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\Employee;
use App\Models\ManagementChangeEvent;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantAccessService;
use App\Services\TenantMembershipService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class MemberAdministrationTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_direct_reactivation_replaces_roles_and_invalidates_invitation_preserving_global_identity(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$targetUser, $target] = $this->membershipFor($owner, TenantRole::Owner);
        $foreignTenant = app(OrganizationService::class)->createTenant($targetUser, 'Other');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Existing');
        $password = $targetUser->password;
        app(TenantAccessService::class)->revokeMember($owner, $target->id);
        $invitation = app(TenantAccessService::class)->createInvitation($owner, $targetUser->email, TenantRole::Employee, $employee->id, []);
        $this->login($user);
        $body = ['role' => 'employee', 'employee_id' => $employee->id, ...$this->confirmation()];
        $this->putJson($this->url($target->id, 'role'), $body)->assertUnprocessable()->assertJsonValidationErrors('reactivate');
        $this->putJson($this->url($target->id, 'role'), [...$body, 'reactivate' => true])->assertOk();
        $this->assertTrue($target->fresh()->is_active);
        $this->assertNull($target->fresh()->revoked_at);
        $this->assertSame(['employee'], $target->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
        $this->assertSame($employee->id, $target->employeeUserLink()->value('employee_id'));
        $this->assertSame($password, $targetUser->fresh()->password);
        $this->assertTrue($foreignTenant->memberships()->where('user_id', $targetUser->id)->firstOrFail()->is_active);
        $this->assertSame('revoked', $invitation['invitation']->fresh()->state());
        $audit = ManagementChangeEvent::where('action', 'role_changed')->sole();
        $this->assertSame('Approved correction', $audit->details['reason']);
        $this->assertSame(['employee'], $audit->details['after']['roles']);
        $this->assertStringNotContainsString('password', json_encode($audit->details));
        $this->login($targetUser);
        $this->postJson('/api/v1/auth/tenant', ['membership_id' => $target->id])->assertOk()->assertJsonPath('active_membership.roles.0', 'employee');
        $this->getJson('/api/v1/management/access')->assertForbidden();

    }

    public function test_owner_replacement_supervisor_scope_and_return_to_owner(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner, TenantRole::Owner);
        [, $outlet] = $this->unitWithOutlet($owner);
        $this->login($user);
        $this->putJson($this->url($target->id, 'role'), ['role' => 'supervisor', 'outlet_ids' => [$outlet->id], ...$this->confirmation()])->assertOk();
        $this->assertSame(['supervisor'], $target->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
        $this->assertSame([$outlet->id], $target->supervisorScopes()->pluck('outlet_id')->all());
        $this->putJson($this->url($target->id, 'role'), ['role' => 'owner', ...$this->confirmation()])->assertOk();
        $this->assertSame(0, $target->supervisorScopes()->count());
    }

    public function test_password_self_and_cross_tenant_guards(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner, TenantRole::Employee);
        [, , $foreign] = $this->tenantWithOwner('Foreign');
        $employee = app(OrganizationService::class)->registerEmployee($foreign, 'Foreign');
        $this->login($user);
        $body = ['role' => 'owner', ...$this->confirmation()];
        $this->putJson($this->url($target->id, 'role'), [...$body, 'password' => 'wrong'])->assertUnprocessable();
        $this->putJson($this->url($owner->id, 'role'), $body)->assertUnprocessable();
        $this->putJson($this->url($foreign->id, 'role'), $body)->assertNotFound();
        $this->putJson($this->url($target->id, 'role'), [...$body, 'role' => 'employee', 'employee_id' => $employee->id])->assertNotFound();
        $this->assertSame(['employee'], $target->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
        $this->assertSame(0, ManagementChangeEvent::where('action', 'role_changed')->count());
    }

    public function test_link_collision_and_non_owner_denial(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner, TenantRole::Owner);
        [$supervisorUser, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Linked');
        app(TenantMembershipService::class)->linkEmployee($owner, $supervisor, $employee);
        $this->login($user);
        $this->putJson($this->url($target->id, 'role'), ['role' => 'employee', 'employee_id' => $employee->id, ...$this->confirmation()])->assertUnprocessable();
        $this->assertSame(['owner'], $target->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
        $this->login($supervisorUser);
        $this->getJson($this->url($target->id))->assertForbidden();
        $this->putJson($this->url($target->id, 'role'), ['role' => 'owner', ...$this->confirmation()])->assertForbidden();
        $this->deleteJson($this->url($target->id), ['confirmation_email' => $target->user->email, ...$this->confirmation()])->assertForbidden();
    }

    public function test_delete_unused_membership_and_profile_preserves_global_user_and_audit(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$targetUser, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Unused');
        app(TenantMembershipService::class)->linkEmployee($owner, $target, $employee);
        $this->login($user);
        $this->getJson($this->url($target->id))->assertOk()->assertJsonPath('can_delete', true)->assertJsonPath('employee_id', $employee->id);
        $body = ['confirmation_email' => $targetUser->email, ...$this->confirmation()];
        $this->deleteJson($this->url($target->id), [...$body, 'confirmation_email' => 'wrong@example.test'])->assertUnprocessable();
        $this->deleteJson($this->url($target->id), $body)->assertOk()->assertJsonPath('global_login_preserved', true);
        $this->assertNull(TenantMembership::find($target->id));
        $this->assertNull(Employee::find($employee->id));
        $this->assertNotNull(User::find($targetUser->id));
        $event = ManagementChangeEvent::where('action', 'permanently_deleted')->sole();
        $this->assertSame($employee->id, $event->details['before']['deleted_employee']['id']);
        $this->assertSame($target->id, $event->subject_id);
    }

    public function test_history_added_after_preview_blocks_deletion(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$targetUser, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Audited');
        app(TenantMembershipService::class)->linkEmployee($owner, $target, $employee);
        $this->login($user);
        $this->getJson($this->url($target->id))->assertOk()->assertJsonPath('can_delete', true);
        $event = ManagementChangeEvent::create(['tenant_id' => $owner->tenant_id, 'actor_user_id' => $owner->user_id, 'actor_membership_id' => $owner->id, 'employee_id' => $employee->id, 'subject_type' => 'employee', 'subject_id' => $employee->id, 'action' => 'created', 'changed_fields' => ['name'], 'occurred_at' => now()]);
        $this->getJson($this->url($target->id))->assertOk()->assertJsonPath('can_delete', false);
        $this->deleteJson($this->url($target->id), ['confirmation_email' => $targetUser->email, ...$this->confirmation()])->assertUnprocessable()->assertJsonValidationErrors('history');
        $this->assertNotNull($employee->fresh());
        $this->assertNotNull($target->fresh());
        $this->assertNotNull($event->fresh());
    }

    public function test_subject_audit_and_invitation_recipient_history_are_preserved_without_foreign_keys_to_target(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        $targetUser = User::factory()->create();
        [, $outlet] = $this->unitWithOutlet($owner);
        app(TenantAccessService::class)->createInvitation($owner, $targetUser->email, TenantRole::Supervisor, null, [$outlet->id]);
        $target = app(TenantMembershipService::class)->addMembership($owner, $targetUser);
        $this->login($user);
        $this->getJson($this->url($target->id))->assertOk()->assertJsonPath('can_delete', false);
        $this->deleteJson($this->url($target->id), ['confirmation_email' => $targetUser->email, ...$this->confirmation()])->assertUnprocessable();
        [, $plain] = $this->membershipFor($owner, TenantRole::Employee);
        ManagementChangeEvent::create(['tenant_id' => $owner->tenant_id, 'actor_user_id' => $owner->user_id, 'actor_membership_id' => $owner->id, 'subject_type' => 'membership', 'subject_id' => $plain->id, 'action' => 'deactivated', 'changed_fields' => ['membership_status'], 'occurred_at' => now()]);
        $this->getJson($this->url($plain->id))->assertOk()->assertJsonPath('can_delete', false);
        $this->deleteJson($this->url($plain->id), ['confirmation_email' => $plain->user->email, ...$this->confirmation()])->assertUnprocessable();
        $this->assertNotNull($plain->fresh());
        $this->assertNotNull($target->fresh());
    }

    public function test_self_last_owner_preview_and_delete_password_guard(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$targetUser, $target] = $this->membershipFor($owner);
        $this->login($user);
        $this->getJson($this->url($owner->id))->assertOk()->assertJsonPath('can_delete', false)->assertJsonPath('blockers.self', 1)->assertJsonPath('blockers.last_owner', 1);
        $this->deleteJson($this->url($owner->id), ['confirmation_email' => $user->email, ...$this->confirmation()])->assertUnprocessable();
        $this->deleteJson($this->url($target->id), ['confirmation_email' => $targetUser->email, 'reason' => 'Approved correction', 'password' => 'wrong'])->assertUnprocessable();
        $this->assertNotNull($owner->fresh());
        $this->assertNotNull($target->fresh());
    }

    public function test_supervisor_outlet_boundaries_and_invalid_role_payload_are_rejected(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner, TenantRole::Employee);
        [, , $foreign] = $this->tenantWithOwner('Foreign');
        [, $outlet] = $this->unitWithOutlet($foreign);
        $this->login($user);
        $this->putJson($this->url($target->id, 'role'), ['role' => 'supervisor', 'outlet_ids' => [$outlet->id], ...$this->confirmation()])->assertUnprocessable();
        $this->putJson($this->url($target->id, 'role'), ['role' => 'supervisor', 'outlet_ids' => [], ...$this->confirmation()])->assertUnprocessable();
        $this->putJson($this->url($target->id, 'role'), ['role' => 'administrator', ...$this->confirmation()])->assertUnprocessable();
        $this->putJson($this->url($target->id, 'role'), ['role' => 'employee', ...$this->confirmation()])->assertUnprocessable();
        $this->assertSame(['employee'], $target->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
    }

    public function test_placement_history_and_foreign_profile_block_permanent_deletion(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$targetUser, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Placed');
        [, $outlet] = $this->unitWithOutlet($owner);
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        app(TenantMembershipService::class)->linkEmployee($owner, $target, $employee);
        [, , $foreign] = $this->tenantWithOwner('Foreign');
        $foreignEmployee = app(OrganizationService::class)->registerEmployee($foreign, 'Foreign');
        $this->login($user);
        $this->getJson($this->url($target->id))->assertOk()->assertJsonPath('can_delete', false);
        $body = ['confirmation_email' => $targetUser->email, ...$this->confirmation()];
        $this->deleteJson($this->url($target->id), $body)->assertUnprocessable();
        $this->deleteJson($this->url($target->id), [...$body, 'employee_id' => $foreignEmployee->id])->assertUnprocessable();
        $this->assertSame(1, $employee->assignments()->count());
        $this->assertNotNull($foreignEmployee->fresh());
        $this->assertNotNull($target->fresh());
    }

    private function confirmation(): array
    {
        return ['password' => 'password', 'reason' => 'Approved correction'];
    }

    private function url(int $id, string $action = 'permanent-deletion'): string
    {
        return "/api/v1/management/access/members/$id/$action";
    }

    private function login(User $user): void
    {
        Auth::forgetGuards();
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $response = $this->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertOk();
        if ($cookie = $response->getCookie(config('session.cookie'))) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }
}
