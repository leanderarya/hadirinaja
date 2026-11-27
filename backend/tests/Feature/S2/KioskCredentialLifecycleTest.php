<?php

namespace Tests\Feature\S2;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\KioskPairingCode;
use App\Services\AttendanceService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class KioskCredentialLifecycleTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['features.kiosk_enabled' => true]);
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $this->travelTo(now()->startOfSecond());
    }

    public function test_server_expiry_boundary_and_null_expiry_reject_original_and_copied_credentials(): void
    {
        $this->travelTo(now()->startOfSecond());
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $paired = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code']);
        $device = $paired['device'];
        $this->assertTrue($device->credential_expires_at->equalTo(now()->addDays(30)));
        $this->travelTo($device->credential_expires_at->subSecond());
        $this->withCookie('hadirinaja_kiosk', $paired['token'])->getJson('/api/v1/kiosk/status')->assertOk();
        $this->travelTo($device->credential_expires_at);
        $this->withCookie('hadirinaja_kiosk', $paired['token'])->getJson('/api/v1/kiosk/status')
            ->assertForbidden()->assertJsonPath('code', 'kiosk_expired');
        $this->withCookie('hadirinaja_kiosk', $paired['token'])->postJson('/api/v1/kiosk/attendance/check-in', [])
            ->assertForbidden()->assertJsonPath('code', 'kiosk_expired');
        $device->forceFill(['credential_expires_at' => null])->save();
        $this->withCookie('hadirinaja_kiosk', $paired['token'])->getJson('/api/v1/kiosk/status')->assertForbidden();
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_evidence', 0);
    }

    public function test_pair_cookie_is_bounded_to_thirty_days(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $code = app(KioskPairingService::class)->issuePairingCode($owner, $outlet, 'Tablet')['code'];
        $response = $this->postJson('/api/v1/kiosk/pair', ['code' => $code])->assertOk();
        $cookie = $response->getCookie('hadirinaja_kiosk');
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('/api/v1/kiosk', $cookie->getPath());
        $this->assertSame(now()->addDays(30)->getTimestamp(), $cookie->getExpiresTime());
    }

    public function test_owner_renewal_rotates_credential_preserves_device_and_invalidates_old_copies(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $paired = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code']);
        $device = $paired['device'];
        $pairedAt = $device->paired_at;
        $this->travelTo($device->credential_expires_at->addSecond());
        $renewal = $service->issuePairingCode($owner, $outlet, 'Tablet', $device->id);
        $new = $service->redeemPairingCode($renewal['code']);
        $this->assertSame($device->id, $new['device']->id);
        $this->assertTrue($new['device']->paired_at->equalTo($pairedAt));
        $this->assertTrue($new['device']->credential_expires_at->equalTo(now()->addDays(30)));
        $this->assertNotSame($paired['token'], $new['token']);
        $this->assertDatabaseCount('kiosk_devices', 1);
        $this->withCookie('hadirinaja_kiosk', $paired['token'])->getJson('/api/v1/kiosk/status')->assertUnauthorized();
        $this->withCookie('hadirinaja_kiosk', $new['token'])->getJson('/api/v1/kiosk/status')->assertOk();
        $service->revokeDevice($owner, $device->id);
        $this->withCookie('hadirinaja_kiosk', $new['token'])->getJson('/api/v1/kiosk/status')->assertForbidden()->assertJsonPath('code', 'kiosk_revoked');
    }

    public function test_active_browser_must_renew_or_revoke_before_fresh_pairing(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $old = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code']);
        $replacement = $service->issuePairingCode($owner, $outlet, 'Replacement');
        $this->withCookie('hadirinaja_kiosk', $old['token'])->postJson('/api/v1/kiosk/pair', ['code' => $replacement['code']])
            ->assertStatus(409)->assertJsonPath('code', 'kiosk_renewal_required');
        $this->assertDatabaseCount('kiosk_devices', 1);
        $service->revokeDevice($owner, $old['device']->id);
        $this->withCookie('hadirinaja_kiosk', $old['token'])->postJson('/api/v1/kiosk/pair', ['code' => $replacement['code']])->assertOk();
        $this->assertDatabaseCount('kiosk_devices', 2);
        $this->assertNotNull($old['device']->fresh()->revoked_at);
    }

    public function test_new_renewal_code_supersedes_old_and_revocation_cannot_be_undone_by_pending_code(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $device = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code'])['device'];
        $first = $service->issuePairingCode($owner, $outlet, 'Tablet', $device->id);
        $second = $service->issuePairingCode($owner, $outlet, 'Tablet', $device->id);
        try {
            $service->redeemPairingCode($first['code']);
            $this->fail('Superseded code must not renew.');
        } catch (ValidationException) {
            $this->assertSame(0, KioskPairingCode::query()->where('renewal_device_id', $device->id)->whereNotNull('redeemed_at')->count());
        }
        $service->revokeDevice($owner, $device->id);
        try {
            $service->redeemPairingCode($second['code']);
            $this->fail('Revoked devices must not be revived by pending codes.');
        } catch (ValidationException) {
            $this->assertNotNull($device->fresh()->revoked_at);
        }
        $fresh = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Replacement')['code']);
        $this->assertNotSame($device->id, $fresh['device']->id);
        $this->assertNotNull($device->fresh()->revoked_at);
    }

    public function test_renewal_denies_foreign_tenant_wrong_outlet_and_non_owner(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        [, $other] = $this->unitWithOutlet($owner, 'Other', 'Other');
        [, , $foreign] = $this->tenantWithOwner('Foreign');
        [, $foreignOutlet] = $this->unitWithOutlet($foreign);
        [, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        $service = app(KioskPairingService::class);
        $device = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code'])['device'];
        foreach ([[$owner, $other], [$foreign, $foreignOutlet], [$supervisor, $outlet]] as [$actor, $target]) {
            try {
                $service->issuePairingCode($actor, $target, 'Forbidden', $device->id);
                $this->fail('Unauthorized renewal must fail.');
            } catch (AuthorizationException|ValidationException) {
                $this->assertDatabaseCount('kiosk_pairing_codes', 1);
            }
        }
    }

    public function test_attendance_rechecks_expiry_rotation_and_revocation_after_middleware_identity_was_loaded(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $device = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code'])['device'];
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Employee');
        foreach (['expired', 'rotated', 'revoked'] as $condition) {
            $device->refresh();
            $actor = AttendanceActor::kiosk($device);
            $changes = match ($condition) {
                'expired' => ['credential_expires_at' => now()->subSecond()],
                'rotated' => ['credential_expires_at' => now()->addDays(30), 'credential_hash' => hash('sha256', Str::random(64))],
                'revoked' => ['revoked_at' => now()],
            };
            $device->forceFill($changes)->save();
            $result = app(AttendanceService::class)->checkIn($actor, $employee, $outlet, (string) Str::uuid(), null,
                UploadedFile::fake()->image('proof.jpg', 640, 480));
            $this->assertSame(403, $result['status']);
            $checkout = app(AttendanceService::class)->checkOut($actor, $employee, (string) Str::uuid(), null,
                UploadedFile::fake()->image('checkout.jpg', 640, 480));
            $this->assertSame(403, $checkout['status']);
            $this->assertDatabaseCount('attendance_sessions', 0);
            $this->assertDatabaseCount('attendance_events', 0);
            $this->assertDatabaseCount('attendance_evidence', 0);
            $this->assertSame(0, DB::table('attendance_idempotency_records')->where('status', 'pending')->count());
        }
    }
}
