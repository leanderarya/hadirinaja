<?php

namespace Tests\Support;

use App\Enums\TenantRole;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use App\Services\TenantMembershipService;
use App\Services\WeeklyPlannerService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

trait BuildsShiftChangeFixtures
{
    use BuildsTenantFixtures;

    protected function shiftFixture(): array
    {
        [, , $owner] = $this->tenantWithOwner('Shift change QA');
        [, $outlet] = $this->unitWithOutlet($owner);
        $date = CarbonImmutable::today('Asia/Jakarta')->addWeek()->startOfWeek()->toDateString();
        $people = $members = $users = [];
        foreach (['A', 'B', 'C'] as $name) {
            $person = app(OrganizationService::class)->registerEmployee($owner, 'QA '.$name);
            app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $person, $outlet, now()->subDay());
            [$user, $membership] = $this->membershipFor($owner, TenantRole::Employee);
            app(TenantMembershipService::class)->linkEmployee($owner, $membership, $person);
            $people[] = $person;
            $members[] = $membership;
            $users[] = $user;
        }
        $staffing = [];
        foreach (['morning' => ['08:00', '16:00'], 'middle' => ['11:00', '19:00'], 'evening' => ['16:00', '22:00']] as $role => [$start, $end]) {
            $staffing[$role] = app(ShiftTemplateService::class)->create($owner, $role, $start, $end, false, $date, 'Fixture shift')->versions->first()->id;
        }
        $entries = [
            ['employee_id' => $people[0]->id, 'work_date' => $date, 'status' => 'work', 'shift_template_version_id' => $staffing['morning']],
            ['employee_id' => $people[1]->id, 'work_date' => $date, 'status' => 'work', 'shift_template_version_id' => $staffing['evening']],
        ];
        $this->publishFixture($owner, $outlet, $date, $entries, $staffing, true);
        $rows = DB::table('schedule_entries')->where('status', 'work')->orderBy('id')->get();

        return compact('owner', 'outlet', 'date', 'people', 'members', 'users', 'staffing', 'entries', 'rows');
    }

    protected function publishFixture($owner, $outlet, string $week, array $entries, array $staffing, bool $cutover = false): array
    {
        $planner = app(WeeklyPlannerService::class);
        $current = $planner->read($owner, $outlet->id, $week);
        $draft = $planner->save($owner, $outlet->id, $week, ['expected_version' => $current['version'], 'reason' => 'Fixture draft', 'staffing' => $staffing, 'entries' => $entries], 'save-'.Str::uuid());

        return $planner->publish($owner, $outlet->id, $week, ['expected_version' => $draft['version'], 'expected_published_revision_id' => $current['published']['revision_id'] ?? null, 'activate_cutover' => $cutover, 'reason' => 'Fixture publish', 'warnings_checksum' => $draft['staffing_report']['checksum']], 'publish-'.Str::uuid());
    }
}
