<?php

namespace Tests\Feature\S4;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceEvidenceAuditEvent;
use App\Models\AttendanceEvidenceLegalHoldEvent;
use App\Models\AttendanceIdempotencyRecord;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\KioskDevice;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AttendanceEvidenceAuditLogger;
use App\Services\AttendanceEvidenceExpirationService;
use App\Services\AttendanceEvidenceLegalHoldReader;
use App\Services\AttendanceEvidenceStorage;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeePinService;
use App\Services\EmployeeScheduleService;
use App\Services\KioskPairingService;
use App\Services\OrganizationService;
use App\Services\OutletCalendarService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class AttendanceEngineTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    /** @var list<string> */
    private array $temporaryImages = [];

    protected function tearDown(): void
    {
        foreach ($this->temporaryImages as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
        parent::tearDown();
    }

    public function test_personal_check_in_and_out_are_idempotent_and_self_scoped_without_a_photo(): void
    {
        $fixture = $this->attendanceFixture();
        $otherEmployee = app(OrganizationService::class)->registerEmployee($fixture['owner'], 'Karyawan lain');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $fixture['owner'], $otherEmployee, $fixture['outlet'], now()->subDay(),
        );
        $this->loginAs($fixture['employeeUser']);

        $checkInKey = (string) Str::uuid();
        $checkInPayload = [
            'outlet_id' => $fixture['outlet']->getKey(),
            'employee_id' => $otherEmployee->getKey(),
            'location' => $this->validLocation(),
        ];
        $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->postJson('/api/v1/attendance/me/check-in', $checkInPayload);
        $this->assertSame(201, $checkIn->status(), json_encode($checkIn->json(), JSON_THROW_ON_ERROR));
        $checkIn->assertJsonPath('event.origin', 'personal')
            ->assertJsonPath('session.review_indicators.0', 'unscheduled_work');
        $eventId = $checkIn->json('event.id');
        $sessionId = $checkIn->json('session.id');
        $this->assertSame((int) $fixture['employee']->getKey(), (int) AttendanceEvent::query()->firstOrFail()->employee_id);
        $this->assertSame(1, AttendanceSession::query()->count());
        $this->assertSame(1, AttendanceEvent::query()->count());

        $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->postJson('/api/v1/attendance/me/check-in', $checkInPayload)
            ->assertCreated()->assertJsonPath('event.id', $eventId);
        $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->postJson('/api/v1/attendance/me/check-in', [
                ...$checkInPayload,
                'location' => ['status' => 'unavailable'],
            ])->assertConflict()->assertJsonPath('code', 'idempotency_key_conflict');

        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('active_session.id', $sessionId)
            ->assertJsonPath('eligibility.status', 'eligible')
            ->assertJsonPath('allowed_next_operation', 'check_out');

        $checkOutKey = (string) Str::uuid();
        $checkOutPayload = ['location' => $this->validLocation()];
        $checkOut = $this->browserRequest()->withHeader('Idempotency-Key', $checkOutKey)
            ->postJson('/api/v1/attendance/me/check-out', $checkOutPayload)
            ->assertOk()->assertJsonPath('event.origin', 'personal')
            ->assertJsonPath('session.status', 'closed');
        $checkOutId = $checkOut->json('event.id');
        $this->browserRequest()->withHeader('Idempotency-Key', $checkOutKey)
            ->postJson('/api/v1/attendance/me/check-out', $checkOutPayload)
            ->assertOk()->assertJsonPath('event.id', $checkOutId);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-out', $checkOutPayload)
            ->assertConflict()->assertJsonPath('code', 'no_active_attendance');

        $this->assertDatabaseCount('attendance_sessions', 1);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
        $this->assertSame('closed', AttendanceSession::query()->firstOrFail()->status);
    }

    public function test_checkout_replays_the_original_destination_and_session_after_a_new_check_in(): void
    {
        $fixture = $this->attendanceFixture();
        [, $otherOutlet] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Other outlet');
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $this->loginAs($fixture['employeeUser']);
        $location = ['location' => $this->validLocation()];
        $outletId = (int) $fixture['outlet']->getKey();
        $checkIn = fn () => $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $outletId, ...$location])->assertCreated();
        $sessionId = $checkIn()->json('session.id');
        $key = (string) Str::uuid();
        $checkout = fn (array $payload) => $this->browserRequest()->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/attendance/me/check-out', $payload);

        $checkout(['checkout_outlet_id' => $foreignOutlet->getKey(), ...$location])->assertForbidden();
        $this->assertDatabaseMissing('attendance_idempotency_records', ['idempotency_key' => $key]);

        $completed = $checkout($location)->assertOk()
            ->assertJsonPath('operation.contract_version', 2)
            ->assertJsonPath('operation.checkout_session_id', $sessionId)
            ->assertJsonPath('operation.checkout_outlet_id', $outletId);
        $event = AttendanceEvent::query()->findOrFail($completed->json('event.id'));
        $this->assertSame($outletId, $event->checkout_outlet_id);
        $this->assertSame($outletId, (int) $event->outlet_id);
        $this->assertNull($event->authenticated_kiosk_outlet_id);
        $this->assertSame(['verification' => 'legacy_policy'], $event->checkout_context);

        $newSessionId = $checkIn()->json('session.id');
        $this->assertNotSame($sessionId, $newSessionId);
        $checkout(['checkout_outlet_id' => $outletId, ...$location])->assertOk()->assertExactJson($completed->json());
        $checkout(['checkout_outlet_id' => $otherOutlet->getKey(), ...$location])
            ->assertConflict()->assertJsonPath('code', 'idempotency_key_conflict');
        $this->browserRequest()->getJson('/api/v1/attendance/me/operations/check_out/'.$key)
            ->assertOk()->assertJsonPath('checkout_outlet_id', $outletId)
            ->assertJsonPath('result.event.id', $event->getKey());

        $differentKey = (string) Str::uuid();
        $this->browserRequest()->withHeader('Idempotency-Key', $differentKey)
            ->postJson('/api/v1/attendance/me/check-out', ['checkout_outlet_id' => $otherOutlet->getKey(), ...$location])
            ->assertConflict()->assertJsonPath('code', 'session_at_origin_outlet');
        $this->assertDatabaseHas('attendance_sessions', ['id' => $newSessionId, 'status' => 'active']);
        $this->assertDatabaseCount('attendance_events', 3);

        $anotherEmployee = $this->addEmployee($fixture, 'Another employee');
        $this->loginAs($anotherEmployee['user']);
        $this->browserRequest()->getJson('/api/v1/attendance/me/operations/check_out/'.$key)
            ->assertOk()->assertExactJson(['state' => 'not_found', 'operation' => 'check_out']);
    }

    public function test_personal_cross_outlet_checkout_is_rejected_without_side_effects_and_origin_checkout_replays(): void
    {
        $fixture = $this->attendanceFixture();
        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Destination');
        $this->loginAs($fixture['employeeUser']);
        $sessionId = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(), 'location' => $this->validLocation(),
            ])->assertCreated()->json('session.id');

        $rejected = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-out', [
                'checkout_outlet_id' => $destination->getKey(),
                'checkout_session_id' => $sessionId,
                'location' => $this->validLocation(),
            ])->assertConflict()->assertJsonPath('code', 'session_at_origin_outlet');
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertDatabaseCount('attendance_active_session_owners', 1);
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);
        $key = (string) Str::uuid();
        $checkout = fn () => $this->browserRequest()->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/attendance/me/check-out', [
                'checkout_outlet_id' => $fixture['outlet']->getKey(),
                'checkout_session_id' => $sessionId,
                'location' => $this->validLocation(),
            ]);
        $completed = $checkout()->assertOk()->assertJsonPath('session.status', 'closed');
        $checkout()->assertOk()->assertExactJson($completed->json());
        $event = AttendanceEvent::query()->findOrFail($completed->json('event.id'));
        $this->assertSame((int) $fixture['outlet']->getKey(), (int) $event->outlet_id);
        $this->assertSame($sessionId, (int) $event->attendance_session_id);
    }

    public function test_personal_checkout_uses_origin_geofence_and_rejects_unconfigured_origin_geofence(): void
    {
        $fixture = $this->attendanceFixture();
        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Destination');
        $this->loginAs($fixture['employeeUser']);
        $location = $this->validLocation();
        $sessionId = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(), 'location' => $location,
            ])->assertCreated()->json('session.id');
        $checkout = fn (int $outletId, string $key) => $this->browserRequest()->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/attendance/me/check-out', [
                'checkout_outlet_id' => $outletId, 'checkout_session_id' => $sessionId, 'location' => $location,
            ]);
        $checkout((int) $destination->getKey(), (string) Str::uuid())
            ->assertConflict()->assertJsonPath('code', 'session_at_origin_outlet');
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_active_session_owners', 1);

        $tomorrow = CarbonImmutable::tomorrow('Asia/Jakarta');
        app(AttendancePolicyService::class)->createOutletVersion(
            $fixture['owner'], $fixture['outlet'], $tomorrow->toDateString(), ['attendance_mode' => 'personal'],
            'Origin policy without geofence',
        );
        $this->travelTo($tomorrow->addHours(12), function () use ($checkout, $fixture, $sessionId): void {
            $this->loginAs($fixture['employeeUser']);
            $checkout((int) $fixture['outlet']->getKey(), (string) Str::uuid())->assertUnprocessable()
                ->assertJsonPath('code', 'location_geofence_unconfigured');
            $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);
            $this->assertDatabaseCount('attendance_events', 1);
        });
    }

    public function test_legacy_pending_checkout_replays_without_claiming_destination_verification(): void
    {
        $fixture = $this->attendanceFixture();
        $actor = AttendanceActor::personal($fixture['membership']);
        $attendance = app(AttendanceService::class);
        $employee = $fixture['employee'];
        $location = $this->validLocation();
        $this->assertSame(201, $attendance->checkIn(
            $actor, $employee, $fixture['outlet'], (string) Str::uuid(), $location, null,
        )['status']);

        $key = (string) Str::uuid();
        $legacyHash = hash('sha256', json_encode([
            'tenant_id' => $actor->tenantId,
            'origin' => 'personal',
            'actor_id' => $actor->tenantMembershipId,
            'employee_id' => (int) $employee->getKey(),
            'operation' => 'check_out',
            'outlet_id' => null,
            'location' => $location,
            'photo_sha256' => null,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        $legacyRecordColumns = [
            'tenant_id' => $actor->tenantId, 'employee_id' => $employee->getKey(),
            ...$actor->eventColumns(),
            'operation' => 'check_out', 'idempotency_key' => $key, 'request_hash' => $legacyHash,
        ];
        $staleKey = (string) Str::uuid();
        $beforeCheckIn = AttendanceSession::query()->sole()->check_in_at->subSecond();
        DB::table('attendance_idempotency_records')->insert([
            ...$legacyRecordColumns, 'idempotency_key' => $staleKey,
            'created_at' => $beforeCheckIn, 'updated_at' => $beforeCheckIn,
        ]);
        $stale = $attendance->checkOut($actor, $employee, $staleKey, $location, null);
        $this->assertSame(409, $stale['status']);
        $this->assertSame('no_active_attendance', $stale['body']['code']);
        $this->assertDatabaseCount('attendance_active_session_owners', 1);

        $record = AttendanceIdempotencyRecord::query()->create($legacyRecordColumns)->refresh();
        $this->assertSame(1, $record->contract_version);
        $this->assertSame([
            'state' => 'pending', 'operation' => 'check_out', 'contract_version' => 1,
            'checkout_session_id' => null, 'checkout_outlet_id' => null,
        ], $attendance->operationStatus($actor, (int) $employee->getKey(), 'check_out', $key));
        $this->assertSame('idempotency_key_conflict', $attendance->checkOut(
            $actor, $employee, $key, $location, null, $fixture['outlet'],
        )['body']['code']);

        $result = $attendance->checkOut($actor, $employee, $key, $location, null);
        $this->assertSame(200, $result['status']);
        $this->assertArrayNotHasKey('contract_version', $result['body']['operation']);
        $event = AttendanceEvent::query()->findOrFail($result['body']['event']['id']);
        $this->assertNull($event->checkout_outlet_id);
        $this->assertNull($event->checkout_context);
        $this->assertEquals($result, $attendance->checkOut($actor, $employee, $key, $location, null));
        $this->assertEquals($result['body'], $attendance->operationStatus(
            $actor, (int) $employee->getKey(), 'check_out', $key,
        )['result']);
    }

    public function test_pending_bound_checkout_cannot_close_a_replacement_session(): void
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $attendance = app(AttendanceService::class);
        $actor = AttendanceActor::personal($fixture['membership']);
        $employee = $fixture['employee'];
        $location = $this->validLocation();
        $checkIn = fn () => $attendance->checkIn(
            $actor, $employee, $fixture['outlet'], (string) Str::uuid(), $location, null,
        );
        $original = $checkIn()['body']['session']['id'];
        $key = (string) Str::uuid();
        $checkout = fn () => $attendance->checkOut($actor, $employee, $key, $location, $this->photo(160, 80, 30));
        AttendanceEvidence::creating(static function (): never {
            throw new RuntimeException('injected checkout evidence failure');
        });

        try {
            $checkout();
            $this->fail('Expected the checkout write to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('injected checkout evidence failure', $exception->getMessage());
        } finally {
            AttendanceEvidence::flushEventListeners();
        }

        $this->assertSame([
            'state' => 'pending', 'operation' => 'check_out', 'contract_version' => 2,
            'checkout_session_id' => $original, 'checkout_outlet_id' => (int) $fixture['outlet']->getKey(),
        ], $attendance->operationStatus($actor, (int) $employee->getKey(), 'check_out', $key));
        $this->assertSame(200, $attendance->checkOut($actor, $employee, (string) Str::uuid(), $location, null)['status']);
        $replacement = $checkIn()['body']['session']['id'];

        $result = $checkout();
        $this->assertSame(409, $result['status']);
        $this->assertSame('no_active_attendance', $result['body']['code']);
        $this->assertSame($original, $result['body']['operation']['checkout_session_id']);
        $this->assertDatabaseHas('attendance_sessions', ['id' => $replacement, 'status' => 'active']);
        $this->assertDatabaseCount('attendance_events', 3);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertSame([], Storage::disk('local')->allFiles('attendance-evidence'));
    }

    public function test_kiosk_cross_outlet_checkout_is_rejected_without_events_evidence_or_session_closure(): void
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Destination unit', 'Destination');
        $this->loginAs($fixture['employeeUser']);
        $sessionId = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(), 'location' => $this->validLocation(),
            ])->assertCreated()->json('session.id');

        $pairing = app(KioskPairingService::class)->issuePairingCode($fixture['owner'], $destination, 'Destination kiosk');
        $paired = $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $pairing['code']])->assertOk();
        $device = KioskDevice::query()->forTenant((int) $fixture['tenant']->getKey())
            ->where('outlet_id', $destination->getKey())->firstOrFail();
        $result = app(AttendanceService::class)->checkOut(
            AttendanceActor::kiosk($device),
            $fixture['employee'],
            (string) Str::uuid(),
            $this->validLocation(),
            $this->photo(40, 88, 177),
            expectedSessionId: $sessionId,
        );

        $this->assertSame(409, $result['status']);
        $this->assertSame('session_at_origin_outlet', $result['body']['code']);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertDatabaseCount('attendance_active_session_owners', 1);
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);
        $this->assertSame([], Storage::disk('local')->allFiles('attendance-evidence'));
    }

    public function test_outlet_transfer_is_rejected_while_attendance_session_is_active(): void
    {
        $fixture = $this->attendanceFixture();
        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Destination unit', 'Destination');
        $this->loginAs($fixture['employeeUser']);
        $sessionId = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(), 'location' => $this->validLocation(),
            ])->assertCreated()->json('session.id');

        try {
            app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
                $fixture['owner'], $fixture['employee'], $destination, now(),
            );
            $this->fail('An active attendance session must prevent an outlet transfer.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('outlet', $exception->errors());
        }

        $this->assertSame((int) $fixture['outlet']->getKey(), (int) $fixture['employee']->assignments()
            ->where('assignment_type', 'primary')->where('effective_until', '>', now())->value('outlet_id'));
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);
        $this->assertDatabaseCount('attendance_events', 1);
    }

    public function test_current_attendance_fails_closed_for_ambiguous_effective_outlets(): void
    {
        $fixture = $this->attendanceFixture();
        [, $otherOutlet] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Other outlet');
        DB::table('employee_outlet_assignments')->insert([
            'tenant_id' => $fixture['tenant']->getKey(),
            'employee_id' => $fixture['employee']->getKey(),
            'outlet_id' => $otherOutlet->getKey(),
            'assignment_type' => 'temporary',
            'effective_from' => now()->subMinute(),
            'effective_until' => now()->addMinute(),
            'created_by_membership_id' => $fixture['owner']->getKey(),
        ]);

        $this->expectException(ValidationException::class);
        app(AttendanceService::class)->current($fixture['membership'], $fixture['employee']);
    }

    public function test_existing_kiosk_checkout_contract_replays_without_claiming_gps(): void
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $employee = $fixture['employee'];
        [$device, $token] = $this->kioskFor($fixture, $employee);
        $sessionId = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']), $employee, $fixture['outlet'],
            (string) Str::uuid(), $this->validLocation(), null,
        )['body']['session']['id'];
        $key = (string) Str::uuid();
        $actor = AttendanceActor::kiosk($device);
        $storage = app(AttendanceEvidenceStorage::class);
        $photo = $storage->prepare($this->photo(42, 90, 150), $actor->tenantId);
        try {
            $hash = hash('sha256', json_encode([
                'tenant_id' => $actor->tenantId,
                'origin' => 'kiosk',
                'actor_id' => $actor->kioskDeviceId,
                'employee_id' => (int) $employee->getKey(),
                'operation' => 'check_out',
                'outlet_id' => null,
                'location' => ['status' => 'unavailable', 'latitude' => null, 'longitude' => null, 'accuracy_meters' => null],
                'photo_sha256' => $photo->sha256,
                'contract_version' => 2,
                'checkout_session_id' => $sessionId,
                'checkout_outlet_id' => $actor->kioskOutletId,
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        } finally {
            $storage->cleanup($photo);
        }
        AttendanceIdempotencyRecord::query()->create([
            'tenant_id' => $actor->tenantId, 'employee_id' => $employee->getKey(), ...$actor->eventColumns(),
            'operation' => 'check_out', 'idempotency_key' => $key, 'request_hash' => $hash,
            'contract_version' => 2, 'checkout_session_id' => $sessionId, 'checkout_outlet_id' => $actor->kioskOutletId,
        ]);
        $checkout = fn () => $this->kioskRequest($token)->withHeader('Idempotency-Key', $key)
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $employee->getKey(), 'pin' => '123456', 'photo' => $this->photo(42, 90, 150),
            ])->assertOk()->assertJsonPath('operation.contract_version', 2);
        $completed = $checkout();
        $event = AttendanceEvent::query()->findOrFail($completed->json('event.id'));
        $this->assertNull($event->location_verdict);
        $this->assertSame(['verification' => 'legacy_policy'], $event->checkout_context);
        $checkout()->assertExactJson($completed->json());
        $this->assertDatabaseCount('attendance_evidence', 1);
    }

    public function test_checkout_schema_keeps_kiosk_destination_and_session_origin_separate(): void
    {
        $fixture = $this->attendanceFixture();
        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Other outlet');
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner);
        $actor = AttendanceActor::personal($fixture['membership']);
        $employee = $fixture['employee'];
        $checkIn = app(AttendanceService::class)->checkIn(
            $actor, $employee, $fixture['outlet'], (string) Str::uuid(), $this->validLocation(), null,
        );
        $this->assertSame(201, $checkIn['status']);
        $sessionId = $checkIn['body']['session']['id'];
        $pairing = app(KioskPairingService::class)->issuePairingCode($fixture['owner'], $destination, 'Destination kiosk');
        $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $pairing['code']])->assertOk();
        $device = KioskDevice::query()->forTenant((int) $fixture['tenant']->getKey())
            ->where('outlet_id', $destination->getKey())->firstOrFail();

        $kioskActor = AttendanceActor::kiosk($device);
        $key = (string) Str::uuid();
        $rejected = app(AttendanceService::class)->checkOut(
            $kioskActor, $employee, $key, $this->validLocation(), $this->photo(20, 60, 100),
            expectedSessionId: $sessionId,
        );
        $this->assertSame(409, $rejected['status']);
        $this->assertSame('session_at_origin_outlet', $rejected['body']['code']);
        $this->assertSame('rejected', app(AttendanceService::class)
            ->operationStatus($kioskActor, (int) $employee->getKey(), 'check_out', $key)['state']);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 0);

        $binding = [
            'tenant_id' => $actor->tenantId, 'employee_id' => $employee->getKey(),
            ...$kioskActor->eventColumns(),
            'operation' => 'check_out', 'idempotency_key' => (string) Str::uuid(), 'request_hash' => str_repeat('a', 64),
            'contract_version' => 2, 'checkout_session_id' => $sessionId, 'checkout_outlet_id' => $destination->getKey(),
        ];
        $this->assertCheckoutConstraint('attendance_idem_checkout_outlet_foreign', fn () => AttendanceIdempotencyRecord::query()->create([
            ...$binding, ...$actor->eventColumns(), 'checkout_outlet_id' => $foreignOutlet->getKey(),
        ]));
        $this->assertCheckoutConstraint('attendance_idem_checkout_kiosk_foreign', fn () => AttendanceIdempotencyRecord::query()->create([
            ...$binding, 'checkout_outlet_id' => $fixture['outlet']->getKey(),
        ]));
        $record = AttendanceIdempotencyRecord::query()->create($binding);
        $legacyRecord = AttendanceIdempotencyRecord::query()->create([
            ...$binding, 'idempotency_key' => (string) Str::uuid(),
            'contract_version' => 1, 'checkout_outlet_id' => null, 'checkout_session_id' => null,
        ]);
        $eventColumns = [
            'tenant_id' => $actor->tenantId, 'employee_id' => $employee->getKey(),
            ...$kioskActor->eventColumns(),
            'attendance_session_id' => $sessionId, 'idempotency_record_id' => $record->getKey(),
            'outlet_id' => $fixture['outlet']->getKey(), 'event_type' => 'check_out', 'origin' => 'kiosk',
            'recorded_at' => now('UTC'), 'context_snapshot' => [],
            'checkout_outlet_id' => $destination->getKey(), 'authenticated_kiosk_outlet_id' => $destination->getKey(),
            'checkout_context' => ['verification' => 'synthetic_schema_fixture'],
        ];
        $verified = AttendanceIdempotencyRecord::query()->create([
            ...$binding, 'idempotency_key' => (string) Str::uuid(), 'contract_version' => 4,
        ]);
        $this->assertCheckoutConstraint('Attendance event must match the verified kiosk checkout contract', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'idempotency_record_id' => $verified->getKey(),
            'checkout_context' => ['verification' => 'verified'], 'location_verdict' => 'verified',
        ]));
        $this->assertCheckoutConstraint('attendance_event_session_employee_outlet_foreign', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'outlet_id' => $destination->getKey(),
        ]));
        $this->assertCheckoutConstraint('attendance_event_kiosk_binding_foreign', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'idempotency_record_id' => $legacyRecord->getKey(),
            'checkout_outlet_id' => null, 'checkout_context' => null, 'authenticated_kiosk_outlet_id' => null,
        ]));
        $this->assertCheckoutConstraint('Attendance event must match the checkout contract', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'checkout_outlet_id' => null, 'checkout_context' => null, 'authenticated_kiosk_outlet_id' => null,
        ]));
        $this->assertCheckoutConstraint('attendance_event_authenticated_outlet_check', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'authenticated_kiosk_outlet_id' => null,
        ]));
        $this->assertCheckoutConstraint('attendance_event_checkout_binding_foreign', fn () => AttendanceEvent::query()->create([
            ...$eventColumns, 'checkout_outlet_id' => $foreignOutlet->getKey(),
            'idempotency_record_id' => $legacyRecord->getKey(),
            'authenticated_kiosk_outlet_id' => null, 'tenant_membership_id' => $actor->tenantMembershipId,
            'origin' => 'personal', 'kiosk_device_id' => null,
        ]));
        $this->assertCheckoutConstraint('Attendance event must match the checkout contract', fn () => AttendanceEvent::query()->create([
            ...$eventColumns,
            'authenticated_kiosk_outlet_id' => null, 'tenant_membership_id' => $actor->tenantMembershipId,
            'origin' => 'personal', 'kiosk_device_id' => null,
        ]));

        $event = AttendanceEvent::query()->create($eventColumns)->refresh();
        $this->assertSame((int) $fixture['outlet']->getKey(), (int) $event->session->outlet_id);
        $this->assertSame((int) $destination->getKey(), $event->authenticated_kiosk_outlet_id);
        $this->assertSame($event->authenticated_kiosk_outlet_id, $event->checkout_outlet_id);
        $this->assertArrayNotHasKey('kiosk_binding_outlet_id', $event->toArray());
        $events = DB::table('attendance_events')->where('id', $event->getKey());
        $this->assertCheckoutConstraint('Attendance provenance is append-only', fn () => $events->update(['checkout_context' => '{}']));
        $this->assertCheckoutConstraint('Attendance provenance is append-only', fn () => $events->delete());
        $this->assertCheckoutConstraint('Checkout operation binding is immutable', fn () => DB::table('attendance_idempotency_records')
            ->where('id', $record->getKey())->update(['checkout_outlet_id' => $fixture['outlet']->getKey()]));

        [$supervisor, $membership] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $membership, $destination);
        $this->loginAs($supervisor);
        $workDate = $event->session->work_date->toDateString();
        $query = '?from='.$workDate.'&to='.$workDate.'&outlet_id=';
        $this->browserRequest()->getJson('/api/v1/management/attendance'.$query.$fixture['outlet']->getKey())
            ->assertForbidden();
        $this->browserRequest()->getJson('/api/v1/management/attendance'.$query.$destination->getKey())
            ->assertOk()->assertJsonCount(0, 'sessions');
    }

    private function assertCheckoutConstraint(string $constraint, callable $write): void
    {
        try {
            $write();
            $this->fail('The write should violate '.$constraint);
        } catch (QueryException $exception) {
            $this->assertStringContainsString($constraint, $exception->getMessage());
        }
    }

    public function test_personal_location_outside_the_configured_geofence_is_rejected_without_attendance(): void
    {
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);

        $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(),
                'location' => [
                    'status' => 'provided',
                    'latitude' => 0,
                    'longitude' => 0,
                    'accuracy_meters' => 20,
                ],
            ])->assertStatus(422)->assertJsonPath('code', 'location_outside_range');

        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);
    }

    public function test_overnight_check_in_and_checkout_keep_the_originating_local_work_date(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        Storage::fake('local');
        Carbon::setTestNow(CarbonImmutable::parse('2026-10-25 13:00:00', 'UTC'));

        try {
            $fixture = $this->attendanceFixture();
            $workDate = '2026-10-25';
            $shift = app(ShiftTemplateService::class)->create(
                $fixture['owner'], 'Shift malam S4', '20:00:00', '04:00:00', true, $workDate, 'Uji lintas tengah malam',
            )->versions->firstOrFail();
            app(EmployeeScheduleService::class)->createWeeklyRule(
                $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
                7, (int) $shift->getKey(), $workDate, null, 'Jadwal malam Minggu.',
            );
            $this->loginAs($fixture['employeeUser']);

            $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->post('/api/v1/attendance/me/check-in', [
                    'location' => $this->validLocation(),
                    'outlet_id' => $fixture['outlet']->getKey(),
                    'photo' => $this->photo(30, 85, 140),
                ])->assertCreated();
            $sessionId = (int) $checkIn->json('session.id');
            $session = AttendanceSession::query()->findOrFail($sessionId);

            $this->assertSame($workDate, $session->work_date->toDateString());
            $this->assertSame('scheduled', $session->schedule_snapshot['status']);
            $this->assertSame((int) $shift->getKey(), $session->schedule_snapshot['shift']['version_id']);
            $this->assertSame('2026-10-25T20:00:00+07:00', $session->schedule_snapshot['scheduled_start']);
            $this->assertSame('2026-10-26T04:00:00+07:00', $session->schedule_snapshot['scheduled_end']);
            $this->assertSame((int) $fixture['outlet']->getKey(), (int) $session->outlet_id);

            Carbon::setTestNow(CarbonImmutable::parse('2026-10-25 21:00:00', 'UTC'));
            $checkOut = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->post('/api/v1/attendance/me/check-out', ['location' => $this->validLocation(), 'photo' => $this->photo(180, 70, 35)])->assertOk();

            $this->assertSame($sessionId, (int) $checkOut->json('session.id'));
            $session->refresh();
            $this->assertSame($workDate, $session->work_date->toDateString());
            $this->assertSame('closed', $session->status);
            $this->assertSame('2026-10-25 21:00:00', $session->check_out_at->format('Y-m-d H:i:s'));
            $this->assertSame(2, AttendanceEvent::query()->where('attendance_session_id', $sessionId)->count());
            $this->assertSame(2, AttendanceEvidence::query()->where('attendance_session_id', $sessionId)->count());
            $this->assertNotContains('early_departure', $session->review_indicators);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_date_specific_rest_exception_records_attendance_with_a_rest_day_indicator(): void
    {
        Carbon::setTestNow(CarbonImmutable::parse('2026-10-26 03:00:00', 'UTC'));

        try {
            $fixture = $this->attendanceFixture();
            $workDate = '2026-10-26';
            $exception = app(EmployeeScheduleService::class)->createException(
                $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
                $workDate, 'rest', null, 'Uji pengecualian libur S4.',
            );
            $this->loginAs($fixture['employeeUser']);

            $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->postJson('/api/v1/attendance/me/check-in', [
                    'location' => $this->validLocation(),
                    'outlet_id' => $fixture['outlet']->getKey(),
                ])->assertCreated()
                ->assertJsonPath('session.work_date', $workDate);

            $session = AttendanceSession::query()->findOrFail($response->json('session.id'));
            $this->assertSame('rest', $session->schedule_snapshot['status']);
            $this->assertSame('date_exception', $session->schedule_snapshot['provenance']['source']);
            $this->assertSame((int) $exception->getKey(), $session->schedule_snapshot['provenance']['exception_id']);
            $this->assertContains('rest_day_work', $session->review_indicators);
            $this->assertSame(1, AttendanceEvent::query()->where('attendance_session_id', $session->getKey())->count());
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_attendance_during_a_closed_outlet_calendar_exception_is_recorded_for_review(): void
    {
        Carbon::setTestNow(CarbonImmutable::parse('2026-10-25 13:00:00', 'UTC'));

        try {
            $fixture = $this->attendanceFixture();
            $workDate = '2026-10-25';
            $shift = app(ShiftTemplateService::class)->create(
                $fixture['owner'], 'Shift saat tutup S4', '19:00:00', '23:00:00', false, $workDate, 'Uji outlet tutup',
            )->versions->firstOrFail();
            app(EmployeeScheduleService::class)->createWeeklyRule(
                $fixture['owner'], (int) $fixture['employee']->getKey(), (int) $fixture['outlet']->getKey(),
                7, (int) $shift->getKey(), $workDate, null, 'Jadwal pada tanggal outlet tutup.',
            );
            app(OutletCalendarService::class)->createDateException(
                $fixture['owner'], $fixture['outlet'], $workDate, 'closed', null, 'Uji pencatatan saat outlet tutup.',
            );
            $this->loginAs($fixture['employeeUser']);

            $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->postJson('/api/v1/attendance/me/check-in', [
                    'location' => $this->validLocation(),
                    'outlet_id' => $fixture['outlet']->getKey(),
                ])->assertCreated();

            $session = AttendanceSession::query()->findOrFail($response->json('session.id'));
            $this->assertSame('scheduled', $session->schedule_snapshot['status']);
            $this->assertFalse($session->schedule_snapshot['outlet_operating']);
            $this->assertContains('outlet_closed', $session->review_indicators);
            $this->assertContains('schedule_conflict', $session->review_indicators);
            $this->assertSame(1, AttendanceEvent::query()->where('attendance_session_id', $session->getKey())->count());
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_personal_access_requires_an_active_employee_link_and_rejects_foreign_outlets(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        $fixture = $this->attendanceFixture();
        [$unlinkedUser, $unlinkedMembership] = $this->membershipFor($fixture['owner'], TenantRole::Employee);
        $this->loginAs($unlinkedUser);
        $this->browserRequest()->getJson('/api/v1/attendance/me')
            ->assertOk()->assertJsonPath('eligibility.status', 'employee_link_required')
            ->assertJsonPath('employee', null);

        $unlinkedMembership->forceFill(['is_active' => false])->save();
        $this->browserRequest()->getJson('/api/v1/attendance/me')->assertStatus(409);

        [, , $foreignOwner] = $this->tenantWithOwner('Foreign attendance tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner, 'Foreign unit', 'Foreign outlet');
        $this->loginAs($fixture['employeeUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $foreignOutlet->getKey(),
                'photo' => $this->photo(120, 80, 30),
            ])->assertForbidden();
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
    }

    public function test_disallowed_personal_mode_does_not_create_an_attendance_event(): void
    {
        $fixture = $this->attendanceFixture('kiosk');
        $this->loginAs($fixture['employeeUser']);

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
            ])->assertForbidden()->assertJsonPath('code', 'attendance_mode_not_allowed');
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
    }

    public function test_personal_photo_gate_requires_valid_evidence_at_controller_and_service_boundaries(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', ['location' => $this->validLocation(), 'outlet_id' => $fixture['outlet']->getKey()])
            ->assertUnprocessable()->assertJsonValidationErrors('photo');
        $this->assertSame(0, AttendanceSession::query()->count());
        $this->assertSame(0, AttendanceEvent::query()->count());

        $invalidPath = tempnam(sys_get_temp_dir(), 'hadirinaja-invalid-photo-');
        if ($invalidPath === false) {
            throw new RuntimeException('Could not create an invalid image fixture.');
        }
        $this->temporaryImages[] = $invalidPath;
        file_put_contents($invalidPath, 'not an image');
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => new UploadedFile($invalidPath, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true),
            ])->assertUnprocessable()->assertJsonValidationErrors('photo');
        $this->assertSame(0, AttendanceEvent::query()->count());

        $this->expectException(ValidationException::class);
        app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']), $fixture['employee'], $fixture['outlet'],
            (string) Str::uuid(), ['status' => 'unavailable'], null,
        );
    }

    public function test_personal_check_in_and_out_persist_distinct_evidence_and_replay_same_payload(): void
    {
        config([
            'attendance_evidence.require_personal_photo' => true,
            'attendance_evidence.write_format' => 'webp',
        ]);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);
        $checkInKey = (string) Str::uuid();

        $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(25, 95, 165),
            ])->assertCreated();
        $eventId = (int) $checkIn->json('event.id');
        $sessionId = (int) $checkIn->json('session.id');
        $evidence = AttendanceEvidence::query()->where('attendance_event_id', $eventId)->firstOrFail();
        $this->assertSame('personal_photo', $evidence->evidence_type);
        $this->assertSame('image/webp', $evidence->stored_mime_type);
        $this->assertSame($sessionId, (int) $evidence->attendance_session_id);
        Storage::disk('local')->assertExists($evidence->storage_path);

        $retry = $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(25, 95, 165),
            ])->assertCreated()->assertJsonPath('event.id', $eventId);
        $this->assertSame($checkIn->json('event.id'), $retry->json('event.id'));

        $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(175, 45, 85),
            ])->assertStatus(409)->assertJsonPath('code', 'idempotency_key_conflict');

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-out', ['location' => $this->validLocation(), 'photo' => $this->photo(25, 95, 165)])
            ->assertStatus(422)->assertJsonPath('code', 'photo_must_be_new');
        $this->assertSame(1, AttendanceEvent::query()->count());

        $checkOut = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-out', ['location' => $this->validLocation(), 'photo' => $this->photo(175, 45, 85)])->assertOk();
        $checkOutEvent = AttendanceEvent::query()->findOrFail($checkOut->json('event.id'));
        $checkOutEvidence = AttendanceEvidence::query()->where('attendance_event_id', $checkOutEvent->getKey())->firstOrFail();
        $this->assertSame('personal', $checkOutEvent->origin);
        $this->assertSame('personal_photo', $checkOutEvidence->evidence_type);
        $this->assertSame($sessionId, (int) $checkOutEvidence->attendance_session_id);
        $this->assertNotSame($evidence->sha256, $checkOutEvidence->sha256);
        $this->assertSame(1, AttendanceSession::query()->count());
        $this->assertSame(2, AttendanceEvent::query()->count());
        $this->assertSame(2, AttendanceEvidence::query()->count());

        $nextCheckIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(60, 150, 220),
            ])->assertCreated();
        $this->assertNotSame($sessionId, (int) $nextCheckIn->json('session.id'));
        $this->assertSame(2, AttendanceSession::query()->count());
        $this->assertSame(3, AttendanceEvent::query()->count());
        $this->assertSame(3, AttendanceEvidence::query()->count());
    }

    public function test_personal_photo_storage_failure_does_not_create_attendance(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);
        $disk = \Mockery::mock(Filesystem::class);
        $disk->shouldReceive('files')->once()->with('attendance-evidence/.staging')->andReturn([]);
        $disk->shouldReceive('put')->once()->andReturnFalse();
        $disk->shouldReceive('delete')->once()->with(\Mockery::type('string'))->andReturnTrue();
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);

        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(100, 170, 220),
            ])->assertServerError();

        $this->assertSame(0, AttendanceSession::query()->count());
        $this->assertSame(0, AttendanceEvent::query()->count());
        $this->assertSame(0, AttendanceEvidence::query()->count());
    }

    public function test_kiosk_requires_new_private_photo_for_each_event_and_protects_evidence_retrieval(): void
    {
        config(['attendance_evidence.write_format' => 'jpeg']);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        [$device, $token] = $this->kioskFor($fixture, $fixture['employee']);
        $employeesResponse = $this->withCookie('hadirinaja_kiosk', $token)->getJson('/api/v1/kiosk/attendance/employees');
        $this->assertSame(200, $employeesResponse->status(), json_encode($employeesResponse->json(), JSON_THROW_ON_ERROR));
        $employeesResponse->assertJsonPath('employees.0.id', $fixture['employee']->getKey());
        $this->withCookie('hadirinaja_kiosk', $token)->postJson('/api/v1/kiosk/attendance/next-operation', [
            'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456',
        ])->assertOk()->assertJsonPath('next_operation', 'check_in');

        $this->withCookie('hadirinaja_kiosk', $token)->postJson('/api/v1/kiosk/attendance/check-in', [
            'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456',
        ])->assertUnprocessable()->assertJsonValidationErrors('photo');
        $invalid = UploadedFile::fake()->create('camera.jpg', 20, 'image/jpeg');
        $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $invalid,
            ])->assertUnprocessable();
        $this->assertDatabaseCount('attendance_events', 0);

        $checkInPhoto = $this->photo(30, 90, 170);
        $checkIn = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $checkInPhoto,
            ])->assertCreated()->assertJsonPath('event.origin', 'kiosk');
        $sessionId = $checkIn->json('session.id');
        $checkInEventId = $checkIn->json('event.id');
        $evidence = AttendanceEvidence::query()->firstOrFail();
        $this->assertSame('kiosk_photo', $evidence->evidence_type);
        $this->assertSame('validated_normalized', $evidence->validation_status);
        $this->assertSame('image/jpeg', $evidence->stored_mime_type);
        $this->assertStringStartsWith('attendance-evidence/'.$fixture['tenant']->getKey().'/', $evidence->storage_path);
        Storage::disk('local')->assertExists($evidence->storage_path);
        $this->assertFalse(Storage::disk('public')->exists($evidence->storage_path));

        $this->loginAs($fixture['employeeUser']);
        $this->get('/api/v1/management/attendance/events/'.$checkInEventId.'/evidence')
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->loginAs($fixture['ownerUser']);
        $evidenceResponse = $this->get('/api/v1/management/attendance/events/'.$checkInEventId.'/evidence')
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('inline; filename="attendance-evidence.jpg"', $evidenceResponse->headers->get('Content-Disposition'));
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $checkInEventId,
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => 'view',
            'outcome' => 'success',
        ]);
        $cacheControl = (string) $evidenceResponse->headers->get('Cache-Control');
        $this->assertStringContainsString('no-store', $cacheControl);
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('max-age=0', $cacheControl);

        $samePhoto = $this->photo(30, 90, 170);
        $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $samePhoto, 'location' => $this->validLocation(),
            ])->assertStatus(422)->assertJsonPath('code', 'photo_must_be_new');
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);

        $checkOutPhoto = $this->photo(170, 90, 30);
        $checkOut = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $checkOutPhoto, 'location' => $this->validLocation(),
            ])->assertOk()->assertJsonPath('event.origin', 'kiosk')
            ->assertJsonPath('session.status', 'closed');
        $this->assertSame($sessionId, $checkOut->json('session.id'));
        $checkoutEvent = AttendanceEvent::query()->findOrFail($checkOut->json('event.id'));
        $this->assertSame((int) $fixture['outlet']->getKey(), $checkoutEvent->checkout_outlet_id);
        $this->assertSame($checkoutEvent->checkout_outlet_id, $checkoutEvent->authenticated_kiosk_outlet_id);
        $this->assertSame('verified', $checkoutEvent->checkout_context['verification']);
        $this->assertSame('verified', $checkoutEvent->location_verdict);
        $this->assertDatabaseCount('attendance_sessions', 1);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseCount('attendance_evidence', 2);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);

        $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(30, 90, 170),
            ])->assertStatus(422)->assertJsonPath('code', 'photo_must_be_new');
        $this->assertDatabaseCount('attendance_sessions', 1);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseCount('attendance_evidence', 2);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);

        $revokedDevice = KioskDevice::query()->findOrFail($device->getKey());
        app(KioskPairingService::class)->revokeDevice($fixture['owner'], (int) $revokedDevice->getKey());
        $this->withCookie('hadirinaja_kiosk', $token)->getJson('/api/v1/kiosk/status')
            ->assertForbidden()->assertJsonPath('code', 'kiosk_revoked');
    }

    public function test_retained_photo_reuse_is_scoped_to_employee_and_idempotent_retries_remain_valid(): void
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $service = app(AttendanceService::class);
        $actor = AttendanceActor::personal($fixture['membership']);
        $key = (string) Str::uuid();
        $in = fn (string $operationKey, int $color) => $service->checkIn($actor, $fixture['employee'], $fixture['outlet'], $operationKey, $this->validLocation(), $this->photo($color, 90, 170));
        $out = fn (int $color) => $service->checkOut($actor, $fixture['employee'], (string) Str::uuid(), $this->validLocation(), $this->photo($color, 90, 170));
        $this->assertSame(201, $in($key, 30)['status']);
        $this->assertSame(201, $in($key, 30)['status']);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertSame(200, $out(60)['status']);
        $this->assertSame('photo_must_be_new', $in((string) Str::uuid(), 30)['body']['code']);
        $this->assertSame(201, $in((string) Str::uuid(), 100)['status']);
        $this->assertSame('photo_must_be_new', $out(60)['body']['code']);
        $this->assertDatabaseCount('attendance_events', 3);
        $this->assertDatabaseCount('attendance_evidence', 3);
        $other = $this->addEmployee($fixture, 'Independent employee');
        $result = $service->checkIn(AttendanceActor::personal($other['membership']), $other['employee'], $fixture['outlet'], (string) Str::uuid(), $this->validLocation(), $this->photo(30, 90, 170));
        $this->assertSame(201, $result['status']);
        $this->assertDatabaseCount('attendance_events', 4);
        $foreign = $this->attendanceFixture();
        $foreignResult = $service->checkIn(AttendanceActor::personal($foreign['membership']), $foreign['employee'], $foreign['outlet'], (string) Str::uuid(), $this->validLocation(), $this->photo(30, 90, 170));
        $this->assertSame(201, $foreignResult['status']);
        $this->assertDatabaseCount('attendance_events', 5);
    }

    public function test_employee_can_view_only_own_evidence_and_denied_attempt_is_audited(): void
    {
        config(['attendance_evidence.write_format' => 'jpeg']);
        Storage::fake('local');
        [$fixture, $ownEvent, $ownEvidence] = $this->createLifecycleEvidence();
        $other = $this->addEmployee($fixture, 'Karyawan Kedua');
        $otherResult = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($other['membership']),
            $other['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            $this->validLocation(),
            $this->photo(120, 55, 35),
        );
        $otherEventId = (int) $otherResult['body']['event']['id'];
        $otherEvidence = AttendanceEvidence::query()
            ->where('attendance_event_id', $otherEventId)->firstOrFail();

        $this->loginAs($fixture['employeeUser']);
        $this->get('/api/v1/management/attendance/events/'.$ownEvent->getKey().'/evidence')
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->getJson('/api/v1/management/attendance/events/'.$otherEventId.'/evidence')
            ->assertForbidden();
        $this->get('/api/v1/attendance/me/events/'.$ownEvent->getKey().'/evidence')
            ->assertOk()->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $this->getJson('/api/v1/attendance/me/events/'.$otherEventId.'/evidence')->assertForbidden();
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'tenant_id' => $fixture['tenant']->getKey(),
            'attendance_event_id' => $otherEventId,
            'attendance_evidence_id' => $otherEvidence->getKey(),
            'actor_membership_id' => $fixture['membership']->getKey(),
            'action' => 'view',
            'outcome' => 'denied',
        ]);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $ownEvent->getKey(),
            'attendance_evidence_id' => $ownEvidence->getKey(),
            'actor_membership_id' => $fixture['membership']->getKey(),
            'action' => 'view',
            'outcome' => 'success',
        ]);
        app(TenantMembershipService::class)->revokeRole($fixture['owner'], $fixture['membership'], TenantRole::Employee);
        $this->getJson('/api/v1/attendance/me/events/'.$ownEvent->getKey().'/evidence')
            ->assertConflict()->assertJsonPath('code', 'active_membership_required');
    }

    public function test_employee_photo_expiry_is_enforced_even_when_a_hold_retains_the_file(): void
    {
        try {
            [$fixture, $event, $evidence] = $this->createLifecycleEvidence();
            $date = $event->recorded_at->setTimezone('Asia/Jakarta')->toDateString();
            $expiry = $event->recorded_at->utc()->addDays(90);
            DB::table('attendance_evidence')->where('id', $evidence->getKey())->update(['expires_at' => null]);
            DB::table('attendance_evidence_legal_hold_events')->insert([
                'tenant_id' => $fixture['tenant']->getKey(),
                'attendance_evidence_id' => $evidence->getKey(),
                'attendance_event_id' => $event->getKey(),
                'hold_reference' => 'wp01-expiry-retained',
                'action' => 'placed',
                'actor_membership_id' => $fixture['owner']->getKey(),
                'occurred_at' => now('UTC'),
            ]);
            $this->loginAs($fixture['employeeUser']);
            Carbon::setTestNow($expiry->subSecond());
            $this->get('/api/v1/attendance/me/events/'.$event->getKey().'/evidence')->assertOk();
            Carbon::setTestNow($expiry);
            foreach ([null, $expiry->addYear()->format('Y-m-d H:i:s')] as $storedExpiry) {
                DB::table('attendance_evidence')->where('id', $evidence->getKey())->update(['expires_at' => $storedExpiry]);
                $this->getJson('/api/v1/attendance/me/events/'.$event->getKey().'/evidence')->assertNotFound();
                $this->getJson('/api/v1/management/attendance/events/'.$event->getKey().'/evidence')->assertNotFound();
                $this->getJson('/api/v1/attendance/me/effective?from='.$date.'&to='.$date)
                    ->assertOk()->assertJsonPath('attendance.0.sessions.0.evidence.0.available', false);
            }
            Storage::disk('local')->assertExists($evidence->storage_path);
            $this->assertSame('available', $evidence->fresh()->lifecycle_state);
            $this->assertSame(1, AttendanceEvent::query()->where('attendance_session_id', $event->attendance_session_id)->count());
            $this->loginAs($fixture['ownerUser']);
            $this->get('/api/v1/management/attendance/events/'.$event->getKey().'/evidence')->assertOk();
            $this->getJson('/api/v1/attendance/me/events/'.$event->getKey().'/evidence')->assertForbidden();
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_supervisor_evidence_access_is_limited_to_authorized_outlets(): void
    {
        config(['attendance_evidence.write_format' => 'jpeg']);
        Storage::fake('local');
        [$fixture, $event] = $this->createLifecycleEvidence();
        [, $otherOutlet] = $this->unitWithOutlet($fixture['owner'], 'Other unit', 'Other outlet');
        [, $inScopeUser] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        [, $outOfScopeUser] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope(
            $fixture['owner'], $inScopeUser, $fixture['outlet'],
        );
        app(TenantMembershipService::class)->assignSupervisorOutletScope(
            $fixture['owner'], $outOfScopeUser, $otherOutlet,
        );

        $this->loginAs($inScopeUser->user);
        $this->get('/api/v1/management/attendance/events/'.$event->getKey().'/evidence')->assertOk();

        $this->loginAs($outOfScopeUser->user);
        $this->getJson('/api/v1/management/attendance/events/'.$event->getKey().'/evidence')
            ->assertForbidden();
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $event->getKey(),
            'actor_membership_id' => $outOfScopeUser->getKey(),
            'action' => 'view',
            'outcome' => 'denied',
        ]);
    }

    public function test_webp_evidence_is_oriented_metadata_stripped_hashed_private_and_jpeg_compatible(): void
    {
        config(['attendance_evidence.write_format' => 'webp']);
        Storage::fake('local');
        $storage = app(AttendanceEvidenceStorage::class);
        $this->assertTrue($storage->webpEncodingAvailable(), 'This runtime must expose GD WebP encoding.');

        $fixture = $this->attendanceFixture();
        [, $token] = $this->kioskFor($fixture, $fixture['employee']);
        $capture = $this->photoWithExifOrientation();
        $sourceExif = @exif_read_data($capture->getRealPath(), 'IFD0', true, false);
        $this->assertSame(6, (int) ($sourceExif['IFD0']['Orientation'] ?? 0));
        $this->assertSame('N', $sourceExif['GPS']['GPSLatitudeRef'] ?? null);

        $key = (string) Str::uuid();
        $checkIn = $this->kioskRequest($token)->withHeader('Idempotency-Key', $key)
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $capture,
            ])->assertCreated();
        $eventId = (int) $checkIn->json('event.id');
        $sessionId = (int) $checkIn->json('session.id');
        $evidence = AttendanceEvidence::query()->where('attendance_event_id', $eventId)->firstOrFail();
        $this->assertSame('image/webp', $evidence->stored_mime_type);
        $this->assertStringEndsWith('.webp', $evidence->storage_path);
        $this->assertSame(480, $evidence->image_width);
        $this->assertSame(640, $evidence->image_height);

        $bytes = Storage::disk('local')->get($evidence->storage_path);
        $this->assertStringStartsWith('RIFF', $bytes);
        $this->assertSame(hash('sha256', $bytes), $evidence->sha256);
        $imageInfo = getimagesizefromstring($bytes);
        $this->assertSame('image/webp', $imageInfo['mime']);
        $this->assertSame(480, $imageInfo[0]);
        $this->assertSame(640, $imageInfo[1]);
        $this->assertNotContains('EXIF', $this->webpChunkTypes($bytes));
        $this->assertNotContains('XMP ', $this->webpChunkTypes($bytes));
        Storage::disk('public')->assertMissing($evidence->storage_path);

        $this->kioskRequest($token)->withHeader('Idempotency-Key', $key)
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456',
                'photo' => $this->photoWithExifOrientation(),
            ])->assertCreated()->assertJsonPath('event.id', $eventId);
        $this->assertDatabaseCount('attendance_events', 1);
        $this->assertDatabaseCount('attendance_evidence', 1);

        $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456',
                'photo' => $this->photoWithExifOrientation(), 'location' => $this->validLocation(),
            ])->assertStatus(422)->assertJsonPath('code', 'photo_must_be_new');
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);

        $checkOut = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(190, 80, 25), 'location' => $this->validLocation(),
            ])->assertOk();
        $checkOutEventId = (int) $checkOut->json('event.id');
        $checkOutEvidence = AttendanceEvidence::query()->where('attendance_event_id', $checkOutEventId)->firstOrFail();
        $this->assertSame('image/webp', $checkOutEvidence->stored_mime_type);
        $this->assertNotSame($evidence->sha256, $checkOutEvidence->sha256);
        $this->assertDatabaseCount('attendance_evidence', 2);

        $this->loginAs($fixture['ownerUser']);
        $view = $this->get('/api/v1/management/attendance/events/'.$eventId.'/evidence')
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('inline; filename="attendance-evidence.webp"', $view->headers->get('Content-Disposition'));
        $download = $this->get('/api/v1/management/attendance/events/'.$eventId.'/evidence?download=1')
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('attachment; filename="attendance-evidence.webp"', $download->headers->get('Content-Disposition'));
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $eventId, 'action' => 'view', 'outcome' => 'success',
        ]);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $eventId, 'action' => 'download', 'outcome' => 'success',
        ]);

        $evidence->forceFill(['stored_mime_type' => 'image/jpeg'])->save();
        $this->get('/api/v1/management/attendance/events/'.$eventId.'/evidence')->assertNotFound();
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $eventId, 'action' => 'view', 'outcome' => 'failure',
        ]);
    }

    public function test_evidence_retrieval_checks_lifecycle_availability(): void
    {
        config(['attendance_evidence.write_format' => 'webp']);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        [, $token] = $this->kioskFor($fixture, $fixture['employee']);
        $checkIn = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(10, 30, 90),
            ])->assertCreated();
        $eventId = (int) $checkIn->json('event.id');
        $evidence = AttendanceEvidence::query()->where('attendance_event_id', $eventId)->firstOrFail();
        $this->loginAs($fixture['ownerUser']);

        $evidence->forceFill(['lifecycle_state' => 'deletion_pending'])->save();
        $this->get('/api/v1/management/attendance/events/'.$eventId.'/evidence')
            ->assertNotFound();
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_event_id' => $eventId, 'outcome' => 'failure',
        ]);
    }

    public function test_evidence_is_not_streamed_when_access_audit_cannot_be_persisted(): void
    {
        config(['attendance_evidence.write_format' => 'webp']);
        Storage::fake('local');
        $logger = \Mockery::mock(AttendanceEvidenceAuditLogger::class);
        $logger->shouldReceive('record')->once()->andThrow(new RuntimeException('audit persistence failed'));
        $this->app->instance(AttendanceEvidenceAuditLogger::class, $logger);

        $fixture = $this->attendanceFixture();
        [, $token] = $this->kioskFor($fixture, $fixture['employee']);
        $checkIn = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(80, 35, 120),
            ])->assertCreated();
        $eventId = (int) $checkIn->json('event.id');
        $this->loginAs($fixture['ownerUser']);

        $this->get('/api/v1/management/attendance/events/'.$eventId.'/evidence')->assertServerError();
    }

    public function test_webp_encoder_failure_fails_closed(): void
    {
        config(['attendance_evidence.write_format' => 'webp']);
        $unavailable = \Mockery::mock(AttendanceEvidenceStorage::class)->makePartial();
        $unavailable->shouldReceive('webpEncodingAvailable')->once()->andReturn(false);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('WebP attendance evidence encoding is unavailable.');
        $unavailable->prepare($this->photo(70, 100, 130), 1);
    }

    public function test_private_storage_write_failure_does_not_prepare_evidence(): void
    {
        config(['attendance_evidence.write_format' => 'jpeg']);
        $disk = \Mockery::mock(Filesystem::class);
        $disk->shouldReceive('files')->once()->with('attendance-evidence/.staging')->andReturn([]);
        $disk->shouldReceive('put')->once()->andReturnFalse();
        $disk->shouldReceive('delete')->once()->with(\Mockery::type('string'))->andReturnTrue();
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Could not stage private attendance evidence.');
        app(AttendanceEvidenceStorage::class)->prepare($this->photo(120, 80, 40), 1);
    }

    public function test_database_failure_after_file_commit_rolls_back_attendance_and_cleans_evidence_file(): void
    {
        config(['attendance_evidence.write_format' => 'webp']);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        [, $token] = $this->kioskFor($fixture, $fixture['employee']);
        AttendanceEvidence::creating(static function (AttendanceEvidence $evidence): void {
            throw new RuntimeException('injected evidence database failure');
        });

        try {
            $response = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
                ->post('/api/v1/kiosk/attendance/check-in', [
                    'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(160, 80, 30),
                ]);
            $this->assertSame(500, $response->status());
        } finally {
            AttendanceEvidence::flushEventListeners();
        }

        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_evidence', 0);
        $this->assertSame([], Storage::disk('local')->allFiles('attendance-evidence'));
    }

    public function test_evidence_lifecycle_expiry_and_append_only_audit_foundation_preserve_attendance_history(): void
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        [, $token] = $this->kioskFor($fixture, $fixture['employee']);

        $response = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(),
                'pin' => '123456',
                'photo' => $this->photo(50, 100, 150),
            ])->assertCreated();

        $event = AttendanceEvent::query()->findOrFail($response->json('event.id'));
        $session = AttendanceSession::query()->findOrFail($response->json('session.id'));
        $evidence = AttendanceEvidence::query()->firstOrFail();
        $this->assertSame('available', $evidence->lifecycle_state);
        $expectedExpiry = $event->recorded_at->utc()->addDays(90)->format('Y-m-d H:i:s');
        $this->assertSame($expectedExpiry, $evidence->expires_at->utc()->format('Y-m-d H:i:s'));
        Storage::disk('local')->assertExists($evidence->storage_path);

        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update(['expires_at' => null]);
        $migration = require base_path('database/migrations/2026_10_25_000001_add_attendance_evidence_lifecycle.php');
        $migration->backfillExistingExpirations();
        $this->assertSame(
            $expectedExpiry,
            AttendanceEvidence::query()->findOrFail($evidence->getKey())->expires_at->utc()->format('Y-m-d H:i:s'),
        );

        $audit = AttendanceEvidenceAuditEvent::query()->create([
            'tenant_id' => $fixture['tenant']->getKey(),
            'actor_type' => 'membership',
            'actor_membership_id' => $fixture['owner']->getKey(),
            'attendance_event_id' => $event->getKey(),
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => 'view',
            'outcome' => 'success',
            'occurred_at' => now('UTC'),
        ]);
        $this->assertSame($event->getKey(), $audit->event->getKey());
        $this->assertSame($evidence->getKey(), $audit->evidence->getKey());
        $this->assertSame($fixture['owner']->getKey(), $audit->actorMembership->getKey());
        $this->assertSame([
            'id', 'tenant_id', 'actor_type', 'actor_membership_id', 'attendance_event_id',
            'attendance_evidence_id', 'storage_key_hash', 'action', 'outcome', 'occurred_at',
        ], Schema::getColumnListing('attendance_evidence_audit_events'));

        try {
            $audit->forceFill(['outcome' => 'failure'])->save();
            $this->fail('Evidence audit events must reject updates.');
        } catch (\LogicException $exception) {
            $this->assertSame('Attendance evidence audit events are append-only.', $exception->getMessage());
        }

        try {
            $audit->delete();
            $this->fail('Evidence audit events must reject deletion.');
        } catch (\LogicException $exception) {
            $this->assertSame('Attendance evidence audit events are append-only.', $exception->getMessage());
        }

        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update([
            'lifecycle_state' => 'expired',
            'storage_path' => null,
            'detected_mime_type' => null,
            'stored_mime_type' => null,
            'stored_size_bytes' => null,
            'image_width' => null,
            'image_height' => null,
            'sha256' => null,
        ]);

        $this->assertSame(1, AttendanceEvidence::query()->where('lifecycle_state', 'expired')->count());
        $this->assertDatabaseHas('attendance_events', ['id' => $event->getKey()]);
        $this->assertDatabaseHas('attendance_sessions', ['id' => $session->getKey()]);
        $this->assertDatabaseHas('attendance_evidence_audit_events', ['id' => $audit->getKey()]);
    }

    public function test_personal_database_failure_after_file_commit_rolls_back_attendance_and_cleans_evidence_file(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);
        AttendanceEvidence::creating(static function (AttendanceEvidence $evidence): void {
            throw new RuntimeException('injected personal evidence database failure');
        });

        try {
            $response = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
                ->post('/api/v1/attendance/me/check-in', [
                    'location' => $this->validLocation(),
                    'outlet_id' => $fixture['outlet']->getKey(),
                    'photo' => $this->photo(160, 80, 30),
                ]);
            $this->assertSame(500, $response->status());
        } finally {
            AttendanceEvidence::flushEventListeners();
        }

        $this->assertSame(0, AttendanceSession::query()->count());
        $this->assertSame(0, AttendanceEvent::query()->count());
        $this->assertSame(0, AttendanceEvidence::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles('attendance-evidence'));
    }

    public function test_personal_and_kiosk_can_close_each_others_canonical_sessions(): void
    {
        config(['attendance_evidence.require_personal_photo' => true]);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $second = $this->addEmployee($fixture, 'Karyawan hibrida');
        [$device, $token] = $this->kioskFor($fixture, $fixture['employee']);
        app(EmployeePinService::class)->redeemEnrollmentCode(
            $device,
            app(EmployeePinService::class)->issueEnrollmentCode($fixture['owner'], $second['employee'], $fixture['outlet'])['code'],
            '654321',
        );

        $kioskCheckIn = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-in', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $this->photo(20, 60, 100),
            ])->assertCreated();
        $firstSession = $kioskCheckIn->json('session.id');
        $this->loginAs($fixture['employeeUser']);
        $personalCheckOut = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-out', ['location' => $this->validLocation(), 'photo' => $this->photo(30, 100, 170)])->assertOk();
        $this->assertSame($firstSession, $personalCheckOut->json('session.id'));
        $this->assertSame('personal', AttendanceEvent::query()->where('attendance_session_id', $firstSession)->orderBy('id')->get()->last()->origin);

        $this->loginAs($second['user']);
        $personalCheckIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/attendance/me/check-in', [
                'location' => $this->validLocation(),
                'outlet_id' => $fixture['outlet']->getKey(),
                'photo' => $this->photo(100, 40, 180),
            ])->assertCreated();
        $secondSession = $personalCheckIn->json('session.id');
        $kioskCheckOut = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $second['employee']->getKey(), 'pin' => '654321', 'photo' => $this->photo(190, 120, 40), 'location' => $this->validLocation(),
            ])->assertOk();
        $this->assertSame($secondSession, $kioskCheckOut->json('session.id'));
        $this->assertSame(2, AttendanceSession::query()->count());
        $this->assertSame(4, AttendanceEvent::query()->count());
        $this->assertSame(4, AttendanceEvidence::query()->count());
        $this->assertSame(
            ['personal', 'kiosk'],
            AttendanceEvent::query()->where('attendance_session_id', $secondSession)->orderBy('id')->pluck('origin')->all(),
        );
        $this->assertSame(
            ['personal_photo', 'kiosk_photo'],
            AttendanceEvidence::query()->where('attendance_session_id', $secondSession)->orderBy('id')->pluck('evidence_type')->all(),
        );
    }

    public function test_historical_session_keeps_its_outlet_after_primary_assignment_changes(): void
    {
        $fixture = $this->attendanceFixture();
        [, $newOutlet] = $this->unitWithOutlet($fixture['owner'], 'Outlet baru', 'Outlet kedua');
        $this->loginAs($fixture['employeeUser']);
        $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', ['location' => $this->validLocation(), 'outlet_id' => $fixture['outlet']->getKey()])
            ->assertCreated();
        $sessionId = $checkIn->json('session.id');
        $oldAssignmentId = AttendanceSession::query()->findOrFail($sessionId)->assignment_snapshot['id'];
        $checkOut = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-out', ['location' => $this->validLocation()])->assertOk();
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $fixture['owner'], $fixture['employee'], $newOutlet, CarbonImmutable::now()->addSecond(),
        );

        $this->assertSame($sessionId, $checkOut->json('session.id'));
        $session = AttendanceSession::query()->findOrFail($sessionId);
        $this->assertSame((int) $fixture['outlet']->getKey(), (int) $session->outlet_id);
        $this->assertNotSame((int) $newOutlet->getKey(), (int) $session->outlet_id);
        $this->assertGreaterThan(0, (int) $session->assignment_snapshot['id']);
        $this->assertSame((int) $oldAssignmentId, (int) $session->assignment_snapshot['id']);
    }

    public function test_attendance_events_reject_model_updates_and_deletes(): void
    {
        $fixture = $this->attendanceFixture();
        $this->loginAs($fixture['employeeUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', ['location' => $this->validLocation(), 'outlet_id' => $fixture['outlet']->getKey()])->assertCreated();

        $event = AttendanceEvent::query()->firstOrFail();
        try {
            $event->forceFill(['event_type' => 'check_out'])->save();
            $this->fail('Attendance events must reject model updates.');
        } catch (\LogicException $exception) {
            $this->assertSame('Attendance events are append-only.', $exception->getMessage());
        }
        try {
            $event->delete();
            $this->fail('Attendance events must reject model deletes.');
        } catch (\LogicException $exception) {
            $this->assertSame('Attendance events are append-only.', $exception->getMessage());
        }
        $this->assertDatabaseCount('attendance_events', 1);
    }

    public function test_expiration_uses_the_utc_event_timestamp_at_the_exact_90_day_boundary_and_dry_run_is_read_only(): void
    {
        [$fixture, $event, $evidence] = $this->createLifecycleEvidence();
        $recordedAt = CarbonImmutable::parse('2026-01-01 12:00:00', 'UTC');
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
        $atBoundary = $recordedAt->addDays(90);

        $lifecycle = app(AttendanceEvidenceExpirationService::class);
        $before = $lifecycle->run(true, 100, $atBoundary->subSecond());
        $at = $lifecycle->run(true, 100, $atBoundary);

        $this->assertSame(0, $before['eligible']);
        $this->assertSame(1, $at['eligible']);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertExists($evidence->storage_path);

        Artisan::call('attendance:evidence-expire', [
            '--dry-run' => true,
            '--limit' => 100,
        ]);
        $this->assertStringContainsString('dry-run', Artisan::output());

        config(['attendance_evidence.deletion_enabled' => false]);
        $disabled = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, $atBoundary);
        $this->assertTrue($disabled['disabled']);
        $this->assertSame(0, $disabled['deleted']);
        Artisan::call('attendance:evidence-expire', ['--limit' => 100]);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertExists($evidence->storage_path);
        $this->assertSame(1, AttendanceEvent::query()->whereKey($event->getKey())->count());
        $this->assertSame(1, AttendanceSession::query()->whereKey($event->attendance_session_id)->count());
        $this->assertSame((int) $fixture['tenant']->getKey(), (int) $evidence->tenant_id);
    }

    public function test_legal_hold_prevents_deletion_and_preserves_evidence_availability(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        [$fixture, $event, $evidence] = $this->createLifecycleEvidence();
        $recordedAt = CarbonImmutable::now('UTC')->subDays(91);
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
        $this->assertDatabaseHas('attendance_evidence', [
            'tenant_id' => $fixture['tenant']->getKey(),
            'id' => $evidence->getKey(),
        ]);
        DB::table('attendance_evidence_legal_hold_events')->insert([
            'tenant_id' => $fixture['tenant']->getKey(),
            'attendance_evidence_id' => $evidence->getKey(),
            'attendance_event_id' => $event->getKey(),
            'hold_reference' => 'case-2026-001',
            'action' => 'placed',
            'actor_membership_id' => $fixture['owner']->getKey(),
            'occurred_at' => now('UTC'),
        ]);

        $result = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, CarbonImmutable::now('UTC'));

        $this->assertSame(1, $result['held']);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        Storage::disk('local')->assertExists($evidence->storage_path);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => 'expiration_attempt',
            'outcome' => 'denied',
        ]);
        $this->expectException(\LogicException::class);
        AttendanceEvidenceLegalHoldEvent::query()->firstOrFail()->delete();
    }

    public function test_unavailable_legal_hold_status_fails_closed_without_deleting_or_hiding_evidence(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        [, $event, $evidence] = $this->createLifecycleEvidence();
        $recordedAt = CarbonImmutable::now('UTC')->subDays(91);
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
        $holdReader = \Mockery::mock(AttendanceEvidenceLegalHoldReader::class);
        $holdReader->shouldReceive('hasActiveHold')->once()->andThrow(new RuntimeException('hold status unavailable'));
        $this->app->instance(AttendanceEvidenceLegalHoldReader::class, $holdReader);

        $result = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, CarbonImmutable::now('UTC'));

        $this->assertSame(1, $result['failed']);
        $this->assertSame('available', $evidence->fresh()->lifecycle_state);
        $this->assertSame('claim_failed', $evidence->fresh()->deletion_last_error_code);
        Storage::disk('local')->assertExists($evidence->storage_path);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => 'expiration_attempt',
            'outcome' => 'failure',
        ]);
        $this->app->forgetInstance(AttendanceEvidenceLegalHoldReader::class);
    }

    public function test_old_unreferenced_orphan_is_deleted_with_a_hashed_path_audit_record(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $path = 'attendance-evidence/'.$fixture['tenant']->getKey().'/'.Str::uuid().'.webp';
        $disk = Storage::disk('local');
        $disk->put($path, 'synthetic orphan bytes');
        touch($disk->path($path), time() - 25 * 60 * 60);

        $result = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, CarbonImmutable::now('UTC'));

        $pathHash = hash('sha256', $fixture['tenant']->getKey().':'.$path);
        $this->assertSame(1, $result['orphans_deleted']);
        $disk->assertMissing($path);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'tenant_id' => $fixture['tenant']->getKey(),
            'attendance_event_id' => null,
            'attendance_evidence_id' => null,
            'storage_key_hash' => $pathHash,
            'action' => 'orphan_cleanup',
            'outcome' => 'success',
        ]);
        $this->assertDatabaseMissing('attendance_evidence_audit_events', ['storage_key_hash' => $path]);
    }

    public function test_deletion_failure_is_retried_and_missing_file_after_interruption_becomes_a_tombstone(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        [, $event, $evidence] = $this->createLifecycleEvidence();
        $recordedAt = CarbonImmutable::now('UTC')->subDays(91);
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
        $path = (string) $evidence->storage_path;
        $realDisk = Storage::disk('local');
        $disk = \Mockery::mock($realDisk)->makePartial();
        $disk->shouldReceive('exists')->once()->with($path)->andReturn(true);
        $disk->shouldReceive('delete')->once()->with($path)->andReturn(false);
        Storage::set('local', $disk);

        $now = CarbonImmutable::now('UTC');
        $failed = app(AttendanceEvidenceExpirationService::class)->run(false, 100, $now);
        $this->assertSame(1, $failed['failed']);
        $pending = $evidence->fresh();
        $this->assertSame('deletion_pending', $pending->lifecycle_state);
        $this->assertSame('storage_delete_failed', $pending->deletion_last_error_code);
        $this->assertTrue($pending->deletion_retry_at->gt($now));

        Storage::set('local', $realDisk);
        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update([
            'deletion_retry_at' => $now->subSecond()->format('Y-m-d H:i:s'),
        ]);
        $recovered = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, $now->addSeconds(10));

        $this->assertSame(1, $recovered['deleted']);
        $this->assertSame('expired', $evidence->fresh()->lifecycle_state);
        $this->assertNull($evidence->fresh()->storage_path);
        $this->assertNotNull($evidence->fresh()->attendance_event_id);
        $this->assertDatabaseHas('attendance_evidence_audit_events', [
            'attendance_evidence_id' => $evidence->getKey(),
            'action' => 'deletion',
            'outcome' => 'success',
        ]);
    }

    public function test_interruption_after_file_delete_recovers_as_a_tombstone_without_restoring_retrieval(): void
    {
        config(['attendance_evidence.deletion_enabled' => true]);
        [, $event, $evidence] = $this->createLifecycleEvidence();
        $recordedAt = CarbonImmutable::now('UTC')->subDays(91);
        DB::table('attendance_events')->where('id', $event->getKey())->update([
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
        DB::table('attendance_evidence')->where('id', $evidence->getKey())->update([
            'lifecycle_state' => 'deletion_pending',
            'deletion_attempts' => 1,
            'deletion_retry_at' => CarbonImmutable::now('UTC')->subMinute()->format('Y-m-d H:i:s'),
        ]);
        Storage::disk('local')->delete((string) $evidence->storage_path);

        $result = app(AttendanceEvidenceExpirationService::class)
            ->run(false, 100, CarbonImmutable::now('UTC'));

        $tombstone = $evidence->fresh();
        $this->assertSame(1, $result['deleted']);
        $this->assertSame('expired', $tombstone->lifecycle_state);
        $this->assertNull($tombstone->storage_path);
        $this->assertNull($tombstone->stored_mime_type);
        $this->assertNull($tombstone->sha256);
        $this->assertSame(1, AttendanceEvent::query()->whereKey($event->getKey())->count());
        $this->assertSame(1, AttendanceSession::query()->whereKey($event->attendance_session_id)->count());
    }

    public function test_orphan_reconciliation_requires_24_hours_and_protects_references_and_pending_operations(): void
    {
        [$fixture, , $evidence] = $this->createLifecycleEvidence();
        $disk = Storage::disk('local');
        $referencedPath = (string) $evidence->storage_path;
        touch($disk->path($referencedPath), time() - 25 * 60 * 60);
        $orphanPath = 'attendance-evidence/'.$fixture['tenant']->getKey().'/'.Str::uuid().'.jpg';
        $disk->put($orphanPath, 'synthetic orphan bytes');
        touch($disk->path($orphanPath), time() - 23 * 60 * 60);
        $pendingPath = 'attendance-evidence/'.$fixture['tenant']->getKey().'/'.Str::uuid().'.webp';
        $disk->put($pendingPath, 'synthetic pending-operation bytes');
        touch($disk->path($pendingPath), time() - 25 * 60 * 60);
        DB::table('attendance_idempotency_records')->insert([
            'tenant_id' => $fixture['tenant']->getKey(),
            'employee_id' => $fixture['employee']->getKey(),
            'tenant_membership_id' => $fixture['membership']->getKey(),
            'kiosk_device_id' => null,
            'operation' => 'check_in',
            'idempotency_key' => (string) Str::uuid(),
            'request_hash' => str_repeat('a', 64),
            'status' => 'pending',
            'created_at' => now('UTC'),
            'updated_at' => now('UTC'),
        ]);

        $result = app(AttendanceEvidenceExpirationService::class)
            ->run(true, 100, CarbonImmutable::now('UTC'));

        $this->assertSame(0, $result['orphan_candidates']);
        $disk->assertExists($referencedPath);
        $disk->assertExists($orphanPath);
        $disk->assertExists($pendingPath);
    }

    /** @return array{0: array<string, mixed>, 1: AttendanceEvent, 2: AttendanceEvidence} */
    private function createLifecycleEvidence(): array
    {
        Storage::fake('local');
        $fixture = $this->attendanceFixture();
        $result = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($fixture['membership']),
            $fixture['employee'],
            $fixture['outlet'],
            (string) Str::uuid(),
            $this->validLocation(),
            $this->photo(65, 115, 175),
        );
        $event = AttendanceEvent::query()->whereKey($result['body']['event']['id'])->firstOrFail();
        $evidence = AttendanceEvidence::query()->where('attendance_event_id', $event->getKey())->firstOrFail();
        Storage::disk('local')->assertExists($evidence->storage_path);

        return [$fixture, $event, $evidence];
    }

    /** @return array<string, mixed> */
    private function attendanceFixture(string $mode = 'hybrid'): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Attendance tenant');
        [, $outlet] = $this->unitWithOutlet($owner, 'Operations', 'Main outlet');
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Karyawan Satu');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);

        app(AttendancePolicyService::class)->createOutletVersion(
            $owner,
            $outlet,
            CarbonImmutable::today('Asia/Jakarta')->toDateString(),
            [
                'attendance_mode' => $mode,
                'personal_location_validation' => [
                    'required' => true,
                    'radius_meters' => 100,
                    'latitude' => -6.2,
                    'longitude' => 106.816666,
                ],
            ],
            'S4 test policy',
        );

        return compact('ownerUser', 'tenant', 'owner', 'outlet', 'employeeUser', 'membership', 'employee');
    }

    /** @param array<string, mixed> $fixture
     * @return array{user: User, membership: TenantMembership, employee: Employee}
     */
    private function addEmployee(array $fixture, string $name): array
    {
        $employee = app(OrganizationService::class)->registerEmployee($fixture['owner'], $name);
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($fixture['owner'], $employee, $fixture['outlet'], now()->subDay());
        [$user, $membership] = $this->membershipFor($fixture['owner'], TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($fixture['owner'], $membership, $employee);

        return compact('user', 'membership', 'employee');
    }

    /** @param array<string, mixed> $fixture
     * @return array{0: KioskDevice, 1: string}
     */
    private function kioskFor(array $fixture, Employee $employee): array
    {
        $pairings = app(KioskPairingService::class);
        $issued = $pairings->issuePairingCode($fixture['owner'], $fixture['outlet'], 'Attendance kiosk');
        $paired = $this->browserRequest()->postJson('/api/v1/kiosk/pair', ['code' => $issued['code']])->assertOk();
        $cookie = $paired->getCookie('hadirinaja_kiosk');
        $this->assertNotNull($cookie);
        $device = KioskDevice::query()->forTenant((int) $fixture['tenant']->getKey())
            ->where('outlet_id', $fixture['outlet']->getKey())->orderByDesc('id')->firstOrFail();
        $pins = app(EmployeePinService::class);
        $pins->redeemEnrollmentCode(
            $device,
            $pins->issueEnrollmentCode($fixture['owner'], $employee, $fixture['outlet'])['code'],
            '123456',
        );

        return [$device, $cookie->getValue()];
    }

    private function photo(int $red, int $green, int $blue): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'hadirinaja-attendance-');
        if ($path === false) {
            throw new RuntimeException('Could not create a temporary test image.');
        }
        $this->temporaryImages[] = $path;
        $image = imagecreatetruecolor(640, 480);
        for ($y = 0; $y < 480; $y += 6) {
            for ($x = 0; $x < 640; $x += 6) {
                $value = ($x * 17 + $y * 29 + $red * 31 + $green * 13 + $blue) & 0xFF;
                $color = imagecolorallocate($image, $value, ($value * 3) & 0xFF, ($value * 7) & 0xFF);
                imagefilledrectangle($image, $x, $y, $x + 5, $y + 5, $color);
            }
        }
        imagejpeg($image, $path, 85);
        imagedestroy($image);

        return new UploadedFile($path, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true);
    }

    private function photoWithExifOrientation(): UploadedFile
    {
        $photo = $this->photo(25, 95, 165);
        $path = $photo->getRealPath();
        $jpeg = is_string($path) ? file_get_contents($path) : false;
        if (! is_string($jpeg) || ! str_starts_with($jpeg, "\xFF\xD8")) {
            throw new RuntimeException('Could not create a JPEG metadata fixture.');
        }

        $exif = hex2bin('45786966000049492a0008000000020012010300010000000600000025880400010000002600000000000000010001000200020000004e00000000000000');
        if (! is_string($exif)) {
            throw new RuntimeException('Could not create an EXIF metadata fixture.');
        }
        $segment = "\xFF\xE1".pack('n', strlen($exif) + 2).$exif;
        file_put_contents($path, substr($jpeg, 0, 2).$segment.substr($jpeg, 2));

        return new UploadedFile($path, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true);
    }

    /** @return list<string> */
    private function webpChunkTypes(string $bytes): array
    {
        $types = [];
        $offset = 12;
        $length = strlen($bytes);

        while ($offset + 8 <= $length) {
            $type = substr($bytes, $offset, 4);
            $chunkLength = unpack('Vlength', substr($bytes, $offset + 4, 4))['length'] ?? 0;
            if (! is_int($chunkLength) || $chunkLength < 0 || $offset + 8 + $chunkLength > $length) {
                break;
            }
            $types[] = $type;
            $offset += 8 + $chunkLength + ($chunkLength % 2);
        }

        return $types;
    }

    private function validLocation(): array
    {
        return ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10];
    }

    private function loginAs(User $user): void
    {
        $login = $this->browserRequest()->postJson('/api/v1/auth/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();
        $this->captureSessionCookie($login);
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }

    private function kioskRequest(string $token): static
    {
        return $this->withCookie('hadirinaja_kiosk', $token)->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
            'Accept' => 'application/json',
        ]);
    }

    private function captureSessionCookie(TestResponse $response): void
    {
        $cookie = $response->getCookie(config('session.cookie'));
        if ($cookie !== null) {
            $this->withCookie(config('session.cookie'), $cookie->getValue());
        }
        Auth::forgetGuards();
    }
}
