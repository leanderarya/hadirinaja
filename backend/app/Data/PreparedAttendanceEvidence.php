<?php

namespace App\Data;

final readonly class PreparedAttendanceEvidence
{
    public function __construct(
        public string $temporaryPath,
        public string $storagePath,
        public string $detectedMimeType,
        public string $storedMimeType,
        public int $storedSizeBytes,
        public int $width,
        public int $height,
        public string $sha256,
    ) {}
}
