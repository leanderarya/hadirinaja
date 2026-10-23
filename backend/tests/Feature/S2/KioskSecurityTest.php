<?php

namespace Tests\Feature\S2;

use App\Models\EmployeePinCredential;
use App\Models\EmployeePinEnrollmentCode;
use App\Models\KioskDevice;
use App\Models\KioskPairingCode;
use App\Models\User;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeePinService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class KioskSecurityTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_pairing_is_short_lived_single_use_and_revocation_is_immediate(): void
    {
        [$ownerUser, , $owner] = $this->tenantWithOwner('Kiosk tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Front desk');
        $pairings = app(KioskPairingService::class);
        $issued = $pairings->issuePairingCode($owner, $outlet, 'Front tablet');
        $this->assertTrue(now()->diffInMinutes($issued['expires_at']) <= 5);

        $paired = $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $issued['code']])
            ->assertOk()->assertJson(['paired' => true]);
        $cookie = $paired->getCookie('hadirinaja_kiosk');
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('/api/v1/kiosk', $cookie->getPath());
        $token = $cookie->getValue();
        $this->assertNotSame($token, KioskDevice::query()->value('credential_hash'));

        $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $issued['code']])->assertUnauthorized();
        $this->withCookie('hadirinaja_kiosk', $token)->getJson('/api/v1/kiosk/status')->assertOk()
            ->assertJsonPath('status', 'ready')->assertJsonPath('outlet.name', 'Front desk');

        $this->loginAs($ownerUser);
        $device = KioskDevice::query()->firstOrFail();
        $this->browserRequest()->postJson('/api/v1/management/kiosks/'.$device->getKey().'/revoke')
            ->assertOk()->assertJson(['revoked' => true]);
        $this->withCookie('hadirinaja_kiosk', $token)->getJson('/api/v1/kiosk/status')
            ->assertForbidden()->assertJsonPath('code', 'kiosk_revoked');

        $this->browserRequest()->postJson('/api/v1/auth/logout')->assertOk();
        Auth::forgetGuards();
        $this->browserRequest()->withCookie('hadirinaja_kiosk', $token)
            ->getJson('/api/v1/management/organization')->assertUnauthorized();
    }

    public function test_pin_enrollment_hashes_and_rotates_pin_and_verification_is_outlet_scoped(): void
    {
        [, , $owner] = $this->tenantWithOwner('PIN tenant');
        [, $outletA] = $this->unitWithOutlet($owner, 'Operations A', 'Outlet A');
        [, $outletB] = $this->unitWithOutlet($owner, 'Operations B', 'Outlet B');
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign PIN tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner, 'Foreign operations', 'Foreign outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Eligible employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outletA, now()->subDay());
        $pairings = app(KioskPairingService::class);
        $deviceA = $pairings->redeemPairingCode($pairings->issuePairingCode($owner, $outletA, 'Kiosk A')['code'])['device'];
        $deviceB = $pairings->redeemPairingCode($pairings->issuePairingCode($owner, $outletB, 'Kiosk B')['code'])['device'];
        $foreignDevice = $pairings->redeemPairingCode(
            $pairings->issuePairingCode($foreignOwner, $foreignOutlet, 'Foreign kiosk')['code'],
        )['device'];
        $pins = app(EmployeePinService::class);

        $firstCode = $pins->issueEnrollmentCode($owner, $employee, $outletA)['code'];
        $storedEnrollment = EmployeePinEnrollmentCode::query()->firstOrFail();
        $this->assertNotSame($firstCode, $storedEnrollment->code_hash);
        $this->assertSame(hash_hmac('sha256', $firstCode, (string) config('app.key')), $storedEnrollment->code_hash);

        try {
            $pins->redeemEnrollmentCode($deviceB, $firstCode, '123456');
            $this->fail('A kiosk bound to another outlet must not redeem an enrollment code.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('employee_pin_credentials', 0);
        }

        try {
            $pins->redeemEnrollmentCode($foreignDevice, $firstCode, '123456');
            $this->fail('A kiosk in another tenant must not redeem an enrollment code.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('employee_pin_credentials', 0);
        }

        $pins->redeemEnrollmentCode($deviceA, $firstCode, '123456');
        $credential = EmployeePinCredential::query()->firstOrFail();
        $this->assertTrue(Hash::check('123456', $credential->pin_hash));
        $this->assertNotSame('123456', $credential->pin_hash);
        $this->assertSame((int) $employee->getKey(), $pins->verify($deviceA, (int) $employee->getKey(), '123456')?->getKey());
        $this->assertNull($pins->verify($deviceA, (int) $employee->getKey(), '654321'));
        $this->assertNull($pins->verify($foreignDevice, (int) $employee->getKey(), '123456'));

        try {
            $pins->redeemEnrollmentCode($deviceA, $firstCode, '654321');
            $this->fail('An enrollment code must not be reusable after it is redeemed.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('employee_pin_credentials', 1);
        }

        $secondCode = $pins->issueEnrollmentCode($owner, $employee, $outletA)['code'];
        $pins->redeemEnrollmentCode($deviceA, $secondCode, '654321');
        $this->assertFalse(Hash::check('123456', $credential->fresh()->pin_hash));
        $this->assertTrue(Hash::check('654321', $credential->fresh()->pin_hash));
        $this->assertSame((int) $employee->getKey(), $pins->verify($deviceA, (int) $employee->getKey(), '654321')?->getKey());
        $this->assertNull($pins->verify($deviceB, (int) $employee->getKey(), '654321'));
    }

    public function test_pin_failures_are_rate_limited_per_device_and_employee(): void
    {
        [, , $owner] = $this->tenantWithOwner('PIN throttling');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'PIN employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $pairings = app(KioskPairingService::class);
        $device = $pairings->redeemPairingCode($pairings->issuePairingCode($owner, $outlet, 'PIN kiosk')['code'])['device'];
        $pins = app(EmployeePinService::class);
        $pins->redeemEnrollmentCode($device, $pins->issueEnrollmentCode($owner, $employee, $outlet)['code'], '123456');
        $rateKey = 'employee-pin:'.hash_hmac(
            'sha256',
            $device->getKey().':'.$device->tenant_id.':'.$employee->getKey(),
            (string) config('app.key'),
        );
        RateLimiter::clear($rateKey);

        foreach (range(1, 5) as $_) {
            $this->assertNull($pins->verify($device, (int) $employee->getKey(), '654321'));
        }

        try {
            $pins->verify($device, (int) $employee->getKey(), '654321');
            $this->fail('The sixth failed PIN attempt must be rate limited.');
        } catch (TooManyRequestsHttpException) {
            $this->assertTrue(RateLimiter::tooManyAttempts($rateKey, 5));
        }
    }

    public function test_expired_and_unknown_pairing_codes_are_rejected(): void
    {
        [, , $owner] = $this->tenantWithOwner('Expired pairing');
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $expired = $service->issuePairingCode($owner, $outlet, 'Expired tablet');
        KioskPairingCode::query()->update(['expires_at' => now()->subMinute()]);

        $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $expired['code']])->assertUnauthorized();
        $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => '000000000000'])->assertUnauthorized();
    }

    private function loginAs(User $user): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $sessionCookie = $response->getCookie(config('session.cookie'));

        if ($sessionCookie !== null) {
            $this->withCookie(config('session.cookie'), $sessionCookie->getValue());
        }
        Auth::forgetGuards();
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }
}
