<?php

namespace Tests\Feature\S3;

use App\Enums\TenantRole;
use App\Services\EffectiveScheduleResolver;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\ShiftChangeService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use App\Services\WeeklyPlannerService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsShiftChangeFixtures;
use Tests\TestCase;

class ShiftChangeTest extends TestCase
{
    use BuildsShiftChangeFixtures, RefreshDatabase;

    private function request(array $f, string $kind = 'swap', string $key = 'request'): array
    {
        $data = ['kind' => $kind, 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][$kind === 'swap' ? 1 : 2]->id, 'reason' => 'Family reason'];
        if ($kind === 'swap') {
            $data['target_entry_id'] = $f['rows'][1]->id;
        }

        return app(ShiftChangeService::class)->create($f['members'][0], $data, $key);
    }

    private function failsWith(int $status, callable $action): void
    {
        try {
            $action();
            $this->fail('Expected rejection');
        } catch (HttpException $error) {
            $this->assertSame($status, $error->getStatusCode());
        }
    }

    public function test_swap_is_atomic_immutable_audited_and_acceptance_replay_is_safe(): void
    {
        $f = $this->shiftFixture();
        $before = DB::table('schedule_entries')->get()->toJson();
        $request = $this->request($f);
        $this->assertSame($request, $this->request($f));
        $service = app(ShiftChangeService::class);
        $result = $service->respond($f['members'][1], $request['id'], 'accept');
        $this->assertSame('accepted', $result['status']);
        $this->assertSame($result, $service->respond($f['members'][1], $request['id'], 'accept'));
        $this->assertSame($before, DB::table('schedule_entries')->whereIn('id', $f['rows']->pluck('id'))->get()->toJson());
        $this->assertDatabaseCount('schedule_revisions', 2);
        $this->assertSame(1, DB::table('scheduling_change_events')->where('resource_type', 'shift_change_request')->where('action', 'accepted')->count());
        $resolver = app(EffectiveScheduleResolver::class);
        $this->assertSame($f['staffing']['evening'], $resolver->resolve($f['owner']->tenant_id, $f['people'][0]->id, $f['date'], $f['outlet']->id)->shift['version_id']);
        $this->assertSame($f['staffing']['morning'], $resolver->resolve($f['owner']->tenant_id, $f['people'][1]->id, $f['date'], $f['outlet']->id)->shift['version_id']);
    }

    public function test_replacement_marks_requester_rest(): void
    {
        $f = $this->shiftFixture();
        $request = $this->request($f, 'replacement');
        $result = app(ShiftChangeService::class)->respond($f['members'][2], $request['id'], 'accept');
        $this->assertSame('accepted', $result['status']);
        $resolver = app(EffectiveScheduleResolver::class);
        $this->assertSame('rest', $resolver->resolve($f['owner']->tenant_id, $f['people'][0]->id, $f['date'], $f['outlet']->id)->status);
        $this->assertSame('scheduled', $resolver->resolve($f['owner']->tenant_id, $f['people'][2]->id, $f['date'], $f['outlet']->id)->status);
    }

    public function test_existing_supervisor_draft_is_preserved_without_becoming_unpublishable(): void
    {
        $f = $this->shiftFixture();
        app(WeeklyPlannerService::class)->save($f['owner'], $f['outlet']->id, $f['date'], ['expected_version' => 2, 'entries' => $f['entries'], 'staffing' => $f['staffing'], 'reason' => 'Existing Supervisor draft'], 'existingdraft');
        $before = DB::table('schedule_weeks')->first();
        $entries = DB::table('schedule_entries')->get()->toJson();
        $request = $this->request($f, 'replacement');
        $this->failsWith(409, fn () => app(ShiftChangeService::class)->respond($f['members'][2], $request['id'], 'accept'));
        $this->assertEquals($before, DB::table('schedule_weeks')->first());
        $this->assertSame($entries, DB::table('schedule_entries')->get()->toJson());
        $this->assertTrue(app(WeeklyPlannerService::class)->validate($f['owner'], $f['outlet']->id, $f['date'], 3)['valid']);
    }

    public function test_rejection_cancellation_and_expiry_never_publish(): void
    {
        $f = $this->shiftFixture();
        $service = app(ShiftChangeService::class);
        $r = $this->request($f);
        $this->assertSame('rejected', $service->respond($f['members'][1], $r['id'], 'reject')['status']);
        $this->failsWith(409, fn () => $service->respond($f['members'][1], $r['id'], 'accept'));
        $r = $this->request($f, key: 'cancel');
        $this->assertSame('cancelled', $service->respond($f['members'][0], $r['id'], 'cancel')['status']);
        $r = $this->request($f, key: 'expire');
        $this->travelTo(CarbonImmutable::parse($r['expires_at']));
        $this->assertSame('expired', $service->respond($f['members'][1], $r['id'], 'accept')['status']);
        $this->assertDatabaseHas('shift_change_requests', ['id' => $r['id'], 'status' => 'expired']);
        $this->assertDatabaseCount('schedule_revisions', 1);
    }

    public function test_only_participants_have_access_and_foreign_tenant_is_not_found(): void
    {
        $f = $this->shiftFixture();
        $r = $this->request($f);
        $s = app(ShiftChangeService::class);
        $this->failsWith(403, fn () => $s->respond($f['members'][0], $r['id'], 'accept'));
        $this->failsWith(403, fn () => $s->respond($f['members'][2], $r['id'], 'reject'));
        $this->failsWith(403, fn () => $s->respond($f['owner'], $r['id'], 'accept'));
        $this->assertEmpty($s->listing($f['members'][2])['requests']);
        [, , $other] = $this->tenantWithOwner('Foreign');
        [$u, $member] = $this->membershipFor($other, TenantRole::Employee);
        $person = app(OrganizationService::class)->registerEmployee($other, 'Foreign QA');
        app(TenantMembershipService::class)->linkEmployee($other, $member, $person);
        $this->failsWith(404, fn () => $s->respond($member, $r['id'], 'accept'));
    }

    public function test_stale_draft_version_blocks_acceptance_without_new_revision(): void
    {
        $f = $this->shiftFixture();
        $r = $this->request($f);
        app(WeeklyPlannerService::class)->save($f['owner'], $f['outlet']->id, $f['date'], ['expected_version' => 2, 'entries' => $f['entries'], 'staffing' => $f['staffing'], 'reason' => 'Supervisor draft'], 'newdraft');
        $this->failsWith(409, fn () => app(ShiftChangeService::class)->respond($f['members'][1], $r['id'], 'accept'));
        $this->assertDatabaseCount('schedule_revisions', 2);
        $this->assertDatabaseHas('shift_change_requests', ['id' => $r['id'], 'status' => 'pending']);
    }

    public function test_blank_reason_and_create_replay_payload_mismatch_rejected(): void
    {
        $f = $this->shiftFixture();
        $this->request($f);
        $this->failsWith(409, fn () => $this->request($f, 'replacement'));
        $this->expectException(ValidationException::class);
        app(ShiftChangeService::class)->create($f['members'][0], ['kind' => 'replacement', 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][2]->id, 'reason' => '   '], 'blank');
    }

    public function test_inactive_recipient_and_removed_assignment_are_revalidated(): void
    {
        $f = $this->shiftFixture();
        $r = $this->request($f);
        DB::table('employee_outlet_assignments')->where('employee_id', $f['people'][1]->id)->update(['effective_until' => now()->addHour()]);
        $this->failsWith(422, fn () => app(ShiftChangeService::class)->respond($f['members'][1], $r['id'], 'accept'));
        $f['members'][1]->update(['is_active' => false]);
        $this->failsWith(403, fn () => app(ShiftChangeService::class)->respond($f['members'][1], $r['id'], 'accept'));
    }

    public function test_api_requires_session_and_recipient_acceptance(): void
    {
        $f = $this->shiftFixture();
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $url = '/api/v1/management/scheduling/me/changes';
        $this->getJson($url)->assertUnauthorized();
        $this->actingAs($f['users'][0])->withSession(['active_membership_id' => $f['members'][0]->id]);
        $response = $this->withHeader('Idempotency-Key', 'api')->postJson($url, ['kind' => 'replacement', 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][2]->id, 'reason' => 'QA API'])->assertOk()->assertJsonPath('status', 'pending');
        $id = $response->json('id');
        $this->postJson($url.'/'.$id.'/respond', ['action' => 'accept'])->assertForbidden();
        Auth::forgetGuards();
        $this->actingAs($f['users'][2])->withSession(['active_membership_id' => $f['members'][2]->id]);
        $this->postJson($url.'/'.$id.'/respond', ['action' => 'accept'])->assertOk()->assertJsonPath('status', 'accepted');
    }

    public function test_swap_across_weeks_preserves_both_published_revisions(): void
    {
        $f = $this->shiftFixture();
        $next = CarbonImmutable::parse($f['date'])->addWeek()->toDateString();
        $entries = [['employee_id' => $f['people'][1]->id, 'work_date' => $next, 'status' => 'work', 'shift_template_version_id' => $f['staffing']['evening']]];
        $this->publishFixture($f['owner'], $f['outlet'], $next, $entries, $f['staffing']);
        $target = DB::table('schedule_entries')->where('work_date', $next)->value('id');
        // Remove B's same-date shift first; cross-date swaps must not overwrite a third assignment.
        $this->publishFixture($f['owner'], $f['outlet'], $f['date'], [$f['entries'][0]], $f['staffing']);
        $source = DB::table('schedule_weeks')->where('week_start', $f['date'])->value('published_revision_id');
        $entry = DB::table('schedule_entries')->where('revision_id', $source)->value('id');
        $r = app(ShiftChangeService::class)->create($f['members'][0], ['kind' => 'swap', 'source_entry_id' => $entry, 'target_entry_id' => $target, 'recipient_id' => $f['people'][1]->id, 'reason' => 'Cross week QA'], 'cross-week');
        $result = app(ShiftChangeService::class)->respond($f['members'][1], $r['id'], 'accept');
        $this->assertCount(2, $result['result']);
        $resolver = app(EffectiveScheduleResolver::class);
        $this->assertSame('scheduled', $resolver->resolve($f['owner']->tenant_id, $f['people'][0]->id, $next, $f['outlet']->id)->status);
        $this->assertSame('rest', $resolver->resolve($f['owner']->tenant_id, $f['people'][0]->id, $f['date'], $f['outlet']->id)->status);
    }

    public function test_cross_outlet_target_is_rejected(): void
    {
        $f = $this->shiftFixture();
        [, $other] = $this->unitWithOutlet($f['owner']);
        $this->insertLegacyTemporaryOutletAssignment(
            $f['owner'],
            $f['people'][2],
            $other,
            now()->subHour(),
            CarbonImmutable::parse($f['date'])->addWeek(),
        );
        $entries = [['employee_id' => $f['people'][2]->id, 'work_date' => $f['date'], 'status' => 'work', 'shift_template_version_id' => $f['staffing']['evening']]];
        $this->publishFixture($f['owner'], $other, $f['date'], $entries, $f['staffing'], true);
        $target = DB::table('schedule_entries')->where('employee_id', $f['people'][2]->id)->value('id');
        $this->failsWith(422, fn () => app(ShiftChangeService::class)->create($f['members'][0], ['kind' => 'swap', 'source_entry_id' => $f['rows'][0]->id, 'target_entry_id' => $target, 'recipient_id' => $f['people'][2]->id, 'reason' => 'Invalid outlet'], 'cross-outlet'));
    }

    public function test_midnight_overlap_rolls_back_but_half_open_boundary_succeeds(): void
    {
        $f = $this->shiftFixture();
        $night = app(ShiftTemplateService::class)->create($f['owner'], 'Night QA', '20:00', '04:00', true, $f['date'], 'Night fixture')->versions->first();
        $early = app(ShiftTemplateService::class)->create($f['owner'], 'Early QA', '03:30', '10:00', false, $f['date'], 'Early fixture')->versions->first();
        $next = CarbonImmutable::parse($f['date'])->addDay()->toDateString();
        $entries = [
            ['employee_id' => $f['people'][0]->id, 'work_date' => $f['date'], 'status' => 'work', 'shift_template_version_id' => $night->id],
            ['employee_id' => $f['people'][2]->id, 'work_date' => $next, 'status' => 'work', 'shift_template_version_id' => $early->id],
        ];
        $this->publishFixture($f['owner'], $f['outlet'], $f['date'], $entries, $f['staffing']);
        $revision = DB::table('schedule_weeks')->value('published_revision_id');
        $f['rows'] = DB::table('schedule_entries')->where('revision_id', $revision)->orderBy('id')->get();
        $r = $this->request($f, 'replacement');
        try {
            app(ShiftChangeService::class)->respond($f['members'][2], $r['id'], 'accept');
            $this->fail('Overnight conflict accepted');
        } catch (ValidationException) {
            $this->assertSame($revision, DB::table('schedule_weeks')->value('published_revision_id'));
            $this->assertDatabaseHas('shift_change_requests', ['id' => $r['id'], 'status' => 'pending']);
        }
        $boundary = app(ShiftTemplateService::class)->create($f['owner'], 'Boundary QA', '04:00', '10:00', false, $f['date'], 'Boundary fixture')->versions->first();
        $entries[1]['shift_template_version_id'] = $boundary->id;
        $this->publishFixture($f['owner'], $f['outlet'], $f['date'], $entries, $f['staffing']);
        $revision = DB::table('schedule_weeks')->value('published_revision_id');
        $f['rows'] = DB::table('schedule_entries')->where('revision_id', $revision)->orderBy('id')->get();
        $r = $this->request($f, 'replacement', 'boundary');
        $this->assertSame('accepted', app(ShiftChangeService::class)->respond($f['members'][2], $r['id'], 'accept')['status']);
    }

    public function test_existing_attendance_prevents_change_and_snapshot_remains_unchanged(): void
    {
        $f = $this->shiftFixture();
        $r = $this->request($f);
        $values = ['tenant_id' => $f['owner']->tenant_id, 'employee_id' => $f['people'][0]->id, 'outlet_id' => $f['outlet']->id, 'work_date' => $f['date'], 'status' => 'closed', 'check_in_at' => now()->subHour(), 'check_out_at' => now(), 'schedule_snapshot' => json_encode(['marker' => 'immutable QA']), 'policy_snapshot' => '{}', 'assignment_snapshot' => '{}', 'review_indicators' => '[]'];
        DB::table('attendance_sessions')->insert($values);
        $before = DB::table('attendance_sessions')->get()->toJson();
        $this->failsWith(409, fn () => app(ShiftChangeService::class)->respond($f['members'][1], $r['id'], 'accept'));
        $this->assertSame($before, DB::table('attendance_sessions')->get()->toJson());
        $this->assertDatabaseCount('schedule_revisions', 1);
    }

    public function test_options_only_expose_same_outlet_eligible_people_and_owned_published_source(): void
    {
        $f = $this->shiftFixture();
        $service = app(ShiftChangeService::class);
        $options = $service->options($f['members'][0], $f['rows'][0]->id);
        $this->assertEqualsCanonicalizing([$f['people'][1]->id, $f['people'][2]->id], array_column($options['recipients'], 'id'));
        $this->assertSame($f['rows'][1]->id, $options['recipients'][0]['shifts'][0]['entry_id']);
        $this->failsWith(403, fn () => $service->options($f['members'][2], $f['rows'][0]->id));
    }
}
