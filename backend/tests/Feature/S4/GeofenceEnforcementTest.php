<?php

namespace Tests\Feature\S4;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceSession;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class GeofenceEnforcementTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public static function locations(): array
    {
        $valid = ['status' => 'provided', 'latitude' => 0, 'longitude' => 0, 'accuracy_meters' => 10];
        $cases = [];
        foreach ([0, 100, 100.01, 101, 1000] as $meters) {
            $cases[$meters.' meters'] = [[...$valid, 'latitude' => rad2deg($meters / 6371000)], $meters <= 100];
        }

        return [...$cases,
            'missing' => [null, false],
            'denied' => [['status' => 'permission_denied'], false],
            'unavailable' => [['status' => 'unavailable'], false],
            'low accuracy' => [[...$valid, 'accuracy_meters' => 100.001], false],
            'accuracy boundary' => [[...$valid, 'accuracy_meters' => 100], true],
            'invalid latitude' => [[...$valid, 'latitude' => 91], false],
            'invalid longitude' => [[...$valid, 'longitude' => -181], false],
            'missing coordinate' => [['status' => 'provided', 'latitude' => 0, 'accuracy_meters' => 10], false],
            'nonnumeric' => [[...$valid, 'latitude' => 'bad'], false],
            'zero accuracy' => [[...$valid, 'accuracy_meters' => 0], false],
        ];
    }

    #[DataProvider('locations')]
    public function test_check_in_enforces_location_before_any_attendance_write(?array $location, bool $allowed): void
    {
        $f = $this->fixture();
        $payload = ['outlet_id' => $f['outlet']->id];
        if ($location !== null) {
            $payload['location'] = $location;
        }
        $key = (string) Str::uuid();
        $response = $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/attendance/me/check-in', $payload);
        $response->assertStatus($allowed ? 201 : 422);
        $this->assertDatabaseCount('attendance_sessions', $allowed ? 1 : 0);
        $this->assertDatabaseCount('attendance_events', $allowed ? 1 : 0);
        $this->assertDatabaseCount('attendance_active_session_owners', $allowed ? 1 : 0);
        $this->assertDatabaseCount('attendance_evidence', 0);
        if (! $allowed && isset($response->json()['code'])) {
            $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/attendance/me/check-in', $payload)
                ->assertStatus(422)->assertJsonPath('code', $response->json('code'));
            $this->assertDatabaseMissing('attendance_idempotency_records', ['status' => 'pending']);
        }
    }

    #[DataProvider('locations')]
    public function test_check_out_preserves_the_open_session_when_location_is_rejected(?array $location, bool $allowed): void
    {
        $this->fixture();
        $valid = ['status' => 'provided', 'latitude' => 0, 'longitude' => 0, 'accuracy_meters' => 10];
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $this->outletId, 'location' => $valid])->assertCreated();
        $before = AttendanceSession::firstOrFail()->getRawOriginal();
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-out', $location === null ? [] : ['location' => $location])->assertStatus($allowed ? 200 : 422);
        $this->assertDatabaseCount('attendance_sessions', 1);
        $this->assertDatabaseCount('attendance_events', $allowed ? 2 : 1);
        $this->assertDatabaseCount('attendance_active_session_owners', $allowed ? 0 : 1);
        if (! $allowed) {
            $this->assertSame($before, AttendanceSession::firstOrFail()->getRawOriginal());
        }
    }

    private int $outletId;

    public function test_required_unconfigured_location_is_rejected_for_both_operations(): void
    {
        $f = $this->fixture();
        $valid = ['status' => 'provided', 'latitude' => 0, 'longitude' => 0, 'accuracy_meters' => 10];
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $f['outlet']->id, 'location' => $valid])->assertCreated();
        $overrides = $f['policy']->overrides;
        $overrides['personal_location_validation']['latitude'] = null;
        $f['policy']->update(['overrides' => $overrides]);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-out', ['location' => $valid])->assertStatus(422)->assertJsonPath('code', 'location_geofence_unconfigured');
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseHas('attendance_sessions', ['status' => 'active']);
        // A different employee cannot create a provisional session with the same missing configuration.
        $this->assertSame(422, app(AttendanceService::class)->checkIn(AttendanceActor::personal($f['secondMembership']), $f['second'], $f['outlet'], (string) Str::uuid(), $valid, null)['status']);
        $this->assertDatabaseCount('attendance_sessions', 1);
    }

    public function test_personal_location_coordinates_are_exposed_only_for_authorized_outlets(): void
    {
        $f = $this->fixture();
        [, $otherTenant, $otherOwner] = $this->tenantWithOwner('Foreign tenant');
        [, $other] = $this->unitWithOutlet($otherOwner);
        $this->getJson('/api/v1/attendance/me')->assertOk()->assertJsonPath('personal_location.latitude', 0)->assertJsonPath('personal_location.longitude', 0);
        $this->getJson('/api/v1/attendance/me?outlet_id='.$other->id)->assertForbidden();
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $other->id, 'location' => ['status' => 'provided', 'latitude' => 0, 'longitude' => 0, 'accuracy_meters' => 10]])->assertForbidden();
        $this->assertDatabaseCount('attendance_sessions', 0);
    }

    public function test_service_boundary_rejects_invalid_numeric_values_without_coercion(): void
    {
        $f = $this->fixture();
        try {
            app(AttendanceService::class)->checkIn(AttendanceActor::personal($f['membership']), $f['employee'], $f['outlet'], (string) Str::uuid(), ['status' => 'provided', 'latitude' => 'bad', 'longitude' => 0, 'accuracy_meters' => 10], null);
            $this->fail('Invalid coordinates were coerced to zero.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('attendance_sessions', 0);
            $this->assertDatabaseCount('attendance_events', 0);
        }
    }

    private function fixture(): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Geofence tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $organization = app(OrganizationService::class);
        $employee = $organization->registerEmployee($owner, 'Geofence employee');
        $second = $organization->registerEmployee($owner, 'Second employee');
        foreach ([$employee, $second] as $person) {
            app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $person, $outlet, now()->subDay());
        }
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        [, $secondMembership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $secondMembership, $second);
        $policy = app(AttendancePolicyService::class)->createOutletVersion($owner, $outlet, CarbonImmutable::today('UTC')->toDateString(), ['attendance_mode' => 'hybrid', 'personal_location_validation' => ['required' => true, 'latitude' => 0, 'longitude' => 0, 'radius_meters' => 100]], 'Geofence test');
        $this->outletId = $outlet->id;
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $response = $this->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertOk();
        $cookie = $response->getCookie(config('session.cookie'));
        $this->withCookie(config('session.cookie'), $cookie->getValue());

        return compact('owner', 'tenant', 'outlet', 'employee', 'second', 'membership', 'secondMembership', 'policy');
    }
}
