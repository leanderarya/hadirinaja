<?php

namespace Tests\Feature\S3;

use App\Enums\TenantRole;
use App\Models\AttendanceSession;
use App\Services\AttendancePolicyService;
use App\Services\TenantMembershipService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\BuildsShiftChangeFixtures;
use Tests\TestCase;

class WeeklyPlannerAcceptanceTest extends TestCase
{
    use BuildsShiftChangeFixtures, RefreshDatabase;

    public function test_supervisor_publish_employee_inbox_replacement_attendance_snapshot_and_scoped_audit(): void
    {
        $f = $this->shiftFixture();
        [$supervisorUser, $supervisor] = $this->membershipFor($f['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($f['owner'], $supervisor, $f['outlet']);
        app(AttendancePolicyService::class)->createOutletVersion($f['owner'], $f['outlet'], CarbonImmutable::today('Asia/Jakarta')->toDateString(), [
            'attendance_mode' => 'hybrid', 'personal_location_validation' => ['required' => true, 'latitude' => -6.2, 'longitude' => 106.8, 'radius_meters' => 100],
        ], 'Synthetic acceptance location');
        config(['attendance_evidence.require_personal_photo' => false]);
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $login = function ($user, $member): void {
            Auth::forgetGuards();
            $this->actingAs($user)->withSession(['active_membership_id' => $member->id]);
        };
        $login($supervisorUser, $supervisor);
        $url = '/api/v1/management/scheduling/planner/outlets/'.$f['outlet']->id.'/weeks/'.$f['date'];
        $entries = $f['entries'];
        $entries[0]['shift_template_version_id'] = $f['staffing']['middle'];
        $draft = $this->withHeader('Idempotency-Key', 'acceptance-draft')->putJson($url.'/draft', ['expected_version' => 2, 'entries' => $entries, 'staffing' => $f['staffing'], 'reason' => 'Supervisor acceptance revision'])->assertOk();
        $published = $this->withHeader('Idempotency-Key', 'acceptance-publish')->postJson($url.'/publish', ['expected_version' => 3, 'expected_published_revision_id' => $f['rows'][0]->revision_id, 'warnings_checksum' => $draft->json('staffing_report.checksum'), 'reason' => 'Publish acceptance'])->assertOk()->json('published.revision_id');
        $this->artisan('planner:notifications-dispatch')->assertExitCode(0);
        $login($f['users'][0], $f['members'][0]);
        $this->getJson('/api/v1/management/notifications')->assertOk()->assertJsonFragment(['kind' => 'assignment_changed']);
        $day = $this->getJson('/api/v1/management/scheduling/me/week?week_start='.$f['date'])->assertOk()->json('days.0');
        $this->assertSame($published, $day['provenance']['published_revision_id']);
        $request = $this->withHeader('Idempotency-Key', 'acceptance-replace')->postJson('/api/v1/management/scheduling/me/changes', ['kind' => 'replacement', 'source_entry_id' => $day['provenance']['entry_id'], 'recipient_id' => $f['people'][2]->id, 'reason' => 'QA replacement acceptance'])->assertOk()->json('id');
        $this->artisan('planner:notifications-dispatch')->assertExitCode(0);
        $login($f['users'][2], $f['members'][2]);
        $this->getJson('/api/v1/management/notifications')->assertOk()->assertJsonFragment(['kind' => 'shift_requested']);
        $accepted = $this->postJson('/api/v1/management/scheduling/me/changes/'.$request.'/respond', ['action' => 'accept'])->assertOk()->assertJsonPath('status', 'accepted')->json('result.0.revision_id');
        $day = $this->getJson('/api/v1/management/scheduling/me/week?week_start='.$f['date'])->assertOk()->json('days.0');
        $this->assertSame($accepted, $day['provenance']['published_revision_id']);
        $this->assertSame('11:00:00', $day['shift']['start_time']);
        $this->travelTo(CarbonImmutable::parse($f['date'].'T11:00:00+07:00'));
        $location = ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.8, 'accuracy_meters' => 10];
        $in = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $f['outlet']->id, 'location' => $location])->assertCreated();
        $session = AttendanceSession::findOrFail($in->json('session.id'));
        $snapshot = $session->schedule_snapshot;
        $this->assertSame($accepted, $snapshot['provenance']['published_revision_id']);
        $this->travelTo(CarbonImmutable::parse($f['date'].'T19:00:00+07:00'));
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-out', ['location' => $location])->assertOk();
        $this->assertSame($snapshot, $session->fresh()->schedule_snapshot);
        $this->assertSame('closed', $session->fresh()->status);
        $login($supervisorUser, $supervisor);
        $auditDay = substr(DB::table('scheduling_change_events')->where('action', 'accepted')->value('created_at'), 0, 10);
        $audit = $this->getJson('/api/v1/management/reports/audit?source=schedule_change&from='.$auditDay.'&to='.$auditDay)->assertOk()->json('data');
        $event = collect($audit)->firstWhere('action', 'schedule.accepted');
        $this->assertNotNull($event);
        $this->assertSame($f['outlet']->id, $event['outlet_id']);
        $this->assertSame($f['users'][2]->id, $event['actor_user_id']);
    }
}
