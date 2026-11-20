<?php

use App\Models\TenantMembership;
use App\Services\AttendanceEvidenceExpirationService;
use App\Services\AttendanceEvidenceLegalHoldService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DisposableTestDatabaseGuard;

$backend = dirname(__DIR__, 2);
if ((string) getenv('APP_ENV') !== 'testing') {
    throw new RuntimeException('Legal hold race workers require the testing environment.');
}

chdir($backend);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
DisposableTestDatabaseGuard::assertConfigured(config('database.connections.mysql'));
DisposableTestDatabaseGuard::assertConnected(DB::connection());
config(['filesystems.disks.local.root' => (string) getenv('S6C_EVIDENCE_ROOT')]);
config(['attendance_evidence.deletion_enabled' => true]);
Storage::forgetDisk('local');

$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
$readyPath = (string) getenv('S6C_READY_FILE');
file_put_contents($readyPath, (string) $connectionId);
$startPath = (string) getenv('S6C_START_FILE');
$deadline = microtime(true) + 15;
while (! is_file($startPath) && microtime(true) < $deadline) {
    usleep(5_000);
}
if (! is_file($startPath)) {
    throw new RuntimeException('Legal hold race worker did not receive its start signal.');
}

$now = Carbon::parse((string) getenv('S6C_NOW'))->utc();
$mode = (string) getenv('S6C_MODE');
try {
    if ($mode === 'request') {
        $membership = TenantMembership::query()->findOrFail((int) getenv('S6C_MEMBERSHIP_ID'));
        $result = app(AttendanceEvidenceLegalHoldService::class)->requestPlacement(
            $membership,
            (int) getenv('S6C_EVENT_ID'),
            'case-race-'.(string) getenv('S6C_RUN_ID'),
            'Concurrent request must not claim preservation after deletion wins.',
            7,
        );
        $payload = ['status' => 'accepted', 'request' => $result];
    } elseif ($mode === 'expire') {
        $result = app(AttendanceEvidenceExpirationService::class)->run(false, 100, $now);
        $payload = ['status' => 'completed', 'summary' => $result];
    } else {
        throw new RuntimeException('Unknown legal hold race worker mode.');
    }
} catch (HttpResponseException $exception) {
    $payload = [
        'status' => 'rejected',
        'http_status' => $exception->getResponse()->getStatusCode(),
        'body' => json_decode((string) $exception->getResponse()->getContent(), true),
    ];
}

file_put_contents((string) getenv('S6C_RESULT_FILE'), json_encode([
    'connection_id' => $connectionId,
    ...$payload,
], JSON_THROW_ON_ERROR));
