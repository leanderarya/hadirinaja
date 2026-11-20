<?php

namespace Database\Seeders;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    private const DEMO_PASSWORD = 'password';

    /**
     * Seed a local Owner and Employee account for browser testing.
     */
    public function run(): void
    {
        $mysql = config('database.connections.mysql');

        if (
            ! app()->environment('local')
            || config('database.default') !== 'mysql'
            || ($mysql['database'] ?? null) !== 'hadirinaja_dev'
            || ! in_array($mysql['host'] ?? null, ['127.0.0.1', 'localhost'], true)
            || (string) ($mysql['port'] ?? '') !== '3306'
            || filled($mysql['url'] ?? null)
        ) {
            throw new RuntimeException('The demo seeder may only run against the local hadirinaja_dev MySQL database.');
        }

        if (DB::connection()->getDatabaseName() !== 'hadirinaja_dev' || (int) DB::selectOne('SELECT 1 AS ok')->ok !== 1) {
            throw new RuntimeException('The demo seeder could not verify its local database connection.');
        }

        DB::transaction(function (): void {
            $owner = User::query()->firstOrCreate(
                ['email' => 'owner@example.com'],
                ['name' => 'HadirinAja Owner Demo', 'password' => self::DEMO_PASSWORD],
            );
            $this->ensureDemoPassword($owner);

            $ownerMemberships = $owner->memberships()
                ->where('is_active', true)
                ->whereHas('roles', fn ($query) => $query->where('role', TenantRole::Owner->value))
                ->get();

            if ($ownerMemberships->count() > 1) {
                throw new RuntimeException('owner@example.com has multiple Owner memberships; the demo tenant is ambiguous.');
            }

            $ownerMembership = $ownerMemberships->first();
            if (! $ownerMembership) {
                $tenant = app(OrganizationService::class)->createTenant($owner, 'HadirinAja Demo');
                $ownerMembership = $tenant->memberships()->where('user_id', $owner->getKey())->firstOrFail();
            }

            $employeeUser = User::query()->firstOrCreate(
                ['email' => 'employee@gmail.com'],
                ['name' => 'HadirinAja Employee Demo', 'password' => self::DEMO_PASSWORD],
            );
            $this->ensureDemoPassword($employeeUser);

            $tenantId = (int) $ownerMembership->tenant_id;
            $employeeMemberships = $employeeUser->memberships()->get();
            if ($employeeMemberships->contains(fn (TenantMembership $membership): bool => (int) $membership->tenant_id !== $tenantId)) {
                throw new RuntimeException('employee@gmail.com already belongs to another tenant; the demo seeder will not relink it.');
            }

            $membershipService = app(TenantMembershipService::class);
            $employeeMembership = $employeeMemberships->first();
            if (! $employeeMembership) {
                $employeeMembership = $membershipService->addMembership($ownerMembership, $employeeUser);
            }

            if (! $employeeMembership->hasRole(TenantRole::Employee)) {
                $membershipService->assignRole($ownerMembership, $employeeMembership, TenantRole::Employee);
            }

            $link = EmployeeUserLink::query()
                ->forTenant($tenantId)
                ->where('tenant_membership_id', $employeeMembership->getKey())
                ->first();

            if (! $link) {
                $employee = app(OrganizationService::class)->registerEmployee($ownerMembership, 'Employee Demo');
                $membershipService->linkEmployee($ownerMembership, $employeeMembership, $employee);
            }
        });
    }

    private function ensureDemoPassword(User $user): void
    {
        if (! Hash::check(self::DEMO_PASSWORD, $user->password)) {
            $user->forceFill(['password' => self::DEMO_PASSWORD])->save();
        }
    }
}
