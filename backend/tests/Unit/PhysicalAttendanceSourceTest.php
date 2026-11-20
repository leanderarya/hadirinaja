<?php

namespace Tests\Unit;

use App\Data\PhysicalAttendanceSource;
use App\Models\AttendanceEvent;
use App\Models\AttendanceSession;
use App\Services\PhysicalAttendanceSourceAdapter;
use Carbon\CarbonImmutable;
use LogicException;
use PHPUnit\Framework\TestCase;

class PhysicalAttendanceSourceTest extends TestCase
{
    public function test_adapter_preserves_recorded_facts_and_normalizes_timestamps_without_mutating_models(): void
    {
        $session = new AttendanceSession;
        $session->setDateFormat('Y-m-d H:i:s');
        $session->setRawAttributes([
            'id' => 12, 'tenant_id' => 1, 'employee_id' => 2, 'outlet_id' => 3,
            'work_date' => '2026-11-05', 'status' => 'closed',
            'check_in_at' => '2026-11-05 01:00:00', 'check_out_at' => '2026-11-05 09:00:00',
        ], true);
        $event = new AttendanceEvent;
        $event->setDateFormat('Y-m-d H:i:s');
        $event->setRawAttributes([
            'id' => 20, 'event_type' => 'check_in', 'origin' => 'personal',
            'recorded_at' => '2026-11-05 01:00:00',
        ], true);
        $event->setRelation('evidence', null);
        $session->setRelation('events', collect([$event]));
        $before = $session->getAttributes();

        $source = (new PhysicalAttendanceSourceAdapter)->adapt($session);

        $this->assertSame('physical_session', $source->kind());
        $this->assertSame(28800, $source->durationSeconds());
        $this->assertSame('2026-11-05T01:00:00+00:00', $source->original()['check_in_at']);
        $this->assertSame([20], $source->original()['event_ids']);
        $this->assertFalse($source->events[0]['has_evidence']);
        $this->assertSame(3, $source->facts()['outlet_id']);
        $this->assertSame($before, $session->getAttributes());
    }

    public function test_incomplete_and_invalid_intervals_are_unknown_but_zero_duration_is_known(): void
    {
        $start = CarbonImmutable::parse('2026-11-05T01:00:00Z');
        foreach ([null, $start->subSecond(), $start] as $end) {
            $source = new PhysicalAttendanceSource(1, 2, 3, 4, '2026-11-05', 'active', $start, $end, []);
            $this->assertSame($end === $start ? 0 : null, $source->durationSeconds());
        }
    }

    public function test_adapter_rejects_missing_relations_instead_of_lazy_loading(): void
    {
        $this->expectException(LogicException::class);
        (new PhysicalAttendanceSourceAdapter)->adapt(new AttendanceSession);
    }
}
