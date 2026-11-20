<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\AttendanceEvidenceLegalHoldService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AttendanceEvidenceLegalHoldController extends Controller
{
    public function __construct(private readonly AttendanceEvidenceLegalHoldService $holds) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->holds->index($this->activeMembership($request)));
    }

    public function requestPlacement(Request $request, int $event): JsonResponse
    {
        $validated = $request->validate([
            'hold_reference' => ['required', 'string', 'max:128'],
            'justification' => ['required', 'string', 'min:20', 'max:2000'],
            'duration_days' => ['required', 'integer', 'min:1', 'max:90'],
        ]);
        $holdRequest = $this->holds->requestPlacement(
            $this->activeMembership($request),
            $event,
            trim($validated['hold_reference']),
            trim($validated['justification']),
            (int) $validated['duration_days'],
        );

        return response()->json(['request' => $holdRequest], 201);
    }

    public function requestExtension(Request $request, int $hold): JsonResponse
    {
        $validated = $request->validate([
            'justification' => ['required', 'string', 'min:20', 'max:2000'],
            'duration_days' => ['required', 'integer', 'min:1', 'max:90'],
        ]);
        $holdRequest = $this->holds->requestExtension(
            $this->activeMembership($request),
            $hold,
            trim($validated['justification']),
            (int) $validated['duration_days'],
        );

        return response()->json(['request' => $holdRequest], 201);
    }

    public function approve(Request $request, int $holdRequest): JsonResponse
    {
        $validated = $request->validate([
            'decision_reason' => ['required', 'string', 'min:10', 'max:1000'],
        ]);

        return response()->json(['request' => $this->holds->decide(
            $this->activeMembership($request), $holdRequest, true, trim($validated['decision_reason']),
        )]);
    }

    public function reject(Request $request, int $holdRequest): JsonResponse
    {
        $validated = $request->validate([
            'decision_reason' => ['required', 'string', 'min:10', 'max:1000'],
        ]);

        return response()->json(['request' => $this->holds->decide(
            $this->activeMembership($request), $holdRequest, false, trim($validated['decision_reason']),
        )]);
    }

    public function release(Request $request, int $hold): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
        ]);

        return response()->json($this->holds->release(
            $this->activeMembership($request), $hold, trim($validated['reason']),
        ));
    }

    private function activeMembership(Request $request): TenantMembership
    {
        $membership = $request->attributes->get('activeMembership');
        if (! $membership instanceof TenantMembership
            || (int) $membership->user_id !== (int) $request->user()?->getAuthIdentifier()) {
            throw new AuthorizationException('An active tenant membership is required.');
        }

        return $membership;
    }
}
