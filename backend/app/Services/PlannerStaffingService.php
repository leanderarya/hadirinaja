<?php

namespace App\Services;

use App\Models\ShiftTemplateVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class PlannerStaffingService
{
    public const SHIFTS = ['morning' => ['08:00:00', '16:00:00'], 'middle' => ['11:00:00', '19:00:00'], 'evening' => ['16:00:00', '22:00:00']];

    private const CEPAT_KOPI_WEEKEND_EVENING = ['16:00:00', '23:00:00'];

    public function settings(array $policy): array
    {
        $custom = ($policy['planner_shift_profile'] ?? null) === 'cepat_kopi';

        return [
            'weekend_starts_on' => ($policy['planner_weekend_starts_on'] ?? null) === 5 ? 5 : 6,
            'weekday_shifts' => $custom ? array_replace(self::SHIFTS, ['middle' => ['11:00:00', '18:00:00']]) : self::SHIFTS,
            'custom' => $custom,
            'weekend_evening' => $custom ? self::CEPAT_KOPI_WEEKEND_EVENING : self::SHIFTS['evening'],
        ];
    }

    public function isWeekend(string $date, array $settings): bool
    {
        return CarbonImmutable::parse($date)->isoWeekday() >= $settings['weekend_starts_on'];
    }

    public function normalize(int $tenantId, array $configuration, array $settings): array
    {
        Validator::make($configuration, [
            'morning' => ['required', 'integer', 'min:1'],
            'middle' => ['required', 'integer', 'min:1'],
            'evening' => ['required', 'integer', 'min:1'],
        ])->validate();
        $normalized = [];
        foreach ($settings['weekday_shifts'] as $role => [$start, $end]) {
            $shift = ShiftTemplateVersion::query()->forTenant($tenantId)->find($configuration[$role]);
            if (! $shift || $shift->crosses_midnight || $shift->start_time !== $start || $shift->end_time !== $end) {
                throw ValidationException::withMessages(['staffing.'.$role => 'Pilih versi shift organisasi dengan jam '.$start.'–'.$end.'.']);
            }
            $normalized[$role] = (int) $shift->id;
        }

        return $normalized;
    }

    public function report(?array $configuration, array $entries, string $weekStart, int $version, ?int $revisionId, int $tenantId, array $settings): array
    {
        if ($configuration === null) {
            return ['enabled' => false, 'days' => [], 'deficits' => [], 'conflicts' => [], 'checksum' => null];
        }
        $shifts = $settings['custom'] ? ShiftTemplateVersion::query()->forTenant($tenantId)
            ->whereIn('id', array_filter(array_column($entries, 'shift_template_version_id')))
            ->get()->keyBy('id') : collect();
        $days = $deficits = $conflicts = [];
        for ($offset = 0; $offset < 7; $offset++) {
            $date = CarbonImmutable::parse($weekStart)->addDays($offset)->toDateString();
            $weekend = $this->isWeekend($date, $settings);
            $targets = $weekend ? ['morning' => 2, 'evening' => 2] : ['morning' => 1, 'middle' => 1, 'evening' => 1];
            $counts = ['morning' => 0, 'middle' => 0, 'evening' => 0];
            foreach ($entries as $entry) {
                if ($entry['work_date'] !== $date || $entry['status'] !== 'work') {
                    continue;
                }
                $role = array_search((int) $entry['shift_template_version_id'], $configuration, true);
                if ($settings['custom'] && $weekend) {
                    $shift = $shifts->get($entry['shift_template_version_id']);
                    $times = $shift && ! $shift->crosses_midnight ? [$shift->start_time, $shift->end_time] : null;
                    if ($times === $settings['weekday_shifts']['morning']) {
                        $role = 'morning';
                    } elseif ($times === $settings['weekend_evening']) {
                        $role = 'evening';
                    } else {
                        $conflicts[] = $date.': gunakan shift pagi atau sore akhir pekan.';

                        continue;
                    }
                }
                if ($weekend && $role === 'middle') {
                    $conflicts[] = $date.': shift tidak sesuai konfigurasi staffing atau shift tengah dipakai pada akhir pekan.';

                    continue;
                }
                if ($role !== false) {
                    $counts[$role]++;
                }
            }
            foreach ($targets as $role => $target) {
                if ($counts[$role] < $target) {
                    $deficits[] = ['work_date' => $date, 'role' => $role, 'required' => $target, 'assigned' => $counts[$role], 'missing' => $target - $counts[$role]];
                }
            }
            $days[] = ['work_date' => $date, 'targets' => $targets, 'counts' => $counts];
        }
        usort($entries, fn ($a, $b) => [$a['work_date'], $a['employee_id']] <=> [$b['work_date'], $b['employee_id']]);
        $payload = [$version, $revisionId, $configuration, $entries, $deficits];
        if ($settings['custom'] || $settings['weekend_starts_on'] !== 6) {
            $payload[] = $settings;
        }
        $digest = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));

        return ['enabled' => true, 'days' => $days, 'deficits' => $deficits, 'conflicts' => array_values(array_unique($conflicts)), 'checksum' => $digest];
    }
}
