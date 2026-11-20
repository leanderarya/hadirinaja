<?php

use App\Data\AttendanceActor;
use App\Models\Employee;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Services\AttendanceService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DisposableTestDatabaseGuard;

$backend = dirname(__DIR__, 2);
file_put_contents((string) getenv('S4_STAGE_FILE'), 'starting');
chdir($backend);
require $backend.'/vendor/autoload.php';
file_put_contents((string) getenv('S4_STAGE_FILE'), 'autoloaded');
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
DisposableTestDatabaseGuard::assertConfigured(config('database.connections.mysql'));
DisposableTestDatabaseGuard::assertConnected(DB::connection());
config(['attendance_evidence.require_personal_photo' => getenv('S4_WITH_PHOTO') === '1']);
file_put_contents((string) getenv('S4_STAGE_FILE'), 'bootstrapped');

$evidenceRoot = (string) getenv('S4_EVIDENCE_ROOT');
if ($evidenceRoot !== '') {
    if (! is_dir($evidenceRoot)) {
        mkdir($evidenceRoot, 0700, true);
    }
    config(['filesystems.disks.local.root' => $evidenceRoot]);
    Storage::forgetDisk('local');
}

$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
file_put_contents((string) getenv('S4_STAGE_FILE'), 'connected');
file_put_contents((string) getenv('S4_READY_FILE'), json_encode([
    'connection_id' => $connectionId,
], JSON_THROW_ON_ERROR));

$startFile = (string) getenv('S4_START_FILE');
$deadline = microtime(true) + 15;
while (! is_file($startFile) && microtime(true) < $deadline) {
    usleep(5_000);
}
if (! is_file($startFile)) {
    throw new RuntimeException('Worker did not receive the concurrency release signal.');
}

file_put_contents((string) getenv('S4_ATTEMPT_FILE'), 'started');
$startedAt = microtime(true);
$tenantId = (int) getenv('S4_TENANT_ID');
$employeeId = (int) getenv('S4_EMPLOYEE_ID');
$employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->firstOrFail();
$origin = (string) getenv('S4_ORIGIN');
$actor = $origin === 'kiosk'
    ? AttendanceActor::kiosk(KioskDevice::query()->forTenant($tenantId)->whereKey((int) getenv('S4_DEVICE_ID'))->firstOrFail())
    : AttendanceActor::personal(TenantMembership::query()->forTenant($tenantId)->whereKey((int) getenv('S4_MEMBERSHIP_ID'))->firstOrFail());
$service = app(AttendanceService::class);
$operation = (string) getenv('S4_OPERATION');
$key = (string) getenv('S4_IDEMPOTENCY_KEY');
$location = ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 10];

if ($operation === 'check_in') {
    $outlet = Outlet::query()->forTenant($tenantId)->whereKey((int) getenv('S4_OUTLET_ID'))->firstOrFail();
    $photoPath = (string) getenv('S4_PHOTO_PATH');
    $photo = $origin === 'kiosk' || getenv('S4_WITH_PHOTO') === '1'
        ? new UploadedFile($photoPath, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true)
        : null;
    $result = $service->checkIn($actor, $employee, $outlet, $key, $location, $photo);
} elseif ($operation === 'check_out') {
    $photoPath = (string) getenv('S4_PHOTO_PATH');
    $photo = $origin === 'kiosk' || getenv('S4_WITH_PHOTO') === '1'
        ? new UploadedFile($photoPath, 'camera.jpg', 'image/jpeg', UPLOAD_ERR_OK, true)
        : null;
    $destinationId = (int) getenv('S4_CHECKOUT_OUTLET_ID');
    $destination = $destinationId > 0 ? Outlet::query()->forTenant($tenantId)->whereKey($destinationId)->firstOrFail() : null;
    $result = $service->checkOut($actor, $employee, $key, $location, $photo, $destination, (int) getenv('S4_CHECKOUT_SESSION_ID') ?: null);
} else {
    throw new InvalidArgumentException('Unsupported attendance worker operation.');
}

file_put_contents((string) getenv('S4_RESULT_FILE'), json_encode([
    'status' => $result['status'],
    'body' => $result['body'],
    'elapsed_ms' => (int) round((microtime(true) - $startedAt) * 1000),
    'connection_id' => $connectionId,
], JSON_THROW_ON_ERROR));
