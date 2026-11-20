<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\ManagementChangeEvent;
use App\Models\User;
use App\Services\OrganizationService;
use App\Services\OwnerPasswordResetService;
use App\Services\TenantAccessService;
use App\Services\TenantMembershipService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class OwnerPasswordResetTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'database', 'session.table' => 'sessions', 'session.connection' => null]);
    }

    public function test_single_use_hashed_token_resets_password_invalidates_sessions_and_preserves_records_and_role(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $member] = $this->membershipFor($owner, TenantRole::Employee);
        $profile = app(OrganizationService::class)->registerEmployee($owner, 'Existing');
        app(TenantMembershipService::class)->linkEmployee($owner, $member, $profile);
        DB::table('sessions')->insert(['id' => 'target-old-session', 'user_id' => $user->id, 'payload' => base64_encode('old'), 'last_activity' => time()]);
        $this->login($ownerUser);
        $issued = $this->postJson($this->issueUrl($member->id), ['password' => 'password'])->assertCreated()->assertJsonPath('role_unchanged', true);
        $token = $issued->json('reset_token');
        $stored = DB::table('owner_password_resets')->sole();
        $this->assertSame(hash('sha256', $token), $stored->token_digest);
        $this->assertNotSame($token, $stored->token_digest);
        $this->postJson('/api/v1/password-resets/inspect', ['token' => $token])->assertOk()->assertJsonPath('email', $user->email)->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $this->postJson('/api/v1/password-resets/complete', $this->body($token, 'bad'))->assertUnprocessable();
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
        $this->postJson('/api/v1/password-resets/complete', $this->body($token))->assertOk()->assertJsonPath('role_unchanged', true);
        $this->assertTrue(Hash::check('NewEmployeePassword123!', $user->fresh()->password));
        $this->assertNotNull($user->fresh()->remember_token);
        $this->assertDatabaseMissing('sessions', ['id' => 'target-old-session']);
        $this->assertNotNull($profile->fresh());
        $this->assertTrue($member->fresh()->is_active);
        $this->assertSame(['employee'], $member->roles()->pluck('role')->map(fn ($r) => $r->value)->all());
        $this->assertSame($profile->id, $member->employeeUserLink()->value('employee_id'));
        $this->postJson('/api/v1/password-resets/complete', $this->body($token))->assertGone();
        $audit = ManagementChangeEvent::where('subject_type', 'password_reset')->get()->toJson();
        foreach ([$token, $stored->token_digest, 'NewEmployeePassword123!'] as $secret) {
            $this->assertStringNotContainsString($secret, $audit);
        }
        $this->postJson('/api/v1/auth/logout')->assertOk();
        Auth::forgetGuards();
        $this->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'NewEmployeePassword123!'])->assertOk()->assertJsonPath('active_membership.roles.0', 'employee');
    }

    public function test_regeneration_expiry_boundary_revocation_and_unknown_tokens(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($user);
        $first = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $second = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $this->postJson('/api/v1/password-resets/complete', $this->body($first->json('reset_token')))->assertGone();
        $this->postJson('/api/v1/management/access/password-resets/'.$second->json('reset_id').'/revoke', ['password' => 'password'])->assertOk();
        $this->postJson('/api/v1/password-resets/complete', $this->body($second->json('reset_token')))->assertGone();
        $third = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $expires = DB::table('owner_password_resets')->where('id', $third->json('reset_id'))->value('expires_at');
        $this->travelTo($expires);
        $this->postJson('/api/v1/password-resets/complete', $this->body($third->json('reset_token')))->assertGone();
        $this->travelBack();
        $this->postJson('/api/v1/password-resets/inspect', ['token' => str_repeat('0', 64)])->assertGone();
        $this->postJson('/api/v1/password-resets/inspect', ['token' => 'bad'])->assertUnprocessable();
    }

    public function test_owner_password_cross_tenant_self_and_supervisor_guards(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [$supervisorUser, $target] = $this->membershipFor($owner, TenantRole::Supervisor);
        [, , $foreign] = $this->tenantWithOwner('Foreign');
        $this->login($user);
        $this->postJson($this->issueUrl($target->id), ['password' => 'wrong'])->assertUnprocessable();
        $this->postJson($this->issueUrl($owner->id), ['password' => 'password'])->assertUnprocessable();
        $this->postJson($this->issueUrl($foreign->id), ['password' => 'password'])->assertNotFound();
        $this->login($supervisorUser);
        $this->postJson($this->issueUrl($owner->id), ['password' => 'password'])->assertForbidden();
        $this->assertSame(0, DB::table('owner_password_resets')->count());
    }

    public function test_multi_tenant_global_account_is_blocked_at_issue_and_after_issue(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $issued = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        app(OrganizationService::class)->createTenant($user, 'Other');
        $this->postJson('/api/v1/password-resets/complete', $this->body($issued->json('reset_token')))->assertUnprocessable();
        $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertUnprocessable();
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
    }

    public function test_revoked_access_stays_revoked_and_invalid_issuer_or_changed_password_invalidates_link(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantAccessService::class)->revokeMember($owner, $target->id);
        $this->login($ownerUser);
        $first = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $this->postJson('/api/v1/password-resets/complete', $this->body($first->json('reset_token')))->assertOk();
        $this->assertFalse($target->fresh()->is_active);
        $this->assertNotNull($target->fresh()->revoked_at);
        $second = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $user->forceFill(['password' => 'DifferentPassword123!'])->save();
        $this->postJson('/api/v1/password-resets/complete', $this->body($second->json('reset_token')))->assertGone();
        $third = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $owner->forceFill(['is_active' => false])->save();
        $this->postJson('/api/v1/password-resets/complete', $this->body($third->json('reset_token')))->assertForbidden();
    }

    public function test_foreign_revoke_and_unsupported_session_storage_are_blocked(): void
    {
        [$user, , $owner] = $this->tenantWithOwner();
        [, $target] = $this->membershipFor($owner);
        $this->login($user);
        $reset = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        [$foreignUser] = $this->tenantWithOwner('Foreign');
        $this->login($foreignUser);
        $this->postJson('/api/v1/management/access/password-resets/'.$reset->json('reset_id').'/revoke', ['password' => 'password'])->assertNotFound();
        config(['session.driver' => 'array']);
        $this->expectException(ValidationException::class);
        app(OwnerPasswordResetService::class)->issue($owner, $target->id, 'password');
    }

    public function test_completion_is_atomic_when_audit_write_fails(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $issued = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        DB::table('sessions')->insert(['id' => 'preserved-session', 'user_id' => $user->id, 'payload' => 'payload', 'last_activity' => time()]);
        $fail = true;
        DB::listen(function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_contains($query->sql, 'insert into `management_change_events`') && in_array('password_reset_completed', $query->bindings, true)) {
                $fail = false;
                throw new \RuntimeException('Injected audit failure');
            }
        });
        try {
            app(OwnerPasswordResetService::class)->consume($issued->json('reset_token'), 'NewEmployeePassword123!');
            $this->fail('Expected injected audit failure');
        } catch (\RuntimeException $error) {
            $this->assertSame('Injected audit failure', $error->getMessage());
        }
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
        $this->assertDatabaseHas('sessions', ['id' => 'preserved-session']);
        $this->assertNull(DB::table('owner_password_resets')->where('id', $issued->json('reset_id'))->value('used_at'));
        $this->assertSame(0, ManagementChangeEvent::where('action', 'password_reset_completed')->count());
    }

    public function test_target_current_session_is_logged_out_after_completing_reset(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $issued = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $this->login($user);
        $this->postJson('/api/v1/password-resets/complete', $this->body($issued->json('reset_token')))->assertOk();
        Auth::forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->assertTrue(Hash::check('NewEmployeePassword123!', $user->fresh()->password));
    }

    public function test_password_boundary_validation_does_not_consume_token(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $issued = $this->postJson($this->issueUrl($target->id), ['password' => 'password'])->assertCreated();
        $token = $issued->json('reset_token');
        $this->postJson('/api/v1/password-resets/complete', $this->body($token, str_repeat('x', 73)))->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/password-resets/complete', $this->body($token, "ValidPassword\0bad"))->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/password-resets/complete', [...$this->body($token), 'password_confirmation' => 'Mismatch'])->assertUnprocessable();
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
        $this->assertNull(DB::table('owner_password_resets')->where('id', $issued->json('reset_id'))->value('used_at'));
    }

    public function test_guest_with_valid_token_can_reset_without_old_password_or_account_creation(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [$user, $target] = $this->membershipFor($owner, TenantRole::Employee);
        $issued = app(OwnerPasswordResetService::class)->issue($owner, $target->id, 'password');
        $count = User::count();
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->postJson('/api/v1/password-resets/inspect', ['token' => $issued['reset_token']])->assertOk();
        $this->postJson('/api/v1/password-resets/complete', $this->body($issued['reset_token']))->assertOk();
        $this->assertSame($count, User::count());
        $this->assertTrue(Hash::check('NewEmployeePassword123!', $user->fresh()->password));
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    private function issueUrl(int $id): string
    {
        return "/api/v1/management/access/members/$id/password-reset";
    }

    private function body(string $token, string $password = 'NewEmployeePassword123!'): array
    {
        return ['token' => $token, 'password' => $password, 'password_confirmation' => $password];
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
