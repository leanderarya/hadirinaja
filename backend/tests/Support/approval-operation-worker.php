<?php

use App\Data\AttendanceActor;
use App\Models\Employee;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\ApprovalWorkflowService;
use App\Services\AttendanceService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$backend = dirname(__DIR__, 2);
chdir($backend);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$connectionId = (int) DB::selectOne('SELECT CONNECTION_ID() AS id')->id;
file_put_contents((string) getenv('S5_READY_FILE'), json_encode(['connection_id' => $connectionId], JSON_THROW_ON_ERROR));
$startFile = (string) getenv('S5_START_FILE');
$deadline = microtime(true) + 15;
while (! is_file($startFile) && microtime(true) < $deadline) {
    usleep(5_000);
}
if (! is_file($startFile)) {
    throw new RuntimeException('Approval worker did not receive the concurrency release signal.');
}

file_put_contents((string) getenv('S5_ATTEMPT_FILE'), 'started');
$tenantId = (int) getenv('S5_TENANT_ID');
$employee = Employee::query()->forTenant($tenantId)->whereKey((int) getenv('S5_EMPLOYEE_ID'))->firstOrFail();
$membership = TenantMembership::query()->forTenant($tenantId)->whereKey((int) getenv('S5_MEMBERSHIP_ID'))->firstOrFail();
$user = User::query()->whereKey((int) getenv('S5_USER_ID'))->firstOrFail();
$operation = (string) getenv('S5_OPERATION');

try {
    if ($operation === 'decide') {
        $result = app(ApprovalWorkflowService::class)->decide(
            $membership,
            $user,
            (int) getenv('S5_REQUEST_ID'),
            (string) getenv('S5_DECISION'),
            (string) getenv('S5_REASON'),
            (string) getenv('S5_IDEMPOTENCY_KEY'),
        );
        $output = ['outcome' => 'decided', 'status' => $result->status];
    } elseif ($operation === 'cancel') {
        $result = app(ApprovalWorkflowService::class)->cancel(
            $membership, $user, (int) getenv('S5_REQUEST_ID'), (string) getenv('S5_IDEMPOTENCY_KEY'),
        );
        $output = ['outcome' => 'cancelled', 'status' => $result->status];
    } elseif ($operation === 'check_out') {
        $result = app(AttendanceService::class)->checkOut(
            AttendanceActor::personal($membership), $employee, (string) getenv('S5_IDEMPOTENCY_KEY'),
            ['status' => 'provided', 'latitude' => -6.2, 'longitude' => 106.816666, 'accuracy_meters' => 20], null,
        );
        $output = [
            'outcome' => 'attendance',
            'http_status' => $result['status'],
            'code' => $result['body']['code'] ?? null,
        ];
    } else {
        throw new InvalidArgumentException('Unsupported S5 worker operation.');
    }
} catch (ValidationException) {
    $output = ['outcome' => 'conflict'];
} catch (AuthorizationException) {
    $output = ['outcome' => 'forbidden'];
} catch (Throwable $exception) {
    file_put_contents((string) getenv('S5_RESULT_FILE'), json_encode([
        'outcome' => 'error', 'class' => $exception::class, 'message' => $exception->getMessage(),
        'connection_id' => $connectionId,
    ], JSON_THROW_ON_ERROR));
    throw $exception;
}

$output['connection_id'] = $connectionId;
file_put_contents((string) getenv('S5_RESULT_FILE'), json_encode($output, JSON_THROW_ON_ERROR));
