<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PlannerNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class PlannerNotificationController extends Controller
{
    public function __construct(private readonly PlannerNotificationService $notifications) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['before' => ['sometimes', 'integer', 'min:1']]);

        return response()->json($this->notifications->inbox($request->attributes->get('activeMembership'), isset($data['before']) ? (int) $data['before'] : null));
    }

    public function read(Request $request, int $notification): JsonResponse
    {
        return response()->json($this->notifications->read($request->attributes->get('activeMembership'), $notification));
    }
}
