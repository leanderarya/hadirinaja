<?php

namespace App\Services;

use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Validation\ValidationException;

final class LocalTimeResolver
{
    public function instant(string $date, string $time, string $timezone): DateTimeImmutable
    {
        try {
            $zone = new DateTimeZone($timezone);
        } catch (\Throwable) {
            throw ValidationException::withMessages(['timezone' => 'Zona waktu harus memakai pengenal IANA yang valid.']);
        }

        $utc = new DateTimeZone('UTC');
        $localText = $date.' '.$time;
        $wallClock = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $localText, $utc);
        $parseErrors = DateTimeImmutable::getLastErrors();

        if (! $wallClock || ($parseErrors !== false && ($parseErrors['warning_count'] > 0 || $parseErrors['error_count'] > 0))
            || $wallClock->format('Y-m-d H:i:s') !== $localText) {
            throw ValidationException::withMessages(['work_date' => 'Tanggal atau jam kerja lokal tidak valid.']);
        }

        $wallTimestamp = (int) $wallClock->format('U');
        $transitions = $zone->getTransitions($wallTimestamp - 172800, $wallTimestamp + 172800);
        $offsets = $transitions === false
            ? [$zone->getOffset($wallClock->setTimezone($zone))]
            : array_values(array_unique(array_column($transitions, 'offset')));
        $matches = [];

        foreach ($offsets as $offset) {
            $candidate = (new DateTimeImmutable('@'.($wallTimestamp - (int) $offset)))->setTimezone($zone);

            if ($candidate->format('Y-m-d H:i:s') === $localText) {
                $matches[] = $candidate;
            }
        }

        if (count($matches) !== 1) {
            throw ValidationException::withMessages([
                'work_date' => 'Jam kerja lokal berada pada perubahan zona waktu yang ambigu atau tidak tersedia.',
            ]);
        }

        return $matches[0];
    }
}
