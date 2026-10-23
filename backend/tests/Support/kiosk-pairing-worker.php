<?php

use App\Services\KioskPairingService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$basePath = dirname(__DIR__, 2);
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$mysql = config('database.connections.mysql');

if (
    config('database.default') !== 'mysql'
    || ($mysql['database'] ?? null) !== 'hadirinaja_test'
    || ! in_array($mysql['host'] ?? null, ['127.0.0.1', 'localhost'], true)
    || (string) ($mysql['port'] ?? '') !== '3306'
    || filled($mysql['url'] ?? null)
) {
    fwrite(STDERR, "Worker refused a non-test database configuration.\n");
    exit(2);
}

$readyPath = (string) getenv('S2_READY_FILE');
$startPath = (string) getenv('S2_START_FILE');
$attemptPath = (string) getenv('S2_ATTEMPT_FILE');
$resultPath = (string) getenv('S2_RESULT_FILE');
$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
file_put_contents($readyPath, json_encode(['connection_id' => $connectionId], JSON_THROW_ON_ERROR));

$deadline = microtime(true) + 15;

while (! is_file($startPath) && microtime(true) < $deadline) {
    usleep(10_000);
}

if (! is_file($startPath)) {
    fwrite(STDERR, "Worker did not receive the concurrency start signal.\n");
    exit(3);
}

file_put_contents($attemptPath, 'started');

try {
    app(KioskPairingService::class)->redeemPairingCode((string) getenv('S2_PAIR_CODE'));
    $status = 'paired';
} catch (ValidationException) {
    $status = 'rejected';
} catch (Throwable $exception) {
    file_put_contents($resultPath, json_encode([
        'status' => 'error',
        'error_type' => $exception::class,
    ], JSON_THROW_ON_ERROR));
    exit(1);
}

file_put_contents($resultPath, json_encode(['status' => $status], JSON_THROW_ON_ERROR));
