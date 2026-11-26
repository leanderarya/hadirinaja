<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\EmailChangeLinkService;
use App\Services\TenantAuthorization;
use App\Support\IdentityNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class EmailChangeLinkController extends Controller
{
    public function __construct(
        private readonly EmailChangeLinkService $links,
        private readonly TenantAuthorization $authorization,
    ) {}

    public function issue(Request $request, int $membership): JsonResponse
    {
        $actor = $this->activeMembership($request);
        $validated = $request->validate([
            'password' => ['required', 'string', 'max:255'],
        ]);

        return response()->json(
            $this->links->issue($actor, $membership, $validated['password']),
            201,
        );
    }

    public function revoke(Request $request, int $link): JsonResponse
    {
        $this->links->revoke($this->activeMembership($request), $link);

        return response()->json(['revoked' => true]);
    }

    public function inspect(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string'],
        ]);

        return response()->json($this->links->inspect($validated['token']));
    }

    public function consume(Request $request): JsonResponse
    {
        $email = $request->input('email');
        $confirmation = $request->input('email_confirmation');
        $request->merge([
            'email' => is_string($email) ? IdentityNormalizer::email($email) : $email,
            'email_confirmation' => is_string($confirmation) ? IdentityNormalizer::email($confirmation) : $confirmation,
        ]);
        $validated = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'string', 'email', 'max:255', 'same:email_confirmation'],
            'email_confirmation' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);
        $userId = $this->links->consume(
            $validated['token'],
            $validated['email'],
            $validated['password'],
        );

        if ((int) $request->user()?->getAuthIdentifier() === $userId && $request->hasSession()) {
            Auth::guard('web')->logoutCurrentDevice();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['email_changed' => true]);
    }

    private function activeMembership(Request $request): TenantMembership
    {
        $actor = $request->attributes->get('activeMembership');
        abort_unless(
            $actor instanceof TenantMembership
                && (int) $actor->user_id === (int) $request->user()?->getAuthIdentifier(),
            403,
        );

        return $actor;
    }
}
