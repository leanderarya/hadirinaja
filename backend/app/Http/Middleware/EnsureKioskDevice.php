<?php

namespace App\Http\Middleware;

use App\Models\KioskDevice;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureKioskDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->cookie('hadirinaja_kiosk');

        if (! is_string($token) || strlen($token) < 32 || strlen($token) > 128) {
            return response()->json([
                'code' => 'kiosk_not_paired',
                'message' => 'Perangkat ini belum dipasangkan.',
            ], 401);
        }

        $device = KioskDevice::query()->with(['tenant', 'outlet'])
            ->where('credential_hash', hash('sha256', $token))
            ->first();

        if (! $device) {
            return response()->json([
                'code' => 'kiosk_not_paired',
                'message' => 'Perangkat ini belum dipasangkan.',
            ], 401);
        }

        if ($device->revoked_at !== null || $device->credentialExpired()) {
            return response()->json([
                'code' => $device->revoked_at !== null ? 'kiosk_revoked' : 'kiosk_expired',
                'message' => $device->revoked_at !== null ? 'Akses perangkat ini sudah dicabut.' : 'Akses perangkat kedaluwarsa. Minta Owner menerbitkan kode pembaruan.',
            ], 403)->withCookie(cookie(
                'hadirinaja_kiosk', '', -262800, '/api/v1/kiosk', config('session.domain'),
                (bool) config('session.secure'), true, false, config('session.same_site', 'lax'),
            ));
        }

        $device->forceFill(['last_seen_at' => now()])->save();
        $request->attributes->set('kioskDevice', $device);

        return $next($request);
    }
}
