<?php

namespace App\Services;

use App\Models\ManagementChangeEvent;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class OwnerPasswordResetService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function issue(TenantMembership $actor, int $membership, string $password): array
    {
        return DB::transaction(function () use ($actor, $membership, $password): array {
            Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            if (! Hash::check($password, $owner->user->password)) {
                throw ValidationException::withMessages(['password' => 'Password Owner tidak sesuai.']);
            }
            $target = TenantMembership::query()->forTenant((int) $owner->tenant_id)->whereKey($membership)->lockForUpdate()->firstOrFail();
            if ((int) $target->user_id === (int) $owner->user_id) {
                throw ValidationException::withMessages(['membership' => 'Gunakan Owner aktif lain untuk reset akun Anda.']);
            }
            $user = User::query()->whereKey($target->user_id)->lockForUpdate()->firstOrFail();
            $this->singleTenant($user, (int) $owner->tenant_id);
            $this->sessionSupport();
            DB::table('owner_password_resets')->where('user_id', $user->id)->whereNull('used_at')->whereNull('revoked_at')->update(['revoked_at' => now(), 'updated_at' => now()]);
            $token = bin2hex(random_bytes(32));
            $expires = now()->addMinutes(max(5, min(120, (int) config('access.password_reset_expiration_minutes', 30))));
            $id = DB::table('owner_password_resets')->insertGetId([
                'tenant_id' => $owner->tenant_id, 'user_id' => $user->id, 'target_membership_id' => $target->id,
                'issued_by_membership_id' => $owner->id, 'email' => $user->email, 'token_digest' => hash('sha256', $token),
                'password_fingerprint' => $this->fingerprint($user), 'expires_at' => $expires, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->audit($owner, $id, 'password_reset_issued');

            return ['reset_token' => $token, 'reset_id' => $id, 'email' => $user->email, 'expires_at' => $expires->toIso8601String(), 'role_unchanged' => true];
        });
    }

    public function inspect(string $token): array
    {
        $reset = $this->pending($token);
        $user = User::find($reset->user_id);
        abort_unless($user && $user->email === $reset->email && hash_equals($reset->password_fingerprint, $this->fingerprint($user)), 410, 'Tautan reset tidak tersedia.');
        $this->singleTenant($user, (int) $reset->tenant_id);
        $this->issuer($reset);

        return ['email' => $reset->email, 'expires_at' => $reset->expires_at, 'role_unchanged' => true];
    }

    public function consume(string $token, string $password): int
    {
        $initial = $this->pending($token);

        return DB::transaction(function () use ($initial, $token, $password): int {
            Tenant::query()->whereKey($initial->tenant_id)->lockForUpdate()->firstOrFail();
            $user = User::query()->whereKey($initial->user_id)->lockForUpdate()->firstOrFail();
            $reset = $this->pending($token, true);
            abort_unless($user->email === $reset->email && hash_equals($reset->password_fingerprint, $this->fingerprint($user)), 410, 'Tautan reset tidak tersedia.');
            $this->singleTenant($user, (int) $reset->tenant_id);
            $issuer = $this->issuer($reset);
            $this->sessionSupport();
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            DB::table('sessions')->where('user_id', $user->id)->delete();
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
            DB::table('owner_password_resets')->where('id', $reset->id)->update(['used_at' => now(), 'updated_at' => now()]);
            DB::table('owner_password_resets')->where('user_id', $user->id)->where('id', '!=', $reset->id)->whereNull('used_at')->whereNull('revoked_at')->update(['revoked_at' => now(), 'updated_at' => now()]);
            $this->audit($issuer, (int) $reset->id, 'password_reset_completed');

            return (int) $user->id;
        });
    }

    public function revoke(TenantMembership $actor, int $id, string $password): void
    {
        DB::transaction(function () use ($actor, $id, $password): void {
            Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $owner = $this->authorization->requireOwner($actor);
            if (! Hash::check($password, $owner->user->password)) {
                throw ValidationException::withMessages(['password' => 'Password Owner tidak sesuai.']);
            }
            $reset = DB::table('owner_password_resets')->where('tenant_id', $owner->tenant_id)->where('id', $id)->lockForUpdate()->firstOrFail();
            abort_if($reset->used_at !== null, 410, 'Tautan sudah digunakan.');
            if ($reset->revoked_at === null) {
                DB::table('owner_password_resets')->where('id', $id)->update(['revoked_at' => now(), 'updated_at' => now()]);
                $this->audit($owner, $id, 'password_reset_revoked');
            }
        });
    }

    private function pending(string $token, bool $lock = false): object
    {
        $query = DB::table('owner_password_resets')->where('token_digest', hash('sha256', $token));
        $reset = ($lock ? $query->lockForUpdate() : $query)->first();
        abort_unless($reset && $reset->used_at === null && $reset->revoked_at === null && now()->lt($reset->expires_at), 410, 'Tautan reset tidak tersedia atau sudah kedaluwarsa.');

        return $reset;
    }

    private function issuer(object $reset): TenantMembership
    {
        $issuer = TenantMembership::query()->forTenant((int) $reset->tenant_id)->findOrFail($reset->issued_by_membership_id);

        return $this->authorization->requireOwner($issuer);
    }

    private function singleTenant(User $user, int $tenant): void
    {
        if ($user->memberships()->where('tenant_id', '!=', $tenant)->exists()) {
            throw ValidationException::withMessages(['membership' => 'Akun dipakai organisasi lain. Reset global harus melalui pemulihan oleh pemilik akun.']);
        }
    }

    private function fingerprint(User $user): string
    {
        return hash_hmac('sha256', $user->password, (string) config('app.key'));
    }

    private function sessionSupport(): void
    {
        if (config('session.driver') !== 'database' || config('session.table') !== 'sessions' || (config('session.connection') !== null && config('session.connection') !== config('database.default'))) {
            throw ValidationException::withMessages(['session' => 'Reset membutuhkan penyimpanan sesi database utama agar sesi lama dapat dicabut.']);
        }
    }

    private function audit(TenantMembership $actor, int $id, string $action): void
    {
        ManagementChangeEvent::create(['tenant_id' => $actor->tenant_id, 'actor_user_id' => $actor->user_id, 'actor_membership_id' => $actor->id, 'subject_type' => 'password_reset', 'subject_id' => $id, 'action' => $action, 'changed_fields' => ['password'], 'occurred_at' => now()]);
    }
}
