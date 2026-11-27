<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\EmailChangeLink;
use App\Models\ManagementChangeEvent;
use App\Models\Tenant;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use App\Support\IdentityNormalizer;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class EmailChangeLinkService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    /** @return array{token: string, link_id: int, expires_at: string, email_masked: string} */
    public function issue(TenantMembership $actor, int $membershipId, string $password): array
    {
        return DB::transaction(function () use ($actor, $membershipId, $password): array {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $issuer = $this->authorizedIssuer($actor);
            $issuerUser = User::query()->whereKey($issuer->user_id)->lockForUpdate()->firstOrFail();

            if (! Hash::check($password, $issuerUser->password)) {
                throw ValidationException::withMessages(['password' => 'Password saat ini tidak sesuai.']);
            }

            $target = TenantMembership::query()->forTenant($tenantId)
                ->whereKey($membershipId)->lockForUpdate()->firstOrFail();
            if ((int) $target->user_id === (int) $issuer->user_id) {
                throw ValidationException::withMessages(['membership' => 'Anda tidak dapat menerbitkan tautan untuk akun sendiri.']);
            }
            if (! $target->is_active || $target->revoked_at !== null) {
                throw ValidationException::withMessages(['membership' => 'Akun harus aktif untuk menerbitkan tautan ubah email.']);
            }

            $user = User::query()->whereKey($target->user_id)->lockForUpdate()->firstOrFail();
            $this->authorizeTarget($issuer, $target);
            $this->rejectPendingInvitation($target, $user);

            $previousLinks = EmailChangeLink::query()->forTenant($tenantId)
                ->where('membership_id', $target->getKey())
                ->whereNull('used_at')->whereNull('revoked_at')
                ->lockForUpdate()->get();
            foreach ($previousLinks as $previousLink) {
                $previousLink->forceFill(['revoked_at' => now()])->save();
                $this->audit($issuer, $target, 'email_change_link_revoked', [
                    'email_change_link_id' => (int) $previousLink->getKey(),
                    'reason' => 'replaced',
                ]);
            }

            $token = bin2hex(random_bytes(32));
            $expires = now()->addHours(24);
            $link = EmailChangeLink::query()->create([
                'tenant_id' => $tenantId,
                'membership_id' => $target->getKey(),
                'user_id' => $user->getKey(),
                'issued_by_membership_id' => $issuer->getKey(),
                'email_at_issue' => $user->email,
                'token_digest' => hash('sha256', $token),
                'expires_at' => $expires,
            ]);
            $this->audit($issuer, $target, 'email_change_link_issued', [
                'email_change_link_id' => (int) $link->getKey(),
                'email_masked' => $this->maskEmail((string) $user->email),
            ]);

            return [
                'token' => $token,
                'link_id' => (int) $link->getKey(),
                'expires_at' => $expires->toIso8601String(),
                'email_masked' => $this->maskEmail((string) $user->email),
            ];
        });
    }

    /** @return array{email_masked: string, expires_at: string} */
    public function inspect(string $token): array
    {
        $link = $this->pending($token);
        $user = User::query()->find($link->user_id);
        abort_unless($user && $user->email === $link->email_at_issue, 410, 'Tautan ubah email tidak tersedia.');

        return [
            'email_masked' => $this->maskEmail((string) $link->email_at_issue),
            'expires_at' => $link->expires_at->toIso8601String(),
        ];
    }

    public function consume(string $token, string $email, string $password): int
    {
        $initial = $this->pending($token);

        try {
            return DB::transaction(function () use ($initial, $token, $email, $password): int {
                Tenant::query()->whereKey($initial->tenant_id)->lockForUpdate()->firstOrFail();
                $link = EmailChangeLink::query()->forTenant((int) $initial->tenant_id)
                    ->where('token_digest', hash('sha256', $token))->lockForUpdate()->first();
                abort_unless($link, 410, 'Tautan ubah email tidak tersedia.');
                $this->assertPending($link);

                $target = TenantMembership::query()->forTenant((int) $link->tenant_id)
                    ->whereKey($link->membership_id)->lockForUpdate()->firstOrFail();
                $user = User::query()->whereKey($link->user_id)->lockForUpdate()->firstOrFail();
                abort_unless(
                    (int) $target->user_id === (int) $user->getKey()
                        && $user->email === $link->email_at_issue,
                    410,
                    'Tautan ubah email tidak tersedia.',
                );

                if (! Hash::check($password, $user->password)) {
                    throw ValidationException::withMessages(['password' => 'Password saat ini tidak sesuai.']);
                }

                $email = IdentityNormalizer::email($email);
                if ($user->email === $email) {
                    throw ValidationException::withMessages(['email' => 'Email baru harus berbeda dari email saat ini.']);
                }
                $this->assertEmailAvailable($email, (int) $user->getKey());
                $this->sessionSupport();

                $oldEmail = (string) $user->email;
                $user->forceFill([
                    'email' => $email,
                    'email_verified_at' => null,
                    'remember_token' => Str::random(60),
                ])->save();

                DB::table('sessions')->where('user_id', $user->getKey())->delete();
                if (Schema::hasTable('personal_access_tokens')) {
                    DB::table('personal_access_tokens')
                        ->where('tokenable_type', $user->getMorphClass())
                        ->where('tokenable_id', $user->getKey())->delete();
                }
                DB::table('password_reset_tokens')->where('email', $oldEmail)->delete();
                if (Schema::hasTable('owner_password_resets')) {
                    DB::table('owner_password_resets')->where('user_id', $user->getKey())
                        ->whereNull('used_at')->whereNull('revoked_at')
                        ->update(['revoked_at' => now(), 'updated_at' => now()]);
                }

                $this->audit($target, $target, 'email_change_completed', [
                    'email_change_link_id' => (int) $link->getKey(),
                    'old_email_masked' => $this->maskEmail($oldEmail),
                    'new_email_masked' => $this->maskEmail($email),
                ]);
                $link->forceFill(['used_at' => now()])->save();

                return (int) $user->getKey();
            });
        } catch (QueryException $exception) {
            if ($this->isDuplicateEmail($exception)) {
                throw ValidationException::withMessages(['email' => 'Email ini sudah digunakan akun lain.']);
            }

            throw $exception;
        }
    }

    public function revoke(TenantMembership $actor, int $linkId): void
    {
        DB::transaction(function () use ($actor, $linkId): void {
            $tenantId = (int) $actor->tenant_id;
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->firstOrFail();
            $issuer = $this->authorizedIssuer($actor);
            $link = EmailChangeLink::query()->forTenant($tenantId)
                ->whereKey($linkId)->lockForUpdate()->firstOrFail();
            $this->assertPending($link);

            if (! $this->authorization->hasRole($issuer, TenantRole::Owner)
                && (int) $link->issued_by_membership_id !== (int) $issuer->getKey()) {
                throw new AuthorizationException('Only the issuer or an Owner can revoke this email change link.');
            }

            $target = TenantMembership::query()->forTenant($tenantId)
                ->whereKey($link->membership_id)->lockForUpdate()->firstOrFail();
            $link->forceFill(['revoked_at' => now()])->save();
            $this->audit($issuer, $target, 'email_change_link_revoked', [
                'email_change_link_id' => (int) $link->getKey(),
                'reason' => 'issuer_revoked',
            ]);
        });
    }

    private function authorizedIssuer(TenantMembership $actor): TenantMembership
    {
        if (! $this->authorization->hasRole($actor, TenantRole::Owner)
            && ! $this->authorization->hasRole($actor, TenantRole::Supervisor)) {
            throw new AuthorizationException('An active tenant Owner or Supervisor membership is required.');
        }

        return $actor;
    }

    private function authorizeTarget(TenantMembership $issuer, TenantMembership $target): void
    {
        if ($this->authorization->hasRole($issuer, TenantRole::Owner)) {
            return;
        }

        $hasEmployeeRole = $target->roles()->where('role', TenantRole::Employee->value)->exists();
        $hasExcludedRole = $target->roles()->whereIn('role', [
            TenantRole::Owner->value,
            TenantRole::Supervisor->value,
        ])->exists();
        $target->loadMissing('employeeUserLink.employee');
        $employee = $target->employeeUserLink?->employee;

        abort_unless(
            $hasEmployeeRole
                && ! $hasExcludedRole
                && $employee !== null
                && $this->authorization->canManageEmployee($issuer, $employee),
            404,
            'Anggota tidak berada dalam cakupan Supervisor.',
        );
    }

    private function rejectPendingInvitation(TenantMembership $target, User $user): void
    {
        $pendingInvitation = TenantAccessInvitation::query()->forTenant((int) $target->tenant_id)
            ->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())
            ->where(fn ($query) => $query->where('intended_user_id', $user->getKey())
                ->orWhere('invitee_email', $user->email))
            ->exists();

        if ($pendingInvitation) {
            throw ValidationException::withMessages(['membership' => 'Ubah email di undangan.']);
        }
    }

    private function pending(string $token): EmailChangeLink
    {
        $link = preg_match('/^[a-f0-9]{64}$/D', $token) === 1
            ? EmailChangeLink::query()->where('token_digest', hash('sha256', $token))->first()
            : null;
        abort_unless($link, 410, 'Tautan ubah email tidak tersedia.');
        $this->assertPending($link);

        return $link;
    }

    private function assertPending(EmailChangeLink $link): void
    {
        abort_unless(
            $link->used_at === null && $link->revoked_at === null && now()->lt($link->expires_at),
            410,
            'Tautan ubah email tidak tersedia atau sudah kedaluwarsa.',
        );
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

    private function maskEmail(string $email): string
    {
        [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');

        return Str::substr($local, 0, 1).'***@'.$domain;
    }

    /** @param array<string, mixed> $details */
    private function audit(TenantMembership $actor, TenantMembership $target, string $action, array $details): void
    {
        ManagementChangeEvent::query()->create([
            'tenant_id' => $target->tenant_id,
            'actor_user_id' => $actor->user_id,
            'actor_membership_id' => $actor->getKey(),
            'employee_id' => $target->employeeUserLink()->value('employee_id'),
            'subject_type' => 'membership',
            'subject_id' => $target->getKey(),
            'action' => $action,
            'changed_fields' => $action === 'email_change_completed' ? ['email'] : ['email_change_link'],
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
