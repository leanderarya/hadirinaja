<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\ShiftChangeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ShiftChangeController extends Controller
{
    public function __construct(private readonly ShiftChangeService $changes) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->changes->listing($request->attributes->get('activeMembership')));
    }

    public function options(Request $request): JsonResponse
    {
        $data = $request->validate(['entry_id' => ['required', 'integer', 'min:1']]);

        return response()->json($this->changes->options($request->attributes->get('activeMembership'), (int) $data['entry_id']));
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json($this->changes->create($request->attributes->get('activeMembership'), $request->all(), (string) $request->header('Idempotency-Key')));
    }

    public function respond(Request $request, int $change): JsonResponse
    {
        $data = $request->validate(['action' => ['required', 'in:accept,reject,cancel']]);

        return response()->json($this->changes->respond($request->attributes->get('activeMembership'), $change, $data['action']));
    }
}
