<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\OwnerPasswordResetService;
use App\Services\TenantAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;

final class OwnerPasswordResetController extends Controller
{
    public function __construct(private readonly OwnerPasswordResetService $resets, private readonly TenantAuthorization $authorization) {}

    public function issue(Request $request, int $membership): JsonResponse
    {
        $actor = $this->owner($request);
        $data = $request->validate(['password' => ['required', 'string', 'max:255']]);

        return response()->json($this->resets->issue($actor, $membership, $data['password']), 201);
    }

    public function revoke(Request $request, int $reset): JsonResponse
    {
        $actor = $this->owner($request);
        $data = $request->validate(['password' => ['required', 'string', 'max:255']]);
        $this->resets->revoke($actor, $reset, $data['password']);

        return response()->json(['revoked' => true]);
    }

    public function inspect(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D']]);

        return response()->json($this->resets->inspect($data['token']));
    }

    public function consume(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D'],
            'password' => ['required', 'string', 'confirmed', 'max:255', Password::defaults(), function (string $attribute, mixed $value, \Closure $fail): void {
                if (! is_string($value)) {
                    return;
                }
                if (str_contains($value, "\0") || (config('hashing.driver') === 'bcrypt' && strlen($value) > 72)) {
                    $fail('Password tidak boleh berisi karakter null dan maksimal 72 byte untuk bcrypt.');
                }
            }],
        ]);
        $userId = $this->resets->consume($data['token'], $data['password']);
        if ((int) $request->user()?->getAuthIdentifier() === $userId && $request->hasSession()) {
            Auth::guard('web')->logoutCurrentDevice();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['password_reset' => true, 'role_unchanged' => true]);
    }

    private function owner(Request $request): TenantMembership
    {
        $actor = $request->attributes->get('activeMembership');
        abort_unless($actor instanceof TenantMembership && (int) $actor->user_id === (int) $request->user()?->getAuthIdentifier(), 403);

        return $this->authorization->requireOwner($actor);
    }
}
