<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\OwnerEmailChangeService;
use App\Services\TenantAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class OwnerEmailChangeController extends Controller
{
    public function __construct(
        private readonly OwnerEmailChangeService $changes,
        private readonly TenantAuthorization $authorization,
    ) {}

    public function request(Request $request, int $membership): JsonResponse
    {
        $owner = $this->owner($request);
        $validated = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
        ]);

        return response()->json($this->changes->request($owner, $membership, $validated['email']));
    }

    public function cancel(Request $request, int $change): JsonResponse
    {
        $this->changes->cancel($this->owner($request), $change);

        return response()->json(['canceled' => true]);
    }

    public function confirmationPage(): Response
    {
        return response()->view('email-change-confirmation-form', [
            'inspectUrl' => route('api.v1.email-changes.inspect'),
            'confirmationUrl' => route('api.v1.email-changes.confirm'),
        ]);
    }

    public function inspect(Request $request): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'size:64']]);

        return response()->json($this->changes->inspect($validated['token']));
    }

    public function confirm(Request $request): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'size:64']]);
        $this->changes->confirm($validated['token']);

        return response()->json(['email_changed' => true]);
    }

    private function owner(Request $request): TenantMembership
    {
        $actor = $request->attributes->get('activeMembership');
        abort_unless(
            $actor instanceof TenantMembership
                && (int) $actor->user_id === (int) $request->user()?->getAuthIdentifier(),
            403,
        );

        return $this->authorization->requireOwner($actor);
    }
}
