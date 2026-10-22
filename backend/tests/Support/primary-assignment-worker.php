<?php

use App\Models\Employee;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Services\EmployeeOutletAssignmentService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\QueryException;
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
    || filled($mysql['url'] ?? null)
) {
    fwrite(STDERR, "Worker refused a non-test database configuration.\n");
    exit(2);
}

$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
$readyPath = (string) getenv('S1_READY_FILE');
$startPath = (string) getenv('S1_START_FILE');
$attemptPath = (string) getenv('S1_ATTEMPT_FILE');
$resultPath = (string) getenv('S1_RESULT_FILE');

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
$startedAt = hrtime(true);

try {
    $membership = TenantMembership::query()->findOrFail((int) getenv('S1_MEMBERSHIP_ID'));
    $employee = Employee::query()->findOrFail((int) getenv('S1_EMPLOYEE_ID'));
    $outlet = Outlet::query()->findOrFail((int) getenv('S1_OUTLET_ID'));

    app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet(
        $membership,
        $employee,
        $outlet,
        new DateTimeImmutable((string) getenv('S1_EFFECTIVE_FROM')),
    );

    $status = 'created';
} catch (ValidationException) {
    $status = 'conflict';
} catch (AuthorizationException|QueryException $exception) {
    file_put_contents($resultPath, json_encode([
        'status' => 'error',
        'error_type' => $exception::class,
        'elapsed_ms' => (int) ((hrtime(true) - $startedAt) / 1_000_000),
    ], JSON_THROW_ON_ERROR));
    exit(1);
}

file_put_contents($resultPath, json_encode([
    'status' => $status,
    'elapsed_ms' => (int) ((hrtime(true) - $startedAt) / 1_000_000),
], JSON_THROW_ON_ERROR));
