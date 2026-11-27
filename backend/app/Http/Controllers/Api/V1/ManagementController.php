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
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeePinService;
use App\Services\KioskPairingService;
use App\Services\ManagementChangeRecorder;
use App\Services\OrganizationService;
use App\Services\TenantAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class ManagementController extends Controller
{
    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly OrganizationService $organization,
        private readonly KioskPairingService $kiosks,
        private readonly EmployeePinService $employeePins,
        private readonly EmployeeOutletAssignmentService $assignments,
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
                'address' => $outlet->address,
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
            'employees' => $employees->map(fn (Employee $employee): array => $this->employeePayload($employee))->values(),
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

        return response()->json(['employee' => $this->employeePayload($record)]);
    }

    public function createEmployee(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'business_unit_id' => ['required', 'integer', 'min:1'],
            'outlet_id' => ['required', 'integer', 'min:1'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
        ]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $unit = BusinessUnit::query()->forTenant((int) $actor->tenant_id)->whereKey($validated['business_unit_id'])->first();
        abort_if(! $unit, 404);
        $outlet = Outlet::query()->forTenant((int) $actor->tenant_id)
            ->whereKey($validated['outlet_id'])->where('business_unit_id', $unit->getKey())->first();
        abort_if(! $outlet, 422, 'Outlet harus berada di Business Unit yang dipilih.');

        $employee = DB::transaction(function () use ($actor, $validated, $outlet): Employee {
            $employee = $this->organization->registerEmployee($actor, $validated['name']);
            $this->assignments->assignPrimaryOutlet($actor, $employee, $outlet, Carbon::createFromFormat('!Y-m-d', $validated['effective_from'], 'UTC'));
            $this->recordManagementChange($actor, 'employee', (int) $employee->getKey(), 'created', ['name', 'placement'], (int) $employee->getKey(), (int) $outlet->getKey());

            return $employee;
        });

        return response()->json(['employee' => $this->employeePayload($employee)], 201);
    }

    public function updateEmployee(Request $request, int $employee): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'business_unit_id' => ['required', 'integer', 'min:1'],
            'outlet_id' => ['required', 'integer', 'min:1'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
        ]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $record = Employee::query()->forTenant((int) $actor->tenant_id)->whereKey($employee)->first();
        abort_if(! $record, 404);
        $unit = BusinessUnit::query()->forTenant((int) $actor->tenant_id)->whereKey($validated['business_unit_id'])->first();
        abort_if(! $unit, 404);
        $outlet = Outlet::query()->forTenant((int) $actor->tenant_id)
            ->whereKey($validated['outlet_id'])->where('business_unit_id', $unit->getKey())->first();
        abort_if(! $outlet, 422, 'Outlet harus berada di Business Unit yang dipilih.');

        DB::transaction(function () use ($actor, $record, $validated, $outlet): void {
            $locked = Employee::query()->forTenant((int) $actor->tenant_id)->whereKey($record->getKey())->lockForUpdate()->firstOrFail();
            $effectiveFrom = Carbon::createFromFormat('!Y-m-d', $validated['effective_from'], 'UTC');
            $changed = [];
            if ($locked->name !== trim($validated['name'])) {
                $locked->name = trim($validated['name']);
                $changed[] = 'name';
            }
            $locked->save();
            $alreadyAssigned = $locked->assignments()->where('assignment_type', 'primary')
                ->where('outlet_id', $outlet->getKey())->where('effective_from', '<=', $effectiveFrom)
                ->where('effective_until', '>', $effectiveFrom)->exists();
            if (! $alreadyAssigned) {
                $this->assignments->assignPrimaryOutlet($actor, $locked, $outlet, $effectiveFrom);
            }
            if ($changed !== []) {
                $this->recordManagementChange($actor, 'employee', (int) $locked->getKey(), 'updated', $changed, (int) $locked->getKey(), (int) $outlet->getKey());
            }
        });

        $record->refresh();

        return response()->json(['employee' => $this->employeePayload($record)]);
    }

    public function updateBusinessUnit(Request $request, int $businessUnit): JsonResponse
    {
        $validated = $request->validate(['name' => ['required', 'string', 'max:120']]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $unit = BusinessUnit::query()->forTenant((int) $actor->tenant_id)->whereKey($businessUnit)->first();
        abort_if(! $unit, 404);
        $name = trim($validated['name']);
        DB::transaction(function () use ($actor, $unit, $name, $businessUnit): void {
            if ($unit->name !== $name) {
                $unit->name = $name;
                $unit->save();
                $this->recordManagementChange($actor, 'business_unit', $businessUnit, 'updated', ['name']);
            }
        });

        return response()->json(['business_unit' => ['id' => $businessUnit, 'name' => $unit->name]]);
    }

    public function updateOutlet(Request $request, int $outlet): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $record = Outlet::query()->forTenant((int) $actor->tenant_id)->whereKey($outlet)->first();
        abort_if(! $record, 404);
        $name = trim($validated['name']);
        $address = array_key_exists('address', $validated)
            ? trim((string) $validated['address']) ?: null
            : $record->address;
        DB::transaction(function () use ($actor, $record, $name, $address, $outlet): void {
            $changed = [];
            if ($record->name !== $name) {
                $record->name = $name;
                $changed[] = 'name';
            }
            if ($record->address !== $address) {
                $record->address = $address;
                $changed[] = 'address';
            }
            if ($changed !== []) {
                $record->save();
                $this->recordManagementChange($actor, 'outlet', $outlet, 'updated', $changed, null, $outlet);
            }
        });

        return response()->json(['outlet' => [
            'id' => $outlet,
            'name' => $record->name,
            'address' => $record->address,
            'business_unit_id' => (int) $record->business_unit_id,
        ]]);
    }

    /** @return array<string, mixed> */
    private function employeePayload(Employee $employee): array
    {
        $placement = $employee->assignments()->with('outlet.businessUnit')->where('assignment_type', 'primary')
            ->where('effective_from', '<=', now())->where('effective_until', '>', now())->first();

        return [
            'id' => (int) $employee->getKey(), 'name' => $employee->name,
            'business_unit_id' => $placement?->outlet?->business_unit_id ? (int) $placement->outlet->business_unit_id : null,
            'business_unit_name' => $placement?->outlet?->businessUnit?->name,
            'outlet_id' => $placement?->outlet_id ? (int) $placement->outlet_id : null,
            'outlet_name' => $placement?->outlet?->name,
        ];
    }

    /** @param list<string> $fields */
    private function recordManagementChange(TenantMembership $actor, string $type, int $subjectId, string $action, array $fields, ?int $employeeId = null, ?int $outletId = null): void
    {
        app(ManagementChangeRecorder::class)->record($actor, $type, $subjectId, $action, $fields, $employeeId, $outletId);
    }

    public function createBusinessUnit(Request $request): JsonResponse
    {
        $validated = $request->validate(['name' => ['required', 'string', 'max:120']]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $unit = DB::transaction(function () use ($actor, $validated): BusinessUnit {
            $unit = $this->organization->createBusinessUnit($actor, $validated['name']);
            $this->recordManagementChange($actor, 'business_unit', (int) $unit->getKey(), 'created', ['name']);

            return $unit;
        });

        return response()->json(['business_unit' => ['id' => (int) $unit->getKey(), 'name' => $unit->name]], 201);
    }

    public function createOutlet(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_unit_id' => ['required', 'integer', 'min:1'],
            'name' => ['required', 'string', 'max:120'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        $actor = $this->authorization->requireOwner($this->activeMembership($request));
        $businessUnit = new BusinessUnit;
        $businessUnit->setAttribute($businessUnit->getKeyName(), $validated['business_unit_id']);
        $outlet = DB::transaction(function () use ($actor, $businessUnit, $validated): Outlet {
            $outlet = $this->organization->createOutlet($actor, $businessUnit, $validated['name'], $validated['address'] ?? null);
            $this->recordManagementChange($actor, 'outlet', (int) $outlet->getKey(), 'created', ['name', 'business_unit_id', 'address'], null, (int) $outlet->getKey());

            return $outlet;
        });

        return response()->json(['outlet' => [
            'id' => (int) $outlet->getKey(),
            'name' => $outlet->name,
            'address' => $outlet->address,
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
            'credential_expires_at' => $device->credential_expires_at?->toIso8601String(),
            'last_seen_at' => $device->last_seen_at?->toIso8601String(),
            'revoked_at' => $device->revoked_at?->toIso8601String(),
        ])->values()]);
    }

    public function issuePairingCode(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'name' => ['required', 'string', 'max:120'],
            'device_id' => ['sometimes', 'integer', 'min:1'],
        ]);
        $outlet = new Outlet;
        $outlet->setAttribute($outlet->getKeyName(), $validated['outlet_id']);
        $result = $this->kiosks->issuePairingCode($this->activeMembership($request), $outlet, $validated['name'], $validated['device_id'] ?? null);

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
