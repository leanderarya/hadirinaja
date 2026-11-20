<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\ManagementChangeEvent;
use App\Models\TenantAccessInvitation;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantAccessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class EmployeeInvitationLifecycleTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_owner_corrects_email_preserving_old_invitation_then_employee_activates_and_logs_in(): void
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Employee Existing');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $this->ownerSession($ownerUser);
        config(['access.invitation_expiration_hours' => 2]);
        $first = $this->browser()->postJson('/api/v1/management/access/invitations', [
            'email' => 'old@example.test', 'role' => 'employee', 'employee_id' => $employee->id,
        ])->assertCreated();
        $firstId = $first->json('invitation.id');
        $oldToken = $first->json('activation_token');
        $replaced = $this->browser()->postJson("/api/v1/management/access/invitations/$firstId/reissue", [
            'email' => 'CORRECT@example.test',
        ])->assertOk()->assertJsonPath('invitation.email', 'correct@example.test');
        $newToken = $replaced->json('activation_token');
        $newId = $replaced->json('invitation.id');
        $this->assertNotSame($firstId, $newId);
        $this->assertNotSame($oldToken, $newToken);
        $old = TenantAccessInvitation::findOrFail($firstId);
        $new = TenantAccessInvitation::findOrFail($newId);
        $this->assertSame('old@example.test', $old->invitee_email);
        $this->assertSame('revoked', $old->state());
        $this->assertSame($employee->id, $new->employee_id);
        $this->assertSame($tenant->id, $new->tenant_id);
        $this->assertSame(hash('sha256', $newToken), $new->token_digest);
        $this->assertEqualsWithDelta(7200, now()->diffInSeconds($new->expires_at), 2);
        $this->assertSame(1, $employee->assignments()->count());
        $this->browser()->postJson('/api/v1/invitations/activate', $this->activation($oldToken))->assertStatus(410);
        $this->browser()->postJson('/api/v1/invitations/activate', [
            ...$this->activation($newToken), 'password_confirmation' => 'Mismatch',
        ])->assertUnprocessable();
        $this->browser()->postJson('/api/v1/invitations/activate', $this->activation($newToken))->assertCreated();
        $this->browser()->postJson('/api/v1/invitations/activate', $this->activation($newToken))->assertStatus(410);
        $user = User::where('email', 'correct@example.test')->sole();
        $this->assertTrue(Hash::check('EmployeePassword123!', $user->password));
        $this->assertSame(1, EmployeeUserLink::where('employee_id', $employee->id)->count());
        $this->browser()->postJson("/api/v1/management/access/invitations/$newId/reissue", ['email' => 'hijack@example.test'])->assertUnprocessable();
        $logout = $this->browser()->postJson('/api/v1/auth/logout')->assertOk();
        if ($cookie = $logout->getCookie(config('session.cookie'))) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
        $this->browser()->postJson('/api/v1/auth/login', [
            'identifier' => 'correct@example.test', 'password' => 'EmployeePassword123!',
        ])->assertOk()->assertJsonPath('user.id', $user->id)->assertJsonPath('active_membership.roles.0', 'employee');
        $audit = ManagementChangeEvent::where('subject_type', 'access_invitation')->get();
        $this->assertContains('recipient_replaced', $audit->pluck('action')->all());
        $this->assertContains('accepted', $audit->pluck('action')->all());
        foreach ([$oldToken, $newToken, hash('sha256', $newToken)] as $secret) {
            $this->assertStringNotContainsString($secret, $audit->toJson());
        }
    }

    public function test_duplicate_profile_or_email_and_failed_replacement_do_not_revoke_valid_link(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'First');
        $other = app(OrganizationService::class)->registerEmployee($owner, 'Second');
        $this->ownerSession($user);
        $payload = ['email' => 'one@example.test', 'role' => 'employee', 'employee_id' => $employee->id];
        $first = $this->browser()->postJson('/api/v1/management/access/invitations', $payload)->assertCreated();
        $id = $first->json('invitation.id');
        $this->browser()->postJson('/api/v1/management/access/invitations', [...$payload, 'email' => 'another@example.test'])->assertUnprocessable();
        $this->browser()->postJson('/api/v1/management/access/invitations', [...$payload, 'employee_id' => $other->id])->assertUnprocessable();
        $this->browser()->postJson("/api/v1/management/access/invitations/$id/reissue", ['email' => $user->email])->assertUnprocessable();
        $this->browser()->postJson("/api/v1/management/access/invitations/$id/reissue", ['email' => 'invalid'])->assertUnprocessable();
        $this->assertSame('pending', TenantAccessInvitation::findOrFail($id)->state());
        $this->browser()->postJson('/api/v1/invitations/inspect', ['token' => $first->json('activation_token')])->assertOk()->assertJsonPath('status', 'pending');
        $this->assertSame(1, TenantAccessInvitation::count());
    }

    public function test_pending_regeneration_invalidates_previous_token_and_foreign_or_supervisor_owner_actions_are_denied(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Scoped');
        $this->ownerSession($user);
        $first = $this->browser()->postJson('/api/v1/management/access/invitations', [
            'email' => 'scoped@example.test', 'role' => 'employee', 'employee_id' => $employee->id,
        ])->assertCreated();
        $id = $first->json('invitation.id');
        $renewed = $this->browser()->postJson("/api/v1/management/access/invitations/$id/reissue")->assertOk();
        $this->assertSame($id, $renewed->json('invitation.id'));
        $this->browser()->postJson('/api/v1/invitations/inspect', ['token' => $first->json('activation_token')])->assertNotFound();
        $this->travel(25)->hours();
        $this->browser()->postJson('/api/v1/invitations/activate', $this->activation($renewed->json('activation_token')))->assertStatus(410);
        $this->travelBack();
        [$foreignUser] = $this->tenantWithOwner('Foreign');
        $this->ownerSession($foreignUser);
        $this->browser()->postJson("/api/v1/management/access/invitations/$id/reissue")->assertNotFound();
        $this->browser()->postJson('/api/v1/management/access/invitations', [
            'email' => 'cross@example.test', 'role' => 'employee', 'employee_id' => $employee->id,
        ])->assertUnprocessable();
        [$supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        $this->ownerSession($supervisor);
        $this->browser()->postJson("/api/v1/management/access/invitations/$id/reissue")->assertForbidden();
    }

    public function test_an_expired_invitation_cannot_be_regenerated_over_a_new_pending_invitation(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Expired');
        $service = app(TenantAccessService::class);
        $old = $service->createInvitation($owner, 'old@example.test', TenantRole::Employee, $employee->id, []);
        $this->travel(25)->hours();
        $service->createInvitation($owner, 'new@example.test', TenantRole::Employee, $employee->id, []);
        $this->expectException(ValidationException::class);
        $service->reissueInvitation($owner, $old['invitation']->id);
    }

    public function test_expiry_is_inclusive_and_email_is_reserved_across_invitation_roles(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Email Reservation');
        $this->ownerSession($user);
        $issued = $this->browser()->postJson('/api/v1/management/access/invitations', [
            'email' => 'reserved@example.test', 'role' => 'employee', 'employee_id' => $employee->id,
        ])->assertCreated();
        $this->browser()->postJson('/api/v1/management/access/invitations', [
            'email' => 'RESERVED@example.test', 'role' => 'supervisor', 'outlet_ids' => [$outlet->id],
        ])->assertUnprocessable();
        $invitation = TenantAccessInvitation::findOrFail($issued->json('invitation.id'));
        $this->travelTo($invitation->expires_at);
        $this->assertSame('expired', $invitation->state());
        $this->browser()->postJson('/api/v1/invitations/activate', $this->activation($issued->json('activation_token')))->assertStatus(410);
        $this->travelBack();
    }

    private function activation(string $token): array
    {
        return ['token' => $token, 'name' => 'Employee Existing', 'password' => 'EmployeePassword123!', 'password_confirmation' => 'EmployeePassword123!'];
    }

    private function ownerSession(User $user): void
    {
        $response = $this->browser()->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertOk();
        if ($cookie = $response->getCookie(config('session.cookie'))) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }

    private function browser(): static
    {
        return $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
    }
}
