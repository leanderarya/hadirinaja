<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Services\CorrectionEvidenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

final class CorrectionEvidenceController extends Controller
{
    public function __construct(private readonly CorrectionEvidenceService $evidence) {}

    public function index(Request $request, int $approvalRequest): JsonResponse
    {
        return response()->json($this->evidence->index($this->membership($request), $request->user(), $approvalRequest));
    }

    public function upload(Request $request, int $approvalRequest): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'max:5120'],
            'decision_id' => ['nullable', 'integer', 'min:1'],
            'finalization_id' => ['nullable', 'integer', 'min:1'],
            'key' => ['required', 'uuid'],
        ]);

        return response()->json(['file' => $this->evidence->upload(
            $this->membership($request), $request->user(), $approvalRequest, $data['file'], strtolower($data['key']),
            isset($data['decision_id']) ? (int) $data['decision_id'] : null,
            isset($data['finalization_id']) ? (int) $data['finalization_id'] : null,
        )]);
    }

    public function download(Request $request, int $approvalRequest, int $evidence): Response
    {
        [$mime, $bytes] = $this->evidence->download($this->membership($request), $request->user(), $approvalRequest, $evidence);
        $extension = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'][$mime];

        return response($bytes, 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="correction-evidence-'.$evidence.'.'.$extension.'"',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "sandbox; default-src 'none'",
        ]);
    }

    public function requireSupplement(Request $request, int $approvalRequest): Response
    {
        $this->evidence->requireSupplement($this->membership($request), $request->user(), $approvalRequest, $this->reason($request));

        return response()->noContent();
    }

    public function hold(Request $request, int $approvalRequest, int $evidence): Response
    {
        $action = $request->validate(['action' => ['required', 'in:request,approve,reject,release']])['action'];
        $this->evidence->hold($this->membership($request), $request->user(), $approvalRequest, $evidence, $action, $this->reason($request));

        return response()->noContent();
    }

    public function retention(Request $request): JsonResponse
    {
        $days = $request->isMethod('PUT')
            ? (int) $request->validate(['days' => ['required', 'integer', 'between:90,1825']])['days']
            : null;

        return response()->json(['days' => $this->evidence->retention($this->membership($request), $request->user(), $days)]);
    }

    private function reason(Request $request): string
    {
        $reason = trim($request->validate(['reason' => ['required', 'string', 'max:1000']])['reason']);
        if ($reason === '') {
            throw ValidationException::withMessages(['reason' => 'Alasan wajib diisi.']);
        }

        return $reason;
    }

    private function membership(Request $request): TenantMembership
    {
        return $request->attributes->get('activeMembership');
    }
}
