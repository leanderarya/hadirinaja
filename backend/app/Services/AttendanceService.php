<?php

namespace App\Services;

use App\Data\AttendanceActor;
use App\Data\EffectiveScheduleResult;
use App\Data\PreparedAttendanceEvidence;
use App\Enums\TenantRole;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceIdempotencyRecord;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeePinCredential;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Support\SchedulingDefaults;
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
    public function current(
        TenantMembership $membership,
        Employee $employee,
        ?int $requestedOutletId = null,
        ?int $checkoutOutletId = null,
    ): array {
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

        if ($checkoutOutletId !== null && (! $active || ! $outletIds->contains($checkoutOutletId))) {
            throw new AuthorizationException('Outlet attendance access is not available.');
        }
        $destination = $active ? $outlets->find($checkoutOutletId ?? $active->outlet_id) : null;

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

        $history = AttendanceSession::query()->forTenant($tenantId)->with(['outlet', 'events.checkoutOutlet'])
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
        $allowedOperation = is_array($effectiveConfiguration)
            && $this->modeAllows($effectiveConfiguration, 'personal')
            ? ($active ? 'check_out' : 'check_in')
            : null;

        if (! $active && $outlets->isEmpty()) {
            $eligibilityStatus = 'assignment_unavailable';
        } elseif (! is_array($effectiveConfiguration)) {
            $eligibilityStatus = 'policy_unavailable';
        } elseif ($allowedOperation === null) {
            $eligibilityStatus = ($effectiveConfiguration['attendance_mode'] ?? null) === 'kiosk'
                ? 'kiosk_only'
                : 'personal_mode_unavailable';
        } else {
            $eligibilityStatus = 'eligible';
        }

        return [
            'eligibility' => ['status' => $eligibilityStatus],
            'server_time' => $this->iso($now),
            'employee' => ['id' => $employeeId, 'name' => $employee->name],
            'outlets' => $outlets->map(fn (Outlet $outlet): array => [
                'id' => (int) $outlet->getKey(),
                'name' => $outlet->name,
            ])->values(),
            'selected_outlet_id' => $selectedOutlet,
            'schedule' => $schedule === null ? null : $this->publicSchedule($schedule),
            'active_session' => $activeData,
            'checkout_destination' => $destination ? $this->checkoutDestinationPreview($destination, $now) : null,
            'allowed_next_operation' => $allowedOperation,
            'require_personal_photo' => (bool) config('attendance_evidence.require_personal_photo', false),
            'personal_location' => $this->locationPreview($locationPolicy),
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
        ?Outlet $destination = null,
        ?int $expectedSessionId = null,
    ): array {
        if ($destination && ($actor->origin !== 'personal' || (int) $destination->tenant_id !== $actor->tenantId)) {
            throw new AuthorizationException('Outlet attendance access is not available.');
        }
        if ($actor->origin === 'personal' && $expectedSessionId !== null && $destination === null) {
            throw ValidationException::withMessages(['checkout_outlet_id' => 'Pilih Outlet tujuan checkout.']);
        }

        return $this->mutate($actor, $employee, 'check_out', $key, $destination, $location, $photo, $expectedSessionId);
    }

    /** @return array<string, mixed> */
    public function operationStatus(AttendanceActor $actor, int $employeeId, string $operation, string $key): array
    {
        $record = $this->idempotencyQuery($actor, $employeeId, $operation, $key)->first();

        if (! $record || ($record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT
            && $actor->origin === 'kiosk' && $record->checkout_outlet_id !== $actor->kioskOutletId)) {
            return ['state' => 'not_found', 'operation' => $operation];
        }
        if ($record->contract_version === AttendanceIdempotencyRecord::VERIFIED_KIOSK_CHECKOUT_CONTRACT) {
            $this->activeDevice($actor);
        }

        $checkout = $this->checkoutBinding($record);
        if ($record->status === 'pending' || $record->response_body === null) {
            return ['state' => 'pending', 'operation' => $operation, ...$checkout];
        }

        return [
            'state' => $record->status,
            'operation' => $operation,
            'result' => $record->response_body,
            ...$checkout,
        ];
    }

    /** @return array<string, mixed> */
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

            if (! $this->isAssignedAt($tenantId, $employeeId, (int) $device->outlet_id, $now)) {
                return ['eligible' => false, 'next_operation' => null, 'reason' => 'outlet_assignment_required'];
            }

            $destination = $this->checkoutDestinationPreview($device->outlet, $now, 'kiosk');
            $reason = ! $destination['mode_allowed'] ? 'mode_not_allowed'
                : (! $destination['personal_location']['geofence_configured'] ? 'location_geofence_unconfigured' : null);

            return [
                'eligible' => $reason === null,
                'next_operation' => $reason === null ? 'check_out' : null,
                'reason' => $reason,
                'checkout_session_id' => (int) $session->getKey(),
                'checkout_outlet_id' => $destination['id'],
                'checkout_location' => $destination['personal_location'],
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
        ?int $expectedSessionId = null,
    ): array {
        if ((int) $employee->tenant_id !== $actor->tenantId) {
            throw new AuthorizationException('Employee attendance access is not available.');
        }

        if ($actor->origin === 'kiosk' && $photo === null) {
            throw ValidationException::withMessages(['photo' => 'Foto baru wajib disertakan untuk setiap operasi kiosk.']);
        }
        if ($actor->origin === 'personal' && (bool) config('attendance_evidence.require_personal_photo', false) && $photo === null) {
            throw ValidationException::withMessages(['photo' => 'Foto wajib disertakan untuk setiap operasi kehadiran personal.']);
        }

        if ($actor->origin === 'personal' && $location === null) {
            $location = ['status' => 'unavailable'];
        }

        $normalizedLocation = $this->normalizeLocation($location);
        $prepared = $photo ? $this->evidenceStorage->prepare($photo, $actor->tenantId) : null;
        $outletId = $requestedOutlet ? (int) $requestedOutlet->getKey() : null;
        try {
            $record = $this->idempotencyQuery($actor, (int) $employee->getKey(), $operation, $key)->first();
            if (! $record) {
                $record = new AttendanceIdempotencyRecord([
                    'tenant_id' => $actor->tenantId,
                    'employee_id' => $employee->getKey(),
                    ...$actor->eventColumns(),
                    'operation' => $operation,
                    'idempotency_key' => $key,
                    'status' => 'pending',
                    ...$this->newOperationContract($actor, (int) $employee->getKey(), $operation, $outletId, $expectedSessionId),
                ]);
                $record->request_hash = $this->requestHash($record, $actor, $outletId, $normalizedLocation, $prepared, $expectedSessionId);
                try {
                    $record->save();
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

            // Hash retries against the recorded target, even after the employee has another active session.
            $requestHash = $this->requestHash($record, $actor, $outletId, $normalizedLocation, $prepared, $expectedSessionId);
            if (! hash_equals($record->request_hash, $requestHash) || $record->status !== 'pending') {
                if ($record->contract_version === AttendanceIdempotencyRecord::VERIFIED_KIOSK_CHECKOUT_CONTRACT) {
                    $this->activeDevice($actor);
                }

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
                    if ($record->contract_version === AttendanceIdempotencyRecord::VERIFIED_KIOSK_CHECKOUT_CONTRACT) {
                        $this->activeDevice($actor, lock: true);
                    }

                    return $this->replay($record, $requestHash);
                }

                try {
                    $device = $actor->origin === 'kiosk' ? $this->activeDevice($actor, lock: true) : null;
                } catch (AuthorizationException) {
                    return $this->reject($record, 403, 'kiosk_unavailable', 'Akses perangkat tidak tersedia. Periksa pemasangan dengan Owner.');
                }
                if ($record->contract_version === AttendanceIdempotencyRecord::VERIFIED_PERSONAL_CHECKOUT_CONTRACT) {
                    $this->assertCurrentPersonalActor($actor, (int) $employee->getKey());
                }
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

    private function photoPreviouslyUsed(int $tenantId, int $employeeId, PreparedAttendanceEvidence $photo): bool
    {
        // The caller holds the employee lock, serializing image reuse across attendance operations.
        return AttendanceEvidence::query()
            ->join('attendance_events as events', function ($join): void {
                $join->on('events.tenant_id', '=', 'attendance_evidence.tenant_id')
                    ->on('events.id', '=', 'attendance_evidence.attendance_event_id');
            })
            ->where('attendance_evidence.tenant_id', $tenantId)
            ->where('events.employee_id', $employeeId)
            ->where('attendance_evidence.sha256', $photo->sha256)
            ->exists();
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
        if ($rejection = $this->locationRejection($record, $locationResult)) {
            return $rejection;
        }
        if ($prepared && $this->photoPreviouslyUsed($actor->tenantId, (int) $employee->getKey(), $prepared)) {
            return $this->reject($record, 422, 'photo_must_be_new', 'Ambil foto baru untuk setiap operasi kehadiran.');
        }

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

        $destinationBound = $record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT;
        $verified = in_array($record->contract_version, [
            AttendanceIdempotencyRecord::VERIFIED_PERSONAL_CHECKOUT_CONTRACT,
            AttendanceIdempotencyRecord::VERIFIED_KIOSK_CHECKOUT_CONTRACT,
        ], true);
        if (! $owner || ($destinationBound && $record->checkout_session_id !== (int) $owner->attendance_session_id)) {
            return $this->reject($record, 409, 'no_active_attendance', 'Tidak ada sesi kehadiran aktif untuk ditutup.');
        }

        $session = AttendanceSession::query()->forTenant($tenantId)
            ->whereKey($owner->attendance_session_id)->lockForUpdate()->first();

        if (! $session || (int) $session->employee_id !== $employeeId) {
            throw new \LogicException('The active-session ownership row is inconsistent.');
        }
        if ($session->status !== 'active') {
            $stillOwned = DB::table('attendance_active_session_owners')->where('tenant_id', $tenantId)
                ->where('employee_id', $employeeId)->where('attendance_session_id', $session->getKey())->lockForUpdate()->exists();
            if (! $stillOwned) {
                return $this->reject($record, 409, 'no_active_attendance', 'Sesi ini telah ditutup atau diselesaikan sebelum checkout diterima.');
            }

            throw new \LogicException('The active-session ownership row is inconsistent.');
        }

        if (! $destinationBound && ! $this->legacyCheckoutMatchesActiveSession($record, $session)) {
            return $this->reject($record, 409, 'no_active_attendance', 'Sesi untuk percobaan checkout ini tidak dapat dipastikan.');
        }

        if (! $verified && $device && (int) $session->outlet_id !== (int) $device->outlet_id) {
            return $this->reject($record, 409, 'session_at_origin_outlet', 'Sesi ini hanya dapat ditutup melalui kiosk outlet asal.');
        }

        if ($destinationBound && ! $verified && $record->checkout_outlet_id !== (int) $session->outlet_id) {
            return $this->reject($record, 409, 'session_at_origin_outlet', 'Sesi ini hanya dapat ditutup di outlet asal.');
        }

        $outletId = $verified ? $record->checkout_outlet_id : (int) $session->outlet_id;
        if ($verified) {
            // Policy and calendar writers lock these roots. Assignment writers share the employee lock.
            Tenant::query()->whereKey($tenantId)->sharedLock()->firstOrFail();
            Outlet::query()->forTenant($tenantId)->whereKey($outletId)->sharedLock()->firstOrFail();
        }
        $now = CarbonImmutable::now('UTC');
        if ($verified && $device && $device->credentialExpired()) {
            return $this->reject($record, 403, 'kiosk_unavailable', 'Akses perangkat tidak tersedia. Periksa pemasangan dengan Owner.');
        }
        $assignment = $verified ? $this->activeAssignment($tenantId, $employeeId, $outletId, $now, currentRead: true) : null;
        if ($verified && ! $assignment) {
            return $this->reject($record, 403, 'outlet_assignment_required', 'Anda tidak lagi memiliki penugasan aktif di Outlet tujuan.');
        }
        $timezone = $verified
            ? $this->checkoutTimezone($tenantId, $outletId, $now, currentRead: true)
            : (string) ($session->schedule_snapshot['timezone'] ?? 'UTC');
        $localDate = $now->setTimezone($timezone)->toDateString();
        $policy = $this->policies->effective($tenantId, $outletId, $localDate, currentRead: $verified);
        $configuration = $policy['configuration'] ?? null;

        if (! is_array($configuration) || ! $this->modeAllows($configuration, $actor->origin)) {
            return $this->reject($record, 403, 'attendance_mode_not_allowed', 'Mode kehadiran ini tidak diizinkan oleh kebijakan outlet.');
        }

        $checkIn = CarbonImmutable::parse($session->check_in_at, 'UTC')->utc();
        if ($now->lessThan($checkIn)) {
            return $this->reject($record, 409, 'server_time_inconsistent', 'Waktu server belum konsisten; sesi belum dapat ditutup.');
        }

        $locationResult = $verified || $actor->origin === 'personal'
            ? $this->evaluateLocation($location, $configuration, required: $verified)
            : $this->emptyLocationResult();
        if ($rejection = $this->locationRejection($record, $locationResult)) {
            return $rejection;
        }
        if ($prepared && $this->photoPreviouslyUsed($actor->tenantId, (int) $employee->getKey(), $prepared)) {
            return $this->reject($record, 422, 'photo_must_be_new', 'Ambil foto baru untuk setiap operasi kehadiran.');
        }

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
            $assignment ? [
                'verification' => 'verified',
                'contract_version' => $record->contract_version,
                'assignment' => [
                    'id' => (int) $assignment->getKey(),
                    'type' => $assignment->assignment_type->value,
                    'effective_from' => $this->iso($assignment->effective_from),
                    'effective_until' => $this->iso($assignment->effective_until),
                ],
                'policy' => [
                    'tenant_version_id' => $policy['tenant_version_id'],
                    'outlet_version_id' => $policy['outlet_version_id'],
                    'attendance_mode' => $configuration['attendance_mode'],
                    'timezone' => $timezone,
                    'local_date' => $localDate,
                ],
                'location' => [
                    'capture_status' => $locationResult['capture_status'],
                    'verdict' => $locationResult['verdict'],
                ],
                'actor' => $device
                    ? ['channel' => 'kiosk', 'kiosk_device_id' => (int) $device->getKey(), 'authenticated_outlet_id' => (int) $device->outlet_id]
                    : ['channel' => 'personal', 'tenant_membership_id' => $actor->tenantMembershipId],
                'recorded_at' => $this->iso($now),
            ] : null,
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
        ?array $checkoutContext = null,
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
            'checkout_outlet_id' => $record->checkout_outlet_id,
            'authenticated_kiosk_outlet_id' => $record->checkout_outlet_id !== null ? $actor->kioskOutletId : null,
            // Destination binding records where checkout ran under the existing policy.
            'checkout_context' => $checkoutContext ?? ($record->checkout_outlet_id !== null ? ['verification' => 'legacy_policy'] : null),
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
            'evidence_type' => $event->origin === 'kiosk' ? 'kiosk_photo' : 'personal_photo',
            'storage_path' => $prepared->storagePath,
            'detected_mime_type' => $prepared->detectedMimeType,
            'stored_mime_type' => $prepared->storedMimeType,
            'stored_size_bytes' => $prepared->storedSizeBytes,
            'image_width' => $prepared->width,
            'image_height' => $prepared->height,
            'sha256' => $prepared->sha256,
            'validation_status' => 'validated_normalized',
            'expires_at' => $event->recorded_at->utc()->addDays(AttendanceEvidenceExpirationService::RETENTION_DAYS)->format('Y-m-d H:i:s'),
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

    private function activeAssignment(int $tenantId, int $employeeId, int $outletId, CarbonImmutable $at, bool $currentRead = false): ?EmployeeOutletAssignment
    {
        return EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('employee_id', $employeeId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $at->format('Y-m-d H:i:s'))
            ->where('effective_until', '>', $at->format('Y-m-d H:i:s'))
            ->orderByDesc('effective_from')
            ->when($currentRead, fn ($query) => $query->orderByDesc('id')->sharedLock())->first();
    }

    private function assertCurrentPersonalActor(AttendanceActor $actor, int $employeeId): void
    {
        $membership = TenantMembership::query()->forTenant($actor->tenantId)
            ->whereKey($actor->tenantMembershipId)->sharedLock()->first();
        if (! $membership || ! $membership->is_active || $membership->revoked_at !== null
            || ! $membership->roles()->where('role', TenantRole::Employee->value)->sharedLock()->first()
            || ! $membership->employeeUserLink()->where('employee_id', $employeeId)->sharedLock()->first()) {
            throw new AuthorizationException('Employee attendance access is not available.');
        }
    }

    private function activeDevice(AttendanceActor $actor, bool $lock = false): KioskDevice
    {
        $device = KioskDevice::query()->forTenant($actor->tenantId)
            ->whereKey($actor->kioskDeviceId)->when($lock, fn ($query) => $query->lockForUpdate())->first();

        if (! $device || $device->revoked_at !== null || $device->credentialExpired()
            || (int) $device->outlet_id !== $actor->kioskOutletId
            || ! hash_equals($device->credential_hash, (string) $actor->kioskCredentialHash)) {
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

        foreach (['latitude', 'longitude', 'accuracy_meters'] as $field) {
            if (! is_numeric($location[$field]) || ! is_finite((float) $location[$field])) {
                throw ValidationException::withMessages(['location' => 'Koordinat dan akurasi lokasi harus berupa angka yang valid.']);
            }
        }
        $latitude = (float) $location['latitude'];
        $longitude = (float) $location['longitude'];
        $accuracy = (float) $location['accuracy_meters'];

        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180 || $accuracy <= 0 || $accuracy > 50000) {
            throw ValidationException::withMessages(['location' => 'Koordinat atau akurasi lokasi berada di luar batas yang valid.']);
        }

        return ['status' => $status, 'latitude' => $latitude, 'longitude' => $longitude, 'accuracy_meters' => $accuracy];
    }

    /** @return array<string, mixed> */
    private function evaluateLocation(array $location, array $policy, bool $required = false): array
    {
        $settings = $policy['personal_location_validation'] ?? [];
        if (! $required && ! ($settings['required'] ?? false)) {
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
        } elseif (! $this->hasConfiguredLocation($settings)) {
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
                // ponytail: absorb floating-point error at the inclusive boundary, not GPS uncertainty.
                if ($distance - $radius > 0.0000001) {
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

    private function hasConfiguredLocation(array $settings): bool
    {
        foreach (['latitude', 'longitude', 'radius_meters'] as $field) {
            if (! isset($settings[$field]) || ! is_numeric($settings[$field]) || ! is_finite((float) $settings[$field])) {
                return false;
            }
        }

        return abs((float) $settings['latitude']) <= 90
            && abs((float) $settings['longitude']) <= 180
            && (float) $settings['radius_meters'] >= 50
            && (float) $settings['radius_meters'] <= 5000;
    }

    private function checkoutDestinationPreview(Outlet $outlet, CarbonImmutable $now, string $origin = 'personal'): array
    {
        $tenantId = (int) $outlet->tenant_id;
        $outletId = (int) $outlet->getKey();
        $timezone = $this->checkoutTimezone($tenantId, $outletId, $now);
        $policy = $this->policies->effective($tenantId, $outletId, $now->setTimezone($timezone)->toDateString());
        $configuration = $policy['configuration'];
        $location = $this->locationPreview([
            ...($configuration['personal_location_validation'] ?? []),
            'required' => true,
        ]);

        return [
            'id' => $outletId,
            'name' => $outlet->name,
            'timezone' => $timezone,
            'mode_allowed' => is_array($configuration) && $this->modeAllows($configuration, $origin),
            'personal_location' => $location,
        ];
    }

    private function checkoutTimezone(int $tenantId, int $outletId, CarbonImmutable $now, bool $currentRead = false): string
    {
        // An effective date belongs to the destination calendar's local day.
        $calendars = OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outletId)
            ->where('effective_from', '<=', $now->addDay()->toDateString())->orderByDesc('effective_from')
            ->when($currentRead, fn ($query) => $query->sharedLock())->get(['timezone', 'effective_from']);

        foreach ($calendars as $calendar) {
            if ($calendar->effective_from->toDateString() <= $now->setTimezone($calendar->timezone)->toDateString()) {
                return $calendar->timezone;
            }
        }

        return SchedulingDefaults::TIMEZONE;
    }

    private function locationPreview(array $settings): array
    {
        $configured = $this->hasConfiguredLocation($settings);

        return [
            'required' => (bool) ($settings['required'] ?? false),
            'radius_meters' => isset($settings['radius_meters']) ? (int) $settings['radius_meters'] : null,
            'geofence_configured' => $configured,
            'latitude' => $configured ? (float) $settings['latitude'] : null,
            'longitude' => $configured ? (float) $settings['longitude'] : null,
            'max_accuracy_meters' => isset($settings['radius_meters']) ? (float) $settings['radius_meters'] : null,
        ];
    }

    /** @return array{status: int, body: array<string, mixed>}|null */
    private function locationRejection(AttendanceIdempotencyRecord $record, array $location): ?array
    {
        $messages = [
            'permission_denied' => 'Izin lokasi ditolak. Aktifkan izin lokasi lalu coba kembali.',
            'unavailable' => 'Lokasi belum tersedia. Dapatkan lokasi sebelum mengirim presensi.',
            'unconfigured' => 'Titik dan radius Outlet belum valid. Hubungi pengelola.',
            'low_accuracy' => 'Akurasi lokasi belum memadai. Perbarui lokasi lalu coba kembali.',
            'outside_range' => 'Lokasi Anda berada di luar radius Outlet. Presensi ditolak.',
        ];
        $verdict = $location['verdict'];
        if (! isset($messages[$verdict ?? ''])) {
            return null;
        }

        $code = $verdict === 'unconfigured' ? 'location_geofence_unconfigured' : 'location_'.$verdict;

        return $this->reject($record, 422, $code, $messages[$verdict]);
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

        $data['checkout_destination'] = null;
        if ($session->check_out_at !== null) {
            $session->loadMissing('events.checkoutOutlet');
            $checkout = $session->events->firstWhere('event_type', 'check_out');
            if ($checkout?->checkout_outlet_id !== null) {
                $data['checkout_destination'] = [
                    'id' => (int) $checkout->checkout_outlet_id,
                    'name' => $checkout->checkoutOutlet?->name,
                    'timezone' => $checkout->checkout_context['policy']['timezone'] ?? null,
                ];
            }
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
            'operation' => [
                'key' => $record->idempotency_key, 'state' => 'completed', 'type' => $operation,
                ...($record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT
                    ? $this->checkoutBinding($record) : []),
            ],
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
                ...($record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT
                    ? $this->checkoutBinding($record) : []),
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
                'body' => ['operation' => [
                    'key' => $record->idempotency_key, 'type' => $record->operation, 'state' => 'pending',
                    ...($record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT
                        ? $this->checkoutBinding($record) : []),
                ]],
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

    private function newOperationContract(AttendanceActor $actor, int $employeeId, string $operation, ?int $outletId, ?int $expectedSessionId): array
    {
        if ($operation !== 'check_out') {
            return ['contract_version' => AttendanceIdempotencyRecord::LEGACY_CONTRACT];
        }

        $session = DB::table('attendance_active_session_owners as owners')
            ->join('attendance_sessions as sessions', function ($join): void {
                $join->on('sessions.tenant_id', '=', 'owners.tenant_id')
                    ->on('sessions.employee_id', '=', 'owners.employee_id')
                    ->on('sessions.id', '=', 'owners.attendance_session_id');
            })
            ->where('owners.tenant_id', $actor->tenantId)->where('owners.employee_id', $employeeId)
            ->first(['sessions.id', 'sessions.outlet_id']);

        $sessionId = $session ? (int) $session->id : null;

        return [
            'contract_version' => match (true) {
                $actor->origin === 'kiosk' => AttendanceIdempotencyRecord::VERIFIED_KIOSK_CHECKOUT_CONTRACT,
                $outletId !== null => AttendanceIdempotencyRecord::VERIFIED_PERSONAL_CHECKOUT_CONTRACT,
                default => AttendanceIdempotencyRecord::DESTINATION_BOUND_CONTRACT,
            },
            'checkout_session_id' => $expectedSessionId === null || $expectedSessionId === $sessionId ? $sessionId : null,
            'checkout_outlet_id' => $actor->kioskOutletId ?? $outletId ?? $session?->outlet_id,
        ];
    }

    private function legacyCheckoutMatchesActiveSession(AttendanceIdempotencyRecord $record, AttendanceSession $session): bool
    {
        if ($record->created_at === null || $session->check_in_at->greaterThan($record->created_at)) {
            return false;
        }

        // Legacy attempts lack a target ID. Reject retries when the recorded second could refer to another session.
        $recordedAt = $record->created_at->utc()->toDateTimeString();

        return ! AttendanceSession::query()->forTenant((int) $session->tenant_id)
            ->where('employee_id', $session->employee_id)->whereKeyNot($session->getKey())
            ->where('check_in_at', '<=', $recordedAt)
            ->where(function ($query) use ($recordedAt): void {
                $query->where('check_out_at', '>=', $recordedAt)
                    ->orWhere(fn ($resolved) => $resolved->where('status', 'administratively_resolved')
                        ->where('updated_at', '>=', $recordedAt));
            })->exists();
    }

    private function checkoutBinding(AttendanceIdempotencyRecord $record): array
    {
        if ($record->operation !== 'check_out') {
            return [];
        }

        return [
            'contract_version' => $record->contract_version,
            'checkout_session_id' => $record->checkout_session_id,
            'checkout_outlet_id' => $record->checkout_outlet_id,
        ];
    }

    private function requestHash(
        AttendanceIdempotencyRecord $record,
        AttendanceActor $actor,
        ?int $outletId,
        array $location,
        ?PreparedAttendanceEvidence $prepared,
        ?int $expectedSessionId,
    ): string {
        $payload = [
            'tenant_id' => $actor->tenantId,
            'origin' => $actor->origin,
            'actor_id' => $actor->tenantMembershipId ?? $actor->kioskDeviceId,
            'employee_id' => (int) $record->employee_id,
            'operation' => $record->operation,
            'outlet_id' => $outletId,
            'location' => $location,
            'photo_sha256' => $prepared?->sha256,
        ];

        if ($record->contract_version !== AttendanceIdempotencyRecord::LEGACY_CONTRACT) {
            $payload['outlet_id'] = null;
            $payload = [
                ...$payload,
                ...$this->checkoutBinding($record),
                'checkout_outlet_id' => $actor->kioskOutletId ?? $outletId ?? $record->checkout_outlet_id,
            ];
        }
        if ($record->contract_version === AttendanceIdempotencyRecord::VERIFIED_PERSONAL_CHECKOUT_CONTRACT) {
            $payload['checkout_outlet_id'] = $outletId;
            $payload['checkout_session_id'] = $expectedSessionId ?? $record->checkout_session_id;
        } elseif ($expectedSessionId !== null) {
            $payload['checkout_session_id'] = $expectedSessionId;
        }

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
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
