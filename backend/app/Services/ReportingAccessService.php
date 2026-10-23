<?php

namespace App\Services;

use App\Data\ReportingScope;
use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;

final class ReportingAccessService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function scope(Request $request): ReportingScope
    {
        $active = $request->attributes->get('activeMembership');
        $user = $request->user();
        if (! $active instanceof TenantMembership || ! $user instanceof User) {
            throw new AuthorizationException('Akses pelaporan tidak tersedia.');
        }

        $membership = $this->authorization->resolveMembership($user, (int) $active->tenant_id);
        $owner = $this->authorization->isOwner($membership);
        $supervisor = $this->authorization->hasRole($membership, TenantRole::Supervisor);
        if (! $owner && ! $supervisor) {
            throw new AuthorizationException('Pelaporan hanya tersedia untuk Owner dan Supervisor.');
        }

        $outletQuery = Outlet::query()->forTenant((int) $membership->tenant_id)->with('businessUnit');
        if (! $owner) {
            $allowedIds = $membership->supervisorScopes()->where('tenant_id', $membership->tenant_id)
                ->pluck('outlet_id')->map(fn ($id): int => (int) $id)->unique()->values();
            if ($allowedIds->isEmpty()) {
                throw new AuthorizationException('Cakupan Outlet pelaporan tidak tersedia.');
            }
            $outletQuery->whereIn('id', $allowedIds);
        }

        $outlets = $outletQuery->orderBy('id')->get()->map(fn (Outlet $outlet): array => [
            'id' => (int) $outlet->getKey(),
            'name' => (string) $outlet->name,
            'business_unit_id' => (int) $outlet->business_unit_id,
            'business_unit_name' => (string) $outlet->businessUnit->name,
        ])->values()->all();
        $outletIds = array_column($outlets, 'id');
        $businessUnitIds = array_values(array_unique(array_column($outlets, 'business_unit_id')));
        $businessUnits = BusinessUnit::query()->forTenant((int) $membership->tenant_id)
            ->whereIn('id', $businessUnitIds)->orderBy('id')->get()
            ->map(fn (BusinessUnit $unit): array => ['id' => (int) $unit->getKey(), 'name' => (string) $unit->name])
            ->values()->all();

        return new ReportingScope(
            $membership,
            (int) $membership->tenant_id,
            (int) $user->getKey(),
            $owner,
            $outletIds,
            $businessUnitIds,
            $outlets,
            $businessUnits,
        );
    }

    /** @param array<string, mixed> $validated @return array<string, mixed> */
    public function filters(ReportingScope $scope, array $validated): array
    {
        $outletIds = $scope->outletIds;
        if (isset($validated['business_unit_id'])) {
            $businessUnitId = (int) $validated['business_unit_id'];
            if (! in_array($businessUnitId, $scope->businessUnitIds, true)) {
                throw new AuthorizationException('Unit bisnis tidak tersedia dalam cakupan Anda.');
            }
            $outletIdsById = collect($scope->outlets)->keyBy('id');
            $outletIds = array_values(array_filter($outletIds, fn (int $id): bool => (int) ($outletIdsById->get($id)['business_unit_id'] ?? 0) === $businessUnitId
            ));
        }

        if (array_key_exists('outlet_ids', $validated)) {
            $requested = array_values(array_unique(array_map('intval', $validated['outlet_ids'])));
            if (array_diff($requested, $scope->outletIds) !== []) {
                throw new AuthorizationException('Outlet tidak tersedia dalam cakupan Anda.');
            }
            if (isset($validated['business_unit_id']) && array_diff($requested, $outletIds) !== []) {
                throw new AuthorizationException('Outlet tidak sesuai dengan unit bisnis terpilih.');
            }
            $outletIds = $requested;
        }

        sort($outletIds);

        return [
            'from' => (string) $validated['from'],
            'to' => (string) $validated['to'],
            'business_unit_id' => isset($validated['business_unit_id']) ? (int) $validated['business_unit_id'] : null,
            'outlet_ids' => $outletIds,
            'employee_id' => isset($validated['employee_id']) ? (int) $validated['employee_id'] : null,
            'status' => $validated['status'] ?? null,
            'page' => max(1, (int) ($validated['page'] ?? 1)),
            'per_page' => min(100, max(1, (int) ($validated['per_page'] ?? 25))),
        ];
    }

    /** @param array<string, mixed> $filters @return array<string, mixed> */
    public function provenance(ReportingScope $scope, array $filters, string $reportType): array
    {
        return [
            'report_type' => $reportType,
            'active_tenant' => [
                'id' => $scope->tenantId,
                'name' => (string) $scope->membership->tenant->name,
            ],
            'authorized_scope' => [
                'type' => $scope->owner ? 'tenant' : 'outlets',
                'outlet_ids' => $filters['outlet_ids'],
                'business_unit_ids' => $filters['business_unit_id'] === null
                    ? $scope->businessUnitIds
                    : [$filters['business_unit_id']],
            ],
            'filters' => [
                'work_date_from' => $filters['from'],
                'work_date_to' => $filters['to'],
                'business_unit_id' => $filters['business_unit_id'],
                'outlet_ids' => $filters['outlet_ids'],
                'employee_id' => $filters['employee_id'],
                'status' => $filters['status'],
            ],
            'generated_at' => now('UTC')->toIso8601String(),
            'reporting_semantics' => 'Rentang adalah label work_date lokal yang diterapkan sama pada setiap Outlet. Waktu jadwal mengikuti zona waktu efektif Outlet; waktu audit disajikan dalam UTC.',
            'values' => 'current_effective_state',
            'historical_snapshot' => false,
        ];
    }
}
