<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\KioskDevice;
use App\Services\EmployeePinService;
use App\Services\KioskPairingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

final class KioskAccessController extends Controller
{
    public function __construct(
        private readonly KioskPairingService $pairing,
        private readonly EmployeePinService $employeePins,
    ) {}

    public function pair(Request $request): JsonResponse
    {
        $validated = $request->validate(['code' => ['required', 'string', 'max:64']]);

        try {
            $result = $this->pairing->redeemPairingCode($validated['code']);
        } catch (ValidationException) {
            return response()->json([
                'code' => 'pairing_code_invalid',
                'message' => 'Kode pemasangan tidak valid atau kedaluwarsa.',
            ], 401);
        }

        $cookie = cookie(
            'hadirinaja_kiosk',
            $result['token'],
            60 * 24 * 365,
            '/api/v1/kiosk',
            config('session.domain'),
            (bool) config('session.secure'),
            true,
            false,
            config('session.same_site', 'lax'),
        );

        return response()->json(['paired' => true])->withCookie($cookie);
    }

    public function status(Request $request): JsonResponse
    {
        /** @var KioskDevice $device */
        $device = $request->attributes->get('kioskDevice');

        return response()->json([
            'status' => 'ready',
            'device' => ['id' => (int) $device->getKey(), 'name' => $device->name],
            'tenant' => ['id' => (int) $device->tenant_id, 'name' => $device->tenant->name],
            'outlet' => ['id' => (int) $device->outlet_id, 'name' => $device->outlet->name],
        ]);
    }

    public function enrollPin(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:64'],
            'pin' => ['required', 'string', 'regex:/^\d{6,8}$/D', 'confirmed'],
        ]);
        /** @var KioskDevice $device */
        $device = $request->attributes->get('kioskDevice');

        try {
            $this->employeePins->redeemEnrollmentCode($device, $validated['code'], $validated['pin']);
        } catch (ValidationException) {
            return response()->json([
                'code' => 'pin_enrollment_invalid',
                'message' => 'Kode aktivasi PIN tidak valid atau kedaluwarsa.',
            ], 401);
        }

        return response()->json(['enrolled' => true]);
    }

    public function verifyPin(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'pin' => ['required', 'string', 'regex:/^\d{6,8}$/D'],
        ]);
        /** @var KioskDevice $device */
        $device = $request->attributes->get('kioskDevice');

        try {
            $employee = $this->employeePins->verify($device, (int) $validated['employee_id'], $validated['pin']);
        } catch (TooManyRequestsHttpException) {
            return response()->json([
                'code' => 'pin_rate_limited',
                'message' => 'PIN tidak dapat diverifikasi saat ini. Coba lagi nanti.',
            ], 429);
        }

        if (! $employee) {
            return response()->json([
                'code' => 'pin_invalid',
                'message' => 'PIN atau identitas tidak valid.',
            ], 401);
        }

        return response()->json([
            'verified' => true,
            'employee' => ['id' => (int) $employee->getKey(), 'name' => $employee->name],
        ]);
    }
}
