<?php

namespace Tests\Unit;

use App\Services\PlannerStaffingService;
use PHPUnit\Framework\TestCase;

final class PlannerWeekendSettingsTest extends TestCase
{
    public function test_empty_legacy_and_friday_weekend_reports_differ_only_as_configured(): void
    {
        $staffing = new PlannerStaffingService;
        $legacy = $staffing->settings([]);
        $friday = $staffing->settings(['planner_weekend_starts_on' => 5]);
        $ids = ['morning' => 1, 'middle' => 2, 'evening' => 3];
        $entries = [['work_date' => '2026-11-20', 'employee_id' => 1, 'status' => 'work', 'shift_template_version_id' => 2]];
        $standard = $staffing->report($ids, $entries, '2026-11-16', 1, 1, 1, $legacy);
        $custom = $staffing->report($ids, $entries, '2026-11-16', 1, 1, 2, $friday);
        self::assertSame(['morning' => 1, 'middle' => 1, 'evening' => 1], $standard['days'][4]['targets']);
        foreach ([4, 5, 6] as $day) {
            self::assertSame(['morning' => 2, 'evening' => 2], $custom['days'][$day]['targets']);
        }
        self::assertSame([], $standard['conflicts']);
        self::assertCount(1, $custom['conflicts']);
        self::assertNotSame($standard['checksum'], $custom['checksum']);
        $profile = $staffing->settings(['planner_weekend_starts_on' => 5, 'planner_shift_profile' => 'cepat_kopi']);
        self::assertSame(['11:00:00', '18:00:00'], $profile['weekday_shifts']['middle']);
        self::assertSame(['16:00:00', '23:00:00'], $profile['weekend_evening']);
        self::assertFalse($staffing->isWeekend('2026-11-19', $profile));
        self::assertTrue($staffing->isWeekend('2026-11-20', $profile));
    }
}
