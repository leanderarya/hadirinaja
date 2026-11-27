<?php

namespace Tests\Feature\S1;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Models\User;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class ManagementEditingTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_owner_can_create_and_edit_employee_without_creating_a_login_and_preserves_assignment_history(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-24 12:00:00', 'UTC'));
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$unit, $outlet] = $this->unitWithOutlet($owner);
        [, $otherUnit, $otherOutlet] = [$owner->tenant, ...$this->unitWithOutlet($owner, 'Retail', 'Market')];
        $usersBefore = User::query()->count();
        $this->loginAs($ownerUser);

        $created = $this->browserRequest()->postJson('/api/v1/management/employees', [
            'name' => '  Rani  ', 'business_unit_id' => $unit->getKey(), 'outlet_id' => $outlet->getKey(), 'effective_from' => '2026-10-24',
        ])->assertCreated()->assertJsonPath('employee.name', 'Rani')->assertJsonPath('employee.outlet_id', $outlet->getKey());
        $employeeId = (int) $created->json('employee.id');
        $this->assertSame($usersBefore, User::query()->count());
        $this->assertSame(0, EmployeeUserLink::query()->where('employee_id', $employeeId)->count());
        $this->browserRequest()->getJson('/api/v1/management/employees/'.$employeeId)
            ->assertOk()->assertJsonPath('employee.business_unit_id', $unit->getKey())
            ->assertJsonPath('employee.outlet_id', $outlet->getKey());

        $this->browserRequest()->putJson('/api/v1/management/employees/'.$employeeId, [
            'name' => 'Rani Putri', 'business_unit_id' => $otherUnit->getKey(), 'outlet_id' => $otherOutlet->getKey(), 'effective_from' => '2026-10-25',
        ])->assertOk()->assertJsonPath('employee.name', 'Rani Putri')->assertJsonPath('employee.outlet_id', $outlet->getKey());

        $assignments = DB::table('employee_outlet_assignments')->where('employee_id', $employeeId)->orderBy('effective_from')->get();
        $this->assertCount(2, $assignments);
        $this->assertSame($outlet->getKey(), (int) $assignments[0]->outlet_id);
        $this->assertSame('2026-10-25 00:00:00', $assignments[0]->effective_until);
        $this->assertSame($otherOutlet->getKey(), (int) $assignments[1]->outlet_id);
        $this->assertSame(2, DB::table('management_change_events')->where('employee_id', $employeeId)->count());
        $this->assertSame(['name'], json_decode(DB::table('management_change_events')->where('employee_id', $employeeId)->where('action', 'updated')->value('changed_fields'), true));

        $today = CarbonImmutable::today('UTC')->toDateString();
        $this->browserRequest()->getJson('/api/v1/management/reports/audit?'.http_build_query([
            'from' => $today, 'to' => $today, 'source' => 'management_change', 'employee_id' => $employeeId,
        ]))->assertOk()->assertJsonPath('pagination.total', 2);
    }

    public function test_owner_can_edit_names_without_changing_outlet_identity_and_scope_is_enforced(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [, $unit, $outlet] = [$owner->tenant, ...$this->unitWithOutlet($owner)];
        [, $foreignTenant, $foreignOwner] = $this->tenantWithOwner('Foreign');
        [, $foreignUnit] = $this->unitWithOutlet($foreignOwner, 'Foreign unit', 'Foreign outlet');
        $this->loginAs($ownerUser);

        $this->browserRequest()->putJson('/api/v1/management/business-units/'.$unit->getKey(), ['name' => 'Ops renamed'])->assertOk();
        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outlet->getKey(), ['name' => 'Central renamed'])->assertOk();
        $this->assertSame($unit->getKey(), $outlet->fresh()->business_unit_id);
        $this->assertSame($unit->getKey(), $unit->fresh()->getKey());
        $this->assertSame($outlet->getKey(), $outlet->fresh()->getKey());
        $this->assertDatabaseHas('management_change_events', ['subject_type' => 'outlet', 'subject_id' => $outlet->getKey(), 'outlet_id' => $outlet->getKey()]);
        $this->browserRequest()->putJson('/api/v1/management/business-units/'.$foreignUnit->getKey(), ['name' => 'Cross tenant'])->assertNotFound();

        [$supervisorUser, $supervisorMembership] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisorMembership, $outlet);
        $this->loginAs($supervisorUser);
        $this->browserRequest()->postJson('/api/v1/management/employees', [
            'name' => 'Forbidden', 'business_unit_id' => $unit->getKey(), 'outlet_id' => $outlet->getKey(), 'effective_from' => now('UTC')->toDateString(),
        ])->assertForbidden();
        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outlet->getKey(), ['name' => 'Forbidden'])->assertForbidden();
        $this->assertSame(1, $foreignTenant->businessUnits()->count());
    }

    public function test_owner_can_create_and_update_an_optional_outlet_address_up_to_500_characters(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [$unit] = $this->unitWithOutlet($owner);
        $this->loginAs($ownerUser);

        $created = $this->browserRequest()->postJson('/api/v1/management/outlets', [
            'business_unit_id' => $unit->getKey(),
            'name' => 'Outlet Beralamat',
            'address' => '  Jl. Merdeka No. 12  ',
        ])->assertCreated()
            ->assertJsonPath('outlet.address', 'Jl. Merdeka No. 12');
        $outletId = (int) $created->json('outlet.id');

        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outletId, [
            'name' => 'Outlet Beralamat',
        ])->assertOk()->assertJsonPath('outlet.address', 'Jl. Merdeka No. 12');

        $maximumAddress = str_repeat('A', 500);
        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outletId, [
            'name' => 'Outlet Beralamat',
            'address' => $maximumAddress,
        ])->assertOk()->assertJsonPath('outlet.address', $maximumAddress);

        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outletId, [
            'name' => 'Outlet Beralamat',
            'address' => str_repeat('A', 501),
        ])->assertUnprocessable()->assertJsonValidationErrors('address');

        $this->browserRequest()->putJson('/api/v1/management/outlets/'.$outletId, [
            'name' => 'Outlet Beralamat',
            'address' => null,
        ])->assertOk()->assertJsonPath('outlet.address', null);

        $withoutAddress = $this->browserRequest()->postJson('/api/v1/management/outlets', [
            'business_unit_id' => $unit->getKey(),
            'name' => 'Outlet tanpa alamat',
        ])->assertCreated()->assertJsonPath('outlet.address', null);
        $this->assertDatabaseHas('outlets', [
            'id' => $withoutAddress->json('outlet.id'),
            'address' => null,
        ]);
    }

    public function test_employee_creation_rejects_mismatched_and_foreign_placements(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner();
        [, $unit, $outlet] = [$owner->tenant, ...$this->unitWithOutlet($owner)];
        [, , $foreignOwner] = $this->tenantWithOwner();
        [$foreignUnit, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $this->loginAs($ownerUser);

        $payload = ['name' => 'Invalid', 'business_unit_id' => $unit->getKey(), 'effective_from' => now('UTC')->toDateString()];
        $this->browserRequest()->postJson('/api/v1/management/employees', [...$payload, 'outlet_id' => $foreignOutlet->getKey()])->assertStatus(422);
        $this->browserRequest()->postJson('/api/v1/management/employees', [...$payload, 'outlet_id' => $outlet->getKey(), 'business_unit_id' => $foreignUnit->getKey()])->assertNotFound();
    }

    private function loginAs(User $user): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertOk();
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
    }
}
