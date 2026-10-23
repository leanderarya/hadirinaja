<?php

namespace Tests\Feature\S4;

use App\Enums\TenantRole;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\KioskDevice;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AttendancePolicyService;
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
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
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
            'location' => ['status' => 'permission_denied'],
        ];
        $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', $checkInKey)
            ->postJson('/api/v1/attendance/me/check-in', $checkInPayload);
        $this->assertSame(201, $checkIn->status(), json_encode($checkIn->json(), JSON_THROW_ON_ERROR));
        $checkIn->assertJsonPath('event.origin', 'personal')
            ->assertJsonPath('session.review_indicators.0', 'unscheduled_work')
            ->assertJsonPath('session.review_indicators.1', 'location_permission_denied');
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
            ->assertJsonPath('allowed_next_operation', 'check_out');

        $checkOutKey = (string) Str::uuid();
        $checkOutPayload = ['location' => ['status' => 'unavailable']];
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

    public function test_personal_location_outside_the_configured_geofence_is_recorded_for_review(): void
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
            ])->assertCreated();

        $event = AttendanceEvent::query()->findOrFail($response->json('event.id'));
        $this->assertSame('outside_range', $event->location_verdict);
        $this->assertContains('location_outside_range', $response->json('session.review_indicators'));
    }

    public function test_overnight_check_in_and_checkout_keep_the_originating_local_work_date(): void
    {
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
                ->postJson('/api/v1/attendance/me/check-in', [
                    'outlet_id' => $fixture['outlet']->getKey(),
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
                ->postJson('/api/v1/attendance/me/check-out', [])->assertOk();

            $this->assertSame($sessionId, (int) $checkOut->json('session.id'));
            $session->refresh();
            $this->assertSame($workDate, $session->work_date->toDateString());
            $this->assertSame('closed', $session->status);
            $this->assertSame('2026-10-25 21:00:00', $session->check_out_at->format('Y-m-d H:i:s'));
            $this->assertSame(2, AttendanceEvent::query()->where('attendance_session_id', $sessionId)->count());
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
        $fixture = $this->attendanceFixture();
        [$unlinkedUser, $unlinkedMembership] = $this->membershipFor($fixture['owner'], TenantRole::Employee);
        $this->loginAs($unlinkedUser);
        $this->browserRequest()->getJson('/api/v1/attendance/me')->assertForbidden();

        $unlinkedMembership->forceFill(['is_active' => false])->save();
        $this->browserRequest()->getJson('/api/v1/attendance/me')->assertStatus(409);

        [, , $foreignOwner] = $this->tenantWithOwner('Foreign attendance tenant');
        [, $foreignOutlet] = $this->unitWithOutlet($foreignOwner, 'Foreign unit', 'Foreign outlet');
        $this->loginAs($fixture['employeeUser']);
        $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $foreignOutlet->getKey(),
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
                'outlet_id' => $fixture['outlet']->getKey(),
            ])->assertForbidden()->assertJsonPath('code', 'attendance_mode_not_allowed');
        $this->assertDatabaseCount('attendance_sessions', 0);
        $this->assertDatabaseCount('attendance_events', 0);
    }

    public function test_kiosk_requires_new_private_photo_for_each_event_and_protects_evidence_retrieval(): void
    {
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
        $this->getJson('/api/v1/management/attendance/events/'.$checkInEventId.'/evidence')->assertForbidden();
        $this->loginAs($fixture['ownerUser']);
        $evidenceResponse = $this->get('/api/v1/management/attendance/events/'.$checkInEventId.'/evidence')
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $cacheControl = (string) $evidenceResponse->headers->get('Cache-Control');
        $this->assertStringContainsString('no-store', $cacheControl);
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('max-age=0', $cacheControl);

        $samePhoto = $this->photo(30, 90, 170);
        $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $samePhoto,
            ])->assertStatus(422)->assertJsonPath('code', 'photo_must_be_new');
        $this->assertSame('active', AttendanceSession::query()->findOrFail($sessionId)->status);

        $checkOutPhoto = $this->photo(170, 90, 30);
        $checkOut = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $fixture['employee']->getKey(), 'pin' => '123456', 'photo' => $checkOutPhoto,
            ])->assertOk()->assertJsonPath('event.origin', 'kiosk')
            ->assertJsonPath('session.status', 'closed');
        $this->assertSame($sessionId, $checkOut->json('session.id'));
        $this->assertDatabaseCount('attendance_sessions', 1);
        $this->assertDatabaseCount('attendance_events', 2);
        $this->assertDatabaseCount('attendance_evidence', 2);
        $this->assertDatabaseCount('attendance_active_session_owners', 0);

        $revokedDevice = KioskDevice::query()->findOrFail($device->getKey());
        app(KioskPairingService::class)->revokeDevice($fixture['owner'], (int) $revokedDevice->getKey());
        $this->withCookie('hadirinaja_kiosk', $token)->getJson('/api/v1/kiosk/status')
            ->assertForbidden()->assertJsonPath('code', 'kiosk_revoked');
    }

    public function test_personal_and_kiosk_can_close_each_others_canonical_sessions(): void
    {
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
            ->postJson('/api/v1/attendance/me/check-out', [])->assertOk();
        $this->assertSame($firstSession, $personalCheckOut->json('session.id'));
        $this->assertSame('personal', AttendanceEvent::query()->where('attendance_session_id', $firstSession)->orderBy('id')->get()->last()->origin);

        $this->loginAs($second['user']);
        $personalCheckIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', [
                'outlet_id' => $fixture['outlet']->getKey(),
            ])->assertCreated();
        $secondSession = $personalCheckIn->json('session.id');
        $kioskCheckOut = $this->kioskRequest($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->post('/api/v1/kiosk/attendance/check-out', [
                'employee_id' => $second['employee']->getKey(), 'pin' => '654321', 'photo' => $this->photo(190, 120, 40),
            ])->assertOk();
        $this->assertSame($secondSession, $kioskCheckOut->json('session.id'));
        $this->assertSame(2, AttendanceSession::query()->count());
        $this->assertSame(4, AttendanceEvent::query()->count());
        $this->assertSame(
            ['personal', 'kiosk'],
            AttendanceEvent::query()->where('attendance_session_id', $secondSession)->orderBy('id')->pluck('origin')->all(),
        );
    }

    public function test_historical_session_keeps_its_outlet_after_primary_assignment_changes(): void
    {
        $fixture = $this->attendanceFixture();
        [, $newOutlet] = $this->unitWithOutlet($fixture['owner'], 'Outlet baru', 'Outlet kedua');
        $this->loginAs($fixture['employeeUser']);
        $checkIn = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $fixture['outlet']->getKey()])
            ->assertCreated();
        $sessionId = $checkIn->json('session.id');
        $oldAssignmentId = AttendanceSession::query()->findOrFail($sessionId)->assignment_snapshot['id'];
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
            $fixture['owner'], $fixture['employee'], $newOutlet, CarbonImmutable::now()->addSecond(),
        );

        $checkOut = $this->browserRequest()->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/attendance/me/check-out', [])->assertOk();
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
            ->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $fixture['outlet']->getKey()])->assertCreated();

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
            CarbonImmutable::today('UTC')->toDateString(),
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
            throw new \RuntimeException('Could not create a temporary test image.');
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
