<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\ApprovalRequest;
use App\Models\AttendanceFinalization;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use League\Flysystem\FilesystemException;
use Symfony\Component\Process\Exception\ExceptionInterface;
use Symfony\Component\Process\Process;

final class CorrectionEvidenceService
{
    private const MAX_BYTES = 5 * 1024 * 1024;

    public function __construct(private readonly ApprovalWorkflowService $workflow) {}

    public function upload(TenantMembership $actor, User $user, int $requestId, UploadedFile $file, string $key, ?int $decisionId, ?int $finalizationId): array
    {
        // Authorize before performing potentially expensive file validation. Recheck at the write boundary.
        $this->withRequest($actor, $user, $requestId, fn () => null);
        [$mime, $bytes] = $this->validateFile($file);
        $digest = hash('sha256', $bytes);
        $disk = Storage::disk(AttendanceEvidenceStorage::DISK);
        $path = "correction-evidence/{$actor->tenant_id}/{$requestId}/".Str::uuid();
        $staged = $path.'.part';

        try {
            return $this->withRequest($actor, $user, $requestId, function (ApprovalRequest $request) use ($actor, $key, $mime, $bytes, $digest, $disk, $path, $staged, $decisionId, $finalizationId): array {
                $rows = self::files($request)->orderBy('slot')->lockForUpdate()->get();
                foreach ($rows as $row) {
                    if ((int) $row->uploader_membership_id === (int) $actor->getKey() && $row->upload_key === $key) {
                        if ($row->sha256 !== $digest || $row->approval_decision_id !== $decisionId || $row->attendance_finalization_id !== $finalizationId) {
                            $this->invalid('idempotency_key', 'Kunci unggahan sudah digunakan untuk bukti lain.');
                        }

                        return $this->metadata($row);
                    }
                }
                if ($rows->count() >= 3) {
                    $this->invalid('file', 'Maksimal tiga lampiran per permintaan.');
                }
                $this->assertBindings($request, $decisionId, $finalizationId);
                $now = now('UTC');
                $days = $this->retentionDays((int) $actor->tenant_id);
                $id = DB::table('correction_evidence')->insertGetId([
                    'tenant_id' => $request->tenant_id, 'approval_request_id' => $request->getKey(),
                    'employee_id' => $request->employee_id, 'uploader_membership_id' => $actor->getKey(),
                    'approval_decision_id' => $decisionId, 'attendance_finalization_id' => $finalizationId,
                    'slot' => $rows->count() + 1, 'upload_key' => $key, 'storage_path' => $path,
                    'mime_type' => $mime, 'size_bytes' => strlen($bytes), 'sha256' => $digest,
                    'retention_days' => $days, 'uploaded_at' => $now, 'expires_at' => $now->copy()->addDays($days),
                ]);
                self::audit((int) $request->tenant_id, 'uploaded', $actor, (int) $request->getKey(), $id);
                if (! $disk->put($staged, $bytes, 'private') || ! $disk->move($staged, $path)) {
                    abort(503, 'Penyimpanan bukti sementara tidak tersedia.');
                }

                return $this->metadata(self::files($request)->where('id', $id)->first());
            }, attempts: 1);
        } catch (\Throwable $error) {
            // A database outage may leave commit status unknown. Reconciliation will recheck under the request lock.
            rescue(fn () => $this->removeOrphan($path, (int) $actor->tenant_id, $requestId), report: false);
            if ($error instanceof FilesystemException) {
                abort(503, 'Penyimpanan bukti sementara tidak tersedia.');
            }

            throw $error;
        }
    }

    public function index(TenantMembership $actor, User $user, int $requestId): array
    {
        return $this->withRequest($actor, $user, $requestId, function (ApprovalRequest $request) use ($actor, $requestId): array {
            self::audit((int) $actor->tenant_id, 'listed', $actor, $requestId);
            $required = self::supplementRequirement($request);

            return [
                'files' => self::files($request)->orderBy('slot')->get()->map($this->metadata(...))->all(),
                'supplement' => $required ? [
                    'reason' => $required->reason, 'required_at' => $required->acted_at,
                    'satisfied' => self::supplementFile($request, (int) $required->id) !== null,
                ] : null,
            ];
        });
    }

