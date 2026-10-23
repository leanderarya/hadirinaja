<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Services\ApprovalWorkflowService;
use App\Services\EffectiveAttendanceProjectionService;
use App\Services\TenantAuthorization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class ApprovalController extends Controller
{
    public function __construct(
        private readonly ApprovalWorkflowService $workflow,
        private readonly EffectiveAttendanceProjectionService $projection,
        private readonly TenantAuthorization $authorization,
    ) {}

    public function ownRequests(Request $request): JsonResponse
    {
        return response()->json(['requests' => $this->workflow->ownRequests($this->activeMembership($request), $request->user())]);
    }

    public function submit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['required', Rule::in(['leave', 'overtime', 'attendance_correction'])],
            'category' => ['sometimes', 'string', 'max:32'],
            'starts_on' => ['sometimes', 'date_format:Y-m-d'],
            'ends_on' => ['sometimes', 'date_format:Y-m-d'],
            'work_date' => ['sometimes', 'date_format:Y-m-d'],
            'starts_at' => ['sometimes', 'date_format:Y-m-d\\TH:i'],
            'ends_at' => ['sometimes', 'date_format:Y-m-d\\TH:i'],
            'attendance_session_id' => ['sometimes', 'integer', 'min:1'],
            'effective_check_in_at' => ['sometimes', 'nullable', 'date'],
            'effective_check_out_at' => ['sometimes', 'nullable', 'date'],
            'effective_work_date' => ['sometimes', 'date_format:Y-m-d'],
            'effective_outlet_id' => ['sometimes', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:1', 'max:1000'],
        ]);
        $approvalRequest = $this->workflow->submitEmployeeRequest(
            $this->activeMembership($request), $request->user(), $validated, $this->idempotencyKey($request),
        );

        return response()->json(['request' => $this->workflow->show($this->activeMembership($request), $request->user(), (int) $approvalRequest->getKey())], 201);
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
        ]);
        $finalization = $this->workflow->finalize(
            $this->activeMembership($request), $request->user(), (int) $validated['employee_id'],
            $validated['work_date'], $validated['outcome'], $validated['reason'],
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
            throw new AuthorizationException('Akun ini belum terhubung ke identitas karyawan.');
        }

        return response()->json(['attendance' => $this->projection->range(
            (int) $membership->tenant_id, (int) $link->employee_id, $validated['from'], $validated['to'],
        )]);
    }

    public function managementProjection(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $membership = $this->activeMembership($request);
        $days = $this->projection->range(
            (int) $membership->tenant_id, (int) $validated['employee_id'], $validated['from'], $validated['to'],
        );
        foreach ($days as $day) {
            if (! $this->workflow->canManageEmployeeOnDate($membership, (int) $validated['employee_id'], $day['work_date'])) {
                throw new AuthorizationException('Proyeksi kehadiran tidak tersedia dalam cakupan Anda.');
            }
            foreach ($day['sessions'] as $session) {
                $outlet = Outlet::query()->forTenant((int) $membership->tenant_id)
                    ->whereKey((int) $session['effective']['outlet_id'])->first();
                if (! $outlet || ! $this->authorization->canManageOutlet($membership, $outlet)) {
                    throw new AuthorizationException('Proyeksi kehadiran mencakup Outlet di luar cakupan Anda.');
                }
            }
        }

        return response()->json(['attendance' => $days]);
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
}
