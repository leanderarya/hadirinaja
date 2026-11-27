<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\EmailChangeLink;
use App\Models\TenantAccessInvitation;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class EmailChangeLinkTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'app.key' => 'base64:'.base64_encode(str_repeat('x', 32)),
            'session.driver' => 'database',
            'session.table' => 'sessions',
            'session.connection' => null,
        ]);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_owner_issues_single_use_link_and_resource_exposes_only_link_metadata(): void
    {
        Mail::fake();
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Email link tenant');
        [$targetUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $targetUser->forceFill(['email' => 'member@example.test'])->save();

        $this->login($ownerUser);
        $response = $this->issueLink((int) $membership->getKey())->assertCreated();
        $response->assertJsonCount(4)
            ->assertJsonPath('email_masked', 'm***@example.test')
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');

        $token = $response->json('token');
        $link = EmailChangeLink::query()->sole();
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $token);
        $this->assertSame(hash('sha256', $token), $link->token_digest);
        $this->assertNotSame($token, $link->token_digest);
        $this->assertSame('member@example.test', $targetUser->fresh()->email);
        $this->assertSame(24 * 60 * 60, $link->expires_at->getTimestamp() - $link->created_at->getTimestamp());
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $tenant->getKey(),
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_change_link_issued',
        ]);

        $members = $this->browserRequest()->getJson('/api/v1/management/access')->assertOk()->json('members');
        $memberView = collect($members)->firstWhere('id', (int) $membership->getKey());
        $this->assertSame((int) $link->getKey(), $memberView['email_change_link']['id']);
        $this->assertSame($link->expires_at->toIso8601String(), $memberView['email_change_link']['expires_at']);
        $this->assertSame((int) $owner->getKey(), $memberView['email_change_link']['issued_by']['id']);
        $this->assertSame($ownerUser->name, $memberView['email_change_link']['issued_by']['name']);
        Mail::assertNothingOutgoing();
    }

    public function test_reissuing_revokes_the_previous_token_and_invalid_tokens_return_gone(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email link replacement tenant');
        [, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);

        $firstToken = $this->issueLink((int) $membership->getKey())->assertCreated()->json('token');
        $first = EmailChangeLink::query()->where('token_digest', hash('sha256', $firstToken))->firstOrFail();
        $secondToken = $this->issueLink((int) $membership->getKey())->assertCreated()->json('token');
        $second = EmailChangeLink::query()->where('token_digest', hash('sha256', $secondToken))->firstOrFail();

        $this->assertNotNull($first->fresh()->revoked_at);
        $this->assertNull($second->revoked_at);
        $this->browserRequest()->postJson('/api/v1/email-change-links/inspect', ['token' => $firstToken])->assertGone();
        $this->browserRequest()->postJson('/api/v1/email-change-links/inspect', ['token' => 'not-a-token'])->assertGone();
    }

    public function test_consume_requires_current_password_normalizes_email_and_revokes_old_credentials(): void
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Email link consume tenant');
        [$targetUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $targetUser->forceFill([
            'email' => 'member@example.test',
            'email_verified_at' => now(),
        ])->save();
        DB::table('sessions')->insert([
            'id' => 'email-change-session',
            'user_id' => $targetUser->getKey(),
            'payload' => base64_encode('old session'),
            'last_activity' => time(),
        ]);
        DB::table('password_reset_tokens')->insert([
            'email' => $targetUser->email,
            'token' => str_repeat('a', 64),
            'created_at' => now(),
        ]);
        DB::table('owner_password_resets')->insert([
            'tenant_id' => $tenant->getKey(),
            'user_id' => $targetUser->getKey(),
            'target_membership_id' => $membership->getKey(),
            'issued_by_membership_id' => $owner->getKey(),
            'email' => $targetUser->email,
            'token_digest' => str_repeat('b', 64),
            'password_fingerprint' => str_repeat('c', 64),
            'expires_at' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $personalAccessTokenId = null;
        if (Schema::hasTable('personal_access_tokens')) {
            $personalAccessTokenId = DB::table('personal_access_tokens')->insertGetId([
                'tokenable_type' => $targetUser->getMorphClass(),
                'tokenable_id' => $targetUser->getKey(),
                'name' => 'email-change-test',
                'token' => hash('sha256', 'old-personal-token'),
                'abilities' => '["*"]',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->login($ownerUser);
        $token = $this->issueLink((int) $membership->getKey())->assertCreated()->json('token');
        $this->browserRequest()->postJson('/api/v1/email-change-links/inspect', ['token' => $token])
            ->assertOk()->assertJsonPath('email_masked', 'm***@example.test')
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');

        $payload = [
            'token' => $token,
            'email' => 'New.Member@Example.test',
            'email_confirmation' => 'New.Member@Example.test',
            'password' => 'wrong-password',
        ];
        $this->browserRequest()->postJson('/api/v1/email-change-links/consume', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->assertNull(EmailChangeLink::query()->sole()->used_at);
        $this->assertSame('member@example.test', $targetUser->fresh()->email);

        User::factory()->create(['email' => 'duplicate@example.test']);
        $payload['email'] = 'duplicate@example.test';
        $payload['email_confirmation'] = 'duplicate@example.test';
        $payload['password'] = 'password';
        $this->browserRequest()->postJson('/api/v1/email-change-links/consume', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertNull(EmailChangeLink::query()->sole()->used_at);

        $payload['email'] = 'New.Member@Example.test';
        $payload['email_confirmation'] = 'New.Member@Example.test';
        $this->browserRequest()->postJson('/api/v1/email-change-links/consume', $payload)
            ->assertOk()->assertExactJson(['email_changed' => true])
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');

        $this->assertSame('new.member@example.test', $targetUser->fresh()->email);
        $this->assertNull($targetUser->fresh()->email_verified_at);
        $this->assertDatabaseMissing('sessions', ['id' => 'email-change-session']);
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => 'member@example.test']);
        $this->assertNotNull(DB::table('owner_password_resets')->where('token_digest', str_repeat('b', 64))->value('revoked_at'));
        if ($personalAccessTokenId !== null) {
            $this->assertDatabaseMissing('personal_access_tokens', ['id' => $personalAccessTokenId]);
        }
        $this->assertNotNull(EmailChangeLink::query()->sole()->used_at);
        $this->browserRequest()->postJson('/api/v1/email-change-links/consume', $payload)->assertGone();
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $tenant->getKey(),
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_change_completed',
        ]);
    }

    public function test_issue_rejects_self_inactive_and_pending_invitation_targets(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email link target validation tenant');
        [$targetUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $targetUser->forceFill(['email' => 'member@example.test'])->save();
        $this->login($ownerUser);

        $this->issueLink((int) $owner->getKey())
            ->assertUnprocessable()->assertJsonValidationErrors('membership');
        $membership->forceFill(['is_active' => false])->save();
        $this->issueLink((int) $membership->getKey())
            ->assertUnprocessable()->assertJsonValidationErrors('membership');
        $membership->forceFill(['is_active' => true])->save();
        TenantAccessInvitation::query()->create([
            'tenant_id' => $owner->tenant_id,
            'created_by_membership_id' => $owner->getKey(),
            'intended_user_id' => $targetUser->getKey(),
            'employee_id' => null,
            'invitee_email' => $targetUser->email,
            'role' => TenantRole::Employee,
            'token_digest' => str_repeat('d', 64),
            'expires_at' => now()->addDay(),
        ]);

        $this->issueLink((int) $membership->getKey())
            ->assertUnprocessable()
            ->assertJsonValidationErrors('membership')
            ->assertJsonPath('errors.membership.0', 'Ubah email di undangan.');
        $this->assertDatabaseCount('email_change_links', 0);
    }

    public function test_supervisor_sees_and_manages_only_scoped_employee_members(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email link supervisor tenant');
        [, $scopedOutlet] = $this->unitWithOutlet($owner, 'Coffee', 'Scoped');
        [, $otherOutlet] = $this->unitWithOutlet($owner, 'Retail', 'Other');
        [$scopedUser, $scopedMembership, $scopedEmployee] = $this->employeeMembership($owner, $scopedOutlet, 'Scoped employee');
        [, $otherMembership] = $this->employeeMembership($owner, $otherOutlet, 'Other employee');
        [, $ownerScopedMembership] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $ownerScopedMembership, $scopedOutlet);
        [$supervisorUser, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisor, $scopedOutlet);

        $this->login($supervisorUser);
        $response = $this->browserRequest()->getJson('/api/v1/management/access')->assertOk();
        $this->assertSame([(int) $scopedMembership->getKey()], collect($response->json('members'))->pluck('id')->all());
        $this->assertSame([], $response->json('invitations'));
        $this->assertSame([(int) $scopedEmployee->getKey()], collect($response->json('employees'))->pluck('id')->all());
        $this->assertSame([(int) $scopedOutlet->getKey()], collect($response->json('outlets'))->pluck('id')->all());

        $issued = $this->issueLink((int) $scopedMembership->getKey())->assertCreated();
        $this->issueLink((int) $otherMembership->getKey())->assertNotFound();
        $this->issueLink((int) $ownerScopedMembership->getKey())->assertNotFound();
        $this->browserRequest()->postJson(
            '/api/v1/management/access/email-change-links/'.$issued->json('link_id').'/revoke',
        )->assertOk()->assertExactJson(['revoked' => true]);

        $this->login($ownerUser);
        $ownerIssued = $this->issueLink((int) $ownerScopedMembership->getKey())->assertCreated();
        $this->browserRequest()->postJson(
            '/api/v1/management/access/email-change-links/'.$ownerIssued->json('link_id').'/revoke',
        )->assertOk()->assertExactJson(['revoked' => true]);
        $this->browserRequest()->postJson('/api/v1/email-change-links/inspect', [
            'token' => $ownerIssued->json('token'),
        ])->assertGone();
    }

    public function test_expired_links_cannot_be_inspected_or_consumed(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email link expiry tenant');
        [, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $token = $this->issueLink((int) $membership->getKey())->assertCreated()->json('token');
        $link = EmailChangeLink::query()->sole();

        $this->travelTo(CarbonImmutable::parse($link->expires_at)->addSecond());
        $this->browserRequest()->postJson('/api/v1/email-change-links/inspect', ['token' => $token])->assertGone();
        $this->browserRequest()->postJson('/api/v1/email-change-links/consume', [
            'token' => $token,
            'email' => 'new@example.test',
            'email_confirmation' => 'new@example.test',
            'password' => 'password',
        ])->assertGone();
    }

    private function employeeMembership($owner, $outlet, string $name): array
    {
        $employee = app(OrganizationService::class)->registerEmployee($owner, $name);
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);

        return [$user, $membership, $employee];
    }

    private function issueLink(int $membershipId): TestResponse
    {
        return $this->browserRequest()->postJson(
            '/api/v1/management/access/members/'.$membershipId.'/email-change-link',
            ['password' => 'password'],
        );
    }

    private function login(User $user): void
    {
        Auth::forgetGuards();
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        if ($cookie = $response->getCookie(config('session.cookie'))) {
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
