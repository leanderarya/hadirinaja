<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\BusinessUnit;
use App\Models\Employee;
use App\Models\Outlet;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class OrganizationService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function createTenant(User $owner, string $name): Tenant
    {
        if (! $owner->exists) {
            throw ValidationException::withMessages(['owner' => 'A saved User is required to own a tenant.']);
        }

        return DB::transaction(function () use ($owner, $name): Tenant {
            $tenant = Tenant::query()->create(['name' => $this->cleanName($name)]);
            $membership = $tenant->memberships()->create(['user_id' => $owner->getKey()]);
            $membership->roles()->create([
                'tenant_id' => $tenant->getKey(),
                'role' => TenantRole::Owner->value,
            ]);

            return $tenant;
        });
    }

    public function createBusinessUnit(TenantMembership $actor, string $name): BusinessUnit
    {
        $actor = $this->authorization->requireOwner($actor);

        return BusinessUnit::query()->create([
            'tenant_id' => $actor->tenant_id,
            'name' => $this->cleanName($name),
        ]);
    }

    public function createOutlet(TenantMembership $actor, BusinessUnit $businessUnit, string $name): Outlet
    {
        $actor = $this->authorization->requireOwner($actor);
        $unit = BusinessUnit::query()->forTenant((int) $actor->tenant_id)
            ->whereKey($businessUnit->getKey())->first();

        if (! $unit) {
            throw ValidationException::withMessages(['business_unit' => 'The Business Unit must belong to the actor tenant.']);
        }

        return Outlet::query()->create([
            'tenant_id' => $actor->tenant_id,
            'business_unit_id' => $unit->getKey(),
            'name' => $this->cleanName($name),
        ]);
    }

    public function registerEmployee(TenantMembership $actor, string $name): Employee
    {
        $actor = $this->authorization->requireOwner($actor);

        return Employee::query()->create([
            'tenant_id' => $actor->tenant_id,
            'name' => $this->cleanName($name),
        ]);
    }

    private function cleanName(string $name): string
    {
        $name = trim($name);

        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'A non-empty name is required.']);
        }

        return $name;
    }
}
