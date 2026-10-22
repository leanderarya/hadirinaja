<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

final class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::selectOne('SELECT 1');
        } catch (Throwable) {
            return response()->json([
                'status' => 'unhealthy',
                'checks' => ['database' => 'unavailable'],
            ], 503);
        }

        return response()->json([
            'status' => 'healthy',
            'checks' => ['database' => 'available'],
        ]);
    }
}
