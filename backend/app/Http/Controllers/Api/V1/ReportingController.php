<?php

namespace App\Http\Controllers\Api\V1;

use App\Data\ReportingScope;
use App\Http\Controllers\Controller;
use App\Models\ReportExportEvent;
use App\Models\Tenant;
use App\Services\AttendanceReportingService;
use App\Services\AuditTrailQueryService;
use App\Services\ReportingAccessService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class ReportingController extends Controller
{
    public function __construct(
        private readonly ReportingAccessService $access,
        private readonly AttendanceReportingService $reports,
        private readonly AuditTrailQueryService $audit,
    ) {}

    public function filters(Request $request): JsonResponse
    {
        $scope = $this->access->scope($request);

        return response()->json($this->reports->filterOptions($scope));
    }

    public function dashboard(Request $request): JsonResponse
    {
        $scope = $this->access->scope($request);
        $filters = $this->filtersFromRequest($request, $scope);

        return response()->json($this->reports->dashboard($scope, $filters));
    }

    public function attendance(Request $request): JsonResponse
    {
        $scope = $this->access->scope($request);
        $filters = $this->filtersFromRequest($request, $scope);

        return response()->json($this->reports->attendancePage($scope, $filters));
    }

    public function approvals(Request $request): JsonResponse
    {
        $scope = $this->access->scope($request);
        $filters = $this->filtersFromRequest($request, $scope);

        return response()->json([
            'approval_requests' => $this->reports->approvalSummary($scope, $filters),
            'provenance' => $this->access->provenance($scope, $filters, 'approval_review_summary'),
        ]);
    }

    public function export(Request $request): StreamedResponse
    {
        $scope = $this->access->scope($request);
        abort_unless($scope->owner, 403, 'Ekspor CSV hanya tersedia untuk Owner.');
        $filters = $this->filtersFromRequest($request, $scope);
        $rows = $this->reports->exportRows($scope, $filters);
        $generatedAt = CarbonImmutable::now('UTC');
        $tenant = Tenant::query()->whereKey($scope->tenantId)->firstOrFail();
        DB::transaction(function () use ($scope, $filters, $rows, $generatedAt): void {
            $event = ReportExportEvent::query()->create([
                'tenant_id' => $scope->tenantId,
                'actor_user_id' => $scope->userId,
                'actor_membership_id' => (int) $scope->membership->getKey(),
                'report_type' => 'attendance_detail_csv',
                'filters' => [
                    'from' => $filters['from'],
                    'to' => $filters['to'],
                    'business_unit_id' => $filters['business_unit_id'],
                    'employee_id' => $filters['employee_id'],
                    'status' => $filters['status'],
                    'row_count' => count($rows),
                ],
                'row_count' => count($rows),
                'generated_at' => $generatedAt,
            ]);
            $outletRows = array_map(fn (int $outletId): array => [
                'tenant_id' => $scope->tenantId,
                'report_export_event_id' => (int) $event->getKey(),
                'outlet_id' => $outletId,
            ], $filters['outlet_ids']);
            if ($outletRows !== []) {
                DB::table('report_export_event_outlets')->insert($outletRows);
            }
        });

        $filename = 'laporan-kehadiran-'.$filters['from'].'-'.$filters['to'].'.csv';
        $headers = [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
        ];

        return response()->streamDownload(function () use ($rows, $scope, $filters, $tenant, $generatedAt): void {
            $output = fopen('php://output', 'wb');
            if ($output === false) {
                return;
            }

            fwrite($output, "\xEF\xBB\xBF");
            $this->csvRow($output, ['Metadata laporan', 'Laporan kehadiran HadirinAja']);
            $this->csvRow($output, ['Organisasi aktif', $tenant->name.' (#'.$scope->tenantId.')']);
            $this->csvRow($output, ['Rentang work_date lokal Outlet', $filters['from'].' s/d '.$filters['to']]);
            $this->csvRow($output, ['Dibuat pada (UTC)', $generatedAt->toIso8601String()]);
            $this->csvRow($output, ['Interpretasi', 'Nilai kehadiran efektif saat ini; bukan snapshot historis yang tidak berubah.']);
            $this->csvRow($output, [
                'Tanggal kerja', 'Unit bisnis', 'Outlet', 'ID karyawan', 'Nama karyawan', 'Jadwal',
                'Jadwal masuk', 'Jadwal pulang', 'Durasi jadwal (detik)', 'Check-in tercatat',
                'Check-out tercatat', 'Durasi tercatat (detik)', 'Check-in efektif', 'Check-out efektif',
                'Durasi efektif (detik)', 'Status hasil efektif', 'Status review', 'Cuti/izin disetujui',
                'Lembur diminta (menit)', 'Lembur disetujui (menit)', 'Finalisasi',
                'Sesi attendance', 'Event attendance', 'Keputusan koreksi',
            ]);

            foreach ($rows as $row) {
                $sessions = collect($row['sessions']);
                $reconstructions = collect($row['reconstructions']);
                $effectiveSources = $sessions->concat($reconstructions);
                $leave = $row['approved_leave']['category'] ?? '';
                $overtime = collect($row['overtime_requests']);
                $this->csvRow($output, [
                    $row['work_date'],
                    collect($row['business_units'])->pluck('name')->unique()->implode(' | '),
                    collect($row['outlets'])->pluck('name')->unique()->implode(' | '),
                    $row['employee']['id'],
                    $row['employee']['name'],
                    $row['schedule']['shift']['name'] ?? '',
                    $row['schedule']['scheduled_start'] ?? '',
                    $row['schedule']['scheduled_end'] ?? '',
                    $row['schedule']['duration_seconds'] ?? '',
                    $sessions->pluck('original.check_in_at')->filter()->implode(' | '),
                    $sessions->pluck('original.check_out_at')->filter()->implode(' | '),
                    $row['actual_duration_seconds'] ?? '',
                    $effectiveSources->pluck('effective.check_in_at')->filter()->implode(' | '),
                    $effectiveSources->pluck('effective.check_out_at')->filter()->implode(' | '),
                    $row['effective_duration_seconds'] ?? '',
                    $row['outcome'],
                    $row['review']['status'],
                    $leave,
                    $overtime->pluck('requested_minutes')->filter(fn ($value) => $value !== null)->sum(),
                    $overtime->pluck('approved_minutes')->filter(fn ($value) => $value !== null)->sum(),
                    $row['is_finalized'] ? $row['finalization']['outcome'].' #'.$row['finalization']['revision'] : 'Belum difinalisasi',
                    $sessions->pluck('id')->implode(' | '),
                    $sessions->pluck('original.event_ids')->flatten()->implode(' | '),
                    $sessions->pluck('correction.decision_id')->concat($reconstructions->pluck('decision_id'))->filter()->implode(' | '),
                ]);
            }

            fclose($output);
        }, $filename, $headers);
    }

    public function audit(Request $request): JsonResponse
    {
        $scope = $this->access->scope($request);
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'outlet_ids' => ['sometimes', 'array', 'max:50'],
            'outlet_ids.*' => ['integer', 'min:1'],
            'business_unit_id' => ['sometimes', 'integer', 'min:1'],
            'employee_id' => ['sometimes', 'integer', 'min:1'],
            'source' => ['sometimes', Rule::in(AuditTrailQueryService::SOURCES)],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ]);
        $this->assertRange($validated['from'], $validated['to']);
        $filters = $this->access->filters($scope, [
            ...$validated,
            'status' => null,
            'page' => $validated['page'] ?? 1,
            'per_page' => $validated['per_page'] ?? 25,
        ]);

        return response()->json($this->audit->page($scope, $filters, $validated['source'] ?? null));
    }

    public function auditEntry(Request $request, string $source, int $entry): JsonResponse
    {
        $scope = $this->access->scope($request);
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'outlet_ids' => ['sometimes', 'array', 'max:50'],
            'outlet_ids.*' => ['integer', 'min:1'],
            'business_unit_id' => ['sometimes', 'integer', 'min:1'],
            'employee_id' => ['sometimes', 'integer', 'min:1'],
        ]);
        $this->assertRange($validated['from'], $validated['to']);
        $filters = $this->access->filters($scope, [
            ...$validated,
            'status' => null,
            'page' => 1,
            'per_page' => 1,
        ]);
        $record = $this->audit->find($scope, $filters, $source, $entry);

        return response()->json(['entry' => $record]);
    }

    /** @return array<string, mixed> */
    private function filtersFromRequest(Request $request, ReportingScope $scope, bool $includeStatus = true): array
    {
        $rules = [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'outlet_ids' => ['sometimes', 'array', 'max:50'],
            'outlet_ids.*' => ['integer', 'min:1'],
            'business_unit_id' => ['sometimes', 'integer', 'min:1'],
            'employee_id' => ['sometimes', 'integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
        if ($includeStatus) {
            $rules['status'] = ['sometimes', Rule::in([
                'present', 'leave', 'sick', 'permission', 'potential_absence',
                'confirmed_absence_pending_finalization', 'exceptional_attendance', 'no_recorded_outcome',
            ])];
        }
        $validated = $request->validate($rules);
        $this->assertRange($validated['from'], $validated['to']);

        return $this->access->filters($scope, [
            ...$validated,
            'page' => $validated['page'] ?? 1,
            'per_page' => $validated['per_page'] ?? 25,
        ]);
    }

    private function assertRange(string $from, string $to): void
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC');
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $to, 'UTC');
        if (! $start || ! $end || $start->diffInDays($end) > 30) {
            throw ValidationException::withMessages(['to' => 'Rentang laporan maksimal 31 work_date.']);
        }
    }

    /** @param resource $output @param list<mixed> $cells */
    private function csvRow($output, array $cells): void
    {
        $safe = array_map(fn (mixed $value): string => $this->csvCell($value), $cells);
        fputcsv($output, $safe, ',', '"', '');
    }

    private function csvCell(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        $cell = is_scalar($value) ? (string) $value : (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return preg_match('/^[\p{Z}\p{C}]*[=+\-@]/u', $cell) === 1 ? "'".$cell : $cell;
    }
}
