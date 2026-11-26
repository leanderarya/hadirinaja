<?php

return [
    'frontend_url' => env('ACCESS_FRONTEND_URL', env('APP_URL', 'http://localhost')),
    'password_reset_expiration_minutes' => max(5, min(120, (int) env('ACCESS_PASSWORD_RESET_EXPIRATION_MINUTES', 30))),
    'invitation_expiration_hours' => max(1, (int) env('ACCESS_INVITATION_EXPIRATION_HOURS', 24)),
];
