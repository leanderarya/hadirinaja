<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\AttendanceFinalization;
use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Services\ApprovalWorkflowService;
use App\Services\EffectiveAttendanceReader;
use App\Services\TenantAuthorization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class ApprovalController extends Controller
{
    public function __construct(
        private readonly ApprovalWorkflowService $workflow,
        private readonly EffectiveAttendanceReader $projection,
        private readonly TenantAuthorization $authorization,
    ) {}

    public function ownRequests(Request $request): JsonResponse
    {
        $membership = $this->activeMembership($request);
        $access = $this->requestAccess($membership);

        return response()->json([
            'requests' => $this->workflow->ownRequests($membership, $request->user()),
            'request_access' => $access,
            'reconstruction_outlets' => $access['can_submit']
                ? Outlet::query()->forTenant((int) $membership->tenant_id)
                    ->whereIn('id', EmployeeOutletAssignment::query()->forTenant((int) $membership->tenant_id)
                        ->where('employee_id', $membership->employeeUserLink()->value('employee_id'))->select('outlet_id'))
                    ->orderBy('name')->get(['id', 'name'])
                : [],
        ]);
    }

    public function submit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['required', Rule::in(['leave', 'overtime', 'attendance_correction'])],
            'correction_target' => ['sometimes', Rule::in(['reconstruction']), 'prohibited_unless:type,attendance_correction'],
            'category' => ['sometimes', 'string', 'max:32'],
            'starts_on' => ['sometimes', 'date_format:Y-m-d'],
            'ends_on' => ['sometimes', 'date_format:Y-m-d'],
            'work_date' => ['sometimes', 'date_format:Y-m-d'],
            'starts_at' => ['sometimes', 'date_format:Y-m-d\\TH:i'],
            'ends_at' => ['sometimes', 'date_format:Y-m-d\\TH:i'],
            'attendance_session_id' => ['prohibited_if:correction_target,reconstruction', 'sometimes', 'integer', 'min:1'],
            'effective_check_in_at' => ['sometimes', 'nullable', 'date'],
            'effective_check_out_at' => ['sometimes', 'nullable', 'date'],
            'effective_work_date' => ['sometimes', 'date_format:Y-m-d'],
            'effective_outlet_id' => ['sometimes', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
        ]);
        $membership = $this->activeMembership($request);
        $access = $this->requestAccess($membership);
        if (! $access['can_submit']) {
            $messages = [
                'employee_link_required' => 'Akun ini belum terhubung ke identitas karyawan.',
                'employee_unavailable' => 'Identitas karyawan tidak tersedia dalam organisasi aktif.',
                'employee_role_required' => 'Peran Karyawan diperlukan untuk mengajukan permintaan personal.',
            ];
            throw new HttpResponseException(response()->json([
                'code' => $access['status'],
                'message' => $messages[$access['status']],
            ], 403));
        }

        $approvalRequest = $this->workflow->submitEmployeeRequest(
            $membership, $request->user(), $validated, $this->idempotencyKey($request),
        );

        return response()->json(['request' => $this->workflow->show($membership, $request->user(), (int) $approvalRequest->getKey())], 201);
    }

    public function cancel(Request $request, int $approvalRequest): JsonResponse
    {
        $result = $this->workflow->cancel(
            $this->activeMembership($request), $request->user(), $approvalRequest, $this->idempotencyKey($request),
        );

        return response()->json(['request' => $this->workflow->show($this->activeMembership($request), $request->user(), (int) $result->getKey())]);
    }

    public function queue(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', Rule::in(['pending', 'approved', 'rejected', 'cancelled'])],
            'type' => ['sometimes', Rule::in(['leave', 'overtime', 'attendance_correction', 'attendance_review'])],
            'employee_id' => ['sometimes', 'integer', 'min:1'],
            'outlet_id' => ['sometimes', 'integer', 'min:1'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        return response()->json($this->workflow->queue($this->activeMembership($request), $request->user(), $filters));
    }

    public function show(Request $request, int $approvalRequest): JsonResponse
    {
        return response()->json(['request' => $this->workflow->show($this->activeMembership($request), $request->user(), $approvalRequest)]);
    }

    public function decide(Request $request, int $approvalRequest): JsonResponse
    {
        $validated = $request->validate([
            'decision' => ['required', Rule::in(['approved', 'rejected'])],
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);
        $result = $this->workflow->decide(
            $this->activeMembership($request), $request->user(), $approvalRequest,
            $validated['decision'], $validated['reason'] ?? null, $this->idempotencyKey($request),
        );

        return response()->json(['request' => $this->workflow->show($this->activeMembership($request), $request->user(), (int) $result->getKey())]);
    }

    public function reverse(Request $request, int $approvalRequest): JsonResponse
    {
        $validated = $request->validate([
            'decision_id' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:1000'],
        ]);
        $membership = $this->activeMembership($request);
        $user = $request->user();
        $this->workflow->reverse(
            $membership, $user, $approvalRequest, (int) $validated['decision_id'],
            $validated['reason'], $this->idempotencyKey($request),
        );

        return response()->json(['request' => $this->workflow->show($membership, $user, $approvalRequest)]);
    }

    public function administrativeCorrection(Request $request, int $session): JsonResponse
    {
        $validated = $request->validate([
            'effective_check_in_at' => ['sometimes', 'nullable', 'date'],
            'effective_check_out_at' => ['sometimes', 'nullable', 'date'],
            'effective_work_date' => ['sometimes', 'date_format:Y-m-d'],
            'effective_outlet_id' => ['sometimes', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
        ]);
        $result = $this->workflow->administrativeCorrection(
            $this->activeMembership($request), $request->user(), $session, $validated, $this->idempotencyKey($request),
        );

        return response()->json([
            'applied' => $result['applied'],
            'classification' => $result['classification'],
            'request' => $this->workflow->show($this->activeMembership($request), $request->user(), (int) $result['request']->getKey()),
        ], $result['applied'] ? 200 : 202);
    }

    public function managedReconstruction(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'work_date' => ['required', 'date_format:Y-m-d'],
            'effective_check_in_at' => ['required', 'date'],
            'effective_check_out_at' => ['required', 'date'],
            'effective_outlet_id' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
        ]);
        $employeeId = (int) $validated['employee_id'];
        unset($validated['employee_id']);
        $membership = $this->activeMembership($request);
        $result = $this->workflow->submitManagedReconstruction(
            $membership, $request->user(), $employeeId, $validated, $this->idempotencyKey($request),
        );

        return response()->json([
            'applied' => $result['applied'],
            'request' => $this->workflow->show($membership, $request->user(), (int) $result['request']->getKey()),
        ], 201);
    }

    public function discoverReviews(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        return response()->json($this->workflow->discoverReviews(
            $this->activeMembership($request), $request->user(), $validated['from'], $validated['to'],
        ));
    }

    public function finalize(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'work_date' => ['required', 'date_format:Y-m-d'],
            'outcome' => ['required', Rule::in(['present', 'leave', 'sick', 'permission', 'absence', 'exceptional_attendance'])],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
            'reviewed_basis' => ['nullable', 'string', 'regex:/^[a-f0-9]{64}$/'],
        ]);
        $finalization = $this->workflow->finalize(
            $this->activeMembership($request), $request->user(), (int) $validated['employee_id'],
            $validated['work_date'], $validated['outcome'], $validated['reason'], $validated['reviewed_basis'] ?? null,
        );

        return response()->json(['finalization' => [
            'id' => (int) $finalization->getKey(),
            'employee_id' => (int) $finalization->employee_id,
            'work_date' => $finalization->work_date->toDateString(),
            'revision' => (int) $finalization->revision,
            'outcome' => $finalization->outcome,
            'finalized_at' => $finalization->finalized_at->toIso8601String(),
        ]], 201);
    }

    public function ownProjection(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $membership = $this->activeMembership($request);
        $link = $membership->employeeUserLink()->first();
        if (! $link) {
            throw new HttpResponseException(response()->json([
                'code' => 'employee_link_required',
                'message' => 'Akun ini belum terhubung ke identitas karyawan.',
            ], 403));
        }
        if (! $membership->hasRole(TenantRole::Employee)) {
            throw new HttpResponseException(response()->json([
                'code' => 'employee_role_required',
                'message' => 'Peran Karyawan diperlukan untuk melihat kehadiran personal.',
            ], 403));
        }

        $attendance = $this->projection->range(
            (int) $membership->tenant_id, (int) $link->employee_id, $validated['from'], $validated['to'],
        );

        return response()->json([
            'attendance' => $attendance,
            'correction_options' => $this->workflow->personalCorrectionOptions($membership, $request->user(), $attendance),
        ]);
    }

    public function managementProjection(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'compare_revision' => ['sometimes', 'integer', 'min:1'],
        ]);
        $membership = $this->activeMembership($request);
        if (isset($validated['compare_revision'])
            && (! $membership->hasRole(TenantRole::Owner) || $validated['from'] !== $validated['to'])) {
            throw new AuthorizationException('Perbandingan revisi memerlukan akses Owner untuk satu Tanggal Kerja.');
        }
        $days = $this->projection->range(
            (int) $membership->tenant_id, (int) $validated['employee_id'], $validated['from'], $validated['to'],
        );
        $owner = $membership->hasRole(TenantRole::Owner);
        foreach ($days as $index => $day) {
            if (! $this->workflow->canManageEmployeeOnDate($membership, (int) $validated['employee_id'], $day['work_date'])) {
                throw new AuthorizationException('Proyeksi kehadiran tidak tersedia dalam cakupan Anda.');
            }
            foreach ($day['sources'] as $source) {
                $outletIds = array_unique(array_filter([$source['effective']['outlet_id'], $source['physical']['outlet_id'] ?? null]));
                foreach ($outletIds as $outletId) {
                    $outlet = Outlet::query()->forTenant((int) $membership->tenant_id)->whereKey((int) $outletId)->first();
                    if (! $outlet || ! $this->authorization->canManageOutlet($membership, $outlet)) {
                        throw new AuthorizationException('Proyeksi kehadiran mencakup Outlet di luar cakupan Anda.');
                    }
                }
            }
            if (! $owner && $day['finalization'] !== null) {
                $days[$index]['finalization']['projection_snapshot'] = null;
            }
        }

        $result = ['attendance' => $days];
        if (isset($validated['compare_revision'])) {
            $finalization = AttendanceFinalization::query()->forTenant((int) $membership->tenant_id)
                ->where('employee_id', $validated['employee_id'])->where('work_date', $validated['from'])
                ->where('revision', $validated['compare_revision'])->firstOrFail();
            $result['historical_comparison'] = [
                'revision' => (int) $finalization->revision,
                'snapshot' => $finalization->projection_snapshot,
            ];
        }

        return response()->json($result);
    }

    private function idempotencyKey(Request $request): string
    {
        $key = (string) $request->header('Idempotency-Key', '');
        if (! Str::isUuid($key)) {
            throw ValidationException::withMessages(['Idempotency-Key' => 'Kunci idempotensi UUID wajib disertakan.']);
        }

        return strtolower($key);
    }

    private function activeMembership(Request $request): TenantMembership
    {
        /** @var TenantMembership $membership */
        $membership = $request->attributes->get('activeMembership');

        return $membership;
    }

    /** @return array{status: string, linked: bool, can_submit: bool} */
    private function requestAccess(TenantMembership $membership): array
    {
        $link = $membership->employeeUserLink()->first();
        if (! $link) {
            return ['status' => 'employee_link_required', 'linked' => false, 'can_submit' => false];
        }

        $employeeExists = Employee::query()->forTenant((int) $membership->tenant_id)
            ->whereKey($link->employee_id)->exists();
        if (! $employeeExists) {
            return ['status' => 'employee_unavailable', 'linked' => true, 'can_submit' => false];
        }

        if (! $membership->hasRole(TenantRole::Employee)) {
            return ['status' => 'employee_role_required', 'linked' => true, 'can_submit' => false];
        }

        return ['status' => 'available', 'linked' => true, 'can_submit' => true];
    }
}
