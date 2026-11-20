<?php

namespace App\Http\Controllers\Api\V1;

use App\Data\AttendanceActor;
use App\Enums\TenantRole;
use App\Http\Controllers\Controller;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceSession;
use App\Models\Employee;
use App\Models\EmployeeUserLink;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\TenantMembership;
use App\Services\AttendanceEvidenceAuditLogger;
use App\Services\AttendanceEvidenceExpirationService;
use App\Services\AttendanceEvidenceStorage;
use App\Services\AttendanceService;
use App\Services\ApprovalWorkflowService;
use App\Services\EffectiveAttendanceReader;
use App\Services\EmployeePinService;
use App\Services\TenantAuthorization;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\File;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

final class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendance,
        private readonly EmployeePinService $pins,
        private readonly TenantAuthorization $authorization,
        private readonly AttendanceEvidenceStorage $evidenceStorage,
        private readonly AttendanceEvidenceAuditLogger $evidenceAudit,
        private readonly EffectiveAttendanceReader $projection,
        private readonly ApprovalWorkflowService $approvals,
    ) {}

    public function personalCurrent(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['sometimes', 'integer', 'min:1'],
            'checkout_outlet_id' => ['sometimes', 'integer', 'min:1'],
        ]);
        $membership = $this->activeMembership($request);
        $identity = $this->employeeLinkResult($membership);
        if ($identity['status'] !== 'linked') {
            return response()->json([
                'eligibility' => ['status' => $identity['status']],
                'employee' => null,
            ]);
        }
        if (! $this->authorization->hasRole($membership, TenantRole::Employee)) {
            return response()->json([
                'eligibility' => ['status' => 'employee_role_required'],
                'employee' => null,
            ]);
        }
        $employee = $identity['employee'];

        $result = $this->attendance->current(
            $membership,
            $employee,
            isset($validated['outlet_id']) ? (int) $validated['outlet_id'] : null,
            isset($validated['checkout_outlet_id']) ? (int) $validated['checkout_outlet_id'] : null,
        );
        $timezone = (string) ($result['schedule']['timezone'] ?? 'Asia/Jakarta');
        $today = CarbonImmutable::now($timezone)->toDateString();
        $result['effective_attendance'] = $this->projection->range(
            (int) $membership->tenant_id, (int) $employee->getKey(),
            CarbonImmutable::parse($today, $timezone)->subDays(6)->toDateString(), $today,
        );
        $result['correction_options'] = $this->approvals->personalCorrectionOptions(
            $membership, $request->user(), $result['effective_attendance'],
            $result['active_session']['id'] ?? null,
        );

        return response()->json($result);
    }

    public function personalCheckIn(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            ...$this->personalPhotoRules(),
            ...$this->locationRules(),
        ]);
        $membership = $this->activeMembership($request);
        $employee = $this->linkedEmployee($request, $membership);
        $outlet = Outlet::query()->forTenant((int) $membership->tenant_id)->whereKey($validated['outlet_id'])->first();

        if (! $outlet) {
            throw new AuthorizationException('Outlet attendance access is not available.');
        }

        $result = $this->attendance->checkIn(
            AttendanceActor::personal($membership), $employee, $outlet,
            $this->idempotencyKey($request), $validated['location'] ?? null, $validated['photo'] ?? null,
        );

        return response()->json($result['body'], $result['status']);
    }

    public function personalCheckOut(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'checkout_outlet_id' => ['sometimes', 'required', 'integer', 'min:1'],
            'checkout_session_id' => ['sometimes', 'required', 'integer', 'min:1'],
            ...$this->personalPhotoRules(),
            ...$this->locationRules(),
        ]);
        $membership = $this->activeMembership($request);
        $employee = $this->linkedEmployee($request, $membership);
        $destination = isset($validated['checkout_outlet_id'])
            ? Outlet::query()->forTenant((int) $membership->tenant_id)->whereKey($validated['checkout_outlet_id'])->first()
            : null;
        if (isset($validated['checkout_outlet_id']) && ! $destination) {
            throw new AuthorizationException('Outlet attendance access is not available.');
        }

        $result = $this->attendance->checkOut(
            AttendanceActor::personal($membership), $employee,
            $this->idempotencyKey($request), $validated['location'] ?? null, $validated['photo'] ?? null, $destination,
            isset($validated['checkout_session_id']) ? (int) $validated['checkout_session_id'] : null,
        );

        return response()->json($result['body'], $result['status']);
    }

    public function personalOperationStatus(Request $request, string $operation, string $key): JsonResponse
    {
        $this->assertOperation($operation);
        $this->assertKey($key);
        $membership = $this->activeMembership($request);
        $employee = $this->linkedEmployee($request, $membership);

        return response()->json($this->attendance->operationStatus(
            AttendanceActor::personal($membership), (int) $employee->getKey(), $operation, $key,
        ));
    }

    public function kioskEmployees(Request $request): JsonResponse
    {
        $device = $this->kioskDevice($request);

        return response()->json(['employees' => $this->attendance->kioskEmployees($device)]);
    }

    public function kioskNextOperation(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'pin' => ['required', 'string', 'regex:/^\d{6,8}$/D'],
        ]);
        $device = $this->kioskDevice($request);
        $this->verifyKioskEmployee($device, (int) $validated['employee_id'], $validated['pin'], false);

        return response()->json($this->attendance->kioskNextOperation($device, (int) $validated['employee_id']));
    }

    public function kioskCheckIn(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'pin' => ['required', 'string', 'regex:/^\d{6,8}$/D'],
            'photo' => [
                'required',
                'file',
                'mimetypes:image/jpeg,image/png,image/webp',
                File::image()->min(10)->max(5120)->dimensions(
                    Rule::dimensions()->minWidth(320)->minHeight(240)->maxWidth(1920)->maxHeight(1920),
                ),
            ],
        ]);
        $device = $this->kioskDevice($request);
        $employee = $this->verifyKioskEmployee($device, (int) $validated['employee_id'], $validated['pin'], true);
        $result = $this->attendance->checkIn(
            AttendanceActor::kiosk($device), $employee, $device->outlet,
            $this->idempotencyKey($request), null, $validated['photo'],
        );

        return response()->json($result['body'], $result['status']);
    }

    public function kioskCheckOut(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'checkout_outlet_id' => ['missing'],
            'checkout_session_id' => ['sometimes', 'required', 'integer', 'min:1'],
            'outlet_id' => ['missing'],
            'authenticated_kiosk_outlet_id' => ['missing'],
            'tenant_id' => ['missing'],
            'kiosk_device_id' => ['missing'],
            'expected_kiosk_device_id' => ['sometimes', 'required', 'integer', 'min:1'],
            ...$this->locationRules(),
            'employee_id' => ['required', 'integer', 'min:1'],
            'pin' => ['required', 'string', 'regex:/^\d{6,8}$/D'],
            'photo' => [
                'required',
                'file',
                'mimetypes:image/jpeg,image/png,image/webp',
                File::image()->min(10)->max(5120)->dimensions(
                    Rule::dimensions()->minWidth(320)->minHeight(240)->maxWidth(1920)->maxHeight(1920),
                ),
            ],
        ]);
        $device = $this->kioskDevice($request, isset($validated['expected_kiosk_device_id']) ? (int) $validated['expected_kiosk_device_id'] : null);
        $employee = $this->verifyKioskEmployee($device, (int) $validated['employee_id'], $validated['pin'], false);
        $result = $this->attendance->checkOut(
            AttendanceActor::kiosk($device), $employee,
            $this->idempotencyKey($request), $validated['location'] ?? null, $validated['photo'],
            expectedSessionId: isset($validated['checkout_session_id']) ? (int) $validated['checkout_session_id'] : null,
        );

        return response()->json($result['body'], $result['status']);
    }

    public function kioskOperationStatus(Request $request, string $operation, string $key): JsonResponse
    {
        $this->assertOperation($operation);
        $this->assertKey($key);
        $validated = $request->validate([
            'employee_id' => ['required', 'integer', 'min:1'],
            'expected_kiosk_device_id' => ['sometimes', 'required', 'integer', 'min:1'],
        ]);
        $device = $this->kioskDevice($request, isset($validated['expected_kiosk_device_id']) ? (int) $validated['expected_kiosk_device_id'] : null);

        return response()->json($this->attendance->operationStatus(
            AttendanceActor::kiosk($device), (int) $validated['employee_id'], $operation, $key,
        ));
    }

    public function managementIndex(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'outlet_id' => ['required', 'integer', 'min:1'],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $membership = $this->activeMembership($request);
        $outlet = Outlet::query()->forTenant((int) $membership->tenant_id)->whereKey($validated['outlet_id'])->first();

        if (! $outlet || ! $this->authorization->canManageOutlet($membership, $outlet)) {
            throw new AuthorizationException('Attendance access is not available for this outlet.');
        }

        $from = CarbonImmutable::createFromFormat('!Y-m-d', $validated['from'], 'UTC');
        $to = CarbonImmutable::createFromFormat('!Y-m-d', $validated['to'], 'UTC');
        if (! $from || ! $to || $from->diffInDays($to) > 30) {
            throw ValidationException::withMessages(['to' => 'Rentang tanggal maksimal 31 hari.']);
        }

        $sessions = AttendanceSession::query()->forTenant((int) $membership->tenant_id)
            ->with(['outlet', 'employee', 'events' => fn ($query) => $query->orderBy('recorded_at'), 'events.evidence'])
            ->where('outlet_id', $outlet->getKey())
            ->whereBetween('work_date', [$validated['from'], $validated['to']])
            ->orderByDesc('check_in_at')->limit(500)->get();

        $projectionCache = [];
        $sessionViews = $sessions->map(function (AttendanceSession $session) use ($membership, &$projectionCache): array {
            $workDate = $session->work_date->toDateString();
            $key = (int) $session->employee_id.'|'.$workDate;
            $day = $projectionCache[$key] ??= $this->projection->project(
                (int) $membership->tenant_id, (int) $session->employee_id, $workDate,
            );
            $effective = collect($day['sessions'])->first(fn (array $row): bool => (int) $row['id'] === (int) $session->getKey());

            if ($effective && (int) ($effective['effective']['outlet_id'] ?? $session->outlet_id) !== (int) $session->outlet_id
                && ! $this->authorization->canManageOutlet(
                    $membership,
                    Outlet::query()->forTenant((int) $membership->tenant_id)->find((int) $effective['effective']['outlet_id']) ?? new Outlet,
                )) {
                $effective = null;
            }

            return [
                'id' => (int) $session->getKey(),
                'employee' => ['id' => (int) $session->employee_id, 'name' => $session->employee->name],
                'work_date' => $workDate,
                'status' => $session->status,
                'check_in_at' => $session->check_in_at->utc()->toIso8601String(),
                'check_out_at' => $session->check_out_at?->utc()->toIso8601String(),
                'review_indicators' => $session->review_indicators,
                'events' => $session->events->map(fn (AttendanceEvent $event): array => [
                    'id' => (int) $event->getKey(),
                    'type' => $event->event_type,
                    'origin' => $event->origin,
                    'recorded_at' => $event->recorded_at->utc()->toIso8601String(),
                    'has_evidence' => $event->evidence !== null,
                ])->values(),
                'effective_attendance' => $effective,
                'effective_outcome' => $effective ? $day['outcome'] : null,
                'review' => $effective ? $day['review'] : null,
                'finalization' => $effective ? $day['finalization'] : null,
            ];
        })->values();

        return response()->json([
            'outlet' => ['id' => (int) $outlet->getKey(), 'name' => $outlet->name],
            'from' => $validated['from'],
            'to' => $validated['to'],
            'sessions' => $sessionViews,
        ]);
    }

    public function evidence(Request $request, int $event): BinaryFileResponse|JsonResponse
    {
        return $this->evidenceResponse($request, $event, false);
    }

    public function personalEvidence(Request $request, int $event): BinaryFileResponse|JsonResponse
    {
        return $this->evidenceResponse($request, $event, true);
    }

    private function evidenceResponse(Request $request, int $event, bool $employeeOnly): BinaryFileResponse|JsonResponse
    {
        $validated = $request->validate(['download' => ['sometimes', 'boolean']]);
        $action = (bool) ($validated['download'] ?? false) ? 'download' : 'view';
        $membership = $this->activeMembership($request);
        $attendanceEvent = AttendanceEvent::query()->forTenant((int) $membership->tenant_id)
            ->with(['session.outlet', 'evidence'])->whereKey($event)->first();

        if (! $attendanceEvent || ! $attendanceEvent->evidence || ! $attendanceEvent->session) {
            throw new AuthorizationException('Attendance evidence is not available.');
        }

        /** @var AttendanceEvidence $evidence */
        $evidence = $attendanceEvent->evidence;
        $canManageOutlet = $this->authorization->canManageOutlet(
            $membership,
            $attendanceEvent->session->outlet,
        );
        $canViewOwnEvidence = $this->authorization->hasRole($membership, TenantRole::Employee)
            && $membership->employeeUserLink()
                ->where('tenant_id', $membership->tenant_id)
                ->where('employee_id', $attendanceEvent->employee_id)
                ->exists();

        if (($employeeOnly && ! $canViewOwnEvidence) || (! $canManageOutlet && ! $canViewOwnEvidence)) {
            $this->evidenceAudit->record($membership, $attendanceEvent, $evidence, $action, 'denied');
            throw new AuthorizationException('Attendance evidence is not available.');
        }

        $contentTypes = [
            'image/jpeg' => ['extension' => 'jpg'],
            'image/webp' => ['extension' => 'webp'],
        ];
        $contentType = $evidence->stored_mime_type;
        if ((($employeeOnly || ! $canManageOutlet) && ! AttendanceEvidenceExpirationService::availableToEmployee($attendanceEvent))
            || $evidence->lifecycle_state !== 'available'
            || ! isset($contentTypes[$contentType])
            || ! is_string($evidence->storage_path)) {
            $this->evidenceAudit->record($membership, $attendanceEvent, $evidence, $action, 'failure');

            return response()->json(['message' => 'Bukti kehadiran tidak tersedia.'], 404);
        }

        $path = $this->evidenceStorage->stream($evidence->storage_path);
        $storedImageInfo = $path ? @getimagesize($path) : false;
        if (! $path || ! is_array($storedImageInfo) || ($storedImageInfo['mime'] ?? null) !== $contentType) {
            $this->evidenceAudit->record($membership, $attendanceEvent, $evidence, $action, 'failure');

            return response()->json(['message' => 'Bukti kehadiran tidak tersedia.'], 404);
        }

        $this->evidenceAudit->record($membership, $attendanceEvent, $evidence, $action, 'success');

        return response()->file($path, [
            'Content-Type' => $contentType,
            'Content-Disposition' => ((bool) ($validated['download'] ?? false) ? 'attachment' : 'inline')
                .'; filename="attendance-evidence.'.$contentTypes[$contentType]['extension'].'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
        ]);
    }

    /** @return array<string, mixed> */
    private function locationRules(): array
    {
        return [
            'location' => ['sometimes', 'nullable', 'array:status,latitude,longitude,accuracy_meters'],
            'location.status' => ['required_with:location', Rule::in(['provided', 'unavailable', 'permission_denied'])],
            'location.latitude' => ['prohibited_unless:location.status,provided', 'required_if:location.status,provided', 'numeric', 'between:-90,90'],
            'location.longitude' => ['prohibited_unless:location.status,provided', 'required_if:location.status,provided', 'numeric', 'between:-180,180'],
            'location.accuracy_meters' => ['prohibited_unless:location.status,provided', 'required_if:location.status,provided', 'numeric', 'gt:0', 'max:50000'],
        ];
    }

    /** @return array{photo: array<int, mixed>} */
    private function personalPhotoRules(): array
    {
        $required = (bool) config('attendance_evidence.require_personal_photo', false);

        return ['photo' => [
            $required ? 'required' : 'sometimes',
            'file',
            'mimetypes:image/jpeg,image/png,image/webp',
            File::image()->min(10)->max(5120)->dimensions(
                Rule::dimensions()->minWidth(320)->minHeight(240)->maxWidth(1920)->maxHeight(1920),
            ),
        ]];
    }

    private function activeMembership(Request $request): TenantMembership
    {
        $membership = $request->attributes->get('activeMembership');
        if (! $membership instanceof TenantMembership || (int) $membership->user_id !== (int) $request->user()?->getAuthIdentifier()) {
            throw new AuthorizationException('An active tenant membership is required.');
        }

        return $membership;
    }

    private function linkedEmployee(Request $request, TenantMembership $membership): Employee
    {
        $identity = $this->employeeLinkResult($membership);
        if ($identity['status'] !== 'linked') {
            $code = $identity['status'];
            $message = $code === 'employee_link_required'
                ? 'Akun ini belum terhubung ke identitas karyawan.'
                : 'Identitas karyawan tidak tersedia dalam organisasi aktif.';
            throw new HttpResponseException(response()->json([
                'code' => $code,
                'message' => $message,
            ], 403));
        }

        if (! $this->authorization->hasRole($membership, TenantRole::Employee)) {
            throw new HttpResponseException(response()->json([
                'code' => 'employee_role_required',
                'message' => 'Peran Karyawan diperlukan untuk kehadiran personal.',
            ], 403));
        }

        return $identity['employee'];
    }

    /** @return array{status: 'linked', employee: Employee}|array{status: 'employee_link_required'|'employee_unavailable', employee: null} */
    private function employeeLinkResult(TenantMembership $membership): array
    {
        $employeeId = EmployeeUserLink::query()->forTenant((int) $membership->tenant_id)
            ->where('tenant_membership_id', $membership->getKey())->value('employee_id');
        if ($employeeId === null) {
            return ['status' => 'employee_link_required', 'employee' => null];
        }

        $employee = Employee::query()->forTenant((int) $membership->tenant_id)->whereKey($employeeId)->first();
        if (! $employee) {
            return ['status' => 'employee_unavailable', 'employee' => null];
        }

        return ['status' => 'linked', 'employee' => $employee];
    }

    private function kioskDevice(Request $request, ?int $expectedId = null): KioskDevice
    {
        $device = $request->attributes->get('kioskDevice');
        if (! $device instanceof KioskDevice || $device->revoked_at !== null) {
            throw new AuthorizationException('Kiosk attendance access is not available.');
        }
        if ($expectedId !== null && $expectedId !== (int) $device->getKey()) {
            throw new HttpResponseException(response()->json([
                'code' => 'kiosk_pairing_changed',
                'message' => 'Pemasangan kiosk berubah. Muat ulang status perangkat.',
            ], 409));
        }

        return $device;
    }

    private function verifyKioskEmployee(KioskDevice $device, int $employeeId, string $pin, bool $requireAssignment): Employee
    {
        try {
            $employee = $this->pins->verify($device, $employeeId, $pin, $requireAssignment);
        } catch (TooManyRequestsHttpException) {
            throw new HttpResponseException(response()->json([
                'code' => 'pin_rate_limited',
                'message' => 'PIN tidak dapat diverifikasi saat ini. Coba lagi nanti.',
            ], 429));
        }

        if (! $employee) {
            throw new HttpResponseException(response()->json([
                'code' => 'pin_invalid',
                'message' => 'PIN atau identitas tidak valid.',
            ], 401));
        }

        return $employee;
    }

    private function idempotencyKey(Request $request): string
    {
        $key = (string) $request->header('Idempotency-Key', '');
        $this->assertKey($key);

        return $key;
    }

    private function assertKey(string $key): void
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $key) !== 1) {
            throw ValidationException::withMessages(['Idempotency-Key' => 'Kunci idempotensi harus berupa UUID yang valid.']);
        }
    }

    private function assertOperation(string $operation): void
    {
        if (! in_array($operation, ['check_in', 'check_out'], true)) {
            throw ValidationException::withMessages(['operation' => 'Operasi kehadiran tidak valid.']);
        }
    }
}
