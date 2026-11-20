<?php

return [
    'pdfinfo_binary' => env('CORRECTION_EVIDENCE_PDFINFO', 'pdfinfo'),
    'correction_deletion_enabled' => (bool) env('CORRECTION_EVIDENCE_DELETION_ENABLED', false),
    // Keep JPEG writes until deployment WebP capability and coordinated rollout are approved.
    'write_format' => env('ATTENDANCE_EVIDENCE_WRITE_FORMAT', 'jpeg'),
    // Personal photo enforcement remains disabled until the Employee camera UI rollout is coordinated.
    'require_personal_photo' => (bool) env('ATTENDANCE_EVIDENCE_REQUIRE_PERSONAL_PHOTO', false),
    'jpeg_quality' => 85,
    'webp_quality' => 82,
    'max_encoded_bytes' => 5 * 1024 * 1024,
    // Evidence deletion and orphan cleanup remain disabled until separately approved.
    'deletion_enabled' => (bool) env('ATTENDANCE_EVIDENCE_DELETION_ENABLED', false),
];
