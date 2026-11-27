<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\TenantAccessService;
use App\Support\IdentityNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use InvalidArgumentException;

final class AuthSessionController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $user = $this->findUser($credentials['identifier']);
        $passwordMatches = Hash::check(
            $credentials['password'],
            $user?->getAuthPassword() ?? $this->dummyPasswordHash(),
        );
        $memberships = $user && $passwordMatches
            ? $this->availableMemberships($user)
            : collect();

        if (! $user || ! $passwordMatches || $memberships->isEmpty()) {
            return $this->invalidCredentials();
        }

        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->forget('active_membership_id');

        if ($memberships->count() === 1) {
            $request->session()->put('active_membership_id', $memberships->first()->getKey());
        }

        return $this->sessionResponse($request, $user, $memberships);
    }

    public function loginForInvitation(Request $request, TenantAccessService $access): JsonResponse
    {
        $credentials = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $user = $this->findUser($credentials['identifier']);
        $passwordMatches = Hash::check(
            $credentials['password'],
            $user?->getAuthPassword() ?? $this->dummyPasswordHash(),
        );

        if (! $user || ! $passwordMatches || ! $access->matchesAuthenticatedRecipient($credentials['token'], $user)) {
            return $this->invalidCredentials();
        }

        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->forget('active_membership_id');
        $memberships = $this->availableMemberships($user);
        if ($memberships->count() === 1) {
            $request->session()->put('active_membership_id', $memberships->first()->getKey());
        }

        return response()->json(['authenticated_for_invitation' => true]);
    }

    public function current(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $memberships = $this->availableMemberships($user);

        return $this->sessionResponse($request, $user, $memberships);
    }

    public function tenants(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $memberships = $this->availableMemberships($user);

        return response()->json([
            'memberships' => $memberships->map(fn (TenantMembership $membership): array => $this->membershipData($membership)),
            'active_membership_id' => $request->session()->get('active_membership_id'),
        ]);
    }

    public function selectTenant(Request $request): JsonResponse
    {
        $validated = $request->validate(['membership_id' => ['required', 'integer', 'min:1']]);
        /** @var User $user */
        $user = $request->user();
        $membership = TenantMembership::query()->with(['tenant', 'roles'])
            ->whereKey($validated['membership_id'])
            ->where('user_id', $user->getKey())
            ->where('is_active', true)
            ->first();

        if (! $membership || $membership->roles->isEmpty()) {
            return response()->json(['message' => 'Organisasi tidak tersedia.'], 404);
        }

        $request->session()->regenerate();
        $request->session()->put('active_membership_id', $membership->getKey());

        return response()->json([
            'active_membership' => $this->membershipData($membership),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['logged_out' => true]);
    }

    private function findUser(string $identifier): ?User
    {
        $identifier = trim($identifier);

        if (str_contains($identifier, '@')) {
            $normalizedEmail = IdentityNormalizer::email($identifier);

            return User::query()->where('email', $normalizedEmail)->first();
        }

        try {
            $normalizedPhone = IdentityNormalizer::phone($identifier);
        } catch (InvalidArgumentException) {
            return null;
        }

        return $normalizedPhone === null
            ? null
            : User::query()->where('phone', $normalizedPhone)->first();
    }

    /** @return Collection<int, TenantMembership> */
    private function availableMemberships(User $user): Collection
    {
        return TenantMembership::query()->with(['tenant', 'roles'])
            ->where('user_id', $user->getKey())
            ->where('is_active', true)
            ->whereHas('roles')
            ->orderBy('id')->get();
    }

    /** @return array{id: int, tenant: array{id: int, name: string}, roles: list<string>} */
    private function membershipData(TenantMembership $membership): array
    {
        return [
            'id' => (int) $membership->getKey(),
            'tenant' => [
                'id' => (int) $membership->tenant->getKey(),
                'name' => $membership->tenant->name,
            ],
            'roles' => $membership->roles
                ->map(fn ($role): string => $role->role instanceof TenantRole ? $role->role->value : (string) $role->role)
                ->values()->all(),
        ];
    }

    private function sessionResponse(Request $request, User $user, Collection $memberships): JsonResponse
    {
        $activeId = $request->session()->get('active_membership_id');
        $activeMembership = $memberships->first(fn (TenantMembership $membership): bool => (int) $membership->getKey() === (int) $activeId);

        if (! $activeMembership && $activeId !== null) {
            $request->session()->forget('active_membership_id');
        }

        return response()->json([
            'user' => [
                'id' => (int) $user->getKey(),
                'name' => $user->name,
                'email' => $user->email,
            ],
            'features' => [
                'kiosk_enabled' => (bool) config('features.kiosk_enabled'),
            ],
            'memberships' => $memberships->map(fn (TenantMembership $membership): array => $this->membershipData($membership))->values(),
            'active_membership' => $activeMembership ? $this->membershipData($activeMembership) : null,
        ]);
    }

    private function invalidCredentials(): JsonResponse
    {
        return response()->json(['message' => 'Email/nomor telepon atau kata sandi tidak valid.'], 401);
    }

    private function dummyPasswordHash(): string
    {
        static $hash;

        return $hash ??= Hash::make('invalid-password-placeholder');
    }
}
