<?php

namespace Tests\Feature\S3;

use App\Models\OutletCalendarVersion;
use App\Services\EffectiveScheduleResolver;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\EmployeeScheduleService;
use App\Services\OrganizationService;
use App\Services\ShiftTemplateService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

class SchedulingCorrectnessTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    public static function writeOrders(): array
    {
        return ['weekly first' => [false], 'exception first' => [true]];
    }

    private function context(): array
    {
        [, , $owner] = $this->tenantWithOwner('Scheduling correctness');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Schedule employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDays(2));
        $date = CarbonImmutable::today('Asia/Jakarta')->addDays(3);
        $night = app(ShiftTemplateService::class)->create($owner, 'Night', '20:00', '04:00', true, $date->toDateString(), 'Test shift')->versions->first();
        $morning = app(ShiftTemplateService::class)->create($owner, 'Morning', '03:30', '09:00', false, $date->toDateString(), 'Test shift')->versions->first();

        return [$owner, $employee, $outlet, $date, $night, $morning];
    }

    #[DataProvider('writeOrders')]
    public function test_weekly_and_exception_conflicts_reject_the_second_write_without_partial_changes(bool $exceptionFirst): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $weekly = fn () => $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Weekly night');
        $exception = fn () => $service->createException($owner, $employee->id, $outlet->id, $date->addDay()->toDateString(), 'work', $morning->id, 'Morning exception');
        ($exceptionFirst ? $exception : $weekly)();
        $before = $this->scheduleState();
        try {
            ($exceptionFirst ? $weekly : $exception)();
            $this->fail('The conflicting second write must be rejected.');
        } catch (ValidationException) {
            $this->assertSame($before, $this->scheduleState());
        }
    }

    public function test_rest_override_removes_adjacent_weekly_conflict(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Night rule');
        $service->createException($owner, $employee->id, $outlet->id, $date->toDateString(), 'rest', null, 'Rest override');
        $service->createException($owner, $employee->id, $outlet->id, $date->addDay()->toDateString(), 'work', $morning->id, 'Morning exception');
        $resolved = app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $employee->id, $date->toDateString());
        $this->assertSame('rest', $resolved->status);
    }

    public function test_weekly_past_date_uses_jakarta_even_when_utc_is_yesterday(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-02T00:30:00+07:00'));
        [$owner, $employee, $outlet] = $this->context();
        $this->expectException(ValidationException::class);
        app(EmployeeScheduleService::class)->createWeeklyRule($owner, $employee->id, $outlet->id, 7, null, '2026-11-01', null, 'Past local date');
    }

    #[DataProvider('writeOrders')]
    public function test_cross_outlet_conflict_is_checked_in_both_orders(bool $exceptionFirst): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        [, $other] = $this->unitWithOutlet($owner, 'Other unit', 'Other outlet');
        $this->insertLegacyTemporaryOutletAssignment($owner, $employee, $other, now(), $date->addDays(3));
        $service = app(EmployeeScheduleService::class);
        $weekly = fn () => $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Night rule');
        $exception = fn () => $service->createException($owner, $employee->id, $other->id, $date->addDay()->toDateString(), 'work', $morning->id, 'Other outlet');
        ($exceptionFirst ? $exception : $weekly)();
        $this->expectException(ValidationException::class);
        ($exceptionFirst ? $weekly : $exception)();
    }

    public function test_touching_intervals_and_work_override_are_allowed(): void
    {
        [$owner, $employee, $outlet, $date, $night, $early] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $morning = app(ShiftTemplateService::class)->create($owner, 'Touching', '04:00', '09:00', false, $date->toDateString(), 'Test boundary')->versions->first();
        $day = app(ShiftTemplateService::class)->create($owner, 'Day', '08:00', '16:00', false, $date->toDateString(), 'Test override')->versions->first();
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Night rule');
        $service->createException($owner, $employee->id, $outlet->id, $date->addDay()->toDateString(), 'work', $morning->id, 'Touching intervals');
        $service->createException($owner, $employee->id, $outlet->id, $date->toDateString(), 'work', $day->id, 'Day replaces night');
        $service->createException($owner, $employee->id, $outlet->id, $date->addDay()->toDateString(), 'work', $early->id, 'No obsolete night conflict');
        $resolved = app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $employee->id, $date->toDateString());
        $this->assertSame($day->id, $resolved->shift['version_id']);
    }

    public function test_exception_beyond_first_fourteen_days_is_checked(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $service->createException($owner, $employee->id, $outlet->id, $date->addDays(71)->toDateString(), 'work', $morning->id, 'Distant exception');
        $this->expectException(ValidationException::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Recurring night');
    }

    public function test_calendar_version_after_first_fourteen_days_is_checked(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        [, $other] = $this->unitWithOutlet($owner, 'Other unit', 'Other outlet');
        $this->insertLegacyTemporaryOutletAssignment($owner, $employee, $other, now(), $date->addYear());
        OutletCalendarVersion::query()->where('outlet_id', $outlet->id)->update(['timezone' => 'Asia/Tokyo']);
        OutletCalendarVersion::query()->create([
            'tenant_id' => $owner->tenant_id, 'outlet_id' => $outlet->id,
            'effective_from' => $date->addDays(60)->toDateString(), 'timezone' => 'Asia/Jakarta',
            'operating_weekdays' => [1, 2, 3, 4, 5, 6, 7], 'actor_user_id' => $owner->user_id, 'reason' => 'Future timezone',
        ]);
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $other->id, $date->addDay()->isoWeekday(), $morning->id, $date->toDateString(), $date->addDays(90)->toDateString(), 'Morning rule');
        $this->expectException(ValidationException::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Night rule');
    }

    public function test_rejected_weekly_revision_rolls_back_period_closure_and_audit(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $day = app(ShiftTemplateService::class)->create($owner, 'Day', '08:00', '16:00', false, $date->toDateString(), 'Test revision')->versions->first();
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $day->id, $date->toDateString(), null, 'Original rule');
        $service->createException($owner, $employee->id, $outlet->id, $date->addDays(8)->toDateString(), 'work', $morning->id, 'Morning exception');
        $before = $this->scheduleState();
        try {
            $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->addDays(7)->toDateString(), null, 'Conflicting revision');
            $this->fail('Revision must be rejected.');
        } catch (ValidationException) {
            $this->assertSame($before, $this->scheduleState());
            $resolved = app(EffectiveScheduleResolver::class)->resolve($owner->tenant_id, $employee->id, $date->addDays(7)->toDateString());
            $this->assertSame($day->id, $resolved->shift['version_id']);
        }
    }

    public function test_exception_today_in_a_western_outlet_is_not_rejected_by_utc_date(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-02T01:00:00Z'));
        [$owner, $employee, $outlet] = $this->context();
        OutletCalendarVersion::query()->where('outlet_id', $outlet->id)->update(['timezone' => 'Pacific/Honolulu', 'effective_from' => '2026-10-01']);
        $exception = app(EmployeeScheduleService::class)->createException($owner, $employee->id, $outlet->id, '2026-11-01', 'rest', null, 'Today locally');
        $this->assertSame('2026-11-01', $exception->work_date->toDateString());
    }

    public function test_rejected_exception_revision_preserves_previous_override_and_audit(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $service->createException($owner, $employee->id, $outlet->id, $date->toDateString(), 'rest', null, 'Original rest');
        $service->createException($owner, $employee->id, $outlet->id, $date->addDay()->toDateString(), 'work', $morning->id, 'Morning exception');
        $before = $this->scheduleState();
        try {
            $service->createException($owner, $employee->id, $outlet->id, $date->toDateString(), 'work', $night->id, 'Conflicting revision');
            $this->fail('Revision must be rejected.');
        } catch (ValidationException) {
            $this->assertSame($before, $this->scheduleState());
        }
    }

    public static function localMidnight(): array
    {
        return [['2026-11-01T23:59:59+07:00'], ['2026-11-02T00:00:00+07:00'], ['2026-11-02T00:00:01+07:00']];
    }

    #[DataProvider('localMidnight')]
    public function test_jakarta_today_is_accepted_and_yesterday_exception_is_rejected(string $instant): void
    {
        $today = CarbonImmutable::parse($instant);
        $this->travelTo($today);
        [$owner, $employee, $outlet] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $today->isoWeekday(), null, $today->toDateString(), null, 'Today local');
        $service->createException($owner, $employee->id, $outlet->id, $today->toDateString(), 'rest', null, 'Today local');
        $before = $this->scheduleState();
        try {
            $service->createException($owner, $employee->id, $outlet->id, $today->subDay()->toDateString(), 'rest', null, 'Yesterday local');
            $this->fail('Past local exception must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('work_date', $exception->errors());
            $this->assertSame($before, $this->scheduleState());
        }
    }

    public function test_recurring_conflict_after_timezone_offset_transition_is_checked(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-05-01T12:00:00Z'));
        [$owner, $employee, $outlet, $date, $night] = $this->context();
        [, $other] = $this->unitWithOutlet($owner, 'UTC unit', 'UTC outlet');
        $this->insertLegacyTemporaryOutletAssignment($owner, $employee, $other, now(), $date->addYear());
        OutletCalendarVersion::query()->where('outlet_id', $outlet->id)->update(['timezone' => 'America/New_York']);
        OutletCalendarVersion::query()->where('outlet_id', $other->id)->update(['timezone' => 'UTC']);
        $morning = app(ShiftTemplateService::class)->create($owner, 'UTC morning', '07:30', '09:00', false, $date->toDateString(), 'UTC shift')->versions->first();
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $other->id, $date->addDay()->isoWeekday(), $morning->id, $date->toDateString(), $date->addDays(300)->toDateString(), 'UTC morning');
        $this->expectException(ValidationException::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), $date->addDays(300)->toDateString(), 'Night crosses offset change');
    }

    public function test_rest_overrides_in_first_two_cycles_do_not_hide_later_recurring_conflict(): void
    {
        [$owner, $employee, $outlet, $date, $night, $morning] = $this->context();
        $service = app(EmployeeScheduleService::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->addDay()->isoWeekday(), $morning->id, $date->toDateString(), null, 'Morning rule');
        foreach ([0, 7] as $offset) {
            $service->createException($owner, $employee->id, $outlet->id, $date->addDays($offset)->toDateString(), 'rest', null, 'Rest at start');
        }
        $this->expectException(ValidationException::class);
        $service->createWeeklyRule($owner, $employee->id, $outlet->id, $date->isoWeekday(), $night->id, $date->toDateString(), null, 'Night after rest overrides');
    }

    private function scheduleState(): array
    {
        return collect(['weekly_schedule_rules', 'schedule_exceptions', 'scheduling_change_events'])
            ->mapWithKeys(fn ($table) => [$table => DB::table($table)->orderBy('id')->get()->toJson()])->all();
    }
}
