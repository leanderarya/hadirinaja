<?php

namespace App\Http\Middleware;

use App\Models\TenantMembership;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureActiveTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $membershipId = $request->session()->get('active_membership_id');

        $membership = $user && is_numeric($membershipId)
            ? TenantMembership::query()
                ->with('tenant')
                ->whereKey((int) $membershipId)
                ->where('user_id', $user->getKey())
                ->where('is_active', true)
                ->first()
            : null;

        if (! $membership || ! $membership->roles()->exists()) {
            $request->session()->forget('active_membership_id');

            return response()->json([
                'code' => 'active_membership_required',
                'message' => 'Pilih organisasi aktif untuk melanjutkan.',
            ], 409);
        }

        $request->attributes->set('activeMembership', $membership);

        return $next($request);
    }
}
