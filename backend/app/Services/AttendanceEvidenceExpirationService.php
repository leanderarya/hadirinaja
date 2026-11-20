<?php

namespace App\Services;

use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class AttendanceEvidenceExpirationService
{
    private const DISK = 'local';

    public const RETENTION_DAYS = 90;

    public static function employeeExpiresAt(AttendanceEvent $event): CarbonImmutable
    {
        $expiry = CarbonImmutable::instance($event->recorded_at)->utc()->addDays(self::RETENTION_DAYS);

        return $event->evidence?->expires_at === null
            ? $expiry
            : $expiry->min($event->evidence->expires_at);
    }

    public static function availableToEmployee(AttendanceEvent $event): bool
    {
        $evidence = $event->evidence;

        return $evidence !== null
            && $evidence->lifecycle_state === 'available'
            && in_array($evidence->stored_mime_type, ['image/jpeg', 'image/webp'], true)
            && is_string($evidence->storage_path)
            && self::employeeExpiresAt($event)->gt(CarbonImmutable::now('UTC'));
    }

    private const ORPHAN_GRACE_HOURS = 24;

    public function __construct(
        private readonly AttendanceEvidenceLegalHoldService $legalHolds,
        private readonly AttendanceEvidenceAuditLogger $audit,
    ) {}

    /** @return array{disabled: bool, eligible: int, deleted: int, held: int, failed: int, orphan_candidates: int, orphans_deleted: int, orphan_failures: int} */
    public function run(bool $dryRun, int $limit, ?DateTimeInterface $now = null): array
    {
        if ($limit < 1 || $limit > 1000) {
            throw new \InvalidArgumentException('Limit must be between 1 and 1000.');
        }

        $now = ($now === null ? now('UTC') : Carbon::instance($now))->copy()->utc();
        if (! $dryRun && ! (bool) config('attendance_evidence.deletion_enabled', false)) {
            return [
                'disabled' => true,
                'eligible' => 0,
                'deleted' => 0,
                'held' => 0,
                'failed' => 0,
                'orphan_candidates' => 0,
                'orphans_deleted' => 0,
                'orphan_failures' => 0,
            ];
        }
        $ids = $this->eligibleIds($now, $limit);
        $summary = [
            'disabled' => false,
            'eligible' => 0,
            'deleted' => 0,
            'held' => 0,
            'failed' => 0,
            'orphan_candidates' => 0,
            'orphans_deleted' => 0,
            'orphan_failures' => 0,
        ];

        if ($dryRun) {
            foreach ($ids as $id) {
                $evidence = AttendanceEvidence::query()->find($id);
                if ($evidence && ($this->legalHolds->hasActiveHold((int) $evidence->tenant_id, $id, $now)
                    || $this->legalHolds->hasPendingLease((int) $evidence->tenant_id, $id, $now))) {
                    $summary['held']++;
                } else {
                    $summary['eligible']++;
                }
            }
            $summary['orphan_candidates'] = count($this->orphanCandidates($now, $limit));

            return $summary;
        }

        foreach ($ids as $id) {
            $summary['eligible']++;
            $result = $this->processEvidence($id, $now);
            if ($result === 'deleted') {
                $summary['deleted']++;
            } elseif ($result === 'held') {
                $summary['eligible']--;
                $summary['held']++;
            } elseif ($result === 'failed') {
                $summary['failed']++;
            } elseif ($result === 'claimed') {
                // The durable claim was written; the deletion phase will be retried after its lease on failure.
                $summary['failed']++;
            }
        }

        foreach ($this->orphanCandidates($now, $limit) as $orphan) {
            $result = $this->deleteOrphan($orphan, $now);
            if ($result === 'deleted') {
                $summary['orphans_deleted']++;
            } elseif ($result === 'failed') {
                $summary['orphan_failures']++;
            }
        }

        return $summary;
    }

    /** @return list<int> */
    private function eligibleIds(Carbon $now, int $limit): array
    {
        $query = DB::table('attendance_evidence as evidence')
            ->join('attendance_events as event', function ($join): void {
                $join->on('event.tenant_id', '=', 'evidence.tenant_id')
                    ->on('event.id', '=', 'evidence.attendance_event_id');
            })
            ->where('event.recorded_at', '<=', $now->copy()->subDays(self::RETENTION_DAYS)->format('Y-m-d H:i:s'))
            ->where(function (Builder $query) use ($now): void {
                $query->where(function (Builder $available) use ($now): void {
                    $available->where('evidence.lifecycle_state', 'available')
                        ->where(function (Builder $retry) use ($now): void {
                            $retry->whereNull('evidence.deletion_retry_at')
                                ->orWhere('evidence.deletion_retry_at', '<=', $now->format('Y-m-d H:i:s'));
                        });
                })->orWhere(function (Builder $pending) use ($now): void {
                    $pending->where('evidence.lifecycle_state', 'deletion_pending')
                        ->where(function (Builder $retry) use ($now): void {
                            $retry->whereNull('evidence.deletion_retry_at')
                                ->orWhere('evidence.deletion_retry_at', '<=', $now->format('Y-m-d H:i:s'));
                        });
                });
            })
            ->orderBy('evidence.id')
            ->limit($limit);

        return $query->pluck('evidence.id')->map(static fn ($id): int => (int) $id)->all();
    }

    private function processEvidence(int $id, Carbon $now): string
    {
        try {
            $claim = DB::transaction(function () use ($id, $now): string {
                /** @var AttendanceEvidence|null $evidence */
                $evidence = AttendanceEvidence::query()->whereKey($id)->lockForUpdate()->first();
                if (! $evidence) {
                    return 'skipped';
                }
                $event = AttendanceEvent::query()->forTenant((int) $evidence->tenant_id)
                    ->whereKey($evidence->attendance_event_id)->first();
                if (! $event || $event->recorded_at->utc()->addDays(self::RETENTION_DAYS)->gt($now)) {
                    return 'skipped';
                }

                $this->legalHolds->expireDueForEvidenceLocked($evidence, $event, $now);

                if ($this->legalHolds->hasActiveHold((int) $evidence->tenant_id, $id, $now)
                    || $this->legalHolds->hasPendingLease((int) $evidence->tenant_id, $id, $now)) {
                    $this->audit->recordSystem((int) $evidence->tenant_id, $event, $evidence, 'expiration_attempt', 'denied');

                    return 'held';
                }

                $isRetry = $evidence->lifecycle_state === 'deletion_pending';
                if (! $isRetry && $evidence->lifecycle_state !== 'available') {
                    return 'skipped';
                }
                if ($isRetry && $evidence->deletion_retry_at && $evidence->deletion_retry_at->gt($now)) {
                    return 'skipped';
                }

                $attempt = min(65535, (int) $evidence->deletion_attempts + 1);
                $evidence->forceFill([
                    'lifecycle_state' => 'deletion_pending',
                    'deletion_attempts' => $attempt,
                    'deletion_last_attempt_at' => $now,
                    'deletion_retry_at' => $now->copy()->addMinutes(5),
                    'deletion_last_error_code' => null,
                ])->save();
                $this->audit->recordSystem(
                    (int) $evidence->tenant_id,
                    $event,
                    $evidence,
                    $isRetry ? 'expiration_retry' : 'expiration_attempt',
                    'success',
                );

                return 'claimed';
            }, attempts: 1);
        } catch (Throwable) {
            $this->recordFailure($id, 'claim_failed', $now, true);

            return 'failed';
        }

        if ($claim !== 'claimed') {
            return $claim;
        }

        try {
            return DB::transaction(function () use ($id, $now): string {
                /** @var AttendanceEvidence|null $evidence */
                $evidence = AttendanceEvidence::query()->whereKey($id)->lockForUpdate()->first();
                if (! $evidence || $evidence->lifecycle_state !== 'deletion_pending') {
                    return 'skipped';
                }
                $event = AttendanceEvent::query()->forTenant((int) $evidence->tenant_id)
                    ->whereKey($evidence->attendance_event_id)->first();
                if (! $event || $event->recorded_at->utc()->addDays(self::RETENTION_DAYS)->gt($now)) {
                    return 'skipped';
                }

                $this->legalHolds->expireDueForEvidenceLocked($evidence, $event, $now);

                if ($this->legalHolds->hasActiveHold((int) $evidence->tenant_id, $id, $now)) {
                    $evidence->forceFill([
                        'deletion_retry_at' => null,
                        'deletion_last_error_code' => 'legal_hold_active',
                    ])->save();
                    $this->audit->recordSystem((int) $evidence->tenant_id, $event, $evidence, 'expiration_retry', 'denied');

                    return 'held';
                }

                if ($this->legalHolds->hasPendingLease((int) $evidence->tenant_id, $id, $now)) {
                    $evidence->forceFill([
                        'deletion_retry_at' => $this->legalHolds->pendingLeaseExpiry((int) $evidence->tenant_id, $id, $now),
                        'deletion_last_error_code' => 'legal_hold_request_pending',
                    ])->save();
                    $this->audit->recordSystem((int) $evidence->tenant_id, $event, $evidence, 'expiration_retry', 'denied');

                    return 'held';
                }

                $path = $evidence->storage_path;
                if (is_string($path)) {
                    if (! $this->isEvidencePathForTenant($path, (int) $evidence->tenant_id)) {
                        throw new EvidenceLifecycleFailure('invalid_storage_key');
                    }
                    $disk = Storage::disk(self::DISK);
                    if ($disk->exists($path) && ! $disk->delete($path)) {
                        throw new EvidenceLifecycleFailure('storage_delete_failed');
                    }
                }

                $evidence->forceFill([
                    'lifecycle_state' => 'expired',
                    'storage_path' => null,
                    'detected_mime_type' => null,
                    'stored_mime_type' => null,
                    'stored_size_bytes' => null,
                    'image_width' => null,
                    'image_height' => null,
                    'sha256' => null,
                    'deletion_retry_at' => null,
                    'deletion_last_error_code' => null,
                ])->save();
                $this->audit->recordSystem((int) $evidence->tenant_id, $event, $evidence, 'deletion', 'success');

                return 'deleted';
            }, attempts: 1);
        } catch (Throwable $exception) {
            $this->recordFailure($id, $exception instanceof EvidenceLifecycleFailure ? $exception->errorCode : 'deletion_failed', $now, false);

            return 'failed';
        }
    }

    private function recordFailure(int $id, string $errorCode, Carbon $now, bool $incrementAttempt): void
    {
        DB::transaction(function () use ($id, $errorCode, $now, $incrementAttempt): void {
            /** @var AttendanceEvidence|null $evidence */
            $evidence = AttendanceEvidence::query()->whereKey($id)->lockForUpdate()->first();
            if (! $evidence || ! in_array($evidence->lifecycle_state, ['available', 'deletion_pending'], true)) {
                return;
            }
            $attempt = min(65535, (int) $evidence->deletion_attempts + ($incrementAttempt ? 1 : 0));
            $delayMinutes = min(1440, 5 * (2 ** min(8, max(0, $attempt - 1))));
            $evidence->forceFill([
                'deletion_attempts' => $attempt,
                'deletion_last_attempt_at' => $now,
                'deletion_retry_at' => $now->copy()->addMinutes($delayMinutes),
                'deletion_last_error_code' => $errorCode,
            ])->save();
            $event = AttendanceEvent::query()->forTenant((int) $evidence->tenant_id)
                ->whereKey($evidence->attendance_event_id)->first();
            $this->audit->recordSystem(
                (int) $evidence->tenant_id,
                $event,
                $evidence,
                $evidence->deletion_attempts > 1 ? 'expiration_retry' : 'expiration_attempt',
                'failure',
            );
        }, attempts: 1);
    }

    /** @return list<array{tenant_id: int, path: string, hash: string}> */
    private function orphanCandidates(Carbon $now, int $limit): array
    {
        $disk = Storage::disk(self::DISK);
        $cutoff = $now->copy()->subHours(self::ORPHAN_GRACE_HOURS)->getTimestamp();
        $candidates = [];
        foreach ($disk->allFiles('attendance-evidence') as $path) {
            if (count($candidates) >= $limit || ! preg_match('#^attendance-evidence/([1-9][0-9]*)/[0-9a-f-]{36}\.(?:jpg|webp)$#i', $path, $matches)) {
                continue;
            }
            $tenantId = (int) $matches[1];
            try {
                if ($disk->lastModified($path) > $cutoff) {
                    continue;
                }
                if (DB::table('attendance_evidence')->where('storage_path', $path)->exists()) {
                    continue;
                }
                if (DB::table('attendance_idempotency_records')->where('tenant_id', $tenantId)->where('status', 'pending')->exists()) {
                    continue;
                }
            } catch (Throwable) {
                continue;
            }

            $candidates[] = [
                'tenant_id' => $tenantId,
                'path' => $path,
                'hash' => hash('sha256', $tenantId.':'.$path),
            ];
        }

        return $candidates;
    }

    /** @param array{tenant_id: int, path: string, hash: string} $orphan */
    private function deleteOrphan(array $orphan, Carbon $now): string
    {
        $disk = Storage::disk(self::DISK);
        try {
            if ($disk->lastModified($orphan['path']) > $now->copy()->subHours(self::ORPHAN_GRACE_HOURS)->getTimestamp()
                || DB::table('attendance_evidence')->where('storage_path', $orphan['path'])->exists()
                || DB::table('attendance_idempotency_records')->where('tenant_id', $orphan['tenant_id'])->where('status', 'pending')->exists()) {
                return 'skipped';
            }

            $this->audit->recordSystem($orphan['tenant_id'], null, null, 'orphan_cleanup_attempt', 'success', $orphan['hash']);
            if ($disk->exists($orphan['path']) && ! $disk->delete($orphan['path'])) {
                throw new EvidenceLifecycleFailure('orphan_delete_failed');
            }
            $this->audit->recordSystem($orphan['tenant_id'], null, null, 'orphan_cleanup', 'success', $orphan['hash']);

            return 'deleted';
        } catch (Throwable) {
            $this->audit->recordSystem($orphan['tenant_id'], null, null, 'orphan_cleanup', 'failure', $orphan['hash']);

            return 'failed';
        }
    }

    private function isEvidencePathForTenant(string $path, int $tenantId): bool
    {
        return preg_match('#^attendance-evidence/'.preg_quote((string) $tenantId, '#').'/[0-9a-f-]{36}\.(?:jpg|webp)$#i', $path) === 1;
    }
}

final class EvidenceLifecycleFailure extends \RuntimeException
{
    public function __construct(public readonly string $errorCode)
    {
        parent::__construct($errorCode);
    }
}
