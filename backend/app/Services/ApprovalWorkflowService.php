<?php

namespace App\Services;

use App\Enums\EmployeeOutletAssignmentType;
use App\Enums\TenantRole;
use App\Models\ApprovalDecision;
use App\Models\ApprovalRequest;
use App\Models\AttendanceCorrection;
use App\Models\AttendanceEvent;
use App\Models\AttendanceFinalization;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeeUserLink;
use App\Models\Outlet;
use App\Models\OutletCalendarVersion;
use App\Support\SchedulingDefaults;
use App\Models\SupervisorOutletScope;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ApprovalWorkflowService
{
    public function __construct(
        private readonly EffectiveScheduleResolver $schedules,
        private readonly EffectiveAttendanceProjectionService $projection,
        private readonly LocalTimeResolver $localTime,
        private readonly AttendancePolicyService $policies,
    ) {}

    public function submitEmployeeRequest(TenantMembership $membership, User $user, array $data, string $key): ApprovalRequest
    {
        $submissionHash = $this->payloadHash($data);

        return DB::transaction(function () use ($membership, $user, $data, $key, $submissionHash): ApprovalRequest {
            [$current, $employee] = $this->personalRequestIdentity($membership, $user);

            $type = (string) ($data['type'] ?? '');
            if (! in_array($type, ['leave', 'overtime', 'attendance_correction'], true)) {
                throw ValidationException::withMessages(['type' => 'Jenis permintaan tidak didukung.']);
            }

            $existing = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                ->where('requester_user_id', $user->getKey())->where('submission_key', $key)->lockForUpdate()->first();
            if ($existing) {
                if ((int) $existing->employee_id !== (int) $employee->getKey() || ! hash_equals((string) $existing->submission_hash, $submissionHash)) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci idempotensi sudah digunakan untuk isi permintaan yang berbeda.']);
                }

                return $existing;
            }

            return match ($type) {
                'leave' => $this->createLeaveRequest($current, $user, $employee, $data, $key),
                'overtime' => $this->createOvertimeRequest($current, $user, $employee, $data, $key),
                'attendance_correction' => ($data['correction_target'] ?? null) === 'reconstruction'
                    ? $this->createReconstruction($current, $user, $employee, $data, $key, true)
                    : $this->createCorrectionRequest($current, $user, $employee, $data, $key, true),
            };
        }, attempts: 3);
    }

    public function personalCorrectionOptions(TenantMembership $membership, User $user, array $days, ?int $activeSessionId = null): array
    {
        return DB::transaction(function () use ($membership, $user, $days, $activeSessionId): array {
            [$current, $employee] = $this->personalRequestIdentity($membership, $user);
            foreach ($days as $day) {
                if ($day['tenant_id'] !== (int) $current->tenant_id || $day['employee']['id'] !== (int) $employee->getKey()) {
                    throw new AuthorizationException('Kehadiran tidak tersedia untuk identitas Anda.');
                }
            }
            $sessionIds = collect($days)->pluck('sessions')->flatten(1)->pluck('id')
                ->push($activeSessionId)->filter()->unique()->values();
            $sessions = AttendanceSession::query()->forTenant((int) $current->tenant_id)
                ->where('employee_id', $employee->getKey())->whereIn('id', $sessionIds)->with('outlet')->get();
            if ($sessions->count() !== $sessionIds->count()) {
                throw new AuthorizationException('Sesi tidak tersedia untuk identitas Anda.');
            }
            $sessionOptions = [];
            foreach ($sessions as $session) {
                $basis = $this->approvedCorrectionBasis($session);
                $values = $basis?->proposed_values ?? [];
                $date = $values['work_date'] ?? $session->work_date->toDateString();
                $outlet = Outlet::query()->forTenant((int) $current->tenant_id)
                    ->findOrFail((int) ($values['outlet_id'] ?? $session->outlet_id));
                $type = $session->status !== 'active' ? 'session'
                    : ($session->work_date->toDateString() < CarbonImmutable::now($session->schedule_snapshot['timezone'] ?? 'Asia/Jakarta')->toDateString()
                        ? 'missing_checkout' : 'check_in');
                $sessionOptions[] = [
                    ...$this->personalCorrectionOption($current, $outlet, $date, $type),
                    'session_id' => (int) $session->getKey(),
                ];
            }
            $outlets = Outlet::query()->forTenant((int) $current->tenant_id)
                ->whereIn('id', EmployeeOutletAssignment::query()->forTenant((int) $current->tenant_id)
                    ->where('employee_id', $employee->getKey())->select('outlet_id'))
                ->orderBy('name')->get();
            $reconstructions = [];
            foreach (collect($days)->pluck('work_date')->unique() as $date) {
                $existingReconstruction = $this->reconstructionRequest($employee, $date);
                foreach ($outlets as $outlet) {
                    $option = $this->personalCorrectionOption($current, $outlet, $date, 'reconstruction');
                    $reconstructions[] = [
                        ...$option,
                        'can_start' => $option['can_start'] && $existingReconstruction === null,
                    ];
                }
            }

            return [
                'tenant_id' => (int) $current->tenant_id,
                'employee_id' => (int) $employee->getKey(),
                'evaluated_at' => CarbonImmutable::now('UTC')->toIso8601String(),
                'sessions' => $sessionOptions,
                'reconstructions' => $reconstructions,
            ];
        });
    }

    private function personalCorrectionOption(TenantMembership $membership, Outlet $outlet, string $date, string $type): array
    {
        $deadline = $this->correctionDeadline($membership, (int) $outlet->getKey(), $date, false);
        $future = $date > CarbonImmutable::now($deadline['historical_timezone'])->toDateString();

        return [
            'work_date' => $date,
            'outlet' => ['id' => (int) $outlet->getKey(), 'name' => $outlet->name],
            'correction_type' => $type,
            'can_start' => ! $deadline['owner_required'] && ! $future,
            'deadline' => $deadline,
        ];
    }

    private function personalRequestIdentity(TenantMembership $membership, User $user): array
    {
        $current = $this->currentMembership($membership, $user);
        $employeeId = EmployeeUserLink::query()->forTenant((int) $current->tenant_id)
            ->where('tenant_membership_id', $current->getKey())->value('employee_id');
        if ($employeeId === null || ! $this->hasRole($current, TenantRole::Employee)) {
            throw new AuthorizationException('Akun ini tidak terhubung ke identitas karyawan aktif.');
        }
        $employee = Employee::query()->forTenant((int) $current->tenant_id)->whereKey($employeeId)->lockForUpdate()->first();
        if (! $employee) {
            throw new AuthorizationException('Identitas karyawan tidak tersedia.');
        }

        return [$current, $employee];
    }

    public function submitManagedReconstruction(TenantMembership $membership, User $user, int $employeeId, array $data, string $key): ApprovalRequest
    {
        return DB::transaction(function () use ($membership, $user, $employeeId, $data, $key): ApprovalRequest {
            $current = $this->currentMembership($membership, $user);
            if (! $this->hasRole($current, TenantRole::Owner)
                && (! $this->hasRole($current, TenantRole::Supervisor) || ! $this->isSupervisorScoped($current, (int) $data['effective_outlet_id']))) {
                throw new AuthorizationException('Outlet tidak tersedia dalam cakupan Anda.');
            }

            $employee = Employee::query()->forTenant((int) $current->tenant_id)->whereKey($employeeId)->lockForUpdate()->firstOrFail();
            $hash = $this->payloadHash([...$data, 'employee_id' => $employeeId, 'correction_target' => 'reconstruction']);
            $existing = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                ->where('requester_user_id', $user->getKey())->where('submission_key', $key)->lockForUpdate()->first();
            if ($existing) {
                if (! hash_equals((string) $existing->submission_hash, $hash)) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci idempotensi sudah digunakan untuk isi permintaan yang berbeda.']);
                }

                return $existing;
            }

            return $this->createReconstruction($current, $user, $employee, $data, $key, false, $hash);
        }, attempts: 3);
    }

    private function createReconstruction(TenantMembership $membership, User $user, Employee $employee, array $data, string $key, bool $personal, ?string $hash = null): ApprovalRequest
    {
        $tenantId = (int) $employee->tenant_id;
        $outletId = (int) ($data['effective_outlet_id'] ?? 0);
        if (! Outlet::query()->forTenant($tenantId)->whereKey($outletId)->exists()) {
            throw ValidationException::withMessages(['effective_outlet_id' => 'Outlet aktual tidak tersedia dalam organisasi aktif.']);
        }

        $date = $this->date((string) ($data['work_date'] ?? ''), 'work_date')->toDateString();
        foreach (['effective_check_in_at', 'effective_check_out_at'] as $field) {
            if (! preg_match('/T.*(?:Z|[+-]\d{2}:\d{2})$/iD', (string) ($data[$field] ?? ''))) {
                throw ValidationException::withMessages([$field => 'Tanggal dan waktu harus menyertakan zona waktu.']);
            }
        }
        $start = $this->instant($data['effective_check_in_at'], 'effective_check_in_at');
        $end = $this->instant($data['effective_check_out_at'], 'effective_check_out_at');
        $deadline = $this->correctionDeadline($membership, $outletId, $date, $personal);
        if ($start->setTimezone($deadline['historical_timezone'])->toDateString() !== $date || $end->lte($start) || $end->gt(CarbonImmutable::now('UTC'))) {
            throw ValidationException::withMessages(['correction' => 'Rekonstruksi memerlukan rentang kerja yang sudah selesai dan dimulai pada Tanggal Kerja Outlet.']);
        }

        $claim = [
            'work_date' => $date,
            'outlet_id' => $outletId,
            'timezone' => $deadline['historical_timezone'],
            'check_in_at' => $start->toIso8601String(),
            'check_out_at' => $end->toIso8601String(),
        ];
        $this->assertReconstructionAvailable($employee, $claim);
        $assignment = $this->historicalAssignment($employee, $claim);
        $primaryOutletId = EmployeeOutletAssignment::query()->forTenant($tenantId)
            ->where('employee_id', $employee->getKey())->where('assignment_type', EmployeeOutletAssignmentType::Primary->value)
            ->where('effective_from', '<=', $start->toDateTimeString())->where('effective_until', '>', $start->toDateTimeString())
            ->lockForUpdate()->first()?->outlet_id;

        return $this->newRequest($membership, $user, [
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outletId,
            'request_type' => 'attendance_correction',
            'status' => 'pending',
            'work_date' => $date,
            'reason' => $this->requiredReason($data),
            'details' => [
                'correction_target' => 'reconstruction', 'contract_version' => 1, 'classification' => 'sensitive',
                'proposed' => $claim, 'deadline' => $deadline,
                'historical_assignment_id' => $assignment?->getKey(),
                'historical_primary_outlet_id' => $primaryOutletId,
                'assignment_exception_required' => $assignment === null,
            ],
            'submission_key' => $key,
            'submission_hash' => $hash ?? $this->payloadHash($data),
        ]);
    }

    private function historicalAssignment(Employee $employee, array $claim): ?EmployeeOutletAssignment
    {
        return EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())->where('outlet_id', $claim['outlet_id'])
            ->where('effective_from', '<=', CarbonImmutable::parse($claim['check_in_at'])->utc()->toDateTimeString())
            ->where('effective_until', '>=', CarbonImmutable::parse($claim['check_out_at'])->utc()->toDateTimeString())
            ->orderBy('id')->lockForUpdate()->first();
    }

    private function assertReconstructionAvailable(Employee $employee, array $claim, ?int $except = null): void
    {
        $existing = $this->reconstructionRequest($employee, $claim['work_date'], $except);
        if ($existing) {
            throw ValidationException::withMessages(['correction' => 'Rekonstruksi sudah diajukan untuk Tanggal Kerja ini.']);
        }

        $this->assertNoOverlappingAttendance($employee, null, $claim);
    }

    private function reconstructionRequest(Employee $employee, string $date, ?int $except = null): ?ApprovalRequest
    {
        return ApprovalRequest::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())->where('work_date', $date)
            ->where('request_type', 'attendance_correction')->where('details->correction_target', 'reconstruction')
            ->whereIn('status', ['pending', 'approved'])
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except))->lockForUpdate()->first();
    }

    private function assertNoReconstructionOverlap(Employee $employee, array $interval): void
    {
        $approved = ApprovalRequest::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())->where('request_type', 'attendance_correction')
            ->where('status', 'approved')->withoutReversal(lock: true)->where('details->correction_target', 'reconstruction')->lockForUpdate()->get();
        foreach ($approved as $request) {
            $claim = $request->details['proposed'];
            if (CarbonImmutable::parse($interval['check_in_at'])->lt(CarbonImmutable::parse($claim['check_out_at']))
                && CarbonImmutable::parse($interval['check_out_at'])->gt(CarbonImmutable::parse($claim['check_in_at']))) {
                throw ValidationException::withMessages(['correction' => 'Rentang koreksi bertabrakan dengan rekonstruksi yang disetujui.']);
            }
        }
    }

    private function correctionDeadline(TenantMembership $membership, int $outletId, string $date, bool $personal): array
    {
        $tenantId = (int) $membership->tenant_id;
        $now = CarbonImmutable::now('UTC');
        $calendar = OutletCalendarVersion::query()->forTenant($tenantId)->where('outlet_id', $outletId);
        $historicalTimezone = (clone $calendar)->where('effective_from', '<=', $date)->latest('effective_from')->value('timezone')
            ?? SchedulingDefaults::TIMEZONE;
        $currentTimezone = $historicalTimezone;
        foreach ($calendar->where('effective_from', '<=', $now->addDay()->toDateString())->latest('effective_from')->get() as $version) {
            if ($version->effective_from->toDateString() <= $now->setTimezone($version->timezone)->toDateString()) {
                $currentTimezone = $version->timezone;
                break;
            }
        }
        $cutoff = function (string $policyDate, string $timezone) use ($tenantId, $outletId, $date): CarbonImmutable {
            $configuration = $this->policies->effective($tenantId, $outletId, $policyDate, currentRead: true)['configuration'] ?? [];
            $days = (int) ($configuration['retroactive_request_limit_days'] ?? SchedulingDefaults::attendancePolicy()['retroactive_request_limit_days']);

            return CarbonImmutable::parse($date, $timezone)->addDays($days + 1)->startOfDay()->utc();
        };
        $historical = $cutoff($date, $historicalTimezone);
        $current = $cutoff($now->setTimezone($currentTimezone)->toDateString(), $currentTimezone);
        $limit = $historical->max($current);
        $late = $now->gte($limit) && ! $this->hasRole($membership, TenantRole::Owner);
        if ($personal && $late) {
            throw ValidationException::withMessages(['work_date' => 'Batas pengajuan koreksi untuk Tanggal Kerja ini sudah lewat.']);
        }

        return [
            'historical_timezone' => $historicalTimezone, 'current_timezone' => $currentTimezone,
            'historical_exclusive_at' => $historical->toIso8601String(), 'current_exclusive_at' => $current->toIso8601String(),
            'exclusive_at' => $limit->toIso8601String(), 'owner_required' => $late,
        ];
    }

    /** @return array{request: ApprovalRequest, applied: bool, classification: string} */
    public function administrativeCorrection(
        TenantMembership $membership,
        User $user,
        int $sessionId,
        array $data,
        string $key,
    ): array {
        $submissionHash = $this->payloadHash($data);

        return DB::transaction(function () use ($membership, $user, $sessionId, $data, $key, $submissionHash): array {
            $current = $this->currentMembership($membership, $user);
            $session = AttendanceSession::query()->forTenant((int) $current->tenant_id)->whereKey($sessionId)->first();
            if (! $session) {
                throw new AuthorizationException('Sesi tidak tersedia dalam organisasi aktif.');
            }
            $employee = Employee::query()->forTenant((int) $current->tenant_id)
                ->whereKey($session->employee_id)->lockForUpdate()->firstOrFail();
            $session = AttendanceSession::query()->forTenant((int) $current->tenant_id)->whereKey($sessionId)->lockForUpdate()->first();
            if (! $session || (! $this->hasRole($current, TenantRole::Owner) && ! $this->hasRole($current, TenantRole::Supervisor))
                || (! $this->hasRole($current, TenantRole::Owner) && ! $this->isSupervisorScoped($current, (int) $session->outlet_id))) {
                throw new AuthorizationException('Sesi tidak tersedia dalam cakupan Outlet Anda.');
            }
            $existing = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                ->where('requester_user_id', $user->getKey())->where('submission_key', $key)->lockForUpdate()->first();
            if ($existing) {
                if ((int) $existing->employee_id !== (int) $employee->getKey() || ! hash_equals((string) $existing->submission_hash, $submissionHash)) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci idempotensi sudah digunakan untuk isi koreksi yang berbeda.']);
                }
                $correction = AttendanceCorrection::query()->forTenant((int) $current->tenant_id)
                    ->where('approval_request_id', $existing->getKey())->first();

                return [
                    'request' => $existing,
                    'applied' => $existing->status === 'approved' && $correction?->classification === 'routine',
                    'classification' => $correction?->classification ?? ($existing->details['classification'] ?? 'sensitive'),
                ];
            }
            $prepared = $this->prepareCorrection($current, $user, $employee, $session, $data, false);
            $classification = $this->hasRole($current, TenantRole::Supervisor)
                && ! $prepared['deadline']['owner_required']
                ? $this->classifyCorrection($current, $user, $session, $prepared['original'], $prepared['proposed'])
                : 'sensitive';
            $request = $this->newRequest($current, $user, [
                'employee_id' => (int) $employee->getKey(),
                'outlet_id' => (int) $session->outlet_id,
                'request_type' => 'attendance_correction',
                'status' => $classification === 'routine' ? 'approved' : 'pending',
                'work_date' => $session->work_date->toDateString(),
                'reason' => $this->requiredReason($data),
                'details' => [
                    'attendance_session_id' => (int) $session->getKey(),
                    'historical_primary_outlet_id' => $this->historicalSessionPrimaryOutlet($session),
                    'proposed' => $prepared['proposed'],
                    'classification' => $classification,
                    'submitted_as' => 'administrative_correction',
                    'deadline' => $prepared['deadline'],
                ],
                'submission_key' => $key,
                'submission_hash' => $submissionHash,
            ]);
            AttendanceCorrection::query()->create([
                'tenant_id' => $current->tenant_id,
                'employee_id' => $employee->getKey(),
                'attendance_session_id' => $session->getKey(),
                'approval_request_id' => $request->getKey(),
                'classification' => $classification,
                'contract_version' => AttendanceCorrection::VERSIONED_EFFECT_CONTRACT,
                'basis_correction_id' => $prepared['basis_correction_id'],
                'original_values' => $prepared['original'],
                'proposed_values' => $prepared['proposed'],
                'created_by_user_id' => $user->getKey(),
                'created_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'),
            ]);

            if ($classification === 'routine') {
                $this->applyApprovedCorrection($current, $request, $session, $prepared, $user, $key, 'routine_applied');

                return ['request' => $request->fresh(), 'applied' => true, 'classification' => $classification];
            }

            return ['request' => $request, 'applied' => false, 'classification' => $classification];
        }, attempts: 3);
    }

    public function decide(
        TenantMembership $membership,
        User $user,
        int $requestId,
        string $decision,
        ?string $reason,
        string $key,
    ): ApprovalRequest {
        return DB::transaction(function () use ($membership, $user, $requestId, $decision, $reason, $key): ApprovalRequest {
            $current = $this->currentMembership($membership, $user);
            $tenantId = (int) $current->tenant_id;
            $requestQuery = ApprovalRequest::query()->forTenant($tenantId)->whereKey($requestId);
            $employeeId = (clone $requestQuery)->value('employee_id');
            if ($employeeId === null) {
                throw new AuthorizationException('Permintaan tidak tersedia pada organisasi aktif.');
            }
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->firstOrFail();
            $request = $requestQuery->lockForUpdate()->firstOrFail();
            $this->assertReviewer($current, $user, $request, $employee);

            $prior = ApprovalDecision::query()->forTenant($tenantId)
                ->where('actor_user_id', $user->getKey())->where('idempotency_key', $key)->lockForUpdate()->first();
            if ($prior) {
                $matchesDecision = $prior->action === $decision
                    || ($decision === 'approved' && $prior->action === 'review_accepted')
                    || ($decision === 'rejected' && $prior->action === 'review_rejected');
                if ((int) $prior->approval_request_id !== $requestId || ! $matchesDecision || $prior->reason !== $reason) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci permintaan sudah dipakai untuk keputusan lain.']);
                }

                return $request->load('decisions');
            }

            if ($request->status !== 'pending') {
                throw ValidationException::withMessages(['status' => 'Permintaan ini sudah memiliki keputusan.']);
            }

            if (! in_array($decision, ['approved', 'rejected'], true)) {
                throw ValidationException::withMessages(['decision' => 'Keputusan harus berupa approve atau reject.']);
            }
            if (($decision === 'rejected' || $request->request_type === 'attendance_review' || $request->request_type === 'attendance_correction')
                && trim((string) $reason) === '') {
                throw ValidationException::withMessages(['reason' => 'Alasan keputusan wajib diisi untuk penolakan, koreksi, dan review.']);
            }

            if ($decision === 'approved' && $request->request_type === 'leave') {
                $this->assertNoApprovedLeaveOverlap($request, $employee);
            }

            $correction = $request->request_type === 'attendance_correction' ? AttendanceCorrection::query()
                ->forTenant((int) $current->tenant_id)->where('approval_request_id', $request->getKey())->first() : null;
            $session = $correction
                ? AttendanceSession::query()->forTenant((int) $current->tenant_id)->whereKey($correction->attendance_session_id)->lockForUpdate()->firstOrFail()
                : null;

            if ($decision === 'approved' && $correction && $session) {
                $this->assertCorrectionCanBecomeEffective($request, $correction, $session);
            }

            $reconstruction = ($request->details['correction_target'] ?? null) === 'reconstruction';
            if ($decision === 'approved' && $reconstruction) {
                $claim = $request->details['proposed'];
                $this->assertReconstructionAvailable($employee, $claim, (int) $request->getKey());
                $assignment = $this->historicalAssignment($employee, $claim);
                if (! $assignment && ! $this->hasRole($current, TenantRole::Owner)) {
                    throw new AuthorizationException('Pengecualian penugasan historis memerlukan persetujuan Owner.');
                }
                $claim['historical_primary_outlet_id'] = $request->details['historical_primary_outlet_id'] ?? null;
                $claim['historical_assignment_id'] = $assignment?->getKey();
                $claim['assignment_exception_approved'] = $assignment === null;
            }
            $request->forceFill(['status' => $decision])->save();
            $action = match (true) {
                $request->request_type === 'attendance_review' && $decision === 'approved' => 'review_accepted',
                $request->request_type === 'attendance_review' && $decision === 'rejected' => 'review_rejected',
                default => $decision,
            };
            $decisionRow = $this->recordDecision($current, $request, $user, $action, $reason, $key,
                $correction?->original_values, $reconstruction ? $request->details['proposed'] : $correction?->proposed_values,
                $decision === 'approved' ? ($reconstruction ? $claim : $correction?->proposed_values) : null);

            if ($decision === 'approved' && $request->request_type === 'attendance_correction') {
                CorrectionEvidenceService::recordSupplementForApproval($request, $current, (int) $decisionRow->getKey());
                if ($correction && $session) {
                    $this->reconcileMissingCheckout($request, $session);
                }
            }

            if ($decision === 'approved' && $reconstruction) {
                $leave = ApprovalRequest::query()->forTenant((int) $request->tenant_id)
                    ->where('employee_id', $employee->getKey())->where('request_type', 'leave')->where('status', 'approved')
                    ->where('starts_on', '<=', $claim['work_date'])->where('ends_on', '>=', $claim['work_date'])
                    ->lockForUpdate()->first();
                if ($leave) {
                    $this->createReconstructionLeaveConflict($request, $leave);
                }
            }

            if ($decision === 'approved' && $request->request_type === 'leave') {
                $this->createLeaveAttendanceConflictCases($request, $employee);
            }

            return $request->fresh()->load('decisions');
        }, attempts: 3);
    }

    public function reverse(
        TenantMembership $membership,
        User $user,
        int $requestId,
        int $decisionId,
        string $reason,
        string $key,
    ): void {
        $reason = $this->requiredReason(['reason' => $reason]);

        DB::transaction(function () use ($membership, $user, $requestId, $decisionId, $reason, $key): void {
            $current = $this->currentMembership($membership, $user);
            if (! $this->hasRole($current, TenantRole::Owner)) {
                throw new AuthorizationException('Pembalikan koreksi hanya tersedia untuk Owner.');
            }

            $tenantId = (int) $current->tenant_id;
            $requestQuery = ApprovalRequest::query()->forTenant($tenantId)
                ->whereKey($requestId)->where('request_type', 'attendance_correction');
            $employeeId = (clone $requestQuery)->value('employee_id');
            if ($employeeId === null) {
                throw new AuthorizationException('Koreksi tidak tersedia dalam organisasi aktif.');
            }
            $employee = Employee::query()->forTenant($tenantId)->whereKey($employeeId)->lockForUpdate()->firstOrFail();
            $request = $requestQuery->lockForUpdate()->firstOrFail();
            $decisions = ApprovalDecision::query()->forTenant($tenantId)->where('approval_request_id', $requestId);
            $prior = ApprovalDecision::query()->forTenant($tenantId)
                ->where('actor_user_id', $user->getKey())->where('idempotency_key', $key)->lockForUpdate()->first();
            if ($prior) {
                if ($prior->action !== 'reversed' || (int) $prior->approval_request_id !== $requestId
                    || ($prior->proposed_values['reverses_decision_id'] ?? null) !== $decisionId || $prior->reason !== $reason) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci permintaan sudah dipakai untuk keputusan lain.']);
                }

                return;
            }
            $applied = (clone $decisions)->whereIn('action', ['approved', 'routine_applied'])
                ->orderByDesc('acted_at')->orderByDesc('id')->lockForUpdate()->first();
            if ($request->status !== 'approved' || ! $applied || (int) $applied->getKey() !== $decisionId
                || (clone $decisions)->where('action', 'reversed')->lockForUpdate()->first(['id'])) {
                throw ValidationException::withMessages(['decision_id' => 'Keputusan koreksi sudah berubah atau tidak dapat dibalik.']);
            }

            $correction = AttendanceCorrection::query()->forTenant($tenantId)
                ->where('approval_request_id', $requestId)->first();
            $before = $applied->effective_values ?? $correction?->proposed_values;
            $after = null;
            if ($correction) {
                $session = AttendanceSession::query()->forTenant($tenantId)->where('employee_id', $employeeId)
                    ->whereKey($correction->attendance_session_id)->lockForUpdate()->firstOrFail();
                if ((int) $this->approvedCorrectionBasis($session)?->getKey() !== (int) $correction->getKey()) {
                    throw ValidationException::withMessages(['decision_id' => 'Balikkan koreksi lanjutan yang masih berlaku terlebih dahulu.']);
                }
                $previous = $this->approvedCorrectionBasis($session, $requestId);
                $after = $previous?->proposed_values ?? [
                    'check_in_at' => $session->check_in_at->utc()->toIso8601String(),
                    'check_out_at' => null,
                    'work_date' => $session->work_date->toDateString(),
                    'outlet_id' => (int) $session->outlet_id,
                ];
                $after['check_out_at'] ??= $session->check_out_at?->utc()->toIso8601String();
                $this->assertNoOverlappingAttendance($employee, $session, [
                    ...$after,
                    'check_out_at' => $after['check_out_at'] ?? ($session->status === 'active' ? CarbonImmutable::now('UTC')->toIso8601String() : null),
                ]);
            } elseif (($request->details['correction_target'] ?? null) !== 'reconstruction') {
                throw ValidationException::withMessages(['decision_id' => 'Keputusan koreksi tidak memiliki efek yang dapat dibalik.']);
            }

            $this->recordDecision($current, $request, $user, 'reversed', $reason, $key, $before,
                ['reverses_decision_id' => $decisionId], $after);
        }, attempts: 3);
    }

    public function cancel(TenantMembership $membership, User $user, int $requestId, string $key): ApprovalRequest
    {
        return DB::transaction(function () use ($membership, $user, $requestId, $key): ApprovalRequest {
            $current = $this->currentMembership($membership, $user);
            $prior = ApprovalDecision::query()->forTenant((int) $current->tenant_id)
                ->where('actor_user_id', $user->getKey())->where('idempotency_key', $key)->first();
            if ($prior) {
                if ((int) $prior->approval_request_id !== $requestId || $prior->action !== 'cancelled') {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci permintaan sudah dipakai untuk tindakan lain.']);
                }

                return ApprovalRequest::query()->forTenant((int) $current->tenant_id)->with('decisions')->whereKey($requestId)->firstOrFail();
            }

            $requestQuery = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                ->whereKey($requestId)->where('requester_user_id', $user->getKey());
            $employeeId = (clone $requestQuery)->value('employee_id');
            if ($employeeId === null) {
                throw new AuthorizationException('Permintaan ini tidak dapat dibatalkan oleh akun Anda.');
            }
            Employee::query()->forTenant((int) $current->tenant_id)->whereKey($employeeId)->lockForUpdate()->firstOrFail();
            $request = $requestQuery->lockForUpdate()->firstOrFail();

            $prior = ApprovalDecision::query()->forTenant((int) $current->tenant_id)
                ->where('actor_user_id', $user->getKey())->where('idempotency_key', $key)->lockForUpdate()->first();
            if ($prior) {
                if ((int) $prior->approval_request_id !== $requestId || $prior->action !== 'cancelled') {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci permintaan sudah dipakai untuk tindakan lain.']);
                }

                return $request->load('decisions');
            }

            if ($request->status !== 'pending') {
                throw ValidationException::withMessages(['status' => 'Hanya permintaan yang masih menunggu yang dapat dibatalkan.']);
            }

            $request->forceFill(['status' => 'cancelled'])->save();
            $this->recordDecision($current, $request, $user, 'cancelled', null, $key);

            return $request->fresh()->load('decisions');
        }, attempts: 3);
    }

    /** @return array<string, int> */
    public function discoverReviews(TenantMembership $membership, User $user, string $from, string $to): array
    {
        $current = $this->currentMembership($membership, $user);
        if (! $this->hasRole($current, TenantRole::Owner) && ! $this->hasRole($current, TenantRole::Supervisor)) {
            throw new AuthorizationException('Approval Center hanya tersedia untuk Owner dan Supervisor.');
        }

        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $to, 'UTC');
        if (! $start || ! $end || $end->lessThan($start) || $start->diffInDays($end) > 13 || $end->greaterThan(CarbonImmutable::now('UTC')->endOfDay())) {
            throw ValidationException::withMessages(['to' => 'Pemeriksaan kasus mencakup maksimal 14 hari yang sudah berjalan.']);
        }

        if ($this->hasRole($current, TenantRole::Owner)) {
            $employeeIds = Employee::query()->forTenant((int) $current->tenant_id)->pluck('id')->map(fn ($id): int => (int) $id)->all();
        } else {
            $scopeIds = SupervisorOutletScope::query()->forTenant((int) $current->tenant_id)
                ->where('tenant_membership_id', $current->getKey())->pluck('outlet_id')->all();
            $employeeIds = EmployeeOutletAssignment::query()->forTenant((int) $current->tenant_id)
                ->whereIn('outlet_id', $scopeIds)
                ->where('effective_from', '<', $end->addDay()->endOfDay())
                ->where('effective_until', '>', $start->startOfDay())
                ->distinct()->pluck('employee_id')->map(fn ($id): int => (int) $id)->all();
        }
        $created = 0;
        $existing = 0;

        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $workDate = $date->toDateString();
            foreach ($employeeIds as $employeeId) {
                $schedule = $this->schedules->resolve((int) $current->tenant_id, $employeeId, $workDate);
                $sessions = AttendanceSession::query()->forTenant((int) $current->tenant_id)
                    ->where('employee_id', $employeeId)->where('work_date', $workDate)->get();
                $approvedLeave = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                    ->where('employee_id', $employeeId)->where('request_type', 'leave')->where('status', 'approved')
                    ->where('starts_on', '<=', $workDate)->where('ends_on', '>=', $workDate)->exists();

                $reconstructed = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
                    ->where('employee_id', $employeeId)->where('work_date', $workDate)
                    ->where('request_type', 'attendance_correction')->where('status', 'approved')->withoutReversal()
                    ->where('details->correction_target', 'reconstruction')->exists();

                if ($sessions->isEmpty() && ! $reconstructed && $schedule->status === 'scheduled' && $schedule->scheduledEnd !== null
                    && CarbonImmutable::parse($schedule->scheduledEnd)->utc()->lessThanOrEqualTo(CarbonImmutable::now('UTC')) && ! $approvedLeave) {
                    $result = $this->createReviewCase($current, $employeeId, $schedule->outletId, $workDate, 'potential_absence', [
                        'case_type' => 'potential_absence',
                        'schedule' => $schedule->toArray(),
                        'indicators' => ['potential_absence'],
                    ]);
                    $result ? $created++ : $existing++;
                }

                foreach ($sessions as $session) {
                    $indicators = $session->review_indicators ?? [];
                    $missingCheckout = false;
                    if ($session->status === 'active') {
                        $expectedEnd = $session->schedule_snapshot['scheduled_end'] ?? null;
                        $graceEnd = $expectedEnd
                            ? CarbonImmutable::parse($expectedEnd)->utc()
                            : $session->check_in_at->utc()->addHours(16);
                        if ($graceEnd->lessThanOrEqualTo(CarbonImmutable::now('UTC'))) {
                            $indicators[] = 'missing_checkout';
                            $missingCheckout = true;
                        }
                    }

                    if ($approvedLeave) {
                        $indicators[] = 'approved_leave_with_recorded_attendance';
                    }
                    $indicators = array_values(array_unique($indicators));
                    if ($indicators === []) {
                        continue;
                    }

                    $result = $this->createReviewCase($current, $employeeId, (int) $session->outlet_id, $workDate, 'attendance_exception', [
                        'case_type' => $missingCheckout ? 'missing_checkout' : 'attendance_exception',
                        'attendance_session_id' => (int) $session->getKey(),
                        'indicators' => $indicators,
                        'schedule' => $session->schedule_snapshot,
                    ]);
                    $result ? $created++ : $existing++;
                }
            }
        }

        return ['created' => $created, 'existing' => $existing];
    }

    public function finalize(
        TenantMembership $membership,
        User $user,
        int $employeeId,
        string $workDate,
        string $outcome,
        string $reason,
        ?string $reviewedBasis = null,
    ): AttendanceFinalization {
        $reason = $this->requiredReason(['reason' => $reason]);

        return DB::transaction(function () use ($membership, $user, $employeeId, $workDate, $outcome, $reason, $reviewedBasis): AttendanceFinalization {
            $current = $this->currentMembership($membership, $user);
            $owner = $this->hasRole($current, TenantRole::Owner);
            if (! $owner && ! $this->hasRole($current, TenantRole::Supervisor)) {
                throw new AuthorizationException('Finalisasi hanya tersedia untuk Owner dan Supervisor.');
            }

            $employee = Employee::query()->forTenant((int) $current->tenant_id)->whereKey($employeeId)->lockForUpdate()->first();
            if (! $employee || ! $this->canManageEmployeeOnDate($current, $employeeId, $workDate)) {
                throw new AuthorizationException('Karyawan tidak tersedia dalam cakupan akses Anda pada tanggal tersebut.');
            }
            $hasLinkedSubject = EmployeeUserLink::query()->forTenant((int) $current->tenant_id)
                ->join('tenant_memberships', 'tenant_memberships.id', '=', 'employee_user_links.tenant_membership_id')
                ->where('tenant_memberships.user_id', $user->getKey())
                ->where('employee_user_links.employee_id', $employeeId)->exists();
            if ($hasLinkedSubject) {
                throw new AuthorizationException('Identitas karyawan Anda tidak dapat memfinalisasi hasil kehadiran sendiri.');
            }

            $projection = $this->projection->project((int) $current->tenant_id, $employeeId, $workDate);
            if (! $owner) {
                foreach ($projection['sources'] as $source) {
                    if (! $this->isSupervisorScoped($current, (int) $source['effective']['outlet_id'])
                        || ($source['physical'] !== null && ! $this->isSupervisorScoped($current, (int) $source['physical']['outlet_id']))) {
                        throw new AuthorizationException('Sumber kehadiran berada di luar cakupan Outlet Anda.');
                    }
                }
            }
            if ($projection['review']['status'] === 'pending' || $projection['unresolved_conflicts'] !== []) {
                throw ValidationException::withMessages(['work_date' => 'Kasus review atau konflik kehadiran harus diselesaikan sebelum finalisasi.']);
            }

            $this->assertOutcomeMatchesProjection($projection, $outcome);
            $latest = AttendanceFinalization::query()->forTenant((int) $current->tenant_id)
                ->where('employee_id', $employeeId)->where('work_date', $workDate)->orderByDesc('revision')->first();
            if ($latest) {
                if (! $projection['requires_refinalization']) {
                    throw ValidationException::withMessages(['work_date' => 'Hasil ini sudah difinalisasi dan belum memiliki perubahan koreksi.']);
                }
                if (! $owner) {
                    $outletIds = [(int) $latest->outlet_id];
                    $newReversals = array_diff(
                        $projection['projection_provenance']['correction_reversal_ids'],
                        $latest->projection_snapshot['projection_provenance']['correction_reversal_ids'] ?? [],
                    );
                    foreach (ApprovalDecision::query()->forTenant((int) $current->tenant_id)
                        ->where('employee_id', $employeeId)->where('action', 'reversed')->whereKey($newReversals)->get() as $reversal) {
                        $outletIds[] = (int) $reversal->original_values['outlet_id'];
                        if ($reversal->effective_values !== null) {
                            $outletIds[] = (int) $reversal->effective_values['outlet_id'];
                        }
                    }
                    foreach (array_unique($outletIds) as $outletId) {
                        if (! $this->isSupervisorScoped($current, $outletId)) {
                            throw new AuthorizationException('Riwayat finalisasi berada di luar cakupan Outlet Anda.');
                        }
                    }
                }
                if ($reviewedBasis !== $projection['finalization_review_basis']) {
                    throw ValidationException::withMessages(['reviewed_basis' => 'Tinjau kembali perubahan kehadiran terbaru sebelum menetapkan hasil.']);
                }
            }

            $revision = ($latest?->revision ?? 0) + 1;

            $sourceOutlets = collect($projection['sources'])->pluck('effective.outlet_id')->unique();

            $projection['is_finalized'] = true;
            $projection['requires_refinalization'] = false;
            $projection['finalization_review_basis'] = null;
            if ($projection['finalization'] !== null) {
                unset($projection['finalization']['projection_snapshot']);
            }

            return AttendanceFinalization::query()->create([
                'tenant_id' => $current->tenant_id,
                'employee_id' => $employeeId,
                'outlet_id' => $projection['outlet']['id'] ?? ($sourceOutlets->count() === 1 ? $sourceOutlets->first() : null),
                'work_date' => $workDate,
                'revision' => $revision,
                'outcome' => $outcome,
                'reason' => trim($reason),
                'projection_snapshot' => $projection,
                'actor_user_id' => $user->getKey(),
                'finalized_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'),
            ]);
        }, attempts: 3);
    }

    /** @return array<string, mixed> */
    public function queue(TenantMembership $membership, User $user, array $filters = []): array
    {
        $current = $this->currentMembership($membership, $user);
        if (! $this->hasRole($current, TenantRole::Owner) && ! $this->hasRole($current, TenantRole::Supervisor)) {
            throw new AuthorizationException('Approval Center hanya tersedia untuk Owner dan Supervisor.');
        }

        $query = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
            ->with(['employee', 'outlet', 'decisions', 'correction'])
            ->whereIn('status', ['pending', 'approved', 'rejected', 'cancelled']);
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['type'])) {
            $query->where('request_type', $filters['type']);
        }
        if (! empty($filters['employee_id'])) {
            $query->where('employee_id', (int) $filters['employee_id']);
        }
        if (! empty($filters['outlet_id']) && $this->hasRole($current, TenantRole::Owner)) {
            $query->where('outlet_id', (int) $filters['outlet_id']);
        }
        if (! empty($filters['from']) || ! empty($filters['to'])) {
            $from = $filters['from'] ?? '0001-01-01';
            $to = $filters['to'] ?? '9999-12-31';
            $query->where(function ($dateQuery) use ($from, $to): void {
                $dateQuery->whereBetween('work_date', [$from, $to])
                    ->orWhere(fn ($range) => $range->where('starts_on', '<=', $to)->where('ends_on', '>=', $from));
            });
        }

        if (! $this->hasRole($current, TenantRole::Owner)) {
            $scopeIds = SupervisorOutletScope::query()->forTenant((int) $current->tenant_id)
                ->where('tenant_membership_id', $current->getKey())->pluck('outlet_id')->map(fn ($id): int => (int) $id)->all();
            if (isset($filters['outlet_id']) && ! in_array((int) $filters['outlet_id'], $scopeIds, true)) {
                throw new AuthorizationException('Outlet berada di luar cakupan Supervisor.');
            }
            $candidateScope = isset($filters['outlet_id']) ? [(int) $filters['outlet_id']] : $scopeIds;
            $query->where(function ($scoped) use ($candidateScope): void {
                $scoped->whereIn('outlet_id', $candidateScope)
                    ->orWhere(function ($correction) use ($candidateScope): void {
                        $correction->where('request_type', 'attendance_correction')
                            ->where(function ($primary) use ($candidateScope): void {
                                $primary->whereIn(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.historical_primary_outlet_id'))"), array_map('strval', $candidateScope))
                                    ->orWhereHas('correction.session', function ($session) use ($candidateScope): void {
                                        $session->whereExists(DB::table('employee_outlet_assignments as historical')
                                            ->whereColumn('historical.tenant_id', 'attendance_sessions.tenant_id')
                                            ->whereColumn('historical.employee_id', 'attendance_sessions.employee_id')
                                            ->where('historical.assignment_type', EmployeeOutletAssignmentType::Primary->value)
                                            ->whereIn('historical.outlet_id', $candidateScope)
                                            ->whereColumn('historical.effective_from', '<=', 'attendance_sessions.check_in_at')
                                            ->whereColumn('historical.effective_until', '>', 'attendance_sessions.check_in_at'));
                                    });
                            });
                    });
            });
        }

        $requests = $query->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
            ->orderByDesc('created_at')->orderByDesc('id');
        $requests = $this->hasRole($current, TenantRole::Owner)
            ? $requests->limit(200)->get()
            : $requests->lazy(200)->filter(fn (ApprovalRequest $request): bool => $request->request_type !== 'attendance_correction'
                || $this->canViewRequest($current, $user, $request))->take(200)->collect();
        $pending = $requests->where('status', 'pending')->count();

        return [
            'pending_count' => $pending,
            'requests' => $requests->map(fn (ApprovalRequest $request): array => $this->requestView($current, $user, $request))->values()->all(),
        ];
    }

    /** Called inside an evidence transaction. Use the same current request scope as the approval API. */
    public function lockCorrectionEvidenceRequest(TenantMembership $membership, User $user, int $requestId, bool $review = false): ApprovalRequest
    {
        $current = $this->currentMembership($membership, $user);
        $request = ApprovalRequest::query()->forTenant((int) $current->tenant_id)->whereKey($requestId)
            ->where('request_type', 'attendance_correction')->lockForUpdate()->first();
        if (! $request) {
            throw new AuthorizationException('Bukti koreksi tidak tersedia dalam cakupan akses Anda.');
        }
        $ownsSubject = ! $review && $this->hasRole($current, TenantRole::Employee)
            && EmployeeUserLink::query()->forTenant((int) $current->tenant_id)
                ->where('tenant_membership_id', $current->getKey())->where('employee_id', $request->employee_id)
                ->lockForUpdate()->first() !== null;
        if (! $ownsSubject) {
            $proposer = ! $review && (int) $request->requester_user_id === (int) $user->getKey();
            $this->assertReviewer($current, $user, $request, $request->employee, evidenceProposer: $proposer);
        }

        return $request;
    }

    public function show(TenantMembership $membership, User $user, int $requestId): array
    {
        $current = $this->currentMembership($membership, $user);
        $request = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
            ->with(['employee', 'outlet', 'decisions', 'correction'])->whereKey($requestId)->first();
        if (! $request || ! $this->canViewRequest($current, $user, $request)) {
            throw new AuthorizationException('Permintaan tidak tersedia dalam cakupan akses Anda.');
        }

        return $this->requestView($current, $user, $request);
    }

    /** @return list<array<string, mixed>> */
    public function ownRequests(TenantMembership $membership, User $user): array
    {
        $current = $this->currentMembership($membership, $user);
        $employeeId = EmployeeUserLink::query()->forTenant((int) $current->tenant_id)
            ->where('tenant_membership_id', $current->getKey())->value('employee_id');
        $requests = ApprovalRequest::query()->forTenant((int) $current->tenant_id)
            ->with(['employee', 'outlet', 'decisions', 'correction'])
            ->where(fn ($query) => $query->where('requester_user_id', $user->getKey())
                ->when($employeeId !== null, fn ($subject) => $subject->orWhere('employee_id', $employeeId)))
            ->orderByDesc('created_at')->limit(100)->get();

        return $requests->map(fn (ApprovalRequest $request): array => $this->requestView($current, $user, $request))->all();
    }

    private function createLeaveRequest(TenantMembership $membership, User $user, Employee $employee, array $data, string $key): ApprovalRequest
    {
        $category = (string) ($data['category'] ?? '');
        if (! in_array($category, ['permission', 'sick', 'annual'], true)) {
            throw ValidationException::withMessages(['category' => 'Pilih Izin, Sakit, atau Cuti.']);
        }

        $from = $this->date((string) ($data['starts_on'] ?? ''), 'starts_on');
        $to = $this->date((string) ($data['ends_on'] ?? ''), 'ends_on');
        if ($to->lessThan($from) || $from->diffInDays($to) > 30) {
            throw ValidationException::withMessages(['ends_on' => 'Rentang permintaan harus 1 sampai 31 hari.']);
        }
        if ($from->lessThan(CarbonImmutable::now('Asia/Jakarta')->startOfDay()->subDays(30))) {
            throw ValidationException::withMessages(['starts_on' => 'Pengajuan historis dibatasi sampai 30 hari terakhir.']);
        }

        $reason = $this->requiredReason($data);
        $this->assertNoApprovedLeaveOverlapForRange($employee, $from->toDateString(), $to->toDateString());
        $outletId = $this->outletForDateRange((int) $membership->tenant_id, (int) $employee->getKey(), $from->toDateString(), $to->toDateString());

        return $this->newRequest($membership, $user, [
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outletId,
            'request_type' => 'leave',
            'status' => 'pending',
            'starts_on' => $from->toDateString(),
            'ends_on' => $to->toDateString(),
            'reason' => $reason,
            'details' => ['category' => $category, 'starts_on' => $from->toDateString(), 'ends_on' => $to->toDateString()],
            'submission_key' => $key,
            'submission_hash' => $this->payloadHash($data),
        ]);
    }

    private function createOvertimeRequest(TenantMembership $membership, User $user, Employee $employee, array $data, string $key): ApprovalRequest
    {
        $workDate = $this->date((string) ($data['work_date'] ?? ''), 'work_date');
        $startInput = (string) ($data['starts_at'] ?? '');
        $endInput = (string) ($data['ends_at'] ?? '');
        if (! preg_match('/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/D', $startInput, $startParts)
            || ! preg_match('/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/D', $endInput, $endParts)
            || $startParts[1] !== $workDate->toDateString()) {
            throw ValidationException::withMessages(['starts_at' => 'Waktu lembur harus menggunakan tanggal kerja dan format jam lokal yang valid.']);
        }
        $schedule = $this->schedules->resolve((int) $membership->tenant_id, (int) $employee->getKey(), $workDate->toDateString());
        $timezone = $schedule->timezone;
        $endDate = $endParts[1];
        if ($endDate !== $workDate->toDateString() && $endDate !== $workDate->addDay()->toDateString()) {
            throw ValidationException::withMessages(['ends_at' => 'Waktu selesai lembur harus berada pada tanggal kerja atau hari berikutnya.']);
        }
        $start = CarbonImmutable::instance($this->localTime->instant($startParts[1], $startParts[2].':00', $timezone));
        $end = CarbonImmutable::instance($this->localTime->instant($endDate, $endParts[2].':00', $timezone));
        if ($end->lessThanOrEqualTo($start) || $end->getTimestamp() - $start->getTimestamp() > 16 * 60 * 60) {
            throw ValidationException::withMessages(['ends_at' => 'Waktu lembur harus berurutan dan maksimal 16 jam.']);
        }

        $sessionId = isset($data['attendance_session_id']) ? (int) $data['attendance_session_id'] : null;
        $outletId = null;
        if ($sessionId !== null) {
            $session = AttendanceSession::query()->forTenant((int) $membership->tenant_id)
                ->where('employee_id', $employee->getKey())->whereKey($sessionId)->first();
            if (! $session) {
                throw ValidationException::withMessages(['attendance_session_id' => 'Sesi kehadiran tidak tersedia untuk karyawan ini.']);
            }
            if ($session->work_date->toDateString() !== $workDate->toDateString()) {
                throw ValidationException::withMessages(['attendance_session_id' => 'Sesi kehadiran harus berasal dari tanggal lembur yang diajukan.']);
            }
            $outletId = (int) $session->outlet_id;
        } else {
            $outletId = $this->outletForDateRange((int) $membership->tenant_id, (int) $employee->getKey(), $workDate->toDateString(), $workDate->toDateString());
        }

        return $this->newRequest($membership, $user, [
            'employee_id' => $employee->getKey(),
            'outlet_id' => $outletId,
            'request_type' => 'overtime',
            'status' => 'pending',
            'work_date' => $workDate->toDateString(),
            'reason' => $this->requiredReason($data),
            'details' => [
                'starts_at' => $start->toIso8601String(),
                'ends_at' => $end->toIso8601String(),
                'requested_minutes' => intdiv($end->getTimestamp() - $start->getTimestamp(), 60),
                'attendance_session_id' => $sessionId,
            ],
            'submission_key' => $key,
            'submission_hash' => $this->payloadHash($data),
        ]);
    }

    private function createCorrectionRequest(TenantMembership $membership, User $user, Employee $employee, array $data, string $key, bool $employeeSubmitted): ApprovalRequest
    {
        $sessionId = (int) ($data['attendance_session_id'] ?? 0);
        $session = AttendanceSession::query()->forTenant((int) $membership->tenant_id)
            ->where('employee_id', $employee->getKey())->whereKey($sessionId)->lockForUpdate()->first();
        if (! $session) {
            throw ValidationException::withMessages(['attendance_session_id' => 'Sesi kehadiran tidak tersedia untuk identitas Anda.']);
        }

        $prepared = $this->prepareCorrection($membership, $user, $employee, $session, $data, $employeeSubmitted);
        $classification = $employeeSubmitted ? 'sensitive' : $this->classifyCorrection($membership, $user, $session, $prepared['original'], $prepared['proposed']);
        $request = $this->newRequest($membership, $user, [
            'employee_id' => $employee->getKey(),
            'outlet_id' => (int) $session->outlet_id,
            'request_type' => 'attendance_correction',
            'status' => 'pending',
            'work_date' => $session->work_date->toDateString(),
            'reason' => $this->requiredReason($data),
            'details' => [
                'attendance_session_id' => (int) $session->getKey(),
                'historical_primary_outlet_id' => $this->historicalSessionPrimaryOutlet($session),
                'original' => $prepared['original'],
                'deadline' => $prepared['deadline'],
                'proposed' => $prepared['proposed'],
                'classification' => $classification,
            ],
            'submission_key' => $key,
            'submission_hash' => $this->payloadHash($data),
        ]);
        AttendanceCorrection::query()->create([
            'tenant_id' => $membership->tenant_id,
            'employee_id' => $employee->getKey(),
            'attendance_session_id' => $session->getKey(),
            'approval_request_id' => $request->getKey(),
            'classification' => $classification,
            'contract_version' => AttendanceCorrection::VERSIONED_EFFECT_CONTRACT,
            'basis_correction_id' => $prepared['basis_correction_id'],
            'original_values' => $prepared['original'],
            'proposed_values' => $prepared['proposed'],
            'created_by_user_id' => $user->getKey(),
            'created_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'),
        ]);

        return $request;
    }

    /** @return array{original: array<string, mixed>, proposed: array<string, mixed>, basis_correction_id: int|null} */
    private function prepareCorrection(TenantMembership $membership, User $user, Employee $employee, AttendanceSession $session, array $data, bool $employeeSubmitted): array
    {
        $reason = $this->requiredReason($data);
        unset($reason);
        $recorded = [
            'check_in_at' => $session->check_in_at->utc()->toIso8601String(),
            'check_out_at' => $session->check_out_at?->utc()->toIso8601String(),
            'work_date' => $session->work_date->toDateString(),
            'outlet_id' => (int) $session->outlet_id,
            'recording_status' => $session->status,
        ];
        $basis = $this->approvedCorrectionBasis($session);
        $effective = $basis?->proposed_values ?? [
            'check_in_at' => $recorded['check_in_at'],
            'check_out_at' => $recorded['check_out_at'],
            'work_date' => $recorded['work_date'],
            'outlet_id' => $recorded['outlet_id'],
        ];
        $effective['check_out_at'] ??= $recorded['check_out_at'];
        $original = [
            ...$effective, 'recording_status' => $session->status, 'recorded' => $recorded,
            'basis_reversal_id' => $this->latestSessionReversalId($session),
        ];
        $proposed = $effective;

        foreach (['effective_check_in_at' => 'check_in_at', 'effective_check_out_at' => 'check_out_at'] as $input => $target) {
            if (array_key_exists($input, $data)) {
                $proposed[$target] = $data[$input] === null || $data[$input] === '' ? null : $this->instant((string) $data[$input], $input)->toIso8601String();
            }
        }
        if (isset($data['effective_work_date'])) {
            $proposed['work_date'] = $this->date((string) $data['effective_work_date'], 'effective_work_date')->toDateString();
        }
        if (isset($data['effective_outlet_id'])) {
            $outlet = Outlet::query()->forTenant((int) $membership->tenant_id)->whereKey((int) $data['effective_outlet_id'])->first();
            if (! $outlet) {
                throw ValidationException::withMessages(['effective_outlet_id' => 'Outlet tujuan tidak tersedia pada organisasi aktif.']);
            }
            $proposed['outlet_id'] = (int) $outlet->getKey();
        }

        if (! array_key_exists('effective_check_in_at', $data)
            && ! array_key_exists('effective_check_out_at', $data)
            && ! array_key_exists('effective_work_date', $data)
            && ! array_key_exists('effective_outlet_id', $data)) {
            throw ValidationException::withMessages(['correction' => 'Isi minimal satu nilai efektif yang ingin dikoreksi.']);
        }
        if ($proposed['check_in_at'] === null) {
            throw ValidationException::withMessages(['effective_check_in_at' => 'Waktu check-in efektif wajib tersedia.']);
        }
        if ($proposed['check_out_at'] !== null && CarbonImmutable::parse($proposed['check_out_at'])->lessThanOrEqualTo(CarbonImmutable::parse($proposed['check_in_at']))) {
            throw ValidationException::withMessages(['effective_check_out_at' => 'Waktu checkout harus setelah check-in.']);
        }
        $now = CarbonImmutable::now('UTC');
        if (CarbonImmutable::parse($proposed['check_in_at'])->greaterThan($now)
            || ($proposed['check_out_at'] !== null && CarbonImmutable::parse($proposed['check_out_at'])->greaterThan($now))) {
            throw ValidationException::withMessages(['correction' => 'Koreksi kehadiran tidak dapat menetapkan waktu di masa depan.']);
        }
        if (CarbonImmutable::parse($proposed['work_date'], 'Asia/Jakarta')->greaterThan(CarbonImmutable::now('Asia/Jakarta')->startOfDay())) {
            throw ValidationException::withMessages(['effective_work_date' => 'Tanggal kerja efektif tidak dapat berada di masa depan.']);
        }

        if ((int) $proposed['outlet_id'] !== (int) $session->outlet_id
            && ! $this->isAssignedAt((int) $membership->tenant_id, (int) $employee->getKey(), (int) $proposed['outlet_id'], (string) $proposed['work_date'])) {
            throw ValidationException::withMessages(['effective_outlet_id' => 'Karyawan tidak memiliki penugasan yang sesuai pada Outlet tujuan.']);
        }
        $deadline = $this->correctionDeadline($membership, (int) $original['outlet_id'], $original['work_date'], $employeeSubmitted);
        $this->assertNoOverlappingAttendance($employee, $session, $proposed);

        return ['original' => $original, 'proposed' => $proposed, 'basis_correction_id' => $basis ? (int) $basis->getKey() : null, 'deadline' => $deadline];
    }

    private function classifyCorrection(TenantMembership $membership, User $user, AttendanceSession $session, array $original, array $proposed): string
    {
        $tenantId = (int) $membership->tenant_id;
        $ownEmployee = EmployeeUserLink::query()->forTenant($tenantId)
            ->join('tenant_memberships', 'tenant_memberships.id', '=', 'employee_user_links.tenant_membership_id')
            ->where('tenant_memberships.user_id', $user->getKey())->where('employee_user_links.employee_id', $session->employee_id)->exists();
        $isFinalized = AttendanceFinalization::query()->forTenant($tenantId)
            ->where('employee_id', $session->employee_id)
            ->whereIn('work_date', array_values(array_unique([$session->work_date->toDateString(), (string) $proposed['work_date']])))
            ->exists();
        $hasPendingSensitive = AttendanceCorrection::query()->forTenant($tenantId)
            ->where('attendance_session_id', $session->getKey())->where('classification', 'sensitive')
            ->whereIn('approval_request_id', ApprovalRequest::query()->forTenant($tenantId)->where('status', 'pending')->select('id'))->exists();
        $indicators = $session->review_indicators ?? [];
        $oldStart = CarbonImmutable::parse($original['check_in_at'])->utc();
        $newStart = CarbonImmutable::parse($proposed['check_in_at'])->utc();
        $startDelta = abs($oldStart->diffInSeconds($newStart, false));
        $endDelta = null;
        if ($original['check_out_at'] !== null && $proposed['check_out_at'] !== null) {
            $endDelta = abs(CarbonImmutable::parse($original['check_out_at'])->utc()->diffInSeconds(CarbonImmutable::parse($proposed['check_out_at'])->utc(), false));
        }
        $sameContext = $original['work_date'] === $proposed['work_date'] && (int) $original['outlet_id'] === (int) $proposed['outlet_id'];
        $recent = CarbonImmutable::parse($session->work_date->toDateString(), 'Asia/Jakarta')
            ->greaterThanOrEqualTo(CarbonImmutable::now('Asia/Jakarta')->startOfDay()->subDays(7));

        return ! $ownEmployee && ! $isFinalized && ! $hasPendingSensitive && $indicators === []
            && $session->status === 'closed' && $original['check_out_at'] !== null && $proposed['check_out_at'] !== null
            && $sameContext && $recent && $startDelta <= 900 && $endDelta !== null && $endDelta <= 900
            ? 'routine'
            : 'sensitive';
    }

    private function assertCorrectionCanBecomeEffective(ApprovalRequest $request, AttendanceCorrection $correction, AttendanceSession $session): void
    {
        $tenantId = (int) $request->tenant_id;
        $employee = Employee::query()->forTenant($tenantId)->whereKey($request->employee_id)->lockForUpdate()->firstOrFail();
        $basis = $this->approvedCorrectionBasis($session);
        $reversalId = $this->latestSessionReversalId($session);
        $staleBasis = ValidationException::withMessages(['correction' => 'Koreksi lain sudah mengubah sesi ini; buat pengajuan baru berdasarkan nilai efektif terbaru.']);
        if ($correction->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT) {
            if ($correction->basis_correction_id !== ($basis ? (int) $basis->getKey() : null)
                || ($correction->original_values['basis_reversal_id'] ?? null) !== $reversalId) {
                throw $staleBasis;
            }
        } elseif ($reversalId !== null || $basis?->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT) {
            throw $staleBasis;
        } elseif ($basis) {
            foreach (['check_in_at', 'check_out_at', 'work_date', 'outlet_id'] as $field) {
                if (($correction->original_values[$field] ?? null) !== ($basis->proposed_values[$field] ?? null)) {
                    throw $staleBasis;
                }
            }
        }

        $proposed = $correction->proposed_values;
        $startOnly = $correction->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT
            && ($correction->original_values['recorded']['recording_status'] ?? null) === 'active'
            && $proposed['check_out_at'] === null
            && $proposed['outlet_id'] === $correction->original_values['outlet_id']
            && $proposed['work_date'] === $correction->original_values['work_date'];
        if ($startOnly && in_array($session->status, ['active', 'closed'], true)) {
            $this->assertNoOverlappingAttendance($employee, $session, [
                    ...$proposed, 'check_out_at' => $session->check_out_at?->toIso8601String() ?? CarbonImmutable::now('UTC')->toIso8601String(),
                ]);
            return;
        }
        $this->assertNoOverlappingAttendance($employee, $session, $proposed);
        $missingCheckoutResolution = ($proposed['check_out_at'] ?? null) !== null && $session->check_out_at === null;
        $hasPhysicalCheckout = $session->status === 'closed'
            && AttendanceEvent::query()->forTenant($tenantId)
                ->where('attendance_session_id', $session->getKey())->where('event_type', 'check_out')
                ->lockForUpdate()->first() !== null;
        if (($correction->original_values['recorded']['recording_status'] ?? $correction->original_values['recording_status'] ?? null) === 'active'
            && ($correction->original_values['recorded']['check_out_at'] ?? $correction->original_values['check_out_at'] ?? null) === null
            && $session->status === 'closed'
            && $hasPhysicalCheckout) {
            throw ValidationException::withMessages(['correction' => 'Checkout fisik tercatat sebelum keputusan koreksi. Checkout tersebut menjadi fakta yang berlaku.']);
        }
        if ($missingCheckoutResolution && $session->status === 'active') {
            return;
        }
        if ($missingCheckoutResolution && $session->status === 'administratively_resolved') {
            return;
        }
        if ($missingCheckoutResolution && $session->status === 'closed') {
            if ($hasPhysicalCheckout) {
                throw ValidationException::withMessages(['correction' => 'Checkout fisik tercatat sebelum keputusan koreksi. Permintaan tidak dapat mengganti fakta tersebut.']);
            }
        }
        if ($session->status === 'administratively_resolved' && ! $missingCheckoutResolution) {
            return;
        }
        if ($session->status === 'active' && ! $missingCheckoutResolution) {
            throw ValidationException::withMessages(['correction' => 'Sesi masih aktif; koreksi harus menyelesaikan checkout secara eksplisit.']);
        }
        unset($employee);
    }

    private function reconcileMissingCheckout(ApprovalRequest $request, AttendanceSession $session): void
    {
        if (($request->details['proposed']['check_out_at'] ?? null) === null) {
            return;
        }

        if ($session->status === 'active' && $session->check_out_at === null) {
            $owner = DB::table('attendance_active_session_owners')->where('tenant_id', $request->tenant_id)
                ->where('employee_id', $request->employee_id)->lockForUpdate()->first();
            if (! $owner || (int) $owner->attendance_session_id !== (int) $session->getKey()) {
                throw ValidationException::withMessages(['correction' => 'Kepemilikan sesi aktif berubah. Muat ulang dan periksa status kehadiran.']);
            }

            $session->forceFill(['status' => 'administratively_resolved'])->save();
            $deleted = DB::table('attendance_active_session_owners')->where('tenant_id', $request->tenant_id)
                ->where('employee_id', $request->employee_id)->where('attendance_session_id', $session->getKey())->delete();
            if ($deleted !== 1) {
                throw new \LogicException('Administrative checkout resolution could not reconcile active-session ownership.');
            }
        }
    }

    /** @param array{original: array<string, mixed>, proposed: array<string, mixed>} $prepared */
    private function applyApprovedCorrection(TenantMembership $membership, ApprovalRequest $request, AttendanceSession $session, array $prepared, User $user, string $key, string $action): void
    {
        if ($session->status === 'active' && $session->check_out_at === null && $prepared['proposed']['check_out_at'] !== null) {
            $this->reconcileMissingCheckout($request, $session);
        }
        $this->recordDecision($membership, $request, $user, $action, $request->reason, $key,
            $prepared['original'], $prepared['proposed'], $prepared['proposed']);
    }

    private function assertNoOverlappingAttendance(Employee $employee, ?AttendanceSession $target, array $proposed): void
    {
        if ($proposed['check_out_at'] === null) {
            return;
        }
        $start = CarbonImmutable::parse($proposed['check_in_at'])->utc();
        $end = CarbonImmutable::parse($proposed['check_out_at'])->utc();
        $others = AttendanceSession::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())->when($target, fn ($query) => $query->whereKeyNot($target->getKey()))->lockForUpdate()->get();

        $corrections = AttendanceCorrection::query()->forTenant((int) $employee->tenant_id)
            ->whereIn('attendance_session_id', $others->modelKeys())
            ->whereIn('approval_request_id', ApprovalRequest::query()->forTenant((int) $employee->tenant_id)
                ->where('employee_id', $employee->getKey())->where('status', 'approved')
                ->withoutReversal(lock: true)->lockForUpdate()->select('id'))
            ->lockForUpdate()->get()->keyBy('approval_request_id');
        $latestBySession = [];
        if ($corrections->isNotEmpty()) {
            $decisions = ApprovalDecision::query()->forTenant((int) $employee->tenant_id)
                ->whereIn('approval_request_id', $corrections->keys())
                ->whereIn('action', ['approved', 'routine_applied'])
                ->orderBy('acted_at')->orderBy('id')->lockForUpdate()->get();
            foreach ($decisions as $decision) {
                $correction = $corrections->get($decision->approval_request_id);
                $sessionId = (int) $correction->attendance_session_id;
                $order = $correction->effectOrder($decision);
                if (! isset($latestBySession[$sessionId]) || $order > $latestBySession[$sessionId]['order']) {
                    $latestBySession[$sessionId] = [
                        'order' => $order,
                        'values' => $correction->contract_version === AttendanceCorrection::VERSIONED_EFFECT_CONTRACT
                            ? $decision->effective_values : $correction->proposed_values,
                    ];
                }
            }
        }

        $this->assertNoReconstructionOverlap($employee, $proposed);

        foreach ($others as $other) {
            $effective = $latestBySession[(int) $other->getKey()]['values'] ?? [];
            $otherStart = CarbonImmutable::parse($effective['check_in_at'] ?? $other->check_in_at->utc()->toIso8601String())->utc();
            $otherEndValue = $effective['check_out_at'] ?? $other->check_out_at?->utc()->toIso8601String();
            $otherEnd = $otherEndValue === null && $other->status === 'active'
                ? CarbonImmutable::now('UTC')
                : ($otherEndValue === null ? null : CarbonImmutable::parse($otherEndValue)->utc());
            if (! $otherEnd) {
                continue;
            }
            if ($start->lessThan($otherEnd) && $end->greaterThan($otherStart)) {
                throw ValidationException::withMessages(['correction' => 'Rentang koreksi bertabrakan dengan sesi kehadiran lain.']);
            }
        }
    }

    private function assertNoApprovedLeaveOverlap(ApprovalRequest $request, Employee $employee): void
    {
        $this->assertNoApprovedLeaveOverlapForRange($employee, $request->starts_on->toDateString(), $request->ends_on->toDateString(), (int) $request->getKey());
    }

    private function assertNoApprovedLeaveOverlapForRange(Employee $employee, string $from, string $to, ?int $except = null): void
    {
        $query = ApprovalRequest::query()->forTenant((int) $employee->tenant_id)->where('employee_id', $employee->getKey())
            ->where('request_type', 'leave')->where('status', 'approved')->where('starts_on', '<=', $to)->where('ends_on', '>=', $from);
        if ($except !== null) {
            $query->whereKeyNot($except);
        }
        if ($query->lockForUpdate()->first()) {
            throw ValidationException::withMessages(['starts_on' => 'Rentang ini bertumpang tindih dengan izin atau cuti yang sudah disetujui.']);
        }
    }

    private function createLeaveAttendanceConflictCases(ApprovalRequest $request, Employee $employee): void
    {
        $sessions = AttendanceSession::query()->forTenant((int) $request->tenant_id)->where('employee_id', $employee->getKey())
            ->whereBetween('work_date', [$request->starts_on->toDateString(), $request->ends_on->toDateString()])->get();
        foreach ($sessions as $session) {
            $this->createReviewCase(null, (int) $employee->getKey(), (int) $session->outlet_id, $session->work_date->toDateString(), 'leave_attendance_conflict', [
                'case_type' => 'leave_attendance_conflict',
                'attendance_session_id' => (int) $session->getKey(),
                'indicators' => ['approved_leave_with_recorded_attendance'],
                'related_request_id' => (int) $request->getKey(),
            ]);
        }
        $reconstructions = ApprovalRequest::query()->forTenant((int) $request->tenant_id)
            ->where('employee_id', $employee->getKey())->where('request_type', 'attendance_correction')->where('status', 'approved')->withoutReversal(lock: true)
            ->where('details->correction_target', 'reconstruction')
            ->whereBetween('work_date', [$request->starts_on->toDateString(), $request->ends_on->toDateString()])
            ->lockForUpdate()->get();
        foreach ($reconstructions as $reconstruction) {
            $this->createReconstructionLeaveConflict($reconstruction, $request);
        }
    }

    private function createReconstructionLeaveConflict(ApprovalRequest $reconstruction, ApprovalRequest $leave): void
    {
        $this->createReviewCase(null, (int) $reconstruction->employee_id, (int) $reconstruction->outlet_id,
            $reconstruction->work_date->toDateString(), 'leave_attendance_conflict', [
                'reconstruction_request_id' => (int) $reconstruction->getKey(),
                'indicators' => ['approved_leave_with_recorded_attendance'],
                'related_request_id' => (int) $leave->getKey(),
            ]);
    }

    private function createReviewCase(?TenantMembership $membership, int $employeeId, ?int $outletId, string $workDate, string $caseType, array $details): bool
    {
        $tenantId = $membership ? (int) $membership->tenant_id : (int) Employee::query()->whereKey($employeeId)->value('tenant_id');
        $key = hash('sha256', implode('|', [$tenantId, $employeeId, $workDate, $caseType, $details['attendance_session_id'] ?? 'none']));
        try {
            ApprovalRequest::query()->create([
                'tenant_id' => $tenantId,
                'employee_id' => $employeeId,
                'outlet_id' => $outletId,
                'requester_user_id' => null,
                'requester_membership_id' => null,
                'request_type' => 'attendance_review',
                'status' => 'pending',
                'work_date' => $workDate,
                'reason' => 'Review kehadiran: '.$caseType,
                'details' => ['case_type' => $caseType, ...$details],
                'review_key' => $key,
            ]);

            return true;
        } catch (QueryException $exception) {
            if (! $this->isDuplicateKey($exception)) {
                throw $exception;
            }

            return false;
        }
    }

    private function newRequest(TenantMembership $membership, User $user, array $data): ApprovalRequest
    {
        return ApprovalRequest::query()->create([
            'tenant_id' => $membership->tenant_id,
            'employee_id' => $data['employee_id'],
            'outlet_id' => $data['outlet_id'] ?? null,
            'requester_user_id' => $user->getKey(),
            'requester_membership_id' => $membership->getKey(),
            'request_type' => $data['request_type'],
            'status' => $data['status'] ?? 'pending',
            'work_date' => $data['work_date'] ?? null,
            'starts_on' => $data['starts_on'] ?? null,
            'ends_on' => $data['ends_on'] ?? null,
            'reason' => $data['reason'] ?? null,
            'details' => $data['details'],
            'submission_key' => $data['submission_key'] ?? null,
            'submission_hash' => $data['submission_hash'] ?? null,
        ]);
    }

    private function recordDecision(TenantMembership $membership, ApprovalRequest $request, User $user, string $action, ?string $reason, ?string $key, ?array $original = null, ?array $proposed = null, ?array $effective = null): ApprovalDecision
    {
        return ApprovalDecision::query()->create([
            'tenant_id' => $membership->tenant_id,
            'approval_request_id' => $request->getKey(),
            'employee_id' => $request->employee_id,
            'actor_user_id' => $user->getKey(),
            'actor_membership_id' => $membership->getKey(),
            'action' => $action,
            'reason' => $reason,
            'original_values' => $original,
            'proposed_values' => $proposed,
            'effective_values' => $effective,
            'idempotency_key' => $key,
            'acted_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'),
        ]);
    }

    private function assertReviewer(TenantMembership $membership, User $user, ApprovalRequest $request, Employee $employee, bool $evidenceProposer = false): void
    {
        $tenantId = (int) $membership->tenant_id;
        if (! $this->hasRole($membership, TenantRole::Owner) && ! $this->hasRole($membership, TenantRole::Supervisor)) {
            throw new AuthorizationException('Keputusan hanya dapat diberikan oleh Owner atau Supervisor.');
        }
        if ($request->request_type === 'attendance_correction') {
            if ($this->hasRole($membership, TenantRole::Owner)) {
                return;
            }
            if (! $evidenceProposer && (($request->details['deadline']['owner_required'] ?? false)
                || ($request->details['assignment_exception_required'] ?? false))) {
                throw new AuthorizationException('Koreksi ini memerlukan persetujuan Owner.');
            }
        }
        if (! $evidenceProposer && (int) $request->requester_user_id === (int) $user->getKey()) {
            throw new AuthorizationException('Anda tidak dapat menyetujui atau menolak permintaan yang Anda ajukan sendiri.');
        }

        $linkedToSubject = EmployeeUserLink::query()->forTenant($tenantId)
            ->join('tenant_memberships', 'tenant_memberships.id', '=', 'employee_user_links.tenant_membership_id')
            ->where('tenant_memberships.user_id', $user->getKey())
            ->where('employee_user_links.employee_id', $employee->getKey())->lockForUpdate()->first() !== null;
        if ($linkedToSubject) {
            throw new AuthorizationException('Identitas karyawan Anda tidak dapat memutuskan perkara kehadiran sendiri.');
        }

        if ($this->hasRole($membership, TenantRole::Owner)) {
            return;
        }
        $outletId = $request->outlet_id;
        if ($request->request_type === 'attendance_correction') {
            $primary = $request->details['historical_primary_outlet_id'] ?? null;
            if (! array_key_exists('historical_primary_outlet_id', $request->details)
                && ($session = $request->correction?->session) !== null) {
                $primary = $this->historicalSessionPrimaryOutlet($session);
            }
            if (($outletId !== null && $this->isSupervisorScoped($membership, (int) $outletId))
                || ($primary !== null && $this->isSupervisorScoped($membership, (int) $primary))) {
                return;
            }

            throw new AuthorizationException('Koreksi berada di luar cakupan Outlet Anda.');
        }
        if ($outletId === null || ! Outlet::query()->forTenant($tenantId)->whereKey($outletId)->exists()
            || ! $this->isSupervisorScoped($membership, (int) $outletId)) {
            throw new AuthorizationException('Permintaan berada di luar cakupan Outlet Anda.');
        }
        $effectiveOutletId = (int) ($request->details['proposed']['outlet_id'] ?? $outletId);
        if ($effectiveOutletId !== (int) $outletId && ! $this->isSupervisorScoped($membership, $effectiveOutletId)) {
            throw new AuthorizationException('Koreksi mengarah ke Outlet di luar cakupan Anda.');
        }
    }

    private function historicalSessionPrimaryOutlet(AttendanceSession $session): ?int
    {
        if (($session->assignment_snapshot['type'] ?? null) === EmployeeOutletAssignmentType::Primary->value
            && isset($session->assignment_snapshot['outlet_id'])) {
            return (int) $session->assignment_snapshot['outlet_id'];
        }
        $outlet = EmployeeOutletAssignment::query()->forTenant((int) $session->tenant_id)
            ->where('employee_id', $session->employee_id)->where('assignment_type', EmployeeOutletAssignmentType::Primary->value)
            ->where('effective_from', '<=', $session->check_in_at->utc()->toDateTimeString())
            ->where('effective_until', '>', $session->check_in_at->utc()->toDateTimeString())
            ->orderByDesc('effective_from')->orderByDesc('id')->value('outlet_id');

        return $outlet === null ? null : (int) $outlet;
    }

    private function canViewRequest(TenantMembership $membership, User $user, ApprovalRequest $request): bool
    {
        $proposer = (int) $request->requester_user_id === (int) $user->getKey();
        if ($proposer && $request->request_type !== 'attendance_correction') {
            return true;
        }
        $subjectLink = EmployeeUserLink::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->where('employee_id', $request->employee_id)->exists();
        if ($subjectLink) {
            return true;
        }
        try {
            $this->assertReviewer($membership, $user, $request, $request->employee, evidenceProposer: $proposer);

            return true;
        } catch (AuthorizationException) {
            return false;
        }
    }

    /** @return array<string, mixed> */
    private function requestView(TenantMembership $membership, User $user, ApprovalRequest $request): array
    {
        $eligible = false;
        $eligibilityReason = 'Akun ini tidak memiliki peran peninjau yang sesuai.';
        if ($request->status === 'pending') {
            try {
                $this->assertReviewer($membership, $user, $request, $request->employee);
                $eligible = true;
                $eligibilityReason = null;
            } catch (AuthorizationException $exception) {
                $eligibilityReason = $exception->getMessage();
            }
        } elseif ($this->hasRole($membership, TenantRole::Owner) || $this->hasRole($membership, TenantRole::Supervisor)) {
            $eligible = $this->canViewRequest($membership, $user, $request);
            $eligibilityReason = $eligible ? null : 'Permintaan berada di luar cakupan Outlet Anda.';
        }

        return [
            'id' => (int) $request->getKey(),
            'type' => $request->request_type,
            'status' => $request->status,
            'employee' => ['id' => (int) $request->employee_id, 'name' => $request->employee?->name],
            'outlet' => $request->outlet ? ['id' => (int) $request->outlet->getKey(), 'name' => $request->outlet->name] : null,
            'requester_user_id' => $request->requester_user_id === null ? null : (int) $request->requester_user_id,
            'work_date' => $request->work_date?->toDateString(),
            'starts_on' => $request->starts_on?->toDateString(),
            'ends_on' => $request->ends_on?->toDateString(),
            'reason' => $request->reason,
            'details' => $request->details,
            'classification' => $request->correction?->classification ?? ($request->details['classification'] ?? null),
            'correction' => $request->correction ? [
                'original_values' => $request->correction->original_values,
                'proposed_values' => $request->correction->proposed_values,
            ] : null,
            'reversed' => $request->decisions->contains('action', 'reversed'),
            'can_decide' => $eligible && $request->status === 'pending',
            'eligibility_reason' => $eligibilityReason,
            'decision_history' => $request->decisions->map(fn (ApprovalDecision $decision): array => [
                'id' => (int) $decision->getKey(),
                'action' => $decision->action,
                'reason' => $decision->reason,
                'actor_user_id' => (int) $decision->actor_user_id,
                'acted_at' => $decision->acted_at->toIso8601String(),
                'original_values' => $decision->original_values,
                'proposed_values' => $decision->proposed_values,
                'effective_values' => $decision->effective_values,
            ])->all(),
        ];
    }

    private function assertOutcomeMatchesProjection(array $projection, string $outcome): void
    {
        $allowed = ['present', 'leave', 'sick', 'permission', 'absence', 'exceptional_attendance'];
        if (! in_array($outcome, $allowed, true)) {
            throw ValidationException::withMessages(['outcome' => 'Hasil finalisasi tidak didukung.']);
        }
        $matches = match ($outcome) {
            'present' => $projection['sources'] !== [] && $projection['outcome'] === 'present',
            'exceptional_attendance' => $projection['sources'] !== [] && $projection['outcome'] === 'exceptional_attendance',
            'absence' => $projection['outcome'] === 'confirmed_absence_pending_finalization',
            'leave' => $projection['approved_leave'] !== null && ($projection['approved_leave']['category'] ?? null) === 'annual',
            'sick', 'permission' => $projection['approved_leave'] !== null
                && ($projection['approved_leave']['category'] ?? null) === $outcome,
        };
        if (! $matches) {
            throw ValidationException::withMessages(['outcome' => 'Hasil finalisasi tidak sesuai dengan proyeksi kehadiran dan keputusan yang tersedia.']);
        }
    }

    private function approvedCorrectionBasis(AttendanceSession $session, ?int $exceptRequestId = null): ?AttendanceCorrection
    {
        // The employee and session are locked by the caller. A locking read avoids a stale transaction snapshot.
        return AttendanceCorrection::query()
            ->join('approval_requests as requests', function ($join): void {
                $join->on('requests.tenant_id', '=', 'attendance_corrections.tenant_id')
                    ->on('requests.id', '=', 'attendance_corrections.approval_request_id');
            })
            ->join('approval_decisions as decisions', function ($join): void {
                $join->on('decisions.tenant_id', '=', 'requests.tenant_id')
                    ->on('decisions.approval_request_id', '=', 'requests.id');
            })
            ->where('attendance_corrections.tenant_id', $session->tenant_id)
            ->where('attendance_corrections.attendance_session_id', $session->getKey())
            ->where('requests.status', 'approved')
            ->when($exceptRequestId !== null, fn ($query) => $query->where('requests.id', '!=', $exceptRequestId))
            ->leftJoin('approval_decisions as reversals', function ($join): void {
                $join->on('reversals.tenant_id', '=', 'requests.tenant_id')
                    ->on('reversals.approval_request_id', '=', 'requests.id')
                    ->where('reversals.action', 'reversed');
            })
            ->whereNull('reversals.id')
            ->whereIn('decisions.action', ['approved', 'routine_applied'])
            ->orderByDesc('attendance_corrections.contract_version')
            // Versioned decisions are serialized per Employee. Their IDs preserve that order across clock changes.
            ->orderByRaw('CASE WHEN attendance_corrections.contract_version = ? THEN decisions.id END DESC', [AttendanceCorrection::VERSIONED_EFFECT_CONTRACT])
            ->orderByDesc('decisions.acted_at')->orderByDesc('decisions.id')
            ->lockForUpdate()->first(['attendance_corrections.*']);
    }

    private function latestSessionReversalId(AttendanceSession $session): ?int
    {
        $id = ApprovalDecision::query()->forTenant((int) $session->tenant_id)->where('action', 'reversed')
            ->whereIn('approval_request_id', AttendanceCorrection::query()->forTenant((int) $session->tenant_id)
                ->where('attendance_session_id', $session->getKey())->lockForUpdate()->select('approval_request_id'))
            ->orderByDesc('id')->lockForUpdate()->value('id');

        return $id === null ? null : (int) $id;
    }

    private function outletForDateRange(int $tenantId, int $employeeId, string $from, string $to): ?int
    {
        $start = CarbonImmutable::parse($from, 'UTC')->startOfDay()->format('Y-m-d H:i:s');
        $end = CarbonImmutable::parse($to, 'UTC')->addDay()->startOfDay()->format('Y-m-d H:i:s');
        $outlets = EmployeeOutletAssignment::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->where('effective_from', '<', $end)->where('effective_until', '>', $start)
            ->distinct()->pluck('outlet_id')->map(fn ($id): int => (int) $id)->values();
        if ($outlets->count() > 1) {
            throw ValidationException::withMessages(['starts_on' => 'Ajukan permintaan terpisah untuk tanggal yang berada di Outlet berbeda.']);
        }

        return $outlets->first();
    }

    private function isAssignedAt(int $tenantId, int $employeeId, int $outletId, string $workDate): bool
    {
        $start = CarbonImmutable::parse($workDate, 'UTC')->startOfDay()->format('Y-m-d H:i:s');
        $end = CarbonImmutable::parse($workDate, 'UTC')->addDay()->startOfDay()->format('Y-m-d H:i:s');

        return EmployeeOutletAssignment::query()->forTenant($tenantId)->where('employee_id', $employeeId)
            ->where('outlet_id', $outletId)->where('effective_from', '<', $end)->where('effective_until', '>', $start)->exists();
    }

    public function canManageEmployeeOnDate(TenantMembership $membership, int $employeeId, string $workDate): bool
    {
        if ($this->hasRole($membership, TenantRole::Owner)) {
            return Employee::query()->forTenant((int) $membership->tenant_id)->whereKey($employeeId)->exists();
        }
        $outletIds = SupervisorOutletScope::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->pluck('outlet_id')->all();

        return EmployeeOutletAssignment::query()->forTenant((int) $membership->tenant_id)->where('employee_id', $employeeId)
            ->whereIn('outlet_id', $outletIds)->where('effective_from', '<', CarbonImmutable::parse($workDate, 'UTC')->addDay()->startOfDay())
            ->where('effective_until', '>', CarbonImmutable::parse($workDate, 'UTC')->startOfDay())->lockForUpdate()->first() !== null;
    }

    private function isSupervisorScoped(TenantMembership $membership, int $outletId): bool
    {
        return SupervisorOutletScope::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->where('outlet_id', $outletId)
            ->lockForUpdate()->first() !== null;
    }

    private function currentMembership(TenantMembership $membership, User $user): TenantMembership
    {
        return TenantMembership::query()->forTenant((int) $membership->tenant_id)
            ->whereKey($membership->getKey())->where('user_id', $user->getKey())->where('is_active', true)->lockForUpdate()->first()
            ?? throw new AuthorizationException('Keanggotaan organisasi sudah tidak aktif.');
    }

    private function hasRole(TenantMembership $membership, TenantRole $role): bool
    {
        return TenantRoleAssignment::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->where('role', $role->value)->lockForUpdate()->first() !== null;
    }

    private function date(string $value, string $field): CarbonImmutable
    {
        $date = CarbonImmutable::createFromFormat('!Y-m-d', $value, 'UTC');
        if (! $date || $date->format('Y-m-d') !== $value) {
            throw ValidationException::withMessages([$field => 'Tanggal harus memakai format YYYY-MM-DD yang valid.']);
        }

        return $date;
    }

    private function instant(string $value, string $field): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (\Throwable) {
            throw ValidationException::withMessages([$field => 'Waktu harus berupa tanggal dan waktu yang valid.']);
        }
    }

    private function requiredReason(array $data): string
    {
        $reason = trim((string) ($data['reason'] ?? ''));
        if ($reason === '' || mb_strlen($reason) > 1000) {
            throw ValidationException::withMessages(['reason' => 'Alasan wajib diisi dan maksimal 1.000 karakter.']);
        }

        return $reason;
    }

    private function payloadHash(array $data): string
    {
        $sort = function (array &$value) use (&$sort): void {
            ksort($value);
            foreach ($value as &$child) {
                if (is_array($child)) {
                    $sort($child);
                }
            }
        };
        $normalized = $data;
        $sort($normalized);

        return hash('sha256', json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    private function isDuplicateKey(QueryException $exception): bool
    {
        return in_array((string) ($exception->errorInfo[1] ?? ''), ['1062', '1555', '2067'], true);
    }
}
