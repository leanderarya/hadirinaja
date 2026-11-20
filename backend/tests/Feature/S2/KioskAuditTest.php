<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\KioskDevice;
use App\Models\KioskPairingCode;
use App\Models\ManagementChangeEvent;
use App\Services\KioskPairingService;
use App\Services\ManagementChangeRecorder;
use App\Services\TenantMembershipService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Mockery\MockInterface;
use RuntimeException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class KioskAuditTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public function test_issuance_and_revocation_record_authorized_actor_without_secrets_and_retries_do_not_duplicate_revocation(): void
    {
        [$user, $tenant, $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $issued = $service->issuePairingCode($owner, $outlet, 'Outlet tablet');
        $pairing = KioskPairingCode::query()->firstOrFail();
        $event = ManagementChangeEvent::query()->where('subject_type', 'kiosk_pairing')->firstOrFail();
        $this->assertSame((int) $tenant->id, (int) $event->tenant_id);
        $this->assertSame((int) $owner->id, (int) $event->actor_membership_id);
        $this->assertSame((int) $user->id, (int) $event->actor_user_id);
        $this->assertSame((int) $outlet->id, (int) $event->outlet_id);
        $this->assertSame((int) $pairing->id, (int) $event->subject_id);
        $this->assertSame('issued', $event->action);
        $this->assertNotNull($event->occurred_at);
        $this->assertLessThanOrEqual(2, abs(now('UTC')->diffInSeconds($event->occurred_at)));
        $this->assertSame('+00:00', DB::selectOne('SELECT @@session.time_zone AS zone')->zone);
        $this->assertStringNotContainsString($issued['code'], $event->toJson());
        $this->assertStringNotContainsString($pairing->code_hash, $event->toJson());

        $paired = $service->redeemPairingCode($issued['code']);
        $device = $paired['device'];
        $service->revokeDevice($owner, $device->id);
        $service->revokeDevice($owner, $device->id);
        $revocations = ManagementChangeEvent::query()->where('subject_type', 'kiosk_device')->get();
        $this->assertCount(1, $revocations);
        $this->assertSame('revoked', $revocations[0]->action);
        $this->assertSame((int) $device->id, (int) $revocations[0]->subject_id);
        $this->assertSame((int) $owner->id, (int) $revocations[0]->actor_membership_id);
        $this->assertStringNotContainsString($paired['token'], $revocations[0]->toJson());

        $login = $this->browser()->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])->assertOk();
        $this->withCookie(config('session.cookie'), $login->getCookie(config('session.cookie'))->getValue());
        Auth::forgetGuards();
        $range = '?from='.now('UTC')->toDateString().'&to='.now('UTC')->toDateString();
        $detail = $this->browser()->getJson('/api/v1/management/reports/audit/management_change/'.$event->id.$range)->assertOk();
        $detail->assertJsonPath('entry.details.kiosk_device_id', (int) $device->id)
            ->assertJsonPath('entry.details.outcome', 'succeeded')
            ->assertJsonPath('entry.details.actor_membership_id', (int) $owner->id)
            ->assertDontSee($issued['code'])->assertDontSee($paired['token']);

        [$supervisorUser, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        [, $otherOutlet] = $this->unitWithOutlet($owner, 'Other', 'Other outlet');
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisor, $otherOutlet);
        $login = $this->browser()->postJson('/api/v1/auth/login', ['identifier' => $supervisorUser->email, 'password' => 'password'])->assertOk();
        $this->withCookie(config('session.cookie'), $login->getCookie(config('session.cookie'))->getValue());
        Auth::forgetGuards();
        $this->browser()->getJson('/api/v1/management/reports/audit/management_change/'.$event->id.$range)->assertNotFound();
    }

    public function test_pairing_issuance_rolls_back_if_durable_audit_fails(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $this->mock(ManagementChangeRecorder::class, function (MockInterface $mock): void {
            $mock->shouldReceive('record')->once()->andThrow(new RuntimeException('audit unavailable'));
        });
        try {
            app(KioskPairingService::class)->issuePairingCode($owner, $outlet, 'Tablet');
            $this->fail('Issuance must fail if the audit cannot be persisted.');
        } catch (RuntimeException $exception) {
            $this->assertSame('audit unavailable', $exception->getMessage());
        }
        $this->assertDatabaseCount('kiosk_pairing_codes', 0);
        $this->assertDatabaseCount('kiosk_devices', 0);
    }

    public function test_revocation_rolls_back_if_durable_audit_fails(): void
    {
        [, , $owner] = $this->tenantWithOwner();
        [, $outlet] = $this->unitWithOutlet($owner);
        $service = app(KioskPairingService::class);
        $device = $service->redeemPairingCode($service->issuePairingCode($owner, $outlet, 'Tablet')['code'])['device'];
        $this->mock(ManagementChangeRecorder::class, function (MockInterface $mock): void {
            $mock->shouldReceive('record')->once()->andThrow(new RuntimeException('audit unavailable'));
        });
        try {
            app(KioskPairingService::class)->revokeDevice($owner, $device->id);
            $this->fail('Revocation must not silently omit its audit event.');
        } catch (RuntimeException $exception) {
            $this->assertSame('audit unavailable', $exception->getMessage());
        }
        $this->assertNull(KioskDevice::query()->findOrFail($device->id)->revoked_at);
    }

    private function browser(): static
    {
        return $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
    }
}
