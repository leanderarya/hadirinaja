<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureKioskEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('features.kiosk_enabled')) {
            return response()->json([
                'code' => 'kiosk_disabled',
                'message' => 'Kiosk belum diaktifkan.',
            ], 404);
        }

        return $next($request);
    }
}
