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
use Tests\Support\DisposableTestDatabaseGuard;

$basePath = dirname(__DIR__, 2);
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$mysql = config('database.connections.mysql');

try {
    if (config('database.default') !== 'mysql') {
        throw new RuntimeException('Worker requires MySQL.');
    }

    DisposableTestDatabaseGuard::assertConfigured($mysql);
    $connection = DB::connection();
    DisposableTestDatabaseGuard::assertConnected($connection);
    $identity = $connection->selectOne(
        'SELECT DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket, CURRENT_USER() AS account_name, CONNECTION_ID() AS connection_id',
    );

    if (! is_object($identity)) {
        throw new RuntimeException('Worker could not retrieve the disposable database identity.');
    }

    $identityOutput = [
        'database_name' => (string) $identity->database_name,
        'port' => (string) $identity->port,
        'data_directory' => realpath((string) $identity->data_directory),
        'socket' => realpath((string) $identity->socket),
        'account_name' => (string) $identity->account_name,
        'connection_id' => (int) $identity->connection_id,
    ];
    if (
        $identityOutput['database_name'] !== getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE')
        || $identityOutput['port'] !== getenv('HADIRINAJA_TEST_DISPOSABLE_PORT')
        || $identityOutput['data_directory'] !== realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR'))
        || $identityOutput['socket'] !== realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET'))
        || $identityOutput['account_name'] !== getenv('DB_USERNAME').'@127.0.0.1'
    ) {
        throw new RuntimeException('Worker connected outside its verified disposable database.');
    }
} catch (Throwable) {
    fwrite(STDERR, "Worker refused to continue because disposable database identity could not be verified.\n");
    exit(2);
}

if (in_array('--identity-probe', $argv, true)) {
    echo json_encode(['disposable_identity_verified' => true, ...$identityOutput], JSON_THROW_ON_ERROR).PHP_EOL;
    exit(0);
}

$readyPath = (string) getenv('S1_READY_FILE');
$startPath = (string) getenv('S1_START_FILE');
$attemptPath = (string) getenv('S1_ATTEMPT_FILE');
$resultPath = (string) getenv('S1_RESULT_FILE');

if ($readyPath === '' || $startPath === '' || $attemptPath === '' || $resultPath === '') {
    fwrite(STDERR, "Worker refused to run without its coordination paths.\n");
    exit(2);
}

file_put_contents($readyPath, json_encode($identityOutput, JSON_THROW_ON_ERROR));

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
