<?php

namespace App\Contracts;

/** Immutable source facts, independent of their current effective projection. */
interface AttendanceSource
{
    public function kind(): string;

    /** @return array<string, mixed> */
    public function facts(): array;
}
