<?php

namespace Tests\Feature\S5;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Models\AttendanceFinalization;
use App\Models\AttendanceSession;
use App\Services\ApprovalWorkflowService;
use App\Services\AttendancePolicyService;
use App\Services\AttendanceService;
use App\Services\EffectiveAttendanceProjectionService;
use App\Services\EffectiveAttendanceReader;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class EffectiveAttendanceReaderTest extends TestCase
{
    use BuildsTenantFixtures, DatabaseTransactions;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_physical_sources_keep_the_legacy_projection_contract_and_unknown_open_duration(): void
    {
        $f = $this->fixture();
        $reader = app(EffectiveAttendanceReader::class);
        $day = $reader->project($f['tenant']->id, $f['employee']->id, $f['date']);
        $this->assertSame($day, app(EffectiveAttendanceProjectionService::class)->project($f['tenant']->id, $f['employee']->id, $f['date']));
        $this->assertNull($day['actual_duration_seconds']);
        $this->assertNull($day['effective_duration_seconds']);
        $this->assertSame('physical_session', $day['sources'][0]['source_kind']);
        $this->assertSame($day['sessions'][0]['id'], $day['sources'][0]['source_id']);
        $this->assertSame($day['sessions'][0]['original']['event_ids'], $day['sources'][0]['physical']['event_ids']);
        $this->assertSame($day['sessions'][0]['effective'], $day['sources'][0]['effective']);
        $this->assertSame([], $reader->project($f['tenant']->id, $f['employee']->id, CarbonImmutable::parse($f['date'])->subDay()->toDateString())['sources']);
        $this->assertSame([], $reader->project($f['tenant']->id, $f['employee']->id, $f['date'], [])['sources']);
    }

    public function test_home_and_personal_history_receive_the_same_reader_sources(): void
    {
        $f = $this->fixture();
        $this->actingAs($f['user'])->withSession(['active_membership_id' => $f['membership']->id])->withHeaders([
            'Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/',
        ]);
        config(['attendance_evidence.require_personal_photo' => false]);
        $home = $this->getJson('/api/v1/attendance/me')->assertOk()->assertJsonPath('require_personal_photo', false);
        config(['attendance_evidence.require_personal_photo' => true]);
        $this->getJson('/api/v1/attendance/me')->assertOk()->assertJsonPath('require_personal_photo', true);
        $history = $this->getJson('/api/v1/attendance/me/effective?'.http_build_query(['from' => $f['date'], 'to' => $f['date']]))->assertOk();
        $days = $home->json('effective_attendance');
        $this->assertSame($history->json('attendance.0'), $days[array_key_last($days)]);
        $this->assertSame($f['employee']->id, $history->json('attendance.0.sources.0.physical.employee_id'));
    }

    public function test_foreign_employee_is_rejected_before_source_disclosure(): void
    {
        $f = $this->fixture();
        [, $otherTenant] = $this->tenantWithOwner('Other reader tenant');
        $this->expectException(ValidationException::class);
        app(EffectiveAttendanceReader::class)->project($otherTenant->id, $f['employee']->id, $f['date']);
    }

    public function test_legacy_finalization_snapshot_is_returned_unchanged_without_source_hydration(): void
    {
        $f = $this->fixture();
        $snapshot = app(EffectiveAttendanceReader::class)->project($f['tenant']->id, $f['employee']->id, $f['date']);
        unset($snapshot['sources']);
        $finalization = AttendanceFinalization::query()->create([
            'tenant_id' => $f['tenant']->id, 'employee_id' => $f['employee']->id,
            'outlet_id' => $f['outlet']->id, 'work_date' => $f['date'], 'revision' => 1,
            'outcome' => 'exceptional_attendance', 'reason' => 'Legacy snapshot fixture',
            'projection_snapshot' => $snapshot, 'actor_user_id' => $f['owner']->user_id, 'finalized_at' => now(),
        ]);
        $before = $finalization->fresh()->getRawOriginal('projection_snapshot');
        $storedSnapshot = $finalization->fresh()->projection_snapshot;
        $day = app(EffectiveAttendanceReader::class)->project($f['tenant']->id, $f['employee']->id, $f['date']);
        $this->assertEquals($snapshot, $storedSnapshot);
        $this->assertSame($storedSnapshot, $day['finalization']['projection_snapshot']);
        $this->assertArrayNotHasKey('sources', $day['finalization']['projection_snapshot']);
        $this->assertSame($before, $finalization->fresh()->getRawOriginal('projection_snapshot'));
    }

    public function test_existing_approved_overlay_changes_only_effective_values_of_one_physical_source(): void
    {
        $f = $this->fixture();
        Carbon::setTestNow(CarbonImmutable::parse($f['date'].'T09:00:00Z'));
        app(AttendanceService::class)->checkOut(
            AttendanceActor::personal($f['membership']), $f['employee'], (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $session = AttendanceSession::query()->forTenant($f['tenant']->id)->firstOrFail();
        $workflow = app(ApprovalWorkflowService::class);
        $request = $workflow->submitEmployeeRequest($f['membership'], $f['user'], [
            'type' => 'attendance_correction', 'attendance_session_id' => $session->id,
            'effective_check_in_at' => $f['date'].'T01:05:00Z',
            'effective_check_out_at' => $f['date'].'T09:00:00Z', 'reason' => 'Existing correction regression',
        ], (string) Str::uuid());
        $workflow->decide($f['owner'], $f['owner']->user, $request->id, 'approved', 'Verified existing overlay', (string) Str::uuid());
        $day = app(EffectiveAttendanceReader::class)->project($f['tenant']->id, $f['employee']->id, $f['date']);
        $this->assertCount(1, $day['sources']);
        $this->assertSame(28800, $day['sources'][0]['physical']['duration_seconds']);
        $this->assertSame(28500, $day['sources'][0]['effective']['duration_seconds']);
        $this->assertSame(28800, $day['actual_duration_seconds']);
        $this->assertSame(28500, $day['effective_duration_seconds']);
        $this->assertSame($f['date'].'T01:00:00+00:00', $session->fresh()->check_in_at->toIso8601String());
        $this->assertSame(2, $session->events()->count());
    }

    public function test_personal_options_share_deadlines_and_keep_owner_exemption_and_an_old_active_session(): void
    {
        $f = $this->fixture();
        $this->actingAs($f['user'])->withSession(['active_membership_id' => $f['membership']->id])->withHeaders([
            'Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/',
        ]);
        $url = '/api/v1/attendance/me/effective?from='.$f['date'].'&to='.$f['date'];
        $option = $this->getJson($url)->assertOk()->json('correction_options.sessions.0');
        $this->assertTrue($option['can_start']);
        $this->assertSame('check_in', $option['correction_type']);
        $this->assertSame((int) $f['outlet']->id, $option['outlet']['id']);
        Carbon::setTestNow(CarbonImmutable::parse($option['deadline']['exclusive_at']));
        $this->getJson($url)->assertOk()->assertJsonPath('correction_options.sessions.0.can_start', false);
        app(TenantMembershipService::class)->assignRole($f['owner'], $f['membership'], TenantRole::Owner);
        $this->getJson($url)->assertOk()->assertJsonPath('correction_options.sessions.0.can_start', true);
        $this->getJson('/api/v1/attendance/me')->assertOk()
            ->assertJsonPath('active_session.work_date', $f['date'])
            ->assertJsonPath('correction_options.sessions.0.session_id', $option['session_id'])
            ->assertJsonPath('correction_options.sessions.0.correction_type', 'missing_checkout');
        $this->assertSame(1, AttendanceSession::query()->where('status', 'active')->count());
    }

    public function test_personal_options_reject_a_foreign_day_before_returning_metadata(): void
    {
        $f = $this->fixture();
        $this->expectException(\Illuminate\Auth\Access\AuthorizationException::class);
        app(ApprovalWorkflowService::class)->personalCorrectionOptions($f['membership'], $f['user'], [[
            'tenant_id' => $f['tenant']->id + 1,
            'employee' => ['id' => $f['employee']->id],
            'work_date' => $f['date'],
            'sessions' => [],
        ]]);
    }

    public function test_photo_expiry_does_not_change_physical_facts_or_a_finalized_snapshot(): void
    {
        Storage::fake('local');
        $f = $this->fixture(UploadedFile::fake()->image('wp01-evidence.jpg', 400, 400));
        $reader = app(EffectiveAttendanceReader::class);
        $snapshot = $reader->project($f['tenant']->id, $f['employee']->id, $f['date']);
        $this->assertTrue($snapshot['sessions'][0]['evidence'][0]['available']);
        $finalization = AttendanceFinalization::query()->create([
            'tenant_id' => $f['tenant']->id, 'employee_id' => $f['employee']->id,
            'outlet_id' => $f['outlet']->id, 'work_date' => $f['date'], 'revision' => 1,
            'outcome' => $snapshot['outcome'], 'reason' => 'WP-01 expiry regression',
            'projection_snapshot' => $snapshot, 'actor_user_id' => $f['owner']->user_id, 'finalized_at' => now(),
        ]);
        $before = $finalization->fresh()->getRawOriginal('projection_snapshot');
        Carbon::setTestNow(CarbonImmutable::parse($snapshot['sessions'][0]['evidence'][0]['expires_at']));
        $day = $reader->project($f['tenant']->id, $f['employee']->id, $f['date']);
        $this->assertFalse($day['sessions'][0]['evidence'][0]['available']);
        $this->assertTrue($day['is_finalized']);
        $this->assertFalse($day['requires_refinalization']);
        $this->assertSame($snapshot['sources'], $day['sources']);
        $this->assertSame($before, $finalization->fresh()->getRawOriginal('projection_snapshot'));
    }

    private function fixture(?UploadedFile $photo = null): array
    {
        Carbon::setTestNow(CarbonImmutable::today('UTC')->setTime(1, 0));
        config(['attendance_evidence.require_personal_photo' => false]);
        [, $tenant, $owner] = $this->tenantWithOwner('Reader tenant');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Reader employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        $date = CarbonImmutable::today('UTC')->toDateString();
        app(AttendancePolicyService::class)->createOutletVersion($owner, $outlet, $date, [
            'attendance_mode' => 'hybrid',
            'personal_location_validation' => ['required' => true, 'radius_meters' => 100, 'latitude' => -6.2, 'longitude' => 106.816666],
        ], 'Reader fixture');
        $result = app(AttendanceService::class)->checkIn(
            AttendanceActor::personal($membership), $employee, $outlet, (string) Str::uuid(),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], $photo,
        );
        $this->assertSame(201, $result['status']);
        $this->assertSame(1, AttendanceSession::query()->forTenant($tenant->id)->count());

        return compact('tenant', 'owner', 'outlet', 'employee', 'user', 'membership', 'date');
    }
}