    public function download(TenantMembership $actor, User $user, int $requestId, int $id): array
    {
        $result = $this->withRequest($actor, $user, $requestId, function (ApprovalRequest $request) use ($actor, $requestId, $id): ?array {
            $row = self::files($request)->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                throw new AuthorizationException('Bukti koreksi tidak tersedia.');
            }
            $bytes = self::readable($row) ? self::readVerified($row) : null;
            self::audit((int) $actor->tenant_id, $bytes === null ? 'unavailable' : 'downloaded', $actor, $requestId, $id);

            return $bytes === null ? null : [$row->mime_type, $bytes];
        });

        abort_if($result === null, 404, 'Bukti koreksi tidak tersedia.');

        return $result;
    }

    public function requireSupplement(TenantMembership $actor, User $user, int $requestId, string $reason): void
    {
        $this->withRequest($actor, $user, $requestId, function (ApprovalRequest $request) use ($actor, $requestId, $reason): void {
            if ($request->status !== 'pending' || ($request->details['classification'] ?? null) !== 'sensitive') {
                $this->invalid('request', 'Bukti tambahan hanya dapat diminta untuk koreksi sensitif yang masih menunggu.');
            }
            if (self::supplementRequirement($request) !== null || self::files($request)->count() >= 3) {
                $this->invalid('request', 'Bukti tambahan sudah diminta atau batas lampiran telah tercapai.');
            }
            self::audit((int) $actor->tenant_id, 'proof_required', $actor, $requestId, reason: $reason);
        }, review: true);
    }

    public static function recordSupplementForApproval(ApprovalRequest $request, TenantMembership $actor, int $decisionId): void
    {
        $required = self::supplementRequirement($request);
        if ($required === null) {
            return;
        }
        $file = self::supplementFile($request, (int) $required->id);
        if ($file === null) {
            throw ValidationException::withMessages(['evidence' => 'Bukti tambahan yang diminta belum tersedia.']);
        }

        self::audit((int) $request->tenant_id, 'proof_used', $actor, (int) $request->getKey(), (int) $file->id,
            details: ['requirement_audit_id' => (int) $required->id], decisionId: $decisionId);
    }

    public function retention(TenantMembership $actor, User $user, ?int $days): int
    {
        return DB::transaction(function () use ($actor, $user, $days): int {
            $this->assertOwner($actor, $user);
            $tenantId = (int) $actor->tenant_id;
            $current = $this->retentionDays($tenantId);
            if ($days === null || $days === $current) {
                return $current;
            }
            DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first();
            $previous = $this->retentionDays($tenantId, lock: true);
            DB::table('correction_evidence_retention')->upsert(['tenant_id' => $tenantId, 'days' => $days], ['tenant_id'], ['days']);
            self::audit($tenantId, 'retention_changed', $actor, details: ['previous_days' => $previous, 'days' => $days]);

            return $days;
        }, attempts: 3);
    }

    public function hold(TenantMembership $actor, User $user, int $requestId, int $id, string $action, string $reason): void
    {
        $this->withRequest($actor, $user, $requestId, function (ApprovalRequest $request) use ($actor, $user, $requestId, $id, $action, $reason): void {
            $this->assertOwner($actor, $user);
            $row = self::files($request)->where('id', $id)->lockForUpdate()->first();
            if (! $row || $row->deletion_started_at !== null || self::readVerified($row) === null) {
                $this->invalid('evidence', 'Bukti tidak tersedia untuk penahanan.');
            }
            $tenantId = (int) $actor->tenant_id;
            $last = self::latestHold($tenantId, $id);
            $state = self::holdState($last);
            $next = match (true) {
                $action === 'request' && $state === null => 'hold_requested',
                $action === 'approve' && $state === 'pending' => 'hold_placed',
                $action === 'reject' && $state === 'pending' => 'hold_rejected',
                $action === 'release' && $state === 'held' => 'hold_released',
                default => null,
            };
            if ($next === null) {
                $this->invalid('hold', 'Tindakan tidak sesuai dengan status penahanan saat ini.');
            }
            if (in_array($action, ['approve', 'reject'], true) && (int) $last->actor_membership_id === (int) $actor->getKey()) {
                $owners = TenantMembership::query()->forTenant($tenantId)->where('is_active', true)
                    ->whereHas('roles', fn ($roles) => $roles->where('role', TenantRole::Owner->value))->count();
                if ($owners !== 1) {
                    throw new AuthorizationException('Penahanan harus diputuskan oleh Owner aktif lain.');
                }
            }
            // Only the first request (or the first after a released hold) grants a preservation lease.
            $details = $action === 'request' ? ['lease_granted' => $last === null || $last->action === 'hold_released'] : null;
            self::audit($tenantId, $next, $actor, $requestId, $id, $reason, $details);
        });
    }

    public function expire(int $limit, bool $dryRun): array
    {
        $summary = ['eligible' => 0, 'deleted' => 0, 'protected' => 0, 'failed' => 0, 'orphans_deleted' => 0];
        $rows = DB::table('correction_evidence')->whereNull('deleted_at')->where('expires_at', '<=', now('UTC'))
            ->lazyById();
        foreach ($rows as $candidate) {
            if ($summary['eligible'] + $summary['failed'] >= $limit) {
                break;
            }
            try {
                $state = $dryRun
                    ? (self::protectedByHold(self::latestHold((int) $candidate->tenant_id, (int) $candidate->id, false)) ? 'protected' : 'eligible')
                    : $this->expireFile($candidate);
                if ($state === 'deleted') {
                    $summary['eligible']++;
                }
                $summary[$state]++;
            } catch (\Throwable $error) {
                report($error);
                $summary['failed']++;
            }
        }
        if (! $dryRun) {
            $summary['orphans_deleted'] = $this->sweepOrphans($limit);
        }

        return $summary;
    }

    private function expireFile(object $candidate): string
    {
        $id = (int) $candidate->id;
        $row = DB::transaction(function () use ($id, $candidate) {
            ApprovalRequest::query()->forTenant((int) $candidate->tenant_id)
                ->whereKey($candidate->approval_request_id)->lockForUpdate()->firstOrFail();
            $row = DB::table('correction_evidence')->where('id', $id)->lockForUpdate()->first();
            if (! $row || $row->deleted_at !== null || self::protectedByHold(self::latestHold((int) $row->tenant_id, $id))) {
                return null;
            }
            if ($row->deletion_started_at === null) {
                DB::table('correction_evidence')->where('id', $id)->update(['deletion_started_at' => now('UTC')]);
                self::audit((int) $row->tenant_id, 'expiry_started', requestId: (int) $row->approval_request_id, evidenceId: $id);
            }

            return $row;
        }, attempts: 3);

        if ($row === null) {
            return 'protected';
        }

        return DB::transaction(function () use ($id, $candidate): string {
            ApprovalRequest::query()->forTenant((int) $candidate->tenant_id)
                ->whereKey($candidate->approval_request_id)->lockForUpdate()->firstOrFail();
            $row = DB::table('correction_evidence')->where('id', $id)->lockForUpdate()->first();
            if ($row->deleted_at !== null) {
                return 'protected';
            }
            $disk = Storage::disk(AttendanceEvidenceStorage::DISK);
            if ($disk->exists($row->storage_path) && ! $disk->delete($row->storage_path)) {
                self::audit((int) $row->tenant_id, 'expiry_failed', requestId: (int) $row->approval_request_id, evidenceId: $id);

                return 'failed';
            }
            DB::table('correction_evidence')->where('id', $id)->update(['deleted_at' => now('UTC')]);
            self::audit((int) $row->tenant_id, 'expired', requestId: (int) $row->approval_request_id, evidenceId: $id);

            return 'deleted';
        }, attempts: 1);
    }

    private function withRequest(TenantMembership $actor, User $user, int $requestId, callable $operation, bool $review = false, int $attempts = 3): mixed
    {
        try {
            return DB::transaction(function () use ($actor, $user, $requestId, $operation, $review) {
                return $operation($this->workflow->lockCorrectionEvidenceRequest($actor, $user, $requestId, $review));
            }, attempts: $attempts);
        } catch (AuthorizationException $error) {
            // Denials do not record unverified foreign request or file identifiers.
            self::audit((int) $actor->tenant_id, 'denied', $actor);
            throw $error;
        }
    }

    private function assertBindings(ApprovalRequest $request, ?int $decisionId, ?int $finalizationId): void
    {
        $decisions = $request->decisions()->forTenant((int) $request->tenant_id)
            ->whereIn('action', ['approved', 'routine_applied', 'rejected', 'reversed']);
        if ($decisionId !== null && ! (clone $decisions)->whereKey($decisionId)->exists()) {
            $this->invalid('decision_id', 'Keputusan bukan bagian dari permintaan koreksi ini.');
        }
        if ($finalizationId !== null) {
            $finalization = AttendanceFinalization::query()->forTenant((int) $request->tenant_id)
                ->where('employee_id', $request->employee_id)->whereKey($finalizationId)->first();
            $provenance = $finalization?->projection_snapshot['projection_provenance'] ?? [];
            $snapshotIds = array_merge($provenance['correction_decision_ids'] ?? [], $provenance['correction_reversal_ids'] ?? [],
                $provenance['correction_departure_decision_ids'] ?? []);
            if ($decisionId === null || ! in_array($decisionId, $snapshotIds, true)) {
                $this->invalid('finalization_id', 'Versi finalisasi tidak memuat keputusan koreksi tersebut.');
            }
        }
    }

    private static function files(ApprovalRequest $request): Builder
    {
        return DB::table('correction_evidence')->where('tenant_id', $request->tenant_id)->where('approval_request_id', $request->getKey());
    }

    private static function supplementRequirement(ApprovalRequest $request): ?object
    {
        return DB::table('correction_evidence_audit')->where('tenant_id', $request->tenant_id)
            ->where('approval_request_id', $request->getKey())->where('action', 'proof_required')->orderByDesc('id')->lockForUpdate()->first();
    }

    private static function supplementFile(ApprovalRequest $request, int $requirementId): ?object
    {
        $files = DB::table('correction_evidence_audit as audit')
            ->join('correction_evidence as file', fn ($join) => $join->on('file.id', '=', 'audit.evidence_id')->on('file.tenant_id', '=', 'audit.tenant_id'))
            ->where('audit.tenant_id', $request->tenant_id)->where('audit.approval_request_id', $request->getKey())
            ->where('audit.action', 'uploaded')->where('audit.id', '>', $requirementId)
            ->whereNull('file.deletion_started_at')->orderBy('audit.id')->lockForUpdate()->get(['file.*']);
        foreach ($files as $file) {
            if (self::readable($file) && self::readVerified($file) !== null) {
                return $file;
            }
        }

        return null;
    }

    private static function readable(object $row): bool
    {
        return $row->deletion_started_at === null && ($row->expires_at > now('UTC')->toDateTimeString()
            || self::protectedByHold(self::latestHold((int) $row->tenant_id, (int) $row->id)));
    }

    private function assertOwner(TenantMembership $actor, User $user): void
    {
        $membership = TenantMembership::query()->forTenant((int) $actor->tenant_id)
            ->whereKey($actor->getKey())->where('user_id', $user->getKey())->where('is_active', true)->lockForUpdate()->first();
        if (! $membership || ! TenantRoleAssignment::query()->forTenant((int) $actor->tenant_id)
            ->where('tenant_membership_id', $actor->getKey())->where('role', TenantRole::Owner->value)->lockForUpdate()->first()) {
            throw new AuthorizationException('Tindakan ini memerlukan Owner aktif.');
        }
    }

    private function retentionDays(int $tenantId, bool $lock = false): int
    {
        return (int) (DB::table('correction_evidence_retention')->where('tenant_id', $tenantId)
            ->when($lock, fn ($query) => $query->lockForUpdate())->value('days') ?? 365);
    }

    private static function latestHold(int $tenantId, int $id, bool $lock = true): ?object
    {
        return DB::table('correction_evidence_audit')->where('tenant_id', $tenantId)->where('evidence_id', $id)
            ->whereIn('action', ['hold_requested', 'hold_placed', 'hold_rejected', 'hold_released'])
            ->when($lock, fn ($query) => $query->lockForUpdate())->orderByDesc('id')->first();
    }

    private static function holdState(?object $last): ?string
    {
        return match ($last?->action) {
            'hold_placed' => 'held',
            'hold_requested' => now('UTC')->subHours(AttendanceEvidenceLegalHoldService::PRESERVATION_LEASE_HOURS)->toDateTimeString() < $last->acted_at ? 'pending' : null,
            default => null,
        };
    }

    private static function protectedByHold(?object $last): bool
    {
        $state = self::holdState($last);

        return $state === 'held' || ($state === 'pending' && (json_decode($last->details ?? '{}', true)['lease_granted'] ?? false));
    }

    private static function audit(int $tenantId, string $action, ?TenantMembership $actor = null, ?int $requestId = null, ?int $evidenceId = null, ?string $reason = null, ?array $details = null, ?int $decisionId = null): void
    {
        DB::table('correction_evidence_audit')->insert([
            'tenant_id' => $tenantId, 'approval_request_id' => $requestId, 'evidence_id' => $evidenceId,
            'actor_membership_id' => $actor?->getKey(), 'approval_decision_id' => $decisionId, 'action' => $action, 'reason' => $reason,
            'details' => $details === null ? null : json_encode($details, JSON_THROW_ON_ERROR), 'acted_at' => now('UTC'),
        ]);
    }

    private function metadata(object $row): array
    {
        return [
            'id' => (int) $row->id, 'mime_type' => $row->mime_type, 'size_bytes' => (int) $row->size_bytes,
            'sha256' => $row->sha256, 'decision_id' => $row->approval_decision_id, 'finalization_id' => $row->attendance_finalization_id,
            'uploaded_at' => $row->uploaded_at, 'expires_at' => $row->expires_at, 'retention_days' => (int) $row->retention_days,
            'available' => self::readable($row),
            'hold_state' => self::holdState(self::latestHold((int) $row->tenant_id, (int) $row->id, false)),
        ];
    }

    private static function readVerified(object $row): ?string
    {
        $disk = Storage::disk(AttendanceEvidenceStorage::DISK);
        $stream = $disk->readStream($row->storage_path);
        if (! is_resource($stream)) {
            return null;
        }
        try {
            $bytes = stream_get_contents($stream, self::MAX_BYTES + 1);
        } finally {
            fclose($stream);
        }

        return is_string($bytes) && strlen($bytes) === (int) $row->size_bytes && hash('sha256', $bytes) === $row->sha256 ? $bytes : null;
    }

    private function sweepOrphans(int $limit): int
    {
        $disk = Storage::disk(AttendanceEvidenceStorage::DISK);
        $count = 0;
        foreach ($disk->getDriver()->listContents('correction-evidence', true) as $entry) {
            if ($entry->isFile() && $entry->lastModified() < now('UTC')->subDay()->timestamp
                && preg_match('~^correction-evidence/(\d+)/(\d+)/[a-f0-9-]{36}(?:\.part)?$~D', $entry->path(), $match)
                && ! DB::table('correction_evidence')->where('storage_path', $entry->path())->exists()
                && $this->removeOrphan($entry->path(), (int) $match[1], (int) $match[2])) {
                if (++$count >= $limit) {
                    break;
                }
            }
        }

        return $count;
    }

    private function removeOrphan(string $path, int $tenantId, int $requestId): bool
    {
        return DB::transaction(function () use ($path, $tenantId, $requestId): bool {
            ApprovalRequest::query()->forTenant($tenantId)->whereKey($requestId)->lockForUpdate()->first();
            if (DB::table('correction_evidence')->where('storage_path', $path)->lockForUpdate()->first()) {
                return false;
            }
            $disk = Storage::disk(AttendanceEvidenceStorage::DISK);
            $deleted = false;
            foreach ([$path, $path.'.part'] as $candidate) {
                if ($disk->exists($candidate)) {
                    $deleted = $disk->delete($candidate) || $deleted;
                }
            }

            return $deleted;
        }, attempts: 1);
    }

    private function validateFile(UploadedFile $file): array
    {
        $size = $file->getSize();
        if (! $file->isValid() || ! is_int($size) || $size < 1 || $size > self::MAX_BYTES) {
            $this->invalid('file', 'Bukti harus berukuran paling banyak 5 MB.');
        }
        $bytes = file_get_contents($file->getPathname(), length: self::MAX_BYTES + 1);
        if ($bytes === false || strlen($bytes) !== $size) {
            $this->invalid('file', 'Bukti tidak dapat dibaca.');
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        if ($mime === 'application/pdf') {
            $this->validatePdf($file->getPathname(), $bytes);
        } else {
            $endMatches = match ($mime) {
                'image/jpeg' => str_ends_with($bytes, "\xFF\xD9"),
                'image/png' => str_ends_with($bytes, "IEND\xAE\x42\x60\x82"),
                'image/webp' => $size >= 12 && substr($bytes, 8, 4) === 'WEBP' && unpack('V', substr($bytes, 4, 4))[1] === $size - 8,
                default => false,
            };
            $image = $endMatches ? @getimagesizefromstring($bytes) : false;
            if (! $image || $image['mime'] !== $mime || $image[0] * $image[1] > 16000000
                || ! function_exists('imagecreatefromstring') || ! @imagecreatefromstring($bytes)) {
                $this->invalid('file', 'Gunakan berkas JPEG, PNG, WebP, atau PDF yang valid.');
            }
        }

        return [$mime, $bytes];
    }

    private function validatePdf(string $path, string $bytes): void
    {
        // Refuse encrypted files and object streams so structural names cannot hide from the feature check.
        $names = preg_replace_callback('/#([0-9a-f]{2})/i', fn ($match) => chr(hexdec($match[1])), $bytes);
        if (! preg_match('/^%PDF-[12]\.\d[\r\n]/', $bytes) || ! preg_match('/%%EOF\s*$/D', $bytes)
            || preg_match('~/\s*(?:JavaScript|JS|Launch|EmbeddedFiles?|FileAttachment|OpenAction|AA|RichMedia|Encrypt|XFA|ObjStm|SubmitForm|ImportData|GoTo[RE]|Rendition|Movie|Sound|3D)\b~i', $names)) {
            $this->invalid('file', 'PDF tidak valid atau memuat fitur aktif.');
        }
        try {
            $process = new Process([(string) config('attendance_evidence.pdfinfo_binary', 'pdfinfo'), '-js', $path], timeout: 5);
            $process->run();
        } catch (ExceptionInterface) {
            abort(503, 'Pemeriksa PDF sementara tidak tersedia.');
        }
        if (in_array($process->getExitCode(), [126, 127], true)) {
            abort(503, 'Pemeriksa PDF sementara tidak tersedia.');
        }
        if (! $process->isSuccessful() || trim($process->getOutput()) !== '' || trim($process->getErrorOutput()) !== '') {
            $this->invalid('file', 'PDF tidak valid atau memuat fitur aktif.');
        }
    }

    private function invalid(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
