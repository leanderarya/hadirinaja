<?php

namespace App\Support;

final class SchedulingDefaults
{
    public const TIMEZONE = 'Asia/Jakarta';

    /** @return list<int> */
    public static function operatingWeekdays(): array
    {
        return [1, 2, 3, 4, 5, 6, 7];
    }

    /** @return array<string, mixed> */
    public static function attendancePolicy(): array
    {
        return [
            'late_tolerance_minutes' => 5,
            'check_in_window' => ['early_minutes' => 60, 'late_minutes' => 60],
            'attendance_mode' => 'kiosk',
            'personal_location_validation' => ['required' => true, 'radius_meters' => 100],
            'retroactive_request_limit_days' => 7,
            'operational_review' => ['schedule_change_reason_required' => true, 'minimum_notice_hours' => 24],
        ];
    }
}
