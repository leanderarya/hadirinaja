<?php

use App\Support\EmployeeUatDatabaseGuard;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__).'/vendor/autoload.php';

$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

try {
    $identity = EmployeeUatDatabaseGuard::assertTarget();
    printf(
        "TARGET PASS database=%s port=%d uuid=%s version=%s datadir=%s socket=%s binlog=%s/%s trust_creators=%s account=%s grants=%s\n",
        $identity['database'],
        $identity['port'],
        $identity['server_uuid'],
        $identity['server_version'],
        $identity['data_directory'],
        $identity['socket'],
        $identity['log_bin'] ? 'ON' : 'OFF',
        $identity['binlog_format'],
        $identity['trust_trigger_creators'] ? 'ON' : 'OFF',
        $identity['authenticated_account'],
        implode(';', $identity['grant_scopes']),
    );

    $arguments = array_slice($argv, 1);
    if (in_array('--schema', $arguments, true)) {
        $migrationFiles = glob(dirname(__DIR__).'/database/migrations/*.php') ?: [];
        $expectedMigrations = array_map(
            static fn (string $path): string => basename($path, '.php'),
            $migrationFiles,
        );
        sort($expectedMigrations);
        $appliedMigrations = DB::table('migrations')->orderBy('migration')->pluck('migration')->all();
        sort($appliedMigrations);

        if ($appliedMigrations !== $expectedMigrations) {
            throw new RuntimeException(sprintf(
                'Migration mismatch: expected %d migration rows, found %d.',
                count($expectedMigrations),
                count($appliedMigrations),
            ));
        }

        $expectedTriggers = [
            'attendance_event_checkout_contract',
            'attendance_event_checkout_immutable',
            'attendance_event_checkout_no_delete',
            'attendance_idem_checkout_immutable',
            'attendance_event_verified_checkout_contract',
            'attendance_idem_verified_checkout_immutable',
            'attendance_event_verified_kiosk_checkout_contract',
            'attendance_idem_verified_kiosk_checkout_immutable',
        ];
        $actualTriggers = array_map(
            static fn (object $trigger): string => (string) $trigger->trigger_name,
            DB::select(
                'SELECT TRIGGER_NAME AS trigger_name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME',
            ),
        );
        sort($expectedTriggers);

        if ($actualTriggers !== $expectedTriggers) {
            throw new RuntimeException(sprintf(
                'Trigger mismatch: expected %d named triggers, found %d.',
                count($expectedTriggers),
                count($actualTriggers),
            ));
        }

        printf("SCHEMA PASS migrations=%d triggers=%d\n", count($appliedMigrations), count($actualTriggers));
    }

    if (in_array('--fixtures', $arguments, true)) {
        $db = DB::connection('mysql');
        $checkInUserId = $db->table('users')->where('email', 'uat.checkin@example.test')->value('id');
        $checkOutEmployeeId = $db->table('employees')->where('name', 'Employee UAT Checkout')->value('id');
        $checkInEmployeeId = $db->table('employees')->where('name', 'Employee UAT Check-in')->value('id');
        $foreignEmployeeId = $db->table('employees')->where('name', 'Employee UAT Foreign')->value('id');

        if ($checkInUserId === null || $checkOutEmployeeId === null
            || $checkInEmployeeId === null || $foreignEmployeeId === null
        ) {
            throw new RuntimeException('Employee UAT fixture identities were not found.');
        }

        $assignmentOutletCounts = [];
        foreach ([$checkInEmployeeId, $checkOutEmployeeId] as $employeeId) {
            $assignmentOutletCounts[] = $db->table('employee_outlet_assignments')
                ->where('employee_id', $employeeId)->distinct()->count('outlet_id');
        }

        $publishedWeeks = $db->table('schedule_weeks')->whereNotNull('published_revision_id')->count();
        $activeSessions = $db->table('attendance_sessions')
            ->where('employee_id', $checkOutEmployeeId)->where('status', 'active')->count();
        $activeOwners = $db->table('attendance_active_session_owners')->count();
        $evidenceTombstones = $db->table('attendance_evidence')->where('lifecycle_state', 'expired')->count();
        $requestStatuses = $db->table('approval_requests')
            ->where('requester_user_id', $checkInUserId)->pluck('status')->unique()->sort()->values()->all();
        $foreignRequestId = $db->table('approval_requests')->where('employee_id', $foreignEmployeeId)->value('id');
        $foreignRequestVisible = $db->table('approval_requests')
            ->where('tenant_id', $db->table('tenants')->where('name', 'HadirinAja Employee UAT')->value('id'))
            ->where('id', $foreignRequestId)->exists();

        if ($assignmentOutletCounts !== [1, 1] || $publishedWeeks < 1 || $activeSessions !== 1
            || $activeOwners !== 1 || $evidenceTombstones !== 1
            || $requestStatuses !== ['approved', 'pending', 'rejected'] || $foreignRequestId === null
            || $foreignRequestVisible
        ) {
            throw new RuntimeException('Employee UAT fixture contents did not pass their deterministic checks.');
        }

        printf(
            "FIXTURES PASS assignment_outlets=%d,%d published_weeks=%d checkout_active_sessions=%d active_owners=%d expired_evidence=%d checkin_request_statuses=%s foreign_request_visible=no\n",
            $assignmentOutletCounts[0],
            $assignmentOutletCounts[1],
            $publishedWeeks,
            $activeSessions,
            $activeOwners,
            $evidenceTombstones,
            implode(',', $requestStatuses),
        );
    }
} catch (Throwable $exception) {
    fwrite(STDERR, 'TARGET FAIL: '.$exception->getMessage().PHP_EOL);
    exit(1);
}
