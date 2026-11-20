<?php

namespace Tests\Feature\S3;

use App\Enums\TenantRole;
use App\Models\EmployeeUserLink;
use App\Services\EmployeeScheduleService;
use App\Services\PlannerNotificationService;
use App\Services\ShiftChangeService;
use App\Services\TenantMembershipService;
use App\Services\WeeklyPlannerService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsShiftChangeFixtures;
use Tests\TestCase;

class PlannerNotificationTest extends TestCase
{
    use BuildsShiftChangeFixtures, RefreshDatabase;

    private function supervisor(array $f): array
    {
        [$user, $member] = $this->membershipFor($f['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($f['owner'], $member, $f['outlet']);
        [, $second] = $this->unitWithOutlet($f['owner'], 'Second QA unit', 'Second QA outlet');
        app(TenantMembershipService::class)->assignSupervisorOutletScope($f['owner'], $member, $second);

        return [$user, $member, $second];
    }

    public function test_published_outbox_dispatch_retries_and_read_state_are_idempotent(): void
    {
        $f = $this->shiftFixture();
        $s = app(PlannerNotificationService::class);
        $this->assertDatabaseCount('planner_notifications', 2);
        $this->assertEmpty($s->inbox($f['members'][0])['notifications']);
        $this->assertSame(2, $s->dispatch());
        $this->assertSame(0, $s->dispatch());
        $notification = $s->inbox($f['members'][0])['notifications'][0];
        $this->assertSame('schedule_published', $notification['kind']);
        $this->assertSame('/scheduling?week='.$f['date'], $notification['href']);
        $first = $s->read($f['members'][0], $notification['id']);
        $this->travel(1)->hours();
        $this->assertSame($first['read_at'], $s->read($f['members'][0], $notification['id'])['read_at']);
        $s->employees($f['owner']->tenant_id, [$f['people'][0]->id], 'schedule_published', 'published:'.$f['rows'][0]->revision_id, ['week_start' => $f['date']]);
        $this->assertDatabaseCount('planner_notifications', 2);
        $this->assertSame($first['read_at'], $s->inbox($f['members'][0])['notifications'][0]['read_at']);
    }

    public function test_notification_privacy_rechecks_employee_link_membership_and_tenant(): void
    {
        $f = $this->shiftFixture();
        $s = app(PlannerNotificationService::class);
        $s->dispatch();
        $id = $s->inbox($f['members'][0])['notifications'][0]['id'];
        try {
            $s->read($f['members'][1], $id);
            $this->fail('Must not read another recipient');
        } catch (HttpException $error) {
            $this->assertSame(404, $error->getStatusCode());
        }
        EmployeeUserLink::query()->where('tenant_membership_id', $f['members'][0]->id)->delete();
        $this->assertEmpty($s->inbox($f['members'][0])['notifications']);
        $f['members'][0]->update(['is_active' => false]);
        try {
            $s->inbox($f['members'][0]);
            $this->fail('Revoked member');
        } catch (HttpException $error) {
            $this->assertSame(403, $error->getStatusCode());
        }
        [$user, , $other] = $this->tenantWithOwner('Foreign');
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $this->actingAs($user)->withSession(['active_membership_id' => $other->id]);
        $this->postJson('/api/v1/management/notifications/'.$id.'/read')->assertNotFound();
        $this->getJson('/api/v1/management/notifications')->assertOk()->assertJsonCount(0, 'notifications');
    }

    public function test_friday_jakarta_boundary_consolidation_scope_and_duplicate_cron(): void
    {
        $f = $this->shiftFixture();
        [, $supervisor, $second] = $this->supervisor($f);
        $s = app(PlannerNotificationService::class);
        // Fixture week may already be published; use a separate fixed reminder week.
        $this->assertSame(0, $s->remindDue(CarbonImmutable::parse('2030-01-04T01:59:59Z')));
        $this->assertSame(1, $s->remindDue(CarbonImmutable::parse('2030-01-04T02:00:00Z')));
        $this->assertSame(0, $s->remindDue(CarbonImmutable::parse('2030-01-04T16:59:59Z')));
        $this->assertSame(0, $s->remindDue(CarbonImmutable::parse('2030-01-04T17:00:00Z')));
        $row = DB::table('planner_notifications')->where('kind', 'roster_reminder')->first();
        $this->assertSame('2030-01-07', json_decode($row->data, true)['week_start']);
        $this->assertCount(2, json_decode($row->data, true)['outlet_ids']);
        $s->dispatch();
        $body = $s->inbox($supervisor)['notifications'][0]['body'];
        $this->assertStringContainsString($f['outlet']->name, $body);
        $this->assertStringContainsString($second->name, $body);
        DB::table('supervisor_outlet_scopes')->where('tenant_membership_id', $supervisor->id)->where('outlet_id', $second->id)->delete();
        $this->assertStringNotContainsString($second->name, $s->inbox($supervisor)['notifications'][0]['body']);
        DB::table('supervisor_outlet_scopes')->where('tenant_membership_id', $supervisor->id)->delete();
        $this->assertEmpty($s->inbox($supervisor)['notifications']);
    }

    public function test_published_week_is_excluded_and_no_supervisor_outside_scope_is_notified(): void
    {
        $f = $this->shiftFixture();
        [, $supervisor, $second] = $this->supervisor($f);
        $at = CarbonImmutable::parse($f['date'], 'Asia/Jakarta')->subDays(3)->setTime(9, 0);
        $this->assertSame(1, app(PlannerNotificationService::class)->remindDue($at));
        $data = json_decode(DB::table('planner_notifications')->where('kind', 'roster_reminder')->value('data'), true);
        $this->assertSame([$second->id], $data['outlet_ids']);
        [, $unscoped] = $this->membershipFor($f['owner'], TenantRole::Supervisor);
        app(PlannerNotificationService::class)->remindDue($at);
        $this->assertFalse(DB::table('planner_notifications')->where('membership_id', $unscoped->id)->exists());
    }

    public function test_request_outcomes_and_expiry_are_deduplicated_and_cannot_be_accepted(): void
    {
        $f = $this->shiftFixture();
        $s = app(PlannerNotificationService::class);
        $changes = app(ShiftChangeService::class);
        $request = $changes->create($f['members'][0], ['kind' => 'swap', 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][1]->id, 'target_entry_id' => $f['rows'][1]->id, 'reason' => 'Notification QA'], 'notify');
        $this->assertSame(1, DB::table('planner_notifications')->where('kind', 'shift_requested')->count());
        $this->travelTo(CarbonImmutable::parse($request['expires_at']));
        $s->queueExpired();
        $s->queueExpired();
        $this->assertSame(2, DB::table('planner_notifications')->where('kind', 'shift_outcome')->count());
        $this->assertSame('expired', $changes->respond($f['members'][1], $request['id'], 'accept')['status']);
        $this->assertSame(2, DB::table('planner_notifications')->where('kind', 'shift_outcome')->count());
        $this->assertDatabaseCount('schedule_revisions', 1);
    }

    public function test_changed_assignments_notify_only_affected_employees_and_failed_publish_rolls_back_outbox(): void
    {
        $f = $this->shiftFixture();
        $s = app(PlannerNotificationService::class);
        $this->publishFixture($f['owner'], $f['outlet'], $f['date'], $f['entries'], $f['staffing']);
        $this->assertDatabaseCount('planner_notifications', 2);
        $entries = $f['entries'];
        $entries[0]['status'] = 'rest';
        $entries[0]['shift_template_version_id'] = null;
        $this->publishFixture($f['owner'], $f['outlet'], $f['date'], $entries, $f['staffing']);
        $this->assertSame(1, DB::table('planner_notifications')->where('kind', 'assignment_changed')->count());
        $before = DB::table('planner_notifications')->count();
        try {
            DB::transaction(function () use ($s, $f): void {
                $s->employees($f['owner']->tenant_id, [$f['people'][0]->id], 'assignment_changed', 'rolled-back', ['week_start' => $f['date']]);
                throw new \RuntimeException('Simulated business rollback');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame($before, DB::table('planner_notifications')->count());
    }

    public function test_unrelated_week_draft_does_not_block_acceptance(): void
    {
        $f = $this->shiftFixture();
        $changes = app(ShiftChangeService::class);
        $request = $changes->create($f['members'][0], ['kind' => 'replacement', 'source_entry_id' => $f['rows'][0]->id, 'recipient_id' => $f['people'][2]->id, 'reason' => 'Other week draft'], 'unrelated');
        app(WeeklyPlannerService::class)->save($f['owner'], $f['outlet']->id, CarbonImmutable::parse($f['date'])->addWeek()->toDateString(), ['expected_version' => 0, 'entries' => [], 'staffing' => $f['staffing'], 'reason' => 'Unrelated draft'], 'unrelated-draft');
        $this->assertSame('accepted', $changes->respond($f['members'][2], $request['id'], 'accept')['status']);
        $this->assertSame(1, DB::table('schedule_weeks')->whereNotNull('draft_revision_id')->count());
        $this->assertSame(2, DB::table('planner_notifications')->where('kind', 'shift_outcome')->count());
    }

    public function test_dispatch_command_is_repeatable_and_enforces_limit(): void
    {
        $this->shiftFixture();
        $this->artisan('planner:notifications-dispatch', ['--limit' => 1])->assertExitCode(0);
        $this->assertSame(1, DB::table('planner_notifications')->whereNotNull('delivered_at')->count());
        $this->artisan('planner:notifications-dispatch', ['--limit' => 1])->assertExitCode(0);
        $this->artisan('planner:notifications-dispatch', ['--limit' => 1])->assertExitCode(0);
        $this->assertSame(2, DB::table('planner_notifications')->whereNotNull('delivered_at')->count());
        $this->artisan('planner:notifications-dispatch', ['--limit' => 0])->assertExitCode(1);
    }

    public function test_delivery_transaction_can_roll_back_and_be_retried_without_duplicates(): void
    {
        $this->shiftFixture();
        $service = app(PlannerNotificationService::class);
        try {
            DB::transaction(function () use ($service): void {
                $service->dispatch();
                throw new \RuntimeException('Simulated interrupted dispatch');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame(0, DB::table('planner_notifications')->whereNotNull('delivered_at')->count());
        $this->assertSame(2, $service->dispatch());
        $this->assertSame(0, $service->dispatch());
    }

    public function test_legacy_assignment_exception_notifies_the_linked_employee_before_cutover(): void
    {
        $f = $this->shiftFixture();
        $date = CarbonImmutable::today('Asia/Jakarta')->toDateString();
        app(EmployeeScheduleService::class)->createException($f['owner'], $f['people'][0]->id, $f['outlet']->id, $date, 'rest', null, 'Legacy exception notice');
        $this->assertSame(1, DB::table('planner_notifications')->where('kind', 'assignment_changed')->count());
    }
}
