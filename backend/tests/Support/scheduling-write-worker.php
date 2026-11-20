<?php

use App\Models\Employee;
use App\Models\TenantMembership;
use App\Services\EmployeeScheduleService;
use App\Services\PlannerNotificationService;
use App\Services\ShiftChangeService;
use App\Services\WeeklyPlannerService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\DisposableTestDatabaseGuard;

$basePath = dirname(__DIR__, 2);
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$mysql = config('database.connections.mysql');
if (config('database.default') !== 'mysql'
    || ($mysql['database'] ?? null) !== 'hadirinaja_test'
    || ! in_array($mysql['host'] ?? null, ['127.0.0.1', 'localhost'], true)
    || filled($mysql['url'] ?? null)) {
    fwrite(STDERR, "Worker refused a non-test database configuration.\n");
    exit(2);
}

DisposableTestDatabaseGuard::assertConfigured($mysql);
$connection = DB::connection();
DisposableTestDatabaseGuard::assertConnected($connection);
$identity = $connection->selectOne(
    'SELECT CONNECTION_ID() AS connection_id, DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket, CURRENT_USER() AS account_name',
);
$readyPath = (string) getenv('S3_READY_FILE');
$startPath = (string) getenv('S3_START_FILE');
$attemptPath = (string) getenv('S3_ATTEMPT_FILE');
$resultPath = (string) getenv('S3_RESULT_FILE');
file_put_contents($readyPath, json_encode([
    'connection_id' => (int) $identity->connection_id,
    'database_name' => $identity->database_name,
    'port' => (string) $identity->port,
    'data_directory' => realpath((string) $identity->data_directory),
    'socket' => realpath((string) $identity->socket),
    'account_name' => $identity->account_name,
], JSON_THROW_ON_ERROR));

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
    $membership = TenantMembership::query()->findOrFail((int) getenv('S3_MEMBERSHIP_ID'));
    $employee = Employee::query()->findOrFail((int) getenv('S3_EMPLOYEE_ID'));
    if (getenv('S3_OPERATION') === 'notification_dispatch') {
        app(PlannerNotificationService::class)->remindDue(CarbonImmutable::parse((string) getenv('S5_NOW')));
        app(PlannerNotificationService::class)->dispatch();
    } elseif (getenv('S3_OPERATION') === 'shift_change_accept') {
        app(ShiftChangeService::class)->respond($membership, (int) getenv('S3_REQUEST_ID'), 'accept');
    } elseif (getenv('S3_OPERATION') === 'planner_publish') {
        app(WeeklyPlannerService::class)->publish($membership, (int) getenv('S3_OUTLET_ID'), (string) getenv('S3_EFFECTIVE_FROM'), [
            'expected_version' => 1, 'expected_published_revision_id' => null, 'activate_cutover' => true, 'reason' => 'Concurrent publication', 'warnings_checksum' => (string) getenv('S3_WARNINGS_CHECKSUM'),
        ], (string) getenv('S3_KEY'));
    } elseif (getenv('S3_OPERATION') === 'exception') {
        app(EmployeeScheduleService::class)->createException(
            $membership, (int) $employee->getKey(), (int) getenv('S3_OUTLET_ID'),
            (string) getenv('S3_WORK_DATE'), 'work', (int) getenv('S3_SHIFT_VERSION_ID'), 'Concurrent exception test.',
        );
    } else {
        app(EmployeeScheduleService::class)->createWeeklyRule(
            $membership,
            (int) $employee->getKey(),
            (int) getenv('S3_OUTLET_ID'),
            (int) getenv('S3_WEEKDAY'),
            (int) getenv('S3_SHIFT_VERSION_ID'),
            (string) getenv('S3_EFFECTIVE_FROM'),
            null,
            'Concurrent schedule test.',
        );
    }
    $status = 'created';
} catch (ValidationException) {
    $status = 'conflict';
} catch (HttpException $exception) {
    if ($exception->getStatusCode() !== 409) {
        throw $exception;
    }
    $status = 'conflict';
} catch (QueryException $exception) {
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
