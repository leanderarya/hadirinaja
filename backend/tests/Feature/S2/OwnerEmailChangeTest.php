<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Mail\EmailChangeConfirmation;
use App\Mail\EmailChangeNotice;
use App\Mail\MemberInvitationEmail;
use App\Models\PendingEmailChange;
use App\Models\TenantAccessInvitation;
use App\Models\User;
use App\Services\OrganizationService;
use App\Services\TenantAccessService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class OwnerEmailChangeTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'database', 'session.table' => 'sessions', 'session.connection' => null]);
    }

    public function test_active_email_change_confirms_once_revokes_sessions_and_password_resets_and_is_audited(): void
    {
        Mail::fake();
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email change tenant');
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $oldEmail = $user->email;
        DB::table('sessions')->insert([
            'id' => 'email-change-session',
            'user_id' => $user->getKey(),
            'payload' => base64_encode('old session'),
            'last_activity' => time(),
        ]);
        DB::table('password_reset_tokens')->insert([
            'email' => $oldEmail,
            'token' => str_repeat('a', 64),
            'created_at' => now(),
        ]);
        DB::table('owner_password_resets')->insert([
            'tenant_id' => $owner->tenant_id,
            'user_id' => $user->getKey(),
            'target_membership_id' => $membership->getKey(),
            'issued_by_membership_id' => $owner->getKey(),
            'email' => $oldEmail,
            'token_digest' => str_repeat('b', 64),
            'password_fingerprint' => str_repeat('c', 64),
            'expires_at' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->login($ownerUser);
        $this->requestEmail($membership->getKey(), 'New.Member@Example.test')
            ->assertOk()
            ->assertJsonPath('mode', 'confirmation_sent')
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $change = PendingEmailChange::query()->sole();
        $this->assertSame('new.member@example.test', $change->new_email);
        $this->assertSame($oldEmail, $user->fresh()->email);
        $this->assertSame(
            24 * 60 * 60,
            CarbonImmutable::parse($change->expires_at)->getTimestamp() - $change->created_at->getTimestamp(),
        );

        $confirmation = null;
        Mail::assertSent(EmailChangeConfirmation::class, function (EmailChangeConfirmation $mail) use (&$confirmation): bool {
            $confirmation = $mail;

            return $mail->hasTo('new.member@example.test');
        });
        $notice = null;
        Mail::assertSent(EmailChangeNotice::class, function (EmailChangeNotice $mail) use ($oldEmail, &$notice): bool {
            if (! $mail->hasTo($oldEmail) || ! $mail->requiresConfirmation) {
                return false;
            }
            $notice = $mail->render();

            return true;
        });
        $this->assertStringContainsString('Perubahan berlaku setelah Anda mengonfirmasi', $notice);
        $token = $this->confirmationToken($confirmation->confirmationUrl);
        $this->assertStringContainsString('Konfirmasi perubahan email', $confirmation->render());
        $this->assertSame(hash('sha256', $token), $change->token_digest);
        $this->assertNotSame($token, $change->token_digest);
        $this->assertStringNotContainsString($token, (string) parse_url($confirmation->confirmationUrl, PHP_URL_PATH));

        $members = $this->browserRequest()->getJson('/api/v1/management/access')->assertOk()->json('members');
        $memberView = collect($members)->firstWhere('id', (int) $membership->getKey());
        $this->assertSame((int) $change->getKey(), $memberView['pending_email_change']['id']);
        $this->assertSame('new.member@example.test', $memberView['pending_email_change']['email']);
        $this->assertSame($change->expires_at->toIso8601String(), $memberView['pending_email_change']['expires_at']);
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $owner->tenant_id,
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_change_requested',
        ]);

        $page = $this->browserRequest()->get('/api/v1/email-changes/confirm')
            ->assertOk()->assertSee('Konfirmasi perubahan email');
        $this->assertStringNotContainsString($token, $page->getContent());
        $this->assertStringContainsString('X-XSRF-TOKEN', $page->getContent());
        $this->browserRequest()->postJson('/api/v1/email-changes/inspect', ['token' => $token])
            ->assertOk()->assertJsonPath('email', 'new.member@example.test');
        $this->browserRequest()->postJson('/api/v1/email-changes/confirm', ['token' => $token])
            ->assertOk()->assertJsonPath('email_changed', true)
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $this->assertSame('new.member@example.test', $user->fresh()->email);
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->assertDatabaseMissing('sessions', ['id' => 'email-change-session']);
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $oldEmail]);
        $this->assertNotNull(DB::table('owner_password_resets')->where('token_digest', str_repeat('b', 64))->value('revoked_at'));
        $this->assertNotNull($change->fresh()->confirmed_at);
        $this->browserRequest()->postJson('/api/v1/email-changes/confirm', ['token' => $token])->assertGone();
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $owner->tenant_id,
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_change_confirmed',
        ]);
    }

    public function test_new_request_supersedes_old_token_and_expired_token_cannot_be_used(): void
    {
        Mail::fake();
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email change regeneration tenant');
        [, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);

        $this->requestEmail($membership->getKey(), 'first@example.test')->assertOk();
        $first = null;
        Mail::assertSent(EmailChangeConfirmation::class, function (EmailChangeConfirmation $mail) use (&$first): bool {
            if ($mail->newEmail !== 'first@example.test') {
                return false;
            }
            $first = $mail;

            return true;
        });
        $firstToken = $this->confirmationToken($first->confirmationUrl);

        $this->requestEmail($membership->getKey(), 'second@example.test')->assertOk();
        $second = null;
        Mail::assertSent(EmailChangeConfirmation::class, function (EmailChangeConfirmation $mail) use (&$second): bool {
            if ($mail->newEmail !== 'second@example.test') {
                return false;
            }
            $second = $mail;

            return true;
        });
        $secondToken = $this->confirmationToken($second->confirmationUrl);

        $this->browserRequest()->postJson('/api/v1/email-changes/confirm', ['token' => $firstToken])->assertGone();
        $this->assertDatabaseHas('pending_email_changes', [
            'token_digest' => hash('sha256', $firstToken),
        ]);
        $this->assertNotNull(DB::table('pending_email_changes')
            ->where('token_digest', hash('sha256', $firstToken))->value('revoked_at'));
        $this->assertSame(1, PendingEmailChange::query()->forTenant((int) $owner->tenant_id)
            ->where('membership_id', $membership->getKey())->whereNull('confirmed_at')
            ->whereNull('revoked_at')->count());

        $secondChange = PendingEmailChange::query()->where('token_digest', hash('sha256', $secondToken))->firstOrFail();
        $this->travelTo(CarbonImmutable::parse($secondChange->expires_at)->addSecond());
        $this->browserRequest()->postJson('/api/v1/email-changes/inspect', ['token' => $secondToken])->assertGone();
        $this->browserRequest()->postJson('/api/v1/email-changes/confirm', ['token' => $secondToken])->assertGone();
    }

    public function test_owner_can_cancel_pending_change_and_member_resource_clears_it(): void
    {
        Mail::fake();
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email change cancellation tenant');
        [, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $this->login($ownerUser);
        $this->requestEmail($membership->getKey(), 'cancel@example.test')->assertOk();
        $change = PendingEmailChange::query()->sole();

        $this->browserRequest()->postJson(
            '/api/v1/management/access/email-changes/'.$change->getKey().'/cancel',
        )->assertOk()->assertExactJson(['canceled' => true]);

        $this->assertNotNull($change->fresh()->revoked_at);
        $members = $this->browserRequest()->getJson('/api/v1/management/access')->assertOk()->json('members');
        $memberView = collect($members)->firstWhere('id', (int) $membership->getKey());
        $this->assertNull($memberView['pending_email_change']);
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $owner->tenant_id,
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_change_canceled',
        ]);
    }

    public function test_owner_only_same_tenant_duplicate_and_self_guards(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Email change authorization tenant');
        [$targetUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $targetEmail = $targetUser->email;
        $duplicate = User::factory()->create(['email' => 'duplicate@example.test']);
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign email change tenant');
        [$supervisorUser] = $this->membershipFor($owner, TenantRole::Supervisor);
        $this->login($ownerUser);

        $this->requestEmail($owner->getKey(), 'another@example.test')
            ->assertUnprocessable()->assertJsonValidationErrors('membership');
        $this->requestEmail($membership->getKey(), $duplicate->email)
            ->assertUnprocessable()->assertJsonValidationErrors('email')
            ->assertJsonPath('errors.email.0', 'Email ini sudah digunakan akun lain.');
        $this->requestEmail($foreignOwner->getKey(), 'foreign-change@example.test')->assertNotFound();
        $this->requestEmail($membership->getKey(), 'not-an-email')->assertUnprocessable()->assertJsonValidationErrors('email');
        app(TenantMembershipService::class)->addMembership($foreignOwner, $targetUser);
        $this->requestEmail($membership->getKey(), 'multi-tenant@example.test')
            ->assertUnprocessable()->assertJsonValidationErrors('membership');

        $this->login($supervisorUser);
        $this->requestEmail($membership->getKey(), 'supervisor-change@example.test')->assertForbidden();
        $this->assertSame($targetEmail, $targetUser->email);
        $this->assertDatabaseCount('pending_email_changes', 0);
    }

    public function test_pending_invitation_is_replaced_and_delivered_to_new_email(): void
    {
        Mail::fake();
        [$ownerUser, , $owner] = $this->tenantWithOwner('Pending invitation email tenant');
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        $oldEmail = $user->email;
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Invited employee');
        app(TenantAccessService::class)->revokeMember($owner, (int) $membership->getKey());
        $original = app(TenantAccessService::class)->createInvitation(
            $owner, $user->email, TenantRole::Employee, (int) $employee->getKey(), [],
        );
        DB::table('sessions')->insert([
            'id' => 'pending-invitation-session',
            'user_id' => $user->getKey(),
            'payload' => base64_encode('old session'),
            'last_activity' => time(),
        ]);

        $this->login($ownerUser);
        $this->requestEmail($membership->getKey(), 'replacement@example.test')
            ->assertOk()->assertExactJson(['mode' => 'invitation_reissued']);

        $this->assertSame('replacement@example.test', $user->fresh()->email);
        $this->assertDatabaseMissing('sessions', ['id' => 'pending-invitation-session']);
        $this->assertNotNull($original['invitation']->fresh()->revoked_at);
        $replacement = TenantAccessInvitation::query()->where('invitee_email', 'replacement@example.test')->sole();
        $this->assertSame((int) $user->getKey(), (int) $replacement->intended_user_id);
        $this->assertSame(TenantRole::Employee, $replacement->role);

        $invitationMail = null;
        Mail::assertSent(MemberInvitationEmail::class, function (MemberInvitationEmail $mail) use (&$invitationMail): bool {
            $invitationMail = $mail;

            return $mail->hasTo('replacement@example.test');
        });
        $notice = null;
        Mail::assertSent(EmailChangeNotice::class, function (EmailChangeNotice $mail) use ($oldEmail, &$notice): bool {
            if (! $mail->hasTo($oldEmail) || $mail->requiresConfirmation) {
                return false;
            }
            $notice = $mail->render();

            return true;
        });
        $this->assertStringContainsString('Undangan lama untuk alamat ini sudah dicabut', $notice);
        $token = substr((string) parse_url($invitationMail->activationUrl, PHP_URL_FRAGMENT), 0);
        $this->assertStringContainsString('Undangan akses Anda', $invitationMail->render());
        $this->assertSame(hash('sha256', $token), $replacement->token_digest);
        $this->browserRequest()->postJson('/api/v1/invitations/inspect', [
            'token' => $original['token'],
        ])->assertOk()->assertJsonPath('status', 'revoked');
        $this->browserRequest()->postJson('/api/v1/invitations/inspect', [
            'token' => $token,
        ])->assertOk()->assertJsonPath('status', 'pending')
            ->assertJsonPath('invitee_email', 'replacement@example.test');
        $this->assertDatabaseHas('management_change_events', [
            'tenant_id' => $owner->tenant_id,
            'subject_type' => 'membership',
            'subject_id' => $membership->getKey(),
            'action' => 'email_changed_for_invitation',
        ]);
        $this->assertDatabaseCount('pending_email_changes', 0);
    }

    private function requestEmail(int $membershipId, string $email): TestResponse
    {
        return $this->browserRequest()->postJson(
            '/api/v1/management/access/members/'.$membershipId.'/email-change',
            ['email' => $email],
        );
    }

    private function confirmationToken(string $url): string
    {
        return (string) parse_url($url, PHP_URL_FRAGMENT);
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
