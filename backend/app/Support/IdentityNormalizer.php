<?php

namespace App\Support;

use Illuminate\Support\Str;
use InvalidArgumentException;

final class IdentityNormalizer
{
    public static function email(string $email): string
    {
        return Str::lower(trim($email));
    }

    public static function phone(?string $phone): ?string
    {
        if ($phone === null || trim($phone) === '') {
            return null;
        }

        $normalized = preg_replace('/[\s().-]+/', '', trim($phone));

        if (! is_string($normalized) || preg_match('/^\+[1-9]\d{7,14}$/D', $normalized) !== 1) {
            throw new InvalidArgumentException('Phone numbers must use canonical E.164 format.');
        }

        return $normalized;
    }
}
