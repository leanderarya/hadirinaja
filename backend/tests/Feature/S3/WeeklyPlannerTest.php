<?php

namespace Tests\Feature\S3;

use App\Enums\TenantRole;
use App\Models\AttendanceSession;
use App\Models\ShiftTemplateVersion;
use App\Services\AttendancePolicyService;
use App\Services\EffectiveScheduleResolver;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeeScheduleService;
use App\Services\OrganizationService;
use App\Services\OutletCalendarService;
use App\Services\PlannerStaffingService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use App\Services\WeeklyPlannerService;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class WeeklyPlannerTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    private array $warningChecksums = [];

    private function staffingConfiguration($owner): array
    {
        $result = [];
        foreach (PlannerStaffingService::SHIFTS as $role => [$start, $end]) {
            $result[$role] = ShiftTemplateVersion::query()->forTenant($owner->tenant_id)->where('start_time', $start)->where('end_time', $end)->value('id');
        }

        return $result;
    }

    private function setupRoster(): array
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-02T08:00:00+07:00'));
        [$user, , $owner] = $this->tenantWithOwner('Planner');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Roster employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        $shift = app(ShiftTemplateService::class)->create($owner, 'Day', '08:00', '16:00', false, '2026-11-02', 'Fixture shift')->versions->first();
        app(EmployeeScheduleService::class)->createWeeklyRule($owner, $employee->id, $outlet->id, 1, $shift->id, '2026-11-02', null, 'Legacy Monday');
        app(ShiftTemplateService::class)->create($owner, 'Middle', '11:00', '19:00', false, '2026-11-02', 'Fixture shift');
        app(ShiftTemplateService::class)->create($owner, 'Evening', '16:00', '22:00', false, '2026-11-02', 'Fixture shift');
        $entries = [['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'rest']];

        return [$user, $owner, $outlet, $employee, $shift, $entries];
    }

    private function saveDraft($owner, $outlet, array $entries, int $version = 0, string $key = 'draft'): array
    {
        return app(WeeklyPlannerService::class)->save($owner, $outlet->id, '2026-11-09', ['expected_version' => $version, 'entries' => $entries, 'reason' => 'Prepare roster', 'staffing' => $this->staffingConfiguration($owner)], $key);
    }

    private function publishDraft($owner, $outlet, int $version = 1, ?int $base = null, bool $activate = true, string $key = 'publish'): array
    {
        $checksum = $this->warningChecksums[$owner->id.'|'.$outlet->id.'|'.$key] ??= app(WeeklyPlannerService::class)->read($owner, $outlet->id, '2026-11-09')['staffing_report']['checksum'];

        return app(WeeklyPlannerService::class)->publish($owner, $outlet->id, '2026-11-09', ['expected_version' => $version, 'expected_published_revision_id' => $base, 'activate_cutover' => $activate, 'reason' => 'Publish roster', 'warnings_checksum' => $checksum], $key);
    }

    private function directChangePayload(array $published, array $entries): array
    {
        return [
            'expected_version' => $published['version'],
            'expected_published_revision_id' => $published['published']['revision_id'],
            'entries' => $entries,
        ];
    }

    public function test_draft_and_non_cutover_publication_do_not_change_effective_legacy(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $resolver = app(EffectiveScheduleResolver::class);
        $before = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id)->toArray();
        $this->saveDraft($owner, $outlet, $entries);
        $this->assertSame($before, $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id)->toArray());
        $this->assertTrue(app(WeeklyPlannerService::class)->validate($owner, $outlet->id, '2026-11-09', 1)['valid']);
        $this->publishDraft($owner, $outlet, activate: false);
        $this->assertSame($before, $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id)->toArray());
        $this->assertNull($outlet->fresh()->weekly_planner_start_on);
    }

    public function test_custom_weekend_validates_friday_through_sunday_without_affecting_another_tenant(): void
    {
        [, $owner, $outlet, $employee, $morning] = $this->setupRoster();
        [, , $otherOwner] = $this->tenantWithOwner('Unconfigured planner');
        [, $otherOutlet] = $this->unitWithOutlet($otherOwner);
        $planner = app(WeeklyPlannerService::class);
        $policies = app(AttendancePolicyService::class);
        $date = '2026-11-02';
        $base = $policies->effective($owner->tenant_id, null, $date)['configuration'];
        $policies->reviseTenantVersion($owner, $date, [
            ...$base, 'planner_weekend_starts_on' => 5, 'planner_shift_profile' => 'cepat_kopi',
        ], 'Enable tenant weekend profile');
        $templates = app(ShiftTemplateService::class);
        $middle = $templates->create($owner, 'Custom middle', '11:00', '18:00', false, $date, 'Fixture shift')->versions->first();
        $weekend = $templates->create($owner, 'Weekend evening', '16:00', '23:00', false, $date, 'Fixture shift')->versions->first();
        $week = '2026-11-09';
        $staffing = [...$this->staffingConfiguration($owner), 'middle' => $middle->id];
        $entry = fn ($date, $shift) => ['employee_id' => $employee->id, 'work_date' => $date, 'status' => 'work', 'shift_template_version_id' => $shift->id];
        $baseDraft = ['staffing' => $staffing, 'reason' => 'Fixture custom draft'];
        $otherWeek = $planner->read($otherOwner, $otherOutlet->id, $week);
        $ownerWeek = $planner->read($owner, $outlet->id, $week);
        self::assertSame('Asia/Jakarta', $otherWeek['outlet']['timezone']);
        self::assertSame(6, $otherWeek['planner_settings']['weekend_starts_on']);
        self::assertSame('Asia/Jakarta', $ownerWeek['outlet']['timezone']);
        self::assertSame(5, $ownerWeek['planner_settings']['weekend_starts_on']);
        $planner->save($owner, $outlet->id, $week, $baseDraft + ['expected_version' => 0, 'entries' => [$entry('2026-11-13', $middle)]], 'bad-friday');
        try {
            $planner->validate($owner, $outlet->id, $week, 1);
            self::fail('Friday must reject the middle shift.');
        } catch (ValidationException $error) {
            self::assertArrayHasKey('entries', $error->errors());
        }
        $planner->save($owner, $outlet->id, $week, $baseDraft + ['expected_version' => 1, 'entries' => [
            $entry('2026-11-12', $middle), $entry('2026-11-13', $weekend),
            $entry('2026-11-14', $morning), $entry('2026-11-15', $weekend),
        ]], 'good-weekend');
        $report = $planner->validate($owner, $outlet->id, $week, 2)['staffing_report'];
        self::assertSame([], $report['conflicts']);
        self::assertSame(1, $report['days'][3]['counts']['middle']);
        self::assertSame(1, $report['days'][4]['counts']['evening']);
        self::assertSame(1, $report['days'][5]['counts']['morning']);
        self::assertSame(1, $report['days'][6]['counts']['evening']);
        self::assertNull($planner->read($owner, $outlet->id, $week)['published']);
    }

    public function test_explicit_cutover_is_atomic_preserves_history_and_disables_legacy_fallback(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $resolver = app(EffectiveScheduleResolver::class);
        $history = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-02', $outlet->id)->toArray();
        $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet);
        $resolved = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id);
        $this->assertSame('rest', $resolved->status);
        $this->assertSame($published['published']['revision_id'], $resolved->provenance['published_revision_id']);
        $this->assertSame($history, $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-02', $outlet->id)->toArray());
        $next = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-16', $outlet->id);
        $this->assertSame('unscheduled', $next->status);
        $this->assertSame('planner_unpublished', $next->provenance['source']);
        $this->expectException(HttpException::class);
        app(EmployeeScheduleService::class)->createException($owner, $employee->id, $outlet->id, '2026-11-10', 'rest', null, 'Unsafe legacy write');
    }

    public function test_published_revisions_are_immutable_and_retries_are_idempotent(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $first = $this->saveDraft($owner, $outlet, $entries);
        $this->assertEquals($first, $this->saveDraft($owner, $outlet, $entries));
        $published = $this->publishDraft($owner, $outlet);
        $this->assertEquals($published, $this->publishDraft($owner, $outlet));
        $id = $published['published']['revision_id'];
        $original = DB::table('schedule_entries')->where('revision_id', $id)->get()->toJson();
        $this->saveDraft($owner, $outlet, [], 2, 'next-draft');
        $this->assertSame('rest', app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $entries[0]['employee_id'], '2026-11-09', $outlet->id)->status);
        $this->publishDraft($owner, $outlet, 3, $id, false, 'next-publish');
        $this->assertSame($original, DB::table('schedule_entries')->where('revision_id', $id)->get()->toJson());
        $this->assertDatabaseCount('schedule_revisions', 2);
        $this->assertDatabaseCount('scheduling_operations', 4);
    }

    public function test_stale_version_and_reused_key_with_different_payload_are_rejected(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, $entries);
        foreach (['stale', 'draft'] as $key) {
            try {
                $this->saveDraft($owner, $outlet, [], 0, $key);
                $this->fail('Stale or changed payload must fail.');
            } catch (HttpException $error) {
                $this->assertSame(409, $error->getStatusCode());
            }
        }
        try {
            $this->publishDraft($owner, $outlet, base: 999999, activate: false, key: 'wrong-base');
            $this->fail('Wrong published base must fail.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
        }
        $this->assertDatabaseCount('scheduling_operations', 1);
    }

    public function test_publish_conflict_rolls_back_cutover_pointer_audit_and_operation(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $night = app(ShiftTemplateService::class)->create($owner, 'Night', '20:00', '04:00', true, '2026-11-02', 'Night shift')->versions->first();
        $morning = app(ShiftTemplateService::class)->create($owner, 'Morning', '03:30', '09:00', false, '2026-11-02', 'Morning shift')->versions->first();
        $entries = [
            ['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $night->id],
            ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'work', 'shift_template_version_id' => $morning->id],
        ];
        $this->saveDraft($owner, $outlet, $entries);
        $audit = DB::table('scheduling_change_events')->count();
        try {
            $this->publishDraft($owner, $outlet);
            $this->fail('Conflicting publication must fail.');
        } catch (ValidationException) {
            $this->assertNull($outlet->fresh()->weekly_planner_start_on);
            $this->assertNull(DB::table('schedule_weeks')->value('published_revision_id'));
            $this->assertDatabaseCount('scheduling_operations', 1);
            $this->assertDatabaseCount('scheduling_change_events', $audit);
        }
    }

    public function test_api_authorization_and_scope_prevent_draft_disclosure(): void
    {
        [$user, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $url = '/api/v1/management/scheduling/planner/outlets/'.$outlet->id.'/weeks/2026-11-09';
        $this->getJson($url)->assertUnauthorized();
        $this->actingAs($user)->withSession(['active_membership_id' => $owner->id]);
        $this->withHeader('Idempotency-Key', 'api-draft')->putJson($url.'/draft', ['expected_version' => 0, 'entries' => $entries, 'reason' => 'API draft'])->assertOk()->assertJsonPath('version', 1);
        $this->getJson($url)->assertOk()->assertJsonCount(1, 'draft.entries');
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        Auth::forgetGuards();
        $this->actingAs($employeeUser)->withSession(['active_membership_id' => $membership->id])->getJson($url)->assertForbidden();
        $this->getJson('/api/v1/management/scheduling/me/week?week_start=2026-11-09')->assertOk()->assertJsonPath('days.0.status', 'scheduled');
        [$foreign, , $foreignOwner] = $this->tenantWithOwner('Foreign');
        Auth::forgetGuards();
        $this->actingAs($foreign)->withSession(['active_membership_id' => $foreignOwner->id])->getJson($url)->assertNotFound();
    }

    public function test_published_roster_drives_attendance_and_existing_session_snapshot_survives_republication(): void
    {
        [$user, $owner, $outlet, $employee, $shift] = $this->setupRoster();
        config(['attendance_evidence.require_personal_photo' => false]);
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        app(AttendancePolicyService::class)->createOutletVersion($owner, $outlet, '2026-11-02', [
            'attendance_mode' => 'hybrid', 'personal_location_validation' => ['required' => true, 'latitude' => -6.2, 'longitude' => 106.8, 'radius_meters' => 100],
        ], 'Personal attendance fixture');
        $entries = [['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $shift->id]];
        $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet);
        $this->travelTo(CarbonImmutable::parse('2026-11-09T08:00:00+07:00'));
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        Auth::forgetGuards();
        $this->actingAs($employeeUser)->withSession(['active_membership_id' => $membership->id]);
        $location = ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.8, 'accuracy_meters' => 10];
        $in = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-in', ['outlet_id' => $outlet->id, 'location' => $location])->assertCreated();
        $session = AttendanceSession::findOrFail($in->json('session.id'));
        $snapshot = $session->schedule_snapshot;
        $this->assertSame($published['published']['revision_id'], $snapshot['provenance']['published_revision_id']);
        $entries[] = ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'rest'];
        $this->saveDraft($owner, $outlet, $entries, 2, 'later-draft');
        $this->publishDraft($owner, $outlet, 3, $published['published']['revision_id'], false, 'later-publish');
        $this->travelTo(CarbonImmutable::parse('2026-11-09T16:00:00+07:00'));
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/attendance/me/check-out', ['location' => $location])->assertOk();
        $this->assertSame($snapshot, $session->fresh()->schedule_snapshot);
        $this->assertSame('closed', $session->fresh()->status);
    }

    public function test_supervisor_can_manage_scoped_drafts_but_cannot_activate_cutover(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        [$supervisorUser, $supervisor] = $this->membershipFor($owner, TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($owner, $supervisor, $outlet);
        $this->saveDraft($supervisor, $outlet, $entries);
        $this->assertTrue(app(WeeklyPlannerService::class)->validate($supervisor, $outlet->id, '2026-11-09', 1)['valid']);
        try {
            $this->publishDraft($supervisor, $outlet);
            $this->fail('Supervisor cannot activate cutover.');
        } catch (AuthorizationException) {
            $this->assertNull($outlet->fresh()->weekly_planner_start_on);
        }
        $this->publishDraft($supervisor, $outlet, activate: false);
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        Auth::forgetGuards();
        $this->actingAs($supervisorUser)->withSession(['active_membership_id' => $supervisor->id]);
        // ponytail: MySQL assigns audit timestamps independently of the frozen application clock.
        $auditDate = substr(DB::table('scheduling_change_events')->where('action', 'published')->value('created_at'), 0, 10);
        $audit = $this->getJson('/api/v1/management/reports/audit?from='.$auditDate.'&to='.$auditDate.'&source=schedule_change')->assertOk();
        $published = collect($audit->json('data'))->firstWhere('action', 'schedule.published');
        $this->assertNotNull($published);
        $this->assertSame($outlet->id, $published['outlet_id']);
        [, $other] = $this->unitWithOutlet($owner, 'Other unit', 'Other outlet');
        $this->expectException(HttpException::class);
        app(WeeklyPlannerService::class)->read($supervisor, $other->id, '2026-11-09');
    }

    public function test_published_interval_blocks_later_legacy_write_in_another_outlet(): void
    {
        [, $owner, $outlet, $employee] = $this->setupRoster();
        [, $other] = $this->unitWithOutlet($owner, 'Other unit', 'Other outlet');
        $this->insertLegacyTemporaryOutletAssignment($owner, $employee, $other, now(), now()->addMonth());
        $night = app(ShiftTemplateService::class)->create($owner, 'Night', '20:00', '04:00', true, '2026-11-02', 'Night shift')->versions->first();
        $morning = app(ShiftTemplateService::class)->create($owner, 'Early', '03:30', '09:00', false, '2026-11-02', 'Early shift')->versions->first();
        $this->saveDraft($owner, $outlet, [['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $night->id]]);
        $this->publishDraft($owner, $outlet);
        $this->expectException(ValidationException::class);
        app(EmployeeScheduleService::class)->createException($owner, $employee->id, $other->id, '2026-11-10', 'work', $morning->id, 'Conflicting legacy');
    }

    public function test_legacy_interval_in_another_outlet_blocks_publication(): void
    {
        [, $owner, $outlet, $employee, $shift] = $this->setupRoster();
        [, $other] = $this->unitWithOutlet($owner, 'Other unit', 'Other outlet');
        $this->insertLegacyTemporaryOutletAssignment($owner, $employee, $other, now(), now()->addMonth());
        app(EmployeeScheduleService::class)->createException($owner, $employee->id, $other->id, '2026-11-10', 'work', $shift->id, 'Other outlet work');
        $this->saveDraft($owner, $outlet, [['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'work', 'shift_template_version_id' => $shift->id]]);
        $this->expectException(ValidationException::class);
        $this->publishDraft($owner, $outlet);
    }

    public function test_failure_after_pointer_switch_rolls_back_publication_and_cutover(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, $entries);
        $before = DB::table('scheduling_change_events')->count();
        $fail = true;
        DB::listen(function ($query) use (&$fail): void {
            if ($fail && str_starts_with($query->sql, 'insert into `scheduling_operations`')) {
                $fail = false;
                throw new \RuntimeException('Injected transaction failure');
            }
        });
        try {
            $this->publishDraft($owner, $outlet);
            $this->fail('Injected failure must roll back.');
        } catch (\RuntimeException $error) {
            $this->assertSame('Injected transaction failure', $error->getMessage());
            $this->assertNull($outlet->fresh()->weekly_planner_start_on);
            $this->assertNull(DB::table('schedule_weeks')->value('published_revision_id'));
            $this->assertNull(DB::table('schedule_revisions')->value('published_at'));
            $this->assertDatabaseCount('scheduling_change_events', $before);
            $this->assertDatabaseCount('scheduling_operations', 1);
        }
    }

    public function test_published_intervals_remain_frozen_after_calendar_revision(): void
    {
        [, $owner, $outlet, $employee, $shift] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, [['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $shift->id]]);
        $this->publishDraft($owner, $outlet);
        $resolver = app(EffectiveScheduleResolver::class);
        $before = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id);
        app(OutletCalendarService::class)->createVersion($owner, $outlet, '2026-11-09', 'Asia/Tokyo', [1, 2, 3, 4, 5, 6, 7], 'Calendar timezone revision');
        $after = $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-09', $outlet->id);
        $this->assertSame($before->scheduledStart, $after->scheduledStart);
        $this->assertSame($before->scheduledEnd, $after->scheduledEnd);
        $this->assertSame('Asia/Jakarta', $after->timezone);
    }

    public function test_monday_date_and_tenant_references_are_validated_without_writes(): void
    {
        [, $owner, $outlet, $employee, $shift, $entries] = $this->setupRoster();
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign roster');
        $foreignEmployee = app(OrganizationService::class)->registerEmployee($foreignOwner, 'Foreign employee');
        foreach ([
            [['employee_id' => $foreignEmployee->id, 'work_date' => '2026-11-09', 'status' => 'rest']],
            [['employee_id' => $employee->id, 'work_date' => '2026-11-16', 'status' => 'rest']],
            [$entries[0], $entries[0]],
            [$entries[0], array_replace($entries[0], ['employee_id' => '0'.$employee->id])],
        ] as $invalid) {
            try {
                $this->saveDraft($owner, $outlet, $invalid);
                $this->fail('Invalid draft must be rejected.');
            } catch (ValidationException) {
                $this->assertDatabaseCount('schedule_weeks', 0);
                $this->assertDatabaseCount('scheduling_operations', 0);
            }
        }
        $this->expectException(ValidationException::class);
        app(WeeklyPlannerService::class)->read($owner, $outlet->id, '2026-11-10');
    }

    public function test_cutover_preserves_sunday_legacy_and_rejects_unbounded_weekly_writes(): void
    {
        [, $owner, $outlet, $employee, $shift, $entries] = $this->setupRoster();
        app(EmployeeScheduleService::class)->createWeeklyRule($owner, $employee->id, $outlet->id, 7, $shift->id, '2026-11-02', null, 'Legacy Sunday');
        $entries[] = ['employee_id' => $employee->id, 'work_date' => '2026-11-15', 'status' => 'work', 'shift_template_version_id' => $shift->id];
        $this->saveDraft($owner, $outlet, $entries);
        $this->publishDraft($owner, $outlet);
        $resolver = app(EffectiveScheduleResolver::class);
        $this->assertSame('weekly_rule', $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-08', $outlet->id)->provenance['source']);
        $this->assertSame('published_roster', $resolver->resolve($owner->tenant_id, $employee->id, '2026-11-15', $outlet->id)->provenance['source']);
        $this->expectException(HttpException::class);
        app(EmployeeScheduleService::class)->createWeeklyRule($owner, $employee->id, $outlet->id, 2, $shift->id, '2026-11-03', null, 'Unsafe recurring rule');
    }

    public function test_assignment_required_for_rest_drafts_and_touching_published_intervals_are_allowed(): void
    {
        [, $owner, $outlet, $employee] = $this->setupRoster();
        $outsider = app(OrganizationService::class)->registerEmployee($owner, 'Unassigned employee');
        try {
            $this->saveDraft($owner, $outlet, [['employee_id' => $outsider->id, 'work_date' => '2026-11-09', 'status' => 'rest']]);
            $this->fail('Unassigned Employee must be rejected.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('schedule_weeks', 0);
        }
        $night = app(ShiftTemplateService::class)->create($owner, 'Night', '20:00', '04:00', true, '2026-11-02', 'Night shift')->versions->first();
        $morning = app(ShiftTemplateService::class)->create($owner, 'Morning boundary', '04:00', '09:00', false, '2026-11-02', 'Touching shift')->versions->first();
        $this->saveDraft($owner, $outlet, [
            ['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $night->id],
            ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'work', 'shift_template_version_id' => $morning->id],
        ]);
        $this->publishDraft($owner, $outlet);
        $this->assertNotNull(DB::table('schedule_weeks')->value('published_revision_id'));
    }

    public function test_staffing_counts_weekdays_weekends_and_requires_exact_warning_acknowledgement(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, $entries);
        $service = app(WeeklyPlannerService::class);
        $report = $service->validate($owner, $outlet->id, '2026-11-09', 1)['staffing_report'];
        $this->assertCount(7, $report['days']);
        $this->assertSame(['morning' => 1, 'middle' => 1, 'evening' => 1], $report['days'][0]['targets']);
        $this->assertSame(['morning' => 2, 'evening' => 2], $report['days'][5]['targets']);
        $this->assertCount(19, $report['deficits']);
        $this->assertSame(23, array_sum(array_column($report['deficits'], 'missing')));
        foreach ([null, str_repeat('0', 64)] as $checksum) {
            try {
                $service->publish($owner, $outlet->id, '2026-11-09', ['expected_version' => 1, 'expected_published_revision_id' => null, 'reason' => 'Missing warning acknowledgement', 'warnings_checksum' => $checksum], 'bad-ack');
                $this->fail('Warning acknowledgement must match.');
            } catch (HttpException $error) {
                $this->assertSame(409, $error->getStatusCode());
                $this->assertNull(DB::table('schedule_weeks')->value('published_revision_id'));
            }
        }
        $published = $this->publishDraft($owner, $outlet, activate: false);
        $this->assertCount(19, $published['published']['publication_warnings']);
    }

    public function test_new_publications_require_staffing_and_it_cannot_be_removed(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $service = app(WeeklyPlannerService::class);
        $service->save($owner, $outlet->id, '2026-11-09', ['expected_version' => 0, 'reason' => 'Incomplete draft', 'entries' => $entries], 'incomplete');
        try {
            $service->validate($owner, $outlet->id, '2026-11-09', 1);
            $this->fail('Unconfigured draft cannot be published.');
        } catch (ValidationException $error) {
            $this->assertArrayHasKey('staffing', $error->errors());
        }
        $this->saveDraft($owner, $outlet, $entries, 1, 'configure');
        $service->save($owner, $outlet->id, '2026-11-09', ['expected_version' => 2, 'reason' => 'Keep staffing', 'entries' => $entries], 'inherit-staffing');
        $this->assertNotNull($service->read($owner, $outlet->id, '2026-11-09')['draft']['staffing']);
        $this->expectException(ValidationException::class);
        $service->save($owner, $outlet->id, '2026-11-09', ['expected_version' => 3, 'reason' => 'Remove staffing', 'entries' => $entries, 'staffing' => null], 'remove-staffing');
    }

    public function test_weekend_middle_shift_is_invalid_even_with_warning_acknowledgement(): void
    {
        [, $owner, $outlet, $employee] = $this->setupRoster();
        $configuration = $this->staffingConfiguration($owner);
        $this->saveDraft($owner, $outlet, [['employee_id' => $employee->id, 'work_date' => '2026-11-14', 'status' => 'work', 'shift_template_version_id' => $configuration['middle']]]);
        $this->expectException(ValidationException::class);
        $this->publishDraft($owner, $outlet, activate: false);
    }

    public function test_old_warning_checksum_is_rejected_after_draft_changes(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, $entries);
        $checksum = app(WeeklyPlannerService::class)->validate($owner, $outlet->id, '2026-11-09', 1)['staffing_report']['checksum'];
        $this->saveDraft($owner, $outlet, [], 1, 'changed-draft');
        $this->expectException(HttpException::class);
        app(WeeklyPlannerService::class)->publish($owner, $outlet->id, '2026-11-09', ['expected_version' => 2, 'expected_published_revision_id' => null, 'reason' => 'Old warning list', 'warnings_checksum' => $checksum], 'stale-warning');
    }

    public function test_copy_published_week_creates_only_a_draft_and_preserves_source(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, activate: false);
        $service = app(WeeklyPlannerService::class);
        $before = app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $employee->id, '2026-11-16', $outlet->id)->toArray();
        $payload = ['expected_version' => 0, 'source_week_start' => '2026-11-09', 'source_revision_id' => $published['published']['revision_id'], 'reason' => 'Copy published week'];
        $copy = $service->copy($owner, $outlet->id, '2026-11-16', $payload, 'copy-week');
        $this->assertEquals($copy, $service->copy($owner, $outlet->id, '2026-11-16', $payload, 'copy-week'));
        $this->assertSame('2026-11-16', $copy['draft']['entries'][0]['work_date']);
        $this->assertNull($copy['published']);
        $this->assertSame($before, app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $employee->id, '2026-11-16', $outlet->id)->toArray());
        $this->assertSame($published['published']['revision_id'], $service->read($owner, $outlet->id, '2026-11-09')['published']['revision_id']);
        $this->assertDatabaseCount('schedule_revisions', 2);
        $this->assertSame(1, DB::table('scheduling_change_events')->where('action', 'draft_copied')->count());
        try {
            $service->copy($owner, $outlet->id, '2026-11-23', array_replace($payload, ['source_revision_id' => 999999]), 'stale-copy');
            $this->fail('Stale copy source must be rejected.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
            $this->assertDatabaseCount('schedule_weeks', 2);
        }
    }

    public function test_complete_staffing_can_publish_without_understaffing_acknowledgement(): void
    {
        [, $owner, $outlet, $employee] = $this->setupRoster();
        $employees = [$employee];
        for ($index = 1; $index <= 3; $index++) {
            $person = app(OrganizationService::class)->registerEmployee($owner, 'Staffing QA '.$index);
            app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $person, $outlet, now()->subDay());
            $employees[] = $person;
        }
        $configuration = $this->staffingConfiguration($owner);
        $entries = [];
        for ($day = 0; $day < 7; $day++) {
            $roles = $day < 5 ? ['morning', 'middle', 'evening'] : ['morning', 'morning', 'evening', 'evening'];
            foreach ($roles as $index => $role) {
                $entries[] = ['employee_id' => $employees[$index]->id, 'work_date' => CarbonImmutable::parse('2026-11-09')->addDays($day)->toDateString(), 'status' => 'work', 'shift_template_version_id' => $configuration[$role]];
            }
        }
        $this->saveDraft($owner, $outlet, $entries);
        $service = app(WeeklyPlannerService::class);
        $this->assertSame([], $service->validate($owner, $outlet->id, '2026-11-09', 1)['staffing_report']['deficits']);
        $published = $service->publish($owner, $outlet->id, '2026-11-09', ['expected_version' => 1, 'expected_published_revision_id' => null, 'reason' => 'Complete staffing'], 'complete-week');
        $this->assertCount(23, $published['published']['entries']);
        $this->assertSame([], $published['published']['publication_warnings']);
    }

    public function test_direct_save_preview_is_read_only_and_save_is_idempotent(): void
    {
        [$user, $owner, $outlet, $employee, $shift, $entries] = $this->setupRoster();
        $draft = $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, $draft['version']);
        [, $employeeMembership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $employeeMembership, $employee);
        $url = '/api/v1/management/scheduling/planner/outlets/'.$outlet->id.'/weeks/2026-11-09';
        $candidate = [
            ['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $shift->id],
            ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'rest'],
        ];
        $input = $this->directChangePayload($published, $candidate);
        $counts = [
            'schedule_revisions' => DB::table('schedule_revisions')->count(),
            'schedule_entries' => DB::table('schedule_entries')->count(),
            'scheduling_change_events' => DB::table('scheduling_change_events')->count(),
            'planner_notifications' => DB::table('planner_notifications')->count(),
            'scheduling_operations' => DB::table('scheduling_operations')->count(),
        ];
        $previousEntries = DB::table('schedule_entries')->where('revision_id', $published['published']['revision_id'])->get()->toJson();
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $this->actingAs($user)->withSession(['active_membership_id' => $owner->id]);

        $preview = $this->postJson($url.'/validate', $input)->assertOk()
            ->assertJsonPath('valid', true)
            ->assertJsonPath('version', $published['version'])
            ->assertJsonPath('entry_count', 2);
        $checksum = $preview->json('staffing_report.checksum');
        $this->assertIsString($checksum);
        $changedCandidate = [...$candidate, ['employee_id' => $employee->id, 'work_date' => '2026-11-11', 'status' => 'rest']];
        $changedPreview = $this->postJson($url.'/validate', [...$input, 'entries' => $changedCandidate])->assertOk();
        $this->assertNotSame($checksum, $changedPreview->json('staffing_report.checksum'));
        $this->assertSame($counts, [
            'schedule_revisions' => DB::table('schedule_revisions')->count(),
            'schedule_entries' => DB::table('schedule_entries')->count(),
            'scheduling_change_events' => DB::table('scheduling_change_events')->count(),
            'planner_notifications' => DB::table('planner_notifications')->count(),
            'scheduling_operations' => DB::table('scheduling_operations')->count(),
        ]);
        $this->assertSame($previousEntries, DB::table('schedule_entries')->where('revision_id', $published['published']['revision_id'])->get()->toJson());

        $request = $input + ['reason' => 'Adjust published roster', 'warnings_checksum' => $checksum];
        $this->withHeader('Idempotency-Key', 'direct-save-stale-warning')
            ->postJson($url.'/save-changes', [...$request, 'warnings_checksum' => str_repeat('0', 64)])->assertConflict();
        $this->assertSame($counts, [
            'schedule_revisions' => DB::table('schedule_revisions')->count(),
            'schedule_entries' => DB::table('schedule_entries')->count(),
            'scheduling_change_events' => DB::table('scheduling_change_events')->count(),
            'planner_notifications' => DB::table('planner_notifications')->count(),
            'scheduling_operations' => DB::table('scheduling_operations')->count(),
        ]);
        $saved = $this->withHeader('Idempotency-Key', 'direct-save-success')->postJson($url.'/save-changes', $request)->assertOk();
        $revisionId = $saved->json('published.revision_id');
        $this->assertNotSame($published['published']['revision_id'], $revisionId);
        $this->assertSame($published['version'] + 1, $saved->json('version'));
        $this->assertDatabaseHas('schedule_weeks', [
            'id' => $published['week_id'],
            'published_revision_id' => $revisionId,
            'draft_revision_id' => null,
            'lock_version' => $published['version'] + 1,
        ]);
        $this->assertDatabaseHas('schedule_revisions', [
            'id' => $revisionId,
            'base_published_revision_id' => $published['published']['revision_id'],
            'actor_membership_id' => $owner->id,
        ]);
        $this->assertSame($previousEntries, DB::table('schedule_entries')->where('revision_id', $published['published']['revision_id'])->get()->toJson());
        $this->assertDatabaseHas('scheduling_change_events', [
            'resource_id' => $published['week_id'],
            'action' => 'changes_saved',
            'reason' => 'Adjust published roster',
        ]);
        $this->assertDatabaseHas('planner_notifications', [
            'membership_id' => $employeeMembership->id,
            'event_key' => 'published:'.$revisionId,
            'kind' => 'assignment_changed',
        ]);

        $replay = $this->withHeader('Idempotency-Key', 'direct-save-success')->postJson($url.'/save-changes', $request)->assertOk();
        $this->assertSame($saved->json(), $replay->json());
        $this->assertSame($counts['schedule_revisions'] + 1, DB::table('schedule_revisions')->count());
        $this->assertSame($counts['scheduling_operations'] + 1, DB::table('scheduling_operations')->count());
        $this->withHeader('Idempotency-Key', 'direct-save-success')
            ->postJson($url.'/save-changes', [...$request, 'reason' => 'Different reason'])->assertConflict();
        $this->assertSame($counts['schedule_revisions'] + 1, DB::table('schedule_revisions')->count());
        $this->assertSame($counts['scheduling_operations'] + 1, DB::table('scheduling_operations')->count());
    }

    public function test_direct_save_rejects_overlap_stale_base_and_unresolved_draft_without_writes(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $draft = $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, $draft['version']);
        $night = app(ShiftTemplateService::class)->create($owner, 'Direct night', '20:00', '04:00', true, '2026-11-02', 'Fixture shift')->versions->first();
        $early = app(ShiftTemplateService::class)->create($owner, 'Direct early', '03:30', '09:00', false, '2026-11-02', 'Fixture shift')->versions->first();
        $service = app(WeeklyPlannerService::class);
        $revisionCount = DB::table('schedule_revisions')->count();
        $operationCount = DB::table('scheduling_operations')->count();
        $week = DB::table('schedule_weeks')->where('id', $published['week_id'])->first();

        try {
            $service->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$this->directChangePayload($published, [
                    ['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'work', 'shift_template_version_id' => $night->id],
                    ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'work', 'shift_template_version_id' => $early->id],
                ]),
                'reason' => 'Overlapping direct edit',
            ], 'direct-overlap');
            $this->fail('Overlapping candidate must be rejected.');
        } catch (ValidationException $error) {
            $this->assertArrayHasKey('entries', $error->errors());
        }

        try {
            $service->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$this->directChangePayload(array_replace($published, ['version' => $published['version'] - 1]), $entries),
                'reason' => 'Stale direct edit',
            ], 'direct-stale');
            $this->fail('Stale version must be rejected.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
        }

        $staleBase = $this->directChangePayload($published, $entries);
        $staleBase['expected_published_revision_id']++;
        try {
            $service->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$staleBase,
                'reason' => 'Stale published base',
            ], 'direct-stale-base');
            $this->fail('Stale published revision must be rejected.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
        }

        $pendingDraft = $this->saveDraft($owner, $outlet, $entries, $published['version'], 'direct-unresolved-draft');
        try {
            $service->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$this->directChangePayload(array_replace($published, ['version' => $pendingDraft['version']]), $entries),
                'reason' => 'Unresolved draft edit',
            ], 'direct-with-unresolved-draft');
            $this->fail('An unresolved draft must block direct save.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
        }

        $this->assertSame($revisionCount + 1, DB::table('schedule_revisions')->count());
        $this->assertSame($operationCount + 1, DB::table('scheduling_operations')->count());
        $week = DB::table('schedule_weeks')->where('id', $published['week_id'])->first();
        $this->assertSame($published['published']['revision_id'], $week->published_revision_id);
        $this->assertSame($pendingDraft['draft']['revision_id'], $week->draft_revision_id);
        $this->assertSame($pendingDraft['version'], $week->lock_version);
    }

    public function test_direct_save_rolls_back_revision_pointer_audit_notification_and_idempotency_on_failure(): void
    {
        [, $owner, $outlet, $employee, , $entries] = $this->setupRoster();
        $draft = $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, $draft['version']);
        $candidate = [...$entries, ['employee_id' => $employee->id, 'work_date' => '2026-11-10', 'status' => 'rest']];
        $preview = app(WeeklyPlannerService::class)->validateCandidate(
            $owner,
            $outlet->id,
            '2026-11-09',
            $this->directChangePayload($published, $candidate),
        );
        $counts = [
            'revisions' => DB::table('schedule_revisions')->count(),
            'entries' => DB::table('schedule_entries')->count(),
            'events' => DB::table('scheduling_change_events')->count(),
            'notifications' => DB::table('planner_notifications')->count(),
            'operations' => DB::table('scheduling_operations')->count(),
        ];
        $fail = true;
        DB::listen(function ($query) use (&$fail): void {
            if ($fail && str_starts_with($query->sql, 'insert into `scheduling_operations`')) {
                $fail = false;
                throw new \RuntimeException('Injected direct-save transaction failure');
            }
        });

        try {
            app(WeeklyPlannerService::class)->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$this->directChangePayload($published, $candidate),
                'reason' => 'Rollback direct edit',
                'warnings_checksum' => $preview['staffing_report']['checksum'],
            ], 'direct-save-rollback');
            $this->fail('Injected failure must roll back direct save.');
        } catch (\RuntimeException $error) {
            $this->assertSame('Injected direct-save transaction failure', $error->getMessage());
        }

        $week = DB::table('schedule_weeks')->where('id', $published['week_id'])->first();
        $this->assertSame($published['published']['revision_id'], $week->published_revision_id);
        $this->assertSame($published['version'], $week->lock_version);
        $this->assertSame($counts, [
            'revisions' => DB::table('schedule_revisions')->count(),
            'entries' => DB::table('schedule_entries')->count(),
            'events' => DB::table('scheduling_change_events')->count(),
            'notifications' => DB::table('planner_notifications')->count(),
            'operations' => DB::table('scheduling_operations')->count(),
        ]);
    }

    public function test_direct_preview_and_save_keep_foreign_tenant_outlets_inaccessible(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        $draft = $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, $draft['version']);
        [$foreignUser, , $foreignOwner] = $this->tenantWithOwner('Foreign direct editor');
        $url = '/api/v1/management/scheduling/planner/outlets/'.$outlet->id.'/weeks/2026-11-09';
        $input = $this->directChangePayload($published, $entries);
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $this->actingAs($foreignUser)->withSession(['active_membership_id' => $foreignOwner->id]);
        $this->postJson($url.'/validate', $input)->assertNotFound();
        $this->withHeader('Idempotency-Key', 'foreign-direct-save')
            ->postJson($url.'/save-changes', $input + ['reason' => 'Foreign edit'])->assertNotFound();
        $this->assertSame($published['published']['revision_id'], DB::table('schedule_weeks')->where('id', $published['week_id'])->value('published_revision_id'));
    }

    public function test_direct_save_rejects_active_sessions_and_started_or_historical_entries(): void
    {
        [, $owner, $outlet, $employee, $shift, $entries] = $this->setupRoster();
        $draft = $this->saveDraft($owner, $outlet, $entries);
        $published = $this->publishDraft($owner, $outlet, $draft['version']);
        $this->travelTo(CarbonImmutable::parse('2026-11-09T07:00:00+07:00'));
        $sessionId = DB::table('attendance_sessions')->insertGetId([
            'tenant_id' => $owner->tenant_id,
            'employee_id' => $employee->id,
            'outlet_id' => $outlet->id,
            'work_date' => '2026-11-09',
            'status' => 'active',
            'check_in_at' => '2026-11-08 23:30:00',
            'check_out_at' => null,
            'schedule_snapshot' => '{}',
            'policy_snapshot' => '{}',
            'assignment_snapshot' => '{}',
            'review_indicators' => '[]',
            'created_at' => now('UTC'),
            'updated_at' => now('UTC'),
        ]);
        DB::table('attendance_active_session_owners')->insert([
            'tenant_id' => $owner->tenant_id,
            'employee_id' => $employee->id,
            'attendance_session_id' => $sessionId,
            'created_at' => now('UTC'),
        ]);
        $candidate = [[
            'employee_id' => $employee->id,
            'work_date' => '2026-11-09',
            'status' => 'work',
            'shift_template_version_id' => $shift->id,
        ]];

        try {
            app(WeeklyPlannerService::class)->saveChanges($owner, $outlet->id, '2026-11-09', [
                ...$this->directChangePayload($published, $candidate),
                'reason' => 'Active session edit',
            ], 'direct-active-session');
            $this->fail('Active session must block an unsafe roster change.');
        } catch (HttpException $error) {
            $this->assertSame(409, $error->getStatusCode());
        }

        DB::table('attendance_active_session_owners')->where('attendance_session_id', $sessionId)->delete();
        DB::table('attendance_sessions')->where('id', $sessionId)->delete();
        $scheduledEntries = [[
            'employee_id' => $employee->id,
            'work_date' => '2026-11-09',
            'status' => 'work',
            'shift_template_version_id' => $shift->id,
        ]];
        $nextDraft = $this->saveDraft($owner, $outlet, $scheduledEntries, $published['version'], 'started-base-draft');
        $startedBase = $this->publishDraft($owner, $outlet, $nextDraft['version'], $published['published']['revision_id'], false, 'started-base-publish');
        $this->travelTo(CarbonImmutable::parse('2026-11-09T08:00:00+07:00'));

        foreach ([
            [['employee_id' => $employee->id, 'work_date' => '2026-11-09', 'status' => 'rest']],
            [],
        ] as $changedEntries) {
            try {
                app(WeeklyPlannerService::class)->saveChanges($owner, $outlet->id, '2026-11-09', [
                    ...$this->directChangePayload($startedBase, $changedEntries),
                    'reason' => 'Started schedule edit',
                ], 'direct-started-'.count($changedEntries));
                $this->fail('Started or historical entries must not be changed or removed.');
            } catch (HttpException $error) {
                $this->assertSame(409, $error->getStatusCode());
            }
        }

        $this->assertSame($startedBase['published']['revision_id'], DB::table('schedule_weeks')->where('id', $published['week_id'])->value('published_revision_id'));
    }

    public function test_staffing_mapping_cannot_reference_another_tenants_shift(): void
    {
        [, $owner, $outlet, , , $entries] = $this->setupRoster();
        [, , $foreignOwner] = $this->tenantWithOwner('Foreign staffing tenant');
        $foreignShift = app(ShiftTemplateService::class)->create($foreignOwner, 'Foreign morning', '08:00', '16:00', false, '2026-11-02', 'Foreign fixture')->versions->first();
        $configuration = $this->staffingConfiguration($owner);
        $configuration['morning'] = $foreignShift->id;
        try {
            app(WeeklyPlannerService::class)->save($owner, $outlet->id, '2026-11-09', ['expected_version' => 0, 'entries' => $entries, 'staffing' => $configuration, 'reason' => 'Foreign mapping attempt'], 'foreign-mapping');
            $this->fail('Cross-tenant shift mapping must fail.');
        } catch (ValidationException $error) {
            $this->assertArrayHasKey('staffing.morning', $error->errors());
            $this->assertDatabaseCount('schedule_weeks', 0);
        }
    }
}
