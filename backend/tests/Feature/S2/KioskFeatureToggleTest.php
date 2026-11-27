<?php

namespace Tests\Feature\S2;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class KioskFeatureToggleTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_kiosk_and_pin_routes_remain_registered_but_return_not_found_when_disabled(): void
    {
        [$user] = $this->tenantWithOwner('Kiosk disabled tenant');
        $this->loginAs($user);
        config(['features.kiosk_enabled' => false]);

        $this->browserRequest()->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('features.kiosk_enabled', false);

        foreach ([
            ['POST', '/api/v1/kiosk/pair'],
            ['GET', '/api/v1/kiosk/status'],
            ['GET', '/api/v1/kiosk/attendance/employees'],
            ['POST', '/api/v1/kiosk/attendance/next-operation'],
            ['POST', '/api/v1/kiosk/attendance/check-in'],
            ['POST', '/api/v1/kiosk/attendance/check-out'],
            ['GET', '/api/v1/kiosk/attendance/operations/check_in/'.str_repeat('a', 64)],
            ['POST', '/api/v1/kiosk/pin/enroll'],
            ['POST', '/api/v1/kiosk/pin/verify'],
            ['GET', '/api/v1/management/kiosks'],
            ['POST', '/api/v1/management/kiosks/pairing-codes'],
            ['POST', '/api/v1/management/kiosks/1/revoke'],
            ['POST', '/api/v1/management/employees/1/pin-enrollment'],
        ] as [$method, $uri]) {
            $this->browserRequest()->json($method, $uri)->assertNotFound()
                ->assertJsonPath('code', 'kiosk_disabled');
        }
    }

    public function test_enabling_kiosk_exposes_the_flag_and_allows_requests_to_reach_existing_guards(): void
    {
        [$user] = $this->tenantWithOwner('Kiosk enabled tenant');
        $this->loginAs($user);
        config(['features.kiosk_enabled' => true]);

        $this->browserRequest()->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('features.kiosk_enabled', true);
        $this->browserRequest()->getJson('/api/v1/management/kiosks')
            ->assertOk()->assertJsonPath('kiosks', []);
        $this->browserRequest()->getJson('/api/v1/kiosk/status')
            ->assertUnauthorized()->assertJsonPath('code', 'kiosk_not_paired');
    }

    private function loginAs(User $user): void
    {
        $response = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
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
