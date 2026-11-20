<?php

use App\Services\AttendanceEvidenceExpirationService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DisposableTestDatabaseGuard;

$backend = dirname(__DIR__, 2);
if ((string) getenv('APP_ENV') !== 'testing') {
    throw new RuntimeException('Evidence expiration workers require the testing environment.');
}

chdir($backend);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
DisposableTestDatabaseGuard::assertConfigured(config('database.connections.mysql'));
DisposableTestDatabaseGuard::assertConnected(DB::connection());
config(['filesystems.disks.local.root' => (string) getenv('S5_EVIDENCE_ROOT')]);
config(['attendance_evidence.deletion_enabled' => filter_var(getenv('ATTENDANCE_EVIDENCE_DELETION_ENABLED'), FILTER_VALIDATE_BOOL)]);
Storage::forgetDisk('local');

$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
file_put_contents((string) getenv('S5_READY_FILE'), (string) $connectionId);
$startPath = (string) getenv('S5_START_FILE');
$deadline = microtime(true) + 15;
while (! is_file($startPath) && microtime(true) < $deadline) {
    usleep(5_000);
}
if (! is_file($startPath)) {
    throw new RuntimeException('Expiration worker did not receive the concurrency release signal.');
}

$summary = app(AttendanceEvidenceExpirationService::class)->run(
    false,
    100,
    Carbon::parse((string) getenv('S5_NOW'))->utc(),
);
file_put_contents((string) getenv('S5_RESULT_FILE'), json_encode([
    'connection_id' => $connectionId,
    'summary' => $summary,
], JSON_THROW_ON_ERROR));
