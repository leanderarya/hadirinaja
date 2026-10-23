<?php

namespace App\Services;

use App\Data\AttendanceActor;
use App\Data\EffectiveScheduleResult;
use App\Data\PreparedAttendanceEvidence;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceIdempotencyRecord;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeePinCredential;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\TenantMembership;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class AttendanceService
{
    public function __construct(
        private readonly EffectiveScheduleResolver $schedules,
        private readonly AttendancePolicyService $policies,
        private readonly AttendanceEvidenceStorage $evidenceStorage,
    ) {}

    /** @return array<string, mixed> */
    public function current(TenantMembership $membership, Employee $employee, ?int $requestedOutletId = null): array
    {
        $tenantId = (int) $membership->tenant_id;
        $employeeId = (int) $employee->getKey();
        $now = CarbonImmutable::now('UTC');
        $assignments = EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('employee_id', $employeeId)
            ->where('effective_from', '<=', $now->format('Y-m-d H:i:s'))
            ->where('effective_until', '>', $now->format('Y-m-d H:i:s'))
            ->with('outlet')
            ->get();
        $outletIds = $assignments->pluck('outlet_id')->map(fn ($id): int => (int) $id)->unique()->values();

        if ($requestedOutletId !== null && ! $outletIds->contains($requestedOutletId)) {
            throw new AuthorizationException('Outlet attendance access is not available.');
        }

        $outlets = Outlet::query()->forTenant($tenantId)->whereIn('id', $outletIds)->orderBy('name')->get();
        $owner = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $tenantId)->where('employee_id', $employeeId)->first();
        $active = $owner
            ? AttendanceSession::query()->forTenant($tenantId)->with('outlet')->whereKey($owner->attendance_session_id)->first()
            : null;

        if ($owner && (! $active || $active->status !== 'active')) {
            throw new \LogicException('The active-session ownership row is inconsistent.');
        }

        $schedule = null;
        $selectedOutlet = null;

        if ($active) {
            $schedule = $active->schedule_snapshot;
            $selectedOutlet = (int) $active->outlet_id;
        } else {
            $selectedOutlet = $requestedOutletId;

            if ($selectedOutlet === null && $outletIds->isNotEmpty()) {
                $unspecified = $this->resolveToday($tenantId, $employeeId, null);
                $selectedOutlet = $unspecified->outletId !== null && $outletIds->contains($unspecified->outletId)
                    ? $unspecified->outletId
                    : (int) $outletIds->first();
            }

            if ($selectedOutlet !== null) {
                $schedule = $this->resolveToday($tenantId, $employeeId, $selectedOutlet)->toArray();
            }
        }

        $history = AttendanceSession::query()->forTenant($tenantId)->with('outlet')
            ->where('employee_id', $employeeId)
            ->orderByDesc('check_in_at')->limit(10)->get()
            ->map(fn (AttendanceSession $session): array => $this->sessionData($session, false))
            ->values();

        if ($active) {
            $activeData = $this->sessionData($active, false);
            $activeData['review_indicators'] = $this->effectiveReviewIndicators($active);
        } else {
            $activeData = null;
        }

        if ($active) {
            $timezone = (string) ($active->schedule_snapshot['timezone'] ?? 'UTC');
            $effectivePolicy = $this->policies->effective(
                $tenantId,
                (int) $active->outlet_id,
                $now->setTimezone($timezone)->toDateString(),
            );
            $effectiveConfiguration = $effectivePolicy['configuration'] ?? null;
        } else {
            $effectiveConfiguration = $schedule['policy']['effective'] ?? null;
        }

        $locationPolicy = is_array($effectiveConfiguration)
            ? ($effectiveConfiguration['personal_location_validation'] ?? [])
            : [];

        return [
            'server_time' => $this->iso($now),
            'employee' => ['id' => $employeeId, 'name' => $employee->name],
            'outlets' => $outlets->map(fn (Outlet $outlet): array => [
                'id' => (int) $outlet->getKey(),
                'name' => $outlet->name,
            ])->values(),
            'selected_outlet_id' => $selectedOutlet,
            'schedule' => $schedule === null ? null : $this->publicSchedule($schedule),
            'active_session' => $activeData,
            'allowed_next_operation' => is_array($effectiveConfiguration)
                && $this->modeAllows($effectiveConfiguration, 'personal')
                ? ($active ? 'check_out' : 'check_in')
                : null,
            'personal_location' => [
                'required' => (bool) ($locationPolicy['required'] ?? false),
                'radius_meters' => isset($locationPolicy['radius_meters']) ? (int) $locationPolicy['radius_meters'] : null,
                'geofence_configured' => isset($locationPolicy['latitude'], $locationPolicy['longitude']),
            ],
            'recent_history' => $history,
        ];
    }

    /** @return array{status: int, body: array<string, mixed>} */
    public function checkIn(
        AttendanceActor $actor,
        Employee $employee,
        Outlet $outlet,
        string $key,
        ?array $location,
        ?UploadedFile $photo,
    ): array {
        return $this->mutate($actor, $employee, 'check_in', $key, $outlet, $location, $photo);
    }

    /** @return array{status: int, body: array<string, mixed>} */
    public function checkOut(
        AttendanceActor $actor,
        Employee $employee,
        string $key,
        ?array $location,
        ?UploadedFile $photo,
    ): array {
        return $this->mutate($actor, $employee, 'check_out', $key, null, $location, $photo);
    }

    /** @return array<string, mixed> */
    public function operationStatus(AttendanceActor $actor, int $employeeId, string $operation, string $key): array
    {
        $record = $this->idempotencyQuery($actor, $employeeId, $operation, $key)->first();

        if (! $record) {
            return ['state' => 'not_found', 'operation' => $operation];
        }

        if ($record->status === 'pending' || $record->response_body === null) {
            return ['state' => 'pending', 'operation' => $operation];
        }

        return [
            'state' => $record->status,
            'operation' => $operation,
            'result' => $record->response_body,
        ];
    }

    /** @return array{eligible: bool, next_operation: string|null, reason: string|null} */
    public function kioskNextOperation(KioskDevice $device, int $employeeId): array
    {
        $tenantId = (int) $device->tenant_id;
        $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->first();

        if (! $employee) {
            return ['eligible' => false, 'next_operation' => null, 'reason' => 'employee_unavailable'];
        }

        $now = CarbonImmutable::now('UTC');
        $activeOwner = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $tenantId)->where('employee_id', $employeeId)->first();

        if ($activeOwner) {
            $session = AttendanceSession::query()->forTenant($tenantId)->whereKey($activeOwner->attendance_session_id)->first();

            if (! $session || $session->status !== 'active') {
                throw new \LogicException('The active-session ownership row is inconsistent.');
            }

            if ((int) $session->outlet_id !== (int) $device->outlet_id) {
                return ['eligible' => false, 'next_operation' => null, 'reason' => 'session_at_origin_outlet'];
            }

            $timezone = (string) ($session->schedule_snapshot['timezone'] ?? 'UTC');
            $policy = $this->policies->effective($tenantId, (int) $session->outlet_id, $now->setTimezone($timezone)->toDateString());
            $configuration = $policy['configuration'] ?? null;

            return [
                'eligible' => is_array($configuration) && $this->modeAllows($configuration, 'kiosk'),
                'next_operation' => is_array($configuration) && $this->modeAllows($configuration, 'kiosk') ? 'check_out' : null,
                'reason' => is_array($configuration) && $this->modeAllows($configuration, 'kiosk') ? null : 'mode_not_allowed',
            ];
        }

        if (! $this->isAssignedAt($tenantId, $employeeId, (int) $device->outlet_id, $now)) {
            return ['eligible' => false, 'next_operation' => null, 'reason' => 'employee_unavailable'];
        }

        $schedule = $this->resolveForCheckIn($tenantId, $employeeId, (int) $device->outlet_id, $now);
        $configuration = $schedule->policy;
        $allowed = is_array($configuration) && $this->modeAllows($configuration, 'kiosk');

        return [
            'eligible' => $allowed,
            'next_operation' => $allowed ? 'check_in' : null,
            'reason' => $allowed ? null : 'mode_not_allowed',
        ];
    }

    /** @return list<array<string, mixed>> */
    public function kioskEmployees(KioskDevice $device): array
    {
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s');
        $tenantId = (int) $device->tenant_id;
        $employeeIds = EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('outlet_id', $device->outlet_id)
            ->where('effective_from', '<=', $now)
            ->where('effective_until', '>', $now)
            ->distinct()->pluck('employee_id');
        $activeSessionEmployeeIds = DB::table('attendance_active_session_owners as owners')
            ->join('attendance_sessions as sessions', function ($join): void {
                $join->on('sessions.tenant_id', '=', 'owners.tenant_id')
                    ->on('sessions.employee_id', '=', 'owners.employee_id')
                    ->on('sessions.id', '=', 'owners.attendance_session_id');
            })
            ->where('owners.tenant_id', $tenantId)
            ->where('sessions.outlet_id', $device->outlet_id)
            ->where('sessions.status', 'active')
            ->pluck('owners.employee_id');
        $employeeIds = $employeeIds->merge($activeSessionEmployeeIds)->unique()->values();

        $enrolledIds = EmployeePinCredential::query()->forTenant($tenantId)
            ->whereIn('employee_id', $employeeIds)->pluck('employee_id');

        return Employee::query()->forTenant($tenantId)->whereIn('id', $enrolledIds)
            ->orderBy('name')->get()->map(fn (Employee $employee): array => [
                'id' => (int) $employee->getKey(),
                'name' => $employee->name,
            ])->values()->all();
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function mutate(
        AttendanceActor $actor,
        Employee $employee,
        string $operation,
        string $key,
        ?Outlet $requestedOutlet,
        ?array $location,
        ?UploadedFile $photo,
    ): array {
        if ((int) $employee->tenant_id !== $actor->tenantId) {
            throw new AuthorizationException('Employee attendance access is not available.');
        }

        if (($actor->origin === 'kiosk') !== ($photo !== null)) {
            throw ValidationException::withMessages(['photo' => 'Foto baru wajib disertakan untuk setiap operasi kiosk.']);
        }

        if ($actor->origin === 'personal' && $location === null) {
            $location = ['status' => 'unavailable'];
        }

        $normalizedLocation = $this->normalizeLocation($location);
        $prepared = $photo ? $this->evidenceStorage->prepare($photo, $actor->tenantId) : null;
        $outletId = $requestedOutlet ? (int) $requestedOutlet->getKey() : null;
        $requestHash = $this->requestHash($actor, $employee, $operation, $outletId, $normalizedLocation, $prepared);

        try {
            $record = $this->idempotencyQuery($actor, (int) $employee->getKey(), $operation, $key)->first();
            if (! $record) {
                try {
                    $record = DB::transaction(fn (): AttendanceIdempotencyRecord => AttendanceIdempotencyRecord::query()->create([
                        'tenant_id' => $actor->tenantId,
                        'employee_id' => $employee->getKey(),
                        'tenant_membership_id' => $actor->tenantMembershipId,
                        'kiosk_device_id' => $actor->kioskDeviceId,
                        'operation' => $operation,
                        'idempotency_key' => $key,
                        'request_hash' => $requestHash,
                        'status' => 'pending',
                    ]));
                } catch (QueryException $exception) {
                    if (! $this->isDuplicateKey($exception)) {
                        throw $exception;
                    }
                    $record = $this->idempotencyQuery($actor, (int) $employee->getKey(), $operation, $key)->first();
                    if (! $record) {
                        throw $exception;
                    }
                }
            }

            if (! hash_equals($record->request_hash, $requestHash) || $record->status !== 'pending') {
                return $this->replay($record, $requestHash);
            }

            return DB::transaction(function () use (
                $actor, $employee, $operation, $key, $requestedOutlet, $normalizedLocation, $prepared, $requestHash,
            ): array {
                $record = $this->idempotencyQuery($actor, (int) $employee->getKey(), $operation, $key, true)->first();
                if (! $record) {
                    throw new \LogicException('The durable attendance idempotency record disappeared.');
                }
                if (! hash_equals($record->request_hash, $requestHash) || $record->status !== 'pending') {
                    return $this->replay($record, $requestHash);
                }

                $device = $actor->origin === 'kiosk' ? $this->lockActiveDevice($actor) : null;
                $lockedEmployee = Employee::query()->forTenant($actor->tenantId)
                    ->whereKey($employee->getKey())->lockForUpdate()->first();

                if (! $lockedEmployee) {
                    throw new AuthorizationException('Employee attendance access is not available.');
                }

                return $operation === 'check_in'
                    ? $this->performCheckIn($record, $actor, $lockedEmployee, $requestedOutlet, $device, $normalizedLocation, $prepared)
                    : $this->performCheckOut($record, $actor, $lockedEmployee, $device, $normalizedLocation, $prepared);
            }, attempts: 3);
        } finally {
            if ($prepared) {
                $this->evidenceStorage->cleanup($prepared);
            }
        }
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function performCheckIn(
        AttendanceIdempotencyRecord $record,
        AttendanceActor $actor,
        Employee $employee,
        ?Outlet $requestedOutlet,
        ?KioskDevice $device,
        array $location,
        ?PreparedAttendanceEvidence $prepared,
    ): array {
        $now = CarbonImmutable::now('UTC');
        $outletId = $actor->origin === 'kiosk' ? (int) $device?->outlet_id : (int) $requestedOutlet?->getKey();
        $outlet = $outletId > 0
            ? Outlet::query()->forTenant($actor->tenantId)->whereKey($outletId)->first()
            : null;

        if (! $outlet || ($requestedOutlet && (int) $requestedOutlet->tenant_id !== $actor->tenantId)) {
            return $this->reject($record, 403, 'outlet_unavailable', 'Outlet tidak tersedia untuk operasi ini.');
        }

        $active = $this->activeSession($actor->tenantId, (int) $employee->getKey());
        if ($active) {
            return $this->reject($record, 409, 'attendance_already_active', 'Masih ada sesi kehadiran yang belum ditutup.');
        }

        if (! $this->isAssignedAt($actor->tenantId, (int) $employee->getKey(), $outletId, $now)) {
            return $this->reject($record, 403, 'outlet_assignment_required', 'Karyawan tidak memiliki penugasan aktif di outlet ini.');
        }

        $schedule = $this->resolveForCheckIn($actor->tenantId, (int) $employee->getKey(), $outletId, $now);
        $policy = $schedule->policy;

        if (! is_array($policy) || ! $this->modeAllows($policy, $actor->origin)) {
            return $this->reject($record, 403, 'attendance_mode_not_allowed', 'Mode kehadiran ini tidak diizinkan oleh kebijakan outlet.');
        }

        $locationResult = $actor->origin === 'personal'
            ? $this->evaluateLocation($location, $policy)
            : $this->emptyLocationResult();
        $indicators = $this->scheduleIndicators($schedule, $now, $policy);
        $indicators = $this->mergeIndicators($indicators, $locationResult['review_indicators']);
        $scheduleSnapshot = $schedule->toArray();
        $policySnapshot = $this->policySnapshot($schedule, $policy, $now);
        $assignment = $this->activeAssignment($actor->tenantId, (int) $employee->getKey(), $outletId, $now);

        $session = AttendanceSession::query()->create([
            'tenant_id' => $actor->tenantId,
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outletId,
            'work_date' => $schedule->workDate,
            'status' => 'active',
            'check_in_at' => $now->format('Y-m-d H:i:s'),
            'schedule_snapshot' => $scheduleSnapshot,
            'policy_snapshot' => $policySnapshot,
            'assignment_snapshot' => $this->assignmentSnapshot($assignment),
            'review_indicators' => $indicators,
        ]);

        DB::table('attendance_active_session_owners')->insert([
            'tenant_id' => $actor->tenantId,
            'employee_id' => $employee->getKey(),
            'attendance_session_id' => $session->getKey(),
            'created_at' => $now->format('Y-m-d H:i:s'),
        ]);

        $event = $this->createEvent(
            $record, $actor, $employee, $session, 'check_in', $now, $locationResult, $scheduleSnapshot,
            $policySnapshot, $indicators,
        );
        if ($prepared) {
            $this->persistEvidence($prepared, $session, $event);
        }

        return $this->complete($record, 201, $this->successBody($record, $session, $event, 'check_in'));
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function performCheckOut(
        AttendanceIdempotencyRecord $record,
        AttendanceActor $actor,
        Employee $employee,
        ?KioskDevice $device,
        array $location,
        ?PreparedAttendanceEvidence $prepared,
    ): array {
        $tenantId = $actor->tenantId;
        $employeeId = (int) $employee->getKey();
        $owner = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $tenantId)->where('employee_id', $employeeId)->first();

        if (! $owner) {
            return $this->reject($record, 409, 'no_active_attendance', 'Tidak ada sesi kehadiran aktif untuk ditutup.');
        }

        $session = AttendanceSession::query()->forTenant($tenantId)
            ->whereKey($owner->attendance_session_id)->lockForUpdate()->first();

        if (! $session || $session->status !== 'active' || (int) $session->employee_id !== $employeeId) {
            throw new \LogicException('The active-session ownership row is inconsistent.');
        }

        if ($actor->origin === 'kiosk' && (int) $session->outlet_id !== (int) $device?->outlet_id) {
            return $this->reject($record, 409, 'session_at_origin_outlet', 'Sesi ini hanya dapat ditutup melalui kiosk outlet asal.');
        }

        $now = CarbonImmutable::now('UTC');
        $timezone = (string) ($session->schedule_snapshot['timezone'] ?? 'UTC');
        $localDate = $now->setTimezone($timezone)->toDateString();
        $policy = $this->policies->effective($tenantId, (int) $session->outlet_id, $localDate);
        $configuration = $policy['configuration'] ?? null;

        if (! is_array($configuration) || ! $this->modeAllows($configuration, $actor->origin)) {
            return $this->reject($record, 403, 'attendance_mode_not_allowed', 'Mode kehadiran ini tidak diizinkan oleh kebijakan outlet.');
        }

        $checkIn = CarbonImmutable::parse($session->check_in_at, 'UTC')->utc();
        if ($now->lessThan($checkIn)) {
            return $this->reject($record, 409, 'server_time_inconsistent', 'Waktu server belum konsisten; sesi belum dapat ditutup.');
        }

        if ($actor->origin === 'kiosk' && $prepared
            && AttendanceEvidence::query()->where('tenant_id', $tenantId)
                ->where('attendance_session_id', $session->getKey())->where('sha256', $prepared->sha256)->exists()) {
            return $this->reject($record, 422, 'photo_must_be_new', 'Ambil foto baru untuk setiap operasi kehadiran kiosk.');
        }

        $locationResult = $actor->origin === 'personal'
            ? $this->evaluateLocation($location, $configuration)
            : $this->emptyLocationResult();
        $indicators = $session->review_indicators ?? [];
        $indicators = $this->mergeIndicators($indicators, $locationResult['review_indicators']);
        $scheduledEnd = $session->schedule_snapshot['scheduled_end'] ?? null;
        $tolerance = (int) ($configuration['late_tolerance_minutes'] ?? 0);

        if ($scheduledEnd !== null) {
            $end = CarbonImmutable::parse($scheduledEnd)->utc();
            if ($now->lessThan($end->subMinutes($tolerance))) {
                $indicators = $this->mergeIndicators($indicators, ['early_departure']);
            } elseif ($now->greaterThan($end->addMinutes($tolerance))) {
                $indicators = $this->mergeIndicators($indicators, ['late_checkout']);
            }
        }

        $policySnapshot = [
            'effective_at' => $this->iso($now),
            'effective_local_date' => $localDate,
            'tenant_version_id' => $policy['tenant_version_id'],
            'outlet_version_id' => $policy['outlet_version_id'],
            'configuration' => $configuration,
        ];

        $event = $this->createEvent(
            $record, $actor, $employee, $session, 'check_out', $now, $locationResult,
            $session->schedule_snapshot, $policySnapshot, $indicators,
        );
        if ($prepared) {
            $this->persistEvidence($prepared, $session, $event);
        }

        $session->forceFill([
            'status' => 'closed',
            'check_out_at' => $now->format('Y-m-d H:i:s'),
            'review_indicators' => $indicators,
        ])->save();

        $released = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $tenantId)->where('employee_id', $employeeId)
            ->where('attendance_session_id', $session->getKey())->delete();

        if ($released !== 1) {
            throw new \LogicException('The active-session ownership row could not be released.');
        }

        return $this->complete($record, 200, $this->successBody($record, $session, $event, 'check_out'));
    }

    private function createEvent(
        AttendanceIdempotencyRecord $record,
        AttendanceActor $actor,
        Employee $employee,
        AttendanceSession $session,
        string $eventType,
        CarbonImmutable $recordedAt,
        array $location,
        array $scheduleSnapshot,
        array $policySnapshot,
        array $indicators,
    ): AttendanceEvent {
        return AttendanceEvent::query()->create([
            'tenant_id' => $actor->tenantId,
            'employee_id' => $employee->getKey(),
            'attendance_session_id' => $session->getKey(),
            'idempotency_record_id' => $record->getKey(),
            'outlet_id' => $session->outlet_id,
            ...$actor->eventColumns(),
            'event_type' => $eventType,
            'origin' => $actor->origin,
            'recorded_at' => $recordedAt->format('Y-m-d H:i:s'),
            'location_capture_status' => $location['capture_status'],
            'location_verdict' => $location['verdict'],
            'location_latitude' => $location['latitude'],
            'location_longitude' => $location['longitude'],
            'location_accuracy_meters' => $location['accuracy_meters'],
            'context_snapshot' => [
                'schedule' => $scheduleSnapshot,
                'policy' => $policySnapshot,
                'review_indicators' => $indicators,
            ],
            'created_at' => $recordedAt->format('Y-m-d H:i:s'),
        ]);
    }

    private function persistEvidence(
        PreparedAttendanceEvidence $prepared,
        AttendanceSession $session,
        AttendanceEvent $event,
    ): void {
        $this->evidenceStorage->commit($prepared);

        AttendanceEvidence::query()->create([
            'tenant_id' => $event->tenant_id,
            'attendance_session_id' => $session->getKey(),
            'attendance_event_id' => $event->getKey(),
            'evidence_type' => 'kiosk_photo',
            'storage_path' => $prepared->storagePath,
            'detected_mime_type' => $prepared->detectedMimeType,
            'stored_mime_type' => 'image/jpeg',
            'stored_size_bytes' => $prepared->storedSizeBytes,
            'image_width' => $prepared->width,
            'image_height' => $prepared->height,
            'sha256' => $prepared->sha256,
            'validation_status' => 'validated_normalized',
            'received_at' => now('UTC')->format('Y-m-d H:i:s'),
        ]);
    }

    private function resolveForCheckIn(int $tenantId, int $employeeId, int $outletId, CarbonImmutable $now): EffectiveScheduleResult
    {
        $seed = $this->schedules->resolve($tenantId, $employeeId, $now->toDateString(), $outletId);
        $localDate = $now->setTimezone($seed->timezone)->toDateString();
        $today = $this->schedules->resolve($tenantId, $employeeId, $localDate, $outletId);
        $stableDate = $now->setTimezone($today->timezone)->toDateString();

        if ($stableDate !== $today->workDate) {
            $today = $this->schedules->resolve($tenantId, $employeeId, $stableDate, $outletId);
        }

        $candidates = [
            $this->schedules->resolve($tenantId, $employeeId, CarbonImmutable::parse($today->workDate, 'UTC')->subDay()->toDateString(), $outletId),
            $today,
            $this->schedules->resolve($tenantId, $employeeId, CarbonImmutable::parse($today->workDate, 'UTC')->addDay()->toDateString(), $outletId),
        ];
        $instantMatches = [];
        $earlyMatches = [];

        foreach ($candidates as $candidate) {
            if ($candidate->status !== 'scheduled' || $candidate->scheduledStart === null || $candidate->scheduledEnd === null) {
                continue;
            }

            $start = CarbonImmutable::parse($candidate->scheduledStart)->utc();
            $end = CarbonImmutable::parse($candidate->scheduledEnd)->utc();
            if ($now->greaterThanOrEqualTo($start) && $now->lessThanOrEqualTo($end)) {
                $instantMatches[] = [$candidate, $start];

                continue;
            }

            $earlyMinutes = (int) ($candidate->policy['check_in_window']['early_minutes'] ?? 0);
            if ($now->lessThan($start) && $now->greaterThanOrEqualTo($start->subMinutes($earlyMinutes))) {
                $earlyMatches[] = [$candidate, $start];
            }
        }

        if ($instantMatches !== []) {
            usort($instantMatches, fn (array $left, array $right): int => $right[1] <=> $left[1]);

            return $instantMatches[0][0];
        }

        if ($earlyMatches !== []) {
            usort($earlyMatches, fn (array $left, array $right): int => abs($left[1]->getTimestamp() - $now->getTimestamp()) <=> abs($right[1]->getTimestamp() - $now->getTimestamp()));

            return $earlyMatches[0][0];
        }

        return $today;
    }

    private function resolveToday(int $tenantId, int $employeeId, ?int $outletId): EffectiveScheduleResult
    {
        $now = CarbonImmutable::now('UTC');
        $seed = $this->schedules->resolve($tenantId, $employeeId, $now->toDateString(), $outletId);
        $localDate = $now->setTimezone($seed->timezone)->toDateString();
        $result = $this->schedules->resolve($tenantId, $employeeId, $localDate, $outletId);
        $stableDate = $now->setTimezone($result->timezone)->toDateString();

        return $stableDate === $result->workDate
            ? $result
            : $this->schedules->resolve($tenantId, $employeeId, $stableDate, $outletId);
    }

    private function activeSession(int $tenantId, int $employeeId): ?AttendanceSession
    {
        $owner = DB::table('attendance_active_session_owners')
            ->where('tenant_id', $tenantId)->where('employee_id', $employeeId)->first();

        if (! $owner) {
            return null;
        }

        $session = AttendanceSession::query()->forTenant($tenantId)->whereKey($owner->attendance_session_id)->first();
        if (! $session || $session->status !== 'active' || (int) $session->employee_id !== $employeeId) {
            throw new \LogicException('The active-session ownership row is inconsistent.');
        }

        return $session;
    }

    private function isAssignedAt(int $tenantId, int $employeeId, int $outletId, CarbonImmutable $at): bool
    {
        return EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('employee_id', $employeeId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $at->format('Y-m-d H:i:s'))
            ->where('effective_until', '>', $at->format('Y-m-d H:i:s'))->exists();
    }

    private function activeAssignment(int $tenantId, int $employeeId, int $outletId, CarbonImmutable $at): ?EmployeeOutletAssignment
    {
        return EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('employee_id', $employeeId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $at->format('Y-m-d H:i:s'))
            ->where('effective_until', '>', $at->format('Y-m-d H:i:s'))
            ->orderByDesc('effective_from')->first();
    }

    private function lockActiveDevice(AttendanceActor $actor): KioskDevice
    {
        $device = KioskDevice::query()->forTenant($actor->tenantId)
            ->whereKey($actor->kioskDeviceId)->lockForUpdate()->first();

        if (! $device || $device->revoked_at !== null) {
            throw new AuthorizationException('Kiosk attendance access is not available.');
        }

        return $device;
    }

    /** @return array{status: string, latitude: float|null, longitude: float|null, accuracy_meters: float|null} */
    private function normalizeLocation(?array $location): array
    {
        $status = $location['status'] ?? 'unavailable';

        if (! in_array($status, ['provided', 'unavailable', 'permission_denied'], true)) {
            throw ValidationException::withMessages(['location.status' => 'Status lokasi tidak valid.']);
        }

        if ($status !== 'provided') {
            return ['status' => $status, 'latitude' => null, 'longitude' => null, 'accuracy_meters' => null];
        }

        if (! isset($location['latitude'], $location['longitude'], $location['accuracy_meters'])) {
            throw ValidationException::withMessages(['location' => 'Koordinat dan akurasi lokasi belum lengkap.']);
        }

        $latitude = round((float) $location['latitude'], 7);
        $longitude = round((float) $location['longitude'], 7);
        $accuracy = round((float) $location['accuracy_meters'], 2);

        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180 || $accuracy <= 0 || $accuracy > 50000) {
            throw ValidationException::withMessages(['location' => 'Koordinat atau akurasi lokasi berada di luar batas yang valid.']);
        }

        return ['status' => $status, 'latitude' => $latitude, 'longitude' => $longitude, 'accuracy_meters' => $accuracy];
    }

    /** @return array<string, mixed> */
    private function evaluateLocation(array $location, array $policy): array
    {
        $settings = $policy['personal_location_validation'] ?? [];
        if (! ($settings['required'] ?? false)) {
            return $this->emptyLocationResult();
        }

        $captureStatus = $location['status'];
        $verdict = null;
        $indicators = [];

        if ($captureStatus === 'permission_denied') {
            $verdict = 'permission_denied';
            $indicators[] = 'location_permission_denied';
        } elseif ($captureStatus !== 'provided') {
            $verdict = 'unavailable';
            $indicators[] = 'location_unavailable';
        } elseif (! isset($settings['latitude'], $settings['longitude'])) {
            $verdict = 'unconfigured';
            $indicators[] = 'location_geofence_unconfigured';
        } else {
            $radius = (float) ($settings['radius_meters'] ?? 0);
            $accuracy = (float) $location['accuracy_meters'];
            if ($accuracy > $radius) {
                $verdict = 'low_accuracy';
                $indicators[] = 'location_low_accuracy';
            } else {
                $distance = $this->distanceMeters(
                    (float) $settings['latitude'], (float) $settings['longitude'],
                    (float) $location['latitude'], (float) $location['longitude'],
                );
                if ($distance > $radius) {
                    $verdict = 'outside_range';
                    $indicators[] = 'location_outside_range';
                } else {
                    $verdict = 'verified';
                }
            }
        }

        return [
            'capture_status' => $captureStatus,
            'verdict' => $verdict,
            'latitude' => $location['latitude'],
            'longitude' => $location['longitude'],
            'accuracy_meters' => $location['accuracy_meters'],
            'review_indicators' => $indicators,
        ];
    }

    /** @return array<string, mixed> */
    private function emptyLocationResult(): array
    {
        return [
            'capture_status' => 'not_requested', 'verdict' => null,
            'latitude' => null, 'longitude' => null, 'accuracy_meters' => null,
            'review_indicators' => [],
        ];
    }

    private function distanceMeters(float $latitudeA, float $longitudeA, float $latitudeB, float $longitudeB): float
    {
        $earthRadius = 6_371_000.0;
        $latDelta = deg2rad($latitudeB - $latitudeA);
        $lonDelta = deg2rad($longitudeB - $longitudeA);
        $a = sin($latDelta / 2) ** 2
            + cos(deg2rad($latitudeA)) * cos(deg2rad($latitudeB)) * sin($lonDelta / 2) ** 2;

        return 2 * $earthRadius * asin(min(1, sqrt($a)));
    }

    /** @return list<string> */
    private function scheduleIndicators(EffectiveScheduleResult $schedule, CarbonImmutable $now, array $policy): array
    {
        $indicators = [];
        if ($schedule->status === 'unscheduled') {
            $indicators[] = 'unscheduled_work';
        } elseif ($schedule->status === 'rest') {
            $indicators[] = 'rest_day_work';
        }

        if ($schedule->outletOperating === false || in_array('outlet_closed', $schedule->conflicts, true)) {
            $indicators[] = 'outlet_closed';
        }
        if ($schedule->conflicts !== []) {
            $indicators[] = 'schedule_conflict';
        }

        if ($schedule->scheduledStart !== null) {
            $start = CarbonImmutable::parse($schedule->scheduledStart)->utc();
            $window = $policy['check_in_window'] ?? [];
            $early = (int) ($window['early_minutes'] ?? 0);
            $late = (int) ($window['late_minutes'] ?? 0);
            $tolerance = (int) ($policy['late_tolerance_minutes'] ?? 0);

            if ($now->lessThan($start->subMinutes($early)) || $now->greaterThan($start->addMinutes($late))) {
                $indicators[] = 'check_in_outside_window';
            }
            if ($now->greaterThan($start->addMinutes($tolerance))) {
                $indicators[] = 'late_arrival';
            }
        }

        return array_values(array_unique($indicators));
    }

    /** @return array<string, mixed> */
    private function policySnapshot(EffectiveScheduleResult $schedule, array $configuration, CarbonImmutable $now): array
    {
        return [
            'effective_at' => $this->iso($now),
            'effective_local_date' => $schedule->workDate,
            'tenant_version_id' => $schedule->tenantPolicyVersionId,
            'outlet_version_id' => $schedule->outletPolicyVersionId,
            'configuration' => $configuration,
        ];
    }

    /** @return array<string, mixed> */
    private function assignmentSnapshot(?EmployeeOutletAssignment $assignment): array
    {
        return $assignment ? [
            'id' => (int) $assignment->getKey(),
            'outlet_id' => (int) $assignment->outlet_id,
            'type' => $assignment->assignment_type->value,
            'effective_from' => $assignment->effective_from->utc()->toIso8601String(),
            'effective_until' => $assignment->effective_until->utc()->toIso8601String(),
        ] : [];
    }

    private function modeAllows(array $policy, string $origin): bool
    {
        $mode = $policy['attendance_mode'] ?? null;

        return $mode === 'hybrid' || $mode === $origin;
    }

    /** @return list<string> */
    private function mergeIndicators(array $left, array $right): array
    {
        return array_values(array_unique([...$left, ...$right]));
    }

    /** @return array<string, mixed> */
    private function publicSchedule(array $schedule): array
    {
        unset($schedule['policy']['effective']['personal_location_validation']['latitude']);
        unset($schedule['policy']['effective']['personal_location_validation']['longitude']);

        return $schedule;
    }

    /** @return list<string> */
    private function effectiveReviewIndicators(AttendanceSession $session): array
    {
        $indicators = $session->review_indicators ?? [];
        $scheduledEnd = $session->schedule_snapshot['scheduled_end'] ?? null;

        if ($session->status === 'active' && $scheduledEnd !== null
            && CarbonImmutable::now('UTC')->greaterThan(CarbonImmutable::parse($scheduledEnd)->utc())) {
            $indicators = $this->mergeIndicators($indicators, ['missing_checkout']);
        }

        return $indicators;
    }

    /** @return array<string, mixed> */
    private function sessionData(AttendanceSession $session, bool $includeEmployee): array
    {
        $data = [
            'id' => (int) $session->getKey(),
            'status' => $session->status,
            'work_date' => $session->work_date->toDateString(),
            'timezone' => (string) ($session->schedule_snapshot['timezone'] ?? 'UTC'),
            'check_in_at' => $this->iso(CarbonImmutable::parse($session->check_in_at, 'UTC')->utc()),
            'check_out_at' => $session->check_out_at ? $this->iso(CarbonImmutable::parse($session->check_out_at, 'UTC')->utc()) : null,
            'outlet' => [
                'id' => (int) $session->outlet_id,
                'name' => $session->outlet?->name,
            ],
            'review_indicators' => $this->effectiveReviewIndicators($session),
        ];

        if ($includeEmployee) {
            $data['employee'] = ['id' => (int) $session->employee_id, 'name' => $session->employee?->name];
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function successBody(
        AttendanceIdempotencyRecord $record,
        AttendanceSession $session,
        AttendanceEvent $event,
        string $operation,
    ): array {
        $session->loadMissing('outlet');

        return [
            'operation' => ['key' => $record->idempotency_key, 'state' => 'completed', 'type' => $operation],
            'event' => [
                'id' => (int) $event->getKey(),
                'type' => $event->event_type,
                'origin' => $event->origin,
                'recorded_at' => $this->iso(CarbonImmutable::parse($event->recorded_at, 'UTC')->utc()),
            ],
            'session' => $this->sessionData($session, false),
            'server_time' => $this->iso(CarbonImmutable::now('UTC')),
        ];
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function reject(AttendanceIdempotencyRecord $record, int $status, string $code, string $message): array
    {
        $body = [
            'code' => $code,
            'message' => $message,
            'operation' => [
                'key' => $record->idempotency_key,
                'type' => $record->operation,
                'state' => 'rejected',
            ],
        ];

        return $this->complete($record, $status, $body, 'rejected');
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function complete(AttendanceIdempotencyRecord $record, int $status, array $body, string $state = 'completed'): array
    {
        $record->forceFill([
            'status' => $state,
            'response_status' => $status,
            'response_body' => $body,
        ])->save();

        return ['status' => $status, 'body' => $body];
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function replay(AttendanceIdempotencyRecord $record, string $requestHash): array
    {
        if (! hash_equals($record->request_hash, $requestHash)) {
            return [
                'status' => 409,
                'body' => [
                    'code' => 'idempotency_key_conflict',
                    'message' => 'Kunci idempotensi sudah digunakan untuk permintaan yang berbeda.',
                    'operation' => ['key' => $record->idempotency_key, 'state' => 'rejected'],
                ],
            ];
        }

        if ($record->status === 'pending' || $record->response_status === null || $record->response_body === null) {
            return [
                'status' => 202,
                'body' => ['operation' => ['key' => $record->idempotency_key, 'type' => $record->operation, 'state' => 'pending']],
            ];
        }

        return ['status' => (int) $record->response_status, 'body' => $record->response_body];
    }

    private function idempotencyQuery(AttendanceActor $actor, int $employeeId, string $operation, string $key, bool $lock = false)
    {
        $query = AttendanceIdempotencyRecord::query()->forTenant($actor->tenantId)
            ->where('employee_id', $employeeId)->where('operation', $operation)->where('idempotency_key', $key);

        if ($actor->tenantMembershipId !== null) {
            $query->where('tenant_membership_id', $actor->tenantMembershipId);
        } else {
            $query->where('kiosk_device_id', $actor->kioskDeviceId);
        }

        return $lock ? $query->lockForUpdate() : $query;
    }

    private function requestHash(
        AttendanceActor $actor,
        Employee $employee,
        string $operation,
        ?int $outletId,
        array $location,
        ?PreparedAttendanceEvidence $prepared,
    ): string {
        return hash('sha256', json_encode([
            'tenant_id' => $actor->tenantId,
            'origin' => $actor->origin,
            'actor_id' => $actor->tenantMembershipId ?? $actor->kioskDeviceId,
            'employee_id' => (int) $employee->getKey(),
            'operation' => $operation,
            'outlet_id' => $outletId,
            'location' => $location,
            'photo_sha256' => $prepared?->sha256,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    private function isDuplicateKey(QueryException $exception): bool
    {
        return (int) ($exception->errorInfo[1] ?? 0) === 1062;
    }

    private function iso(CarbonImmutable $date): string
    {
        return $date->utc()->format('Y-m-d\TH:i:s\Z');
    }
}
