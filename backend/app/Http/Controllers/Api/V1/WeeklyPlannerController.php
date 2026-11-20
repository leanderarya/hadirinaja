<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\WeeklyPlannerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class WeeklyPlannerController extends Controller
{
    public function __construct(private readonly WeeklyPlannerService $planner) {}

    public function show(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        return response()->json($this->planner->read($request->attributes->get('activeMembership'), $outlet, $weekStart));
    }

    public function save(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        return response()->json($this->planner->save($request->attributes->get('activeMembership'), $outlet, $weekStart, $request->all(), (string) $request->header('Idempotency-Key')));
    }

    public function copy(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        return response()->json($this->planner->copy($request->attributes->get('activeMembership'), $outlet, $weekStart, $request->all(), (string) $request->header('Idempotency-Key')));
    }

    public function validate(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        if ($request->exists('expected_published_revision_id') || $request->exists('entries')) {
            return response()->json($this->planner->validateCandidate(
                $request->attributes->get('activeMembership'),
                $outlet,
                $weekStart,
                $request->all(),
            ));
        }

        $data = $request->validate(['expected_version' => ['required', 'integer', 'min:1']]);

        return response()->json($this->planner->validate($request->attributes->get('activeMembership'), $outlet, $weekStart, (int) $data['expected_version']));
    }

    public function saveChanges(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        return response()->json($this->planner->saveChanges(
            $request->attributes->get('activeMembership'),
            $outlet,
            $weekStart,
            $request->all(),
            (string) $request->header('Idempotency-Key'),
        ));
    }

    public function publish(Request $request, int $outlet, string $weekStart): JsonResponse
    {
        return response()->json($this->planner->publish($request->attributes->get('activeMembership'), $outlet, $weekStart, $request->all(), (string) $request->header('Idempotency-Key')));
    }
}
