<?php

namespace App\Services;

use App\Mail\EmailChangeConfirmation;
use App\Mail\EmailChangeNotice;
use App\Mail\MemberInvitationEmail;
use App\Models\ManagementChangeEvent;
use App\Models\PendingEmailChange;
use App\Models\Tenant;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\IdentityNormalizer;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use LogicException;

final class OwnerEmailChangeService
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly TenantAccessService $access,
    ) {}

    /** @return array{mode: string, expires_at?: string} */
    public function request(TenantMembership $actor, int $membershipId, string $email): array
    {
        $email = IdentityNormalizer::email($email);

        try {
            $result = DB::transaction(function () use ($actor, $membershipId, $email): array {
                $tenantId = (int) $actor->tenant_id;
                $tenant = Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
                $owner = $this->authorization->requireOwner($actor);
                $target = TenantMembership::query()->forTenant($tenantId)->whereKey($membershipId)
                    ->lockForUpdate()->firstOrFail();

                if ((int) $target->user_id === (int) $owner->user_id) {
                    throw ValidationException::withMessages(['membership' => 'Owner tidak dapat mengubah email akunnya sendiri.']);
                }

                $user = User::query()->whereKey($target->user_id)->lockForUpdate()->firstOrFail();
                if ($user->email === $email) {
                    throw ValidationException::withMessages(['email' => 'Email baru harus berbeda dari email saat ini.']);
                }
                $this->singleTenant($user, $tenantId);
                $this->assertEmailAvailable($email, (int) $user->getKey());

                $invitation = $this->pendingInvitation($target);
                if ($invitation) {
                    $this->sessionSupport();
                    $issued = $this->access->reissueInvitationForEmailChange(
                        $owner, (int) $invitation->getKey(), $email, (int) $user->getKey(),
                    );
                    $activationUrl = $this->activationUrl((string) $issued['token']);
                    $oldEmail = (string) $user->email;
                    $this->applyEmail($user, $email, verified: false, oldEmail: $oldEmail);
                    $this->audit($owner, $target, 'email_changed_for_invitation', ['email'], [
                        'old_email' => $oldEmail,
                        'new_email' => $email,
                        'invitation_id' => (int) $issued['invitation']->getKey(),
                    ]);

                    return [
                        'mode' => 'invitation_reissued',
                        'member_name' => $user->name,
                        'old_email' => $oldEmail,
                        'new_email' => $email,
                        'activation_url' => $activationUrl,
                        'expires_at' => $issued['invitation']->expires_at->toIso8601String(),
                        'tenant_name' => $tenant->name,
                    ];
                }

                $supersededIds = PendingEmailChange::query()->forTenant($tenantId)
                    ->where('membership_id', $target->getKey())
                    ->whereNull('confirmed_at')->whereNull('revoked_at')
                    ->lockForUpdate()->get();
                foreach ($supersededIds as $superseded) {
                    $superseded->forceFill(['revoked_at' => now()])->save();
                }

                $token = bin2hex(random_bytes(32));
                $expires = now()->addHours(24);
                $change = PendingEmailChange::query()->create([
                    'tenant_id' => $tenantId,
                    'membership_id' => $target->getKey(),
                    'user_id' => $user->getKey(),
                    'issued_by_membership_id' => $owner->getKey(),
                    'old_email' => $user->email,
                    'new_email' => $email,
                    'token_digest' => hash('sha256', $token),
                    'expires_at' => $expires,
                ]);
                $this->audit($owner, $target, 'email_change_requested', ['email'], [
                    'email_change_id' => (int) $change->getKey(),
                    'old_email' => $user->email,
                    'new_email' => $email,
                    'superseded_change_ids' => $supersededIds->modelKeys(),
                ]);

                return [
                    'mode' => 'confirmation_sent',
                    'member_name' => $user->name,
                    'old_email' => (string) $user->email,
                    'new_email' => $email,
                    'token' => $token,
                    'expires_at' => $expires->toIso8601String(),
                ];
            });
        } catch (QueryException $exception) {
            if ($this->isDuplicateEmail($exception)) {
                throw ValidationException::withMessages(['email' => 'Email ini sudah digunakan akun lain.']);
            }

            throw $exception;
        }

        if ($result['mode'] === 'invitation_reissued') {
            Mail::to((string) $result['new_email'])->send(new MemberInvitationEmail(
                (string) $result['member_name'],
                (string) $result['tenant_name'],
                (string) $result['activation_url'],
                (string) $result['expires_at'],
            ));
        } else {
            $confirmationUrl = route('api.v1.email-changes.confirmation').'#'.$result['token'];
            Mail::to((string) $result['new_email'])->send(new EmailChangeConfirmation(
                (string) $result['member_name'],
                (string) $result['new_email'],
                $confirmationUrl,
                (string) $result['expires_at'],
            ));
        }

        Mail::to((string) $result['old_email'])->send(new EmailChangeNotice(
            (string) $result['member_name'],
            (string) $result['old_email'],
            (string) $result['new_email'],
            $result['mode'] !== 'invitation_reissued',
        ));

        if ($result['mode'] === 'invitation_reissued') {
            return ['mode' => 'invitation_reissued'];
        }

        return [
            'mode' => 'confirmation_sent',
            'expires_at' => (string) $result['expires_at'],
        ];
    }

    /** @return array{email: string, expires_at: string} */
    public function inspect(string $token): array
    {
        $change = $this->pending($token);
        $user = User::query()->find($change->user_id);
        abort_unless($user && $user->email === $change->old_email, 410, 'Tautan perubahan email tidak tersedia.');
        $this->issuer($change);

        return [
            'email' => $change->new_email,
            'expires_at' => $change->expires_at->toIso8601String(),
        ];
    }

    public function confirm(string $token): void
    {
        $initial = $this->pending($token);

        try {
            DB::transaction(function () use ($initial, $token): void {
                Tenant::query()->whereKey($initial->tenant_id)->lockForUpdate()->firstOrFail();
                $change = PendingEmailChange::query()->forTenant((int) $initial->tenant_id)
                    ->where('token_digest', hash('sha256', $token))->lockForUpdate()->first();
                abort_unless($change, 410, 'Tautan perubahan email tidak tersedia.');
                $this->assertPending($change);

                $owner = $this->issuer($change);
                $target = TenantMembership::query()->forTenant((int) $change->tenant_id)
                    ->whereKey($change->membership_id)->lockForUpdate()->firstOrFail();
                $user = User::query()->whereKey($change->user_id)->lockForUpdate()->firstOrFail();
                abort_unless($user->email === $change->old_email, 410, 'Tautan perubahan email tidak tersedia.');

                $this->singleTenant($user, (int) $change->tenant_id);
                $this->assertEmailAvailable($change->new_email, (int) $user->getKey());
                $this->sessionSupport();
                $this->applyEmail($user, $change->new_email, verified: true, oldEmail: $change->old_email);
                $change->forceFill(['confirmed_at' => now()])->save();
                $this->audit($owner, $target, 'email_change_confirmed', ['email'], [
                    'email_change_id' => (int) $change->getKey(),
                    'old_email' => $change->old_email,
                    'new_email' => $change->new_email,
                ]);
            });
        } catch (QueryException $exception) {
            if ($this->isDuplicateEmail($exception)) {
                throw ValidationException::withMessages(['email' => 'Email ini sudah digunakan akun lain.']);
            }

            throw $exception;
        }
    }

    public function cancel(TenantMembership $actor, int $changeId): void
    {
        DB::transaction(function () use ($actor, $changeId): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            $change = PendingEmailChange::query()->forTenant($tenantId)
                ->whereKey($changeId)->lockForUpdate()->firstOrFail();
            $this->assertPending($change);
            $target = TenantMembership::query()->forTenant($tenantId)
                ->whereKey($change->membership_id)->lockForUpdate()->firstOrFail();

            $change->forceFill(['revoked_at' => now()])->save();
            $this->audit($owner, $target, 'email_change_canceled', ['email_change_status'], [
                'email_change_id' => (int) $change->getKey(),
                'new_email' => $change->new_email,
            ]);
        });
    }

    private function pendingInvitation(TenantMembership $target): ?TenantAccessInvitation
    {
        return TenantAccessInvitation::query()->forTenant((int) $target->tenant_id)
            ->whereNull('accepted_at')->whereNull('revoked_at')
            ->where(function ($query) use ($target): void {
                $query->where('intended_user_id', $target->user_id)
                    ->orWhere('invitee_email', $target->user->email);
            })
            ->orderByDesc('id')->lockForUpdate()->first();
    }

    private function pending(string $token): PendingEmailChange
    {
        $change = preg_match('/^[a-f0-9]{64}$/D', $token) === 1
            ? PendingEmailChange::query()->where('token_digest', hash('sha256', $token))->first()
            : null;
        abort_unless($change, 410, 'Tautan perubahan email tidak tersedia.');
        $this->assertPending($change);

        return $change;
    }

    private function assertPending(PendingEmailChange $change): void
    {
        abort_unless(
            $change->confirmed_at === null && $change->revoked_at === null && now()->lt($change->expires_at),
            410,
            'Tautan perubahan email tidak tersedia atau sudah kedaluwarsa.',
        );
    }

    private function issuer(PendingEmailChange $change): TenantMembership
    {
        $issuer = TenantMembership::query()->forTenant((int) $change->tenant_id)
            ->whereKey($change->issued_by_membership_id)->firstOrFail();

        try {
            return $this->authorization->requireOwner($issuer);
        } catch (AuthorizationException) {
            abort(410, 'Tautan perubahan email tidak tersedia.');
        }
    }

    private function singleTenant(User $user, int $tenantId): void
    {
        if ($user->memberships()->where('tenant_id', '!=', $tenantId)->exists()) {
            throw ValidationException::withMessages([
                'membership' => 'Akun dipakai organisasi lain. Perubahan email global harus melalui pemulihan oleh pemilik akun.',
            ]);
        }
    }

    private function assertEmailAvailable(string $email, int $exceptUserId): void
    {
        if (User::query()->where('email', $email)->whereKeyNot($exceptUserId)->exists()) {
            throw ValidationException::withMessages(['email' => 'Email ini sudah digunakan akun lain.']);
        }
    }

    private function sessionSupport(): void
    {
        if (config('session.driver') !== 'database'
            || config('session.table') !== 'sessions'
            || (config('session.connection') !== null && config('session.connection') !== config('database.default'))) {
            throw ValidationException::withMessages([
                'session' => 'Perubahan email membutuhkan penyimpanan sesi database utama agar sesi lama dapat dicabut.',
            ]);
        }
    }

    private function applyEmail(User $user, string $email, bool $verified, string $oldEmail): void
    {
        $user->forceFill([
            'email' => $email,
            'email_verified_at' => $verified ? now() : null,
            'remember_token' => Str::random(60),
        ])->save();

        DB::table('sessions')->where('user_id', $user->getKey())->delete();
        if (Schema::hasTable('personal_access_tokens')) {
            DB::table('personal_access_tokens')
                ->where('tokenable_type', $user->getMorphClass())->where('tokenable_id', $user->getKey())->delete();
        }
        DB::table('password_reset_tokens')->where('email', $oldEmail)->delete();
        DB::table('owner_password_resets')->where('user_id', $user->getKey())->where('email', $oldEmail)
            ->whereNull('used_at')->whereNull('revoked_at')
            ->update(['revoked_at' => now(), 'updated_at' => now()]);
    }

    private function activationUrl(string $token): string
    {
        $base = rtrim((string) config('access.frontend_url'), '/');
        $parts = parse_url($base);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $local = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true);

        if (! in_array($scheme, ['http', 'https'], true)
            || ($scheme !== 'https' && ! $local)
            || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])) {
            throw new LogicException('ACCESS_FRONTEND_URL must be a trusted HTTPS origin, or a local HTTP origin.');
        }

        return $base.'/activate#'.$token;
    }

    /** @param list<string> $changedFields @param array<string, mixed> $details */
    private function audit(
        TenantMembership $actor,
        TenantMembership $target,
        string $action,
        array $changedFields,
        array $details,
    ): void {
        ManagementChangeEvent::query()->create([
            'tenant_id' => $actor->tenant_id,
            'actor_user_id' => $actor->user_id,
            'actor_membership_id' => $actor->getKey(),
            'employee_id' => $target->employeeUserLink()->value('employee_id'),
            'subject_type' => 'membership',
            'subject_id' => $target->getKey(),
            'action' => $action,
            'changed_fields' => $changedFields,
            'details' => $details,
            'occurred_at' => now(),
        ]);
    }

    private function isDuplicateEmail(QueryException $exception): bool
    {
        return (int) ($exception->errorInfo[1] ?? 0) === 1062
            && str_contains(strtolower($exception->getMessage()), 'users_email_unique');
    }
}
