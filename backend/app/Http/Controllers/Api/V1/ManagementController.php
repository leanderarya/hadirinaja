<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\BusinessUnit;
use App\Models\Employee;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\EmployeePinService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use App\Services\TenantAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ManagementController extends Controller
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly OrganizationService $organization,
        private readonly KioskPairingService $kiosks,
        private readonly EmployeePinService $employeePins,
    ) {}

    public function organization(Request $request): JsonResponse
    {
        $membership = $this->activeMembership($request);
        /** @var User $user */
        $user = $request->user();
        $tenant = $membership->tenant;
        $tenantId = (int) $membership->tenant_id;
        $businessUnits = $this->authorization->businessUnitsFor($user, $tenantId);
        $outlets = $this->authorization->outletsFor($user, $tenantId);
        $employees = $this->authorization->employeesFor($user, $tenantId);

        return response()->json([
            'tenant' => ['id' => $tenantId, 'name' => $tenant->name],
            'roles' => $membership->roles()->pluck('role')->map(fn ($role): string => $role instanceof TenantRole ? $role->value : (string) $role)->values(),
            'business_units' => $businessUnits->map(fn ($unit): array => [
                'id' => (int) $unit->getKey(), 'name' => $unit->name,
            ])->values(),
            'outlets' => $outlets->map(fn ($outlet): array => [
                'id' => (int) $outlet->getKey(),
                'name' => $outlet->name,
                'business_unit_id' => (int) $outlet->business_unit_id,
            ])->values(),
            'employee_count' => $employees->count(),
        ]);
    }

    public function employees(Request $request): JsonResponse
    {
        $membership = $this->activeMembership($request);
        /** @var User $user */
        $user = $request->user();
        $employees = $this->authorization->employeesFor($user, (int) $membership->tenant_id);

        return response()->json([
            'employees' => $employees->map(fn (Employee $employee): array => [
                'id' => (int) $employee->getKey(), 'name' => $employee->name,
            ])->values(),
        ]);
    }

    public function employee(Request $request, int $employee): JsonResponse
    {
        $membership = $this->activeMembership($request);
        /** @var User $user */
        $user = $request->user();
        $record = Employee::query()->forTenant((int) $membership->tenant_id)->whereKey($employee)->first();

        if (! $record || ! $this->authorization->canAccessEmployee($user, (int) $membership->tenant_id, $employee)) {
            return response()->json(['message' => 'Karyawan tidak tersedia.'], 404);
        }

        return response()->json(['employee' => ['id' => (int) $record->getKey(), 'name' => $record->name]]);
    }

    public function createBusinessUnit(Request $request): JsonResponse
    {
        $validated = $request->validate(['name' => ['required', 'string', 'max:120']]);
        $unit = $this->organization->createBusinessUnit($this->activeMembership($request), $validated['name']);

        return response()->json(['business_unit' => ['id' => (int) $unit->getKey(), 'name' => $unit->name]], 201);
    }

    public function createOutlet(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_unit_id' => ['required', 'integer', 'min:1'],
            'name' => ['required', 'string', 'max:120'],
        ]);
        $businessUnit = new BusinessUnit;
        $businessUnit->setAttribute($businessUnit->getKeyName(), $validated['business_unit_id']);
        $outlet = $this->organization->createOutlet($this->activeMembership($request), $businessUnit, $validated['name']);

        return response()->json(['outlet' => [
            'id' => (int) $outlet->getKey(),
            'name' => $outlet->name,
            'business_unit_id' => (int) $outlet->business_unit_id,
        ]], 201);
    }

    public function kiosks(Request $request): JsonResponse
    {
        $membership = app(TenantAuthorization::class)->requireOwner($this->activeMembership($request));
        $devices = KioskDevice::query()->forTenant((int) $membership->tenant_id)->with('outlet')
            ->orderBy('id')->get();

        return response()->json(['kiosks' => $devices->map(fn (KioskDevice $device): array => [
            'id' => (int) $device->getKey(),
            'name' => $device->name,
            'outlet_id' => (int) $device->outlet_id,
            'outlet_name' => $device->outlet->name,
            'paired_at' => $device->paired_at->toIso8601String(),
            'last_seen_at' => $device->last_seen_at?->toIso8601String(),
            'revoked_at' => $device->revoked_at?->toIso8601String(),
        ])->values()]);
    }

    public function issuePairingCode(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'name' => ['required', 'string', 'max:120'],
        ]);
        $outlet = new Outlet;
        $outlet->setAttribute($outlet->getKeyName(), $validated['outlet_id']);
        $result = $this->kiosks->issuePairingCode($this->activeMembership($request), $outlet, $validated['name']);

        return response()->json([
            'pairing_code' => $result['code'],
            'expires_at' => $result['expires_at'],
        ], 201);
    }

    public function revokeKiosk(Request $request, int $device): JsonResponse
    {
        $this->kiosks->revokeDevice($this->activeMembership($request), $device);

        return response()->json(['revoked' => true]);
    }

    public function issuePinEnrollment(Request $request, int $employee): JsonResponse
    {
        $validated = $request->validate(['outlet_id' => ['required', 'integer', 'min:1']]);
        $employeeModel = new Employee;
        $employeeModel->setAttribute($employeeModel->getKeyName(), $employee);
        $outlet = new Outlet;
        $outlet->setAttribute($outlet->getKeyName(), $validated['outlet_id']);
        $result = $this->employeePins->issueEnrollmentCode($this->activeMembership($request), $employeeModel, $outlet);

        return response()->json([
            'enrollment_code' => $result['code'],
            'expires_at' => $result['expires_at'],
        ], 201);
    }

    private function activeMembership(Request $request): TenantMembership
    {
        /** @var TenantMembership $membership */
        $membership = $request->attributes->get('activeMembership');

        return $membership;
    }
}
