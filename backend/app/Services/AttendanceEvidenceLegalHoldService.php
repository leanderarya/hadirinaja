<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\AttendanceEvent;
use App\Models\AttendanceEvidence;
use App\Models\AttendanceEvidenceLegalHoldEvent;
use App\Models\AttendanceEvidenceLegalHoldRequest;
use App\Models\AttendanceEvidenceLegalHoldWorkflowEvent;
use App\Models\TenantMembership;
use DateTimeInterface;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class AttendanceEvidenceLegalHoldService
{
    private const MAX_GRANT_DAYS = 90;

    public const PRESERVATION_LEASE_HOURS = 24;

    public function __construct(
        private readonly TenantAuthorization $authorization,
        private readonly AttendanceEvidenceLegalHoldReader $reader,
        private readonly AttendanceEvidenceAuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function requestPlacement(
        TenantMembership $actor,
        int $eventId,
        string $holdReference,
        string $justification,
        int $durationDays,
    ): array {
        $now = now('UTC');

        // Retry the whole placement when a concurrent evidence update invalidates the read.
        return DB::transaction(function () use ($actor, $eventId, $holdReference, $justification, $durationDays, $now): array {
            $event = $this->eventForTenant((int) $actor->tenant_id, $eventId);
            $this->assertCanRequest($actor, $event);
            $evidence = $this->lockEvidence((int) $actor->tenant_id, $eventId);
            $this->assertAvailable($evidence, (int) $actor->tenant_id);
            $this->expireStalePendingRequests($evidence, $event, $now);
            $this->assertNoPendingLease($evidence, $now);
            if ($this->currentHoldEvent($evidence, $holdReference, $now)) {
                $this->conflict('A hold with this reference is already active.', 'legal_hold_already_active');
            }

            return $this->createRequest(
                $actor, $event, $evidence, 'placement', $holdReference, $justification,
                $durationDays, $now->copy()->addDays($durationDays), $now,
            );
        }, attempts: 3);
    }

    /** @return array<string, mixed> */
    public function requestExtension(
        TenantMembership $actor,
        int $holdEventId,
        string $justification,
        int $durationDays,
    ): array {
        $now = now('UTC');
        $tenantId = (int) $actor->tenant_id;
        $target = AttendanceEvidenceLegalHoldEvent::query()->forTenant($tenantId)->whereKey($holdEventId)->first();
        if (! $target || $target->action !== 'placed') {
            $this->notFound();
        }

        return DB::transaction(function () use ($actor, $target, $holdEventId, $justification, $durationDays, $now, $tenantId): array {
            $event = $this->eventForTenant($tenantId, (int) $target->attendance_event_id);
            $this->assertCanRequest($actor, $event);
            $evidence = $this->lockEvidence($tenantId, (int) $target->attendance_event_id);
            $this->assertAvailable($evidence, $tenantId);
            $this->expireStalePendingRequests($evidence, $event, $now);
            $this->assertNoPendingLease($evidence, $now);
            $current = $this->currentHoldEvent($evidence, (string) $target->hold_reference, $now);
            if (! $current || (int) $current->getKey() !== (int) $holdEventId) {
                $this->conflict('The referenced hold is no longer active.', 'legal_hold_not_active');
            }

            $base = $current->expires_at ? Carbon::instance($current->expires_at)->utc() : $now->copy();
            if ($base->lt($now)) {
                $base = $now->copy();
            }

            return $this->createRequest(
                $actor, $event, $evidence, 'extension', (string) $target->hold_reference,
                $justification, $durationDays, $base->addDays($durationDays), $now,
            );
        }, attempts: 1);
    }

    /** @return array<string, mixed> */
    public function decide(
        TenantMembership $actor,
        int $requestId,
        bool $approve,
        string $decisionReason,
    ): array {
        $tenantId = (int) $actor->tenant_id;
        $snapshot = AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)->whereKey($requestId)->first();
        if (! $snapshot) {
            $this->notFound();
        }
        $now = now('UTC');

        $result = DB::transaction(function () use ($actor, $requestId, $snapshot, $approve, $decisionReason, $now, $tenantId): array {
            $event = $this->eventForTenant($tenantId, (int) $snapshot->attendance_event_id);
            $evidence = $this->lockEvidence($tenantId, (int) $snapshot->attendance_event_id);
            $request = AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
                ->whereKey($requestId)->lockForUpdate()->first();
            if (! $request) {
                $this->notFound();
            }
            $this->authorization->requireOwner($actor);
            $singleOwnerException = $this->assertDistinctApprover($actor, $request);

            if ($request->status !== 'pending') {
                $this->conflict('This hold request has already been decided.', 'legal_hold_request_not_pending');
            }
            if ($request->lease_expires_at->lte($now)) {
                $this->expireRequest($request, $event, $now);

                return ['_conflict' => 'legal_hold_lease_expired'];
            }
            if ($evidence->lifecycle_state !== 'available') {
                $this->conflict('Evidence is no longer available for a hold decision.', 'evidence_not_available');
            }
            if ($approve) {
                $this->assertAvailable($evidence, $tenantId);
                if ($request->request_type === 'placement' && $this->currentHoldEvent($evidence, $request->hold_reference, $now)) {
                    $this->conflict('A hold with this reference is already active.', 'legal_hold_already_active');
                }
                if ($request->request_type === 'extension' && ! $this->hasLatestUnreleasedPlacement($evidence, $request->hold_reference)) {
                    $this->conflict('The referenced hold has ended.', 'legal_hold_not_active');
                }
                $request->requested_expires_at = $this->approvedExpiry($request, $evidence, $now);
            }

            $request->forceFill([
                'status' => $approve ? 'approved' : 'rejected',
                'decided_by_membership_id' => $actor->getKey(),
                'decision_reason' => $decisionReason,
                'decided_at' => $now,
            ])->save();

            if ($approve) {
                $this->placeHold($actor, $request, $event, $evidence, $now);
            }

            $action = $approve
                ? ($singleOwnerException ? 'single_owner_approved' : 'approved')
                : 'rejected';
            $this->recordWorkflow(
                $request, $event, $actor, $action, $decisionReason, $now,
                $request->hold_reference, $evidence, $approve ? $request->requested_expires_at : null,
            );

            return $this->requestData($request->fresh());
        }, attempts: 1);

        if (isset($result['_conflict'])) {
            $this->conflict('The preservation lease has expired.', 'legal_hold_lease_expired');
        }

        return $result;
    }

    /** @return array<string, mixed> */
    public function release(
        TenantMembership $actor,
        int $holdEventId,
        string $reason,
    ): array {
        $tenantId = (int) $actor->tenant_id;
        $target = AttendanceEvidenceLegalHoldEvent::query()->forTenant($tenantId)->whereKey($holdEventId)->first();
        if (! $target || $target->action !== 'placed') {
            $this->notFound();
        }
        $now = now('UTC');

        return DB::transaction(function () use ($actor, $target, $holdEventId, $reason, $now, $tenantId): array {
            $this->authorization->requireOwner($actor);
            $event = $this->eventForTenant($tenantId, (int) $target->attendance_event_id);
            $evidence = $this->lockEvidence($tenantId, (int) $target->attendance_event_id);
            if ($evidence->lifecycle_state !== 'available') {
                $this->conflict('A hold cannot be released while evidence deletion is pending or complete.', 'evidence_not_available');
            }
            $current = $this->currentHoldEvent($evidence, (string) $target->hold_reference, $now);
            if (! $current || (int) $current->getKey() !== (int) $holdEventId) {
                $this->conflict('The referenced hold is no longer active.', 'legal_hold_not_active');
            }

            AttendanceEvidenceLegalHoldEvent::query()->create([
                'tenant_id' => $tenantId,
                'attendance_evidence_id' => $evidence->getKey(),
                'attendance_event_id' => $event->getKey(),
                'hold_reference' => $target->hold_reference,
                'action' => 'released',
                'actor_membership_id' => $actor->getKey(),
                'occurred_at' => $now,
            ]);
            $request = $target->legal_hold_request_id
                ? AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
                    ->whereKey($target->legal_hold_request_id)->lockForUpdate()->first()
                : null;
            if ($request && $request->status === 'approved') {
                $request->forceFill(['status' => 'released'])->save();
            }
            $evidence->forceFill(['legal_hold_lease_consumed_at' => null])->save();
            $this->recordWorkflow($request, $event, $actor, 'released', $reason, $now, (string) $target->hold_reference, $evidence);

            return [
                'hold_reference' => $target->hold_reference,
                'state' => 'released',
                'released_at' => $now->toIso8601String(),
            ];
        }, attempts: 1);
    }

    /** @return array{requests: list<array<string, mixed>>, active_holds: list<array<string, mixed>>} */
    public function index(TenantMembership $actor): array
    {
        $tenantId = (int) $actor->tenant_id;
        $owner = $this->authorization->isOwner($actor);
        if (! $owner && ! $this->authorization->hasRole($actor, TenantRole::Supervisor)) {
            throw new AuthorizationException('Legal hold access is not available.');
        }

        $requestRows = AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
            ->when(! $owner, fn ($query) => $query->where('requested_by_membership_id', $actor->getKey()))
            ->with('event.session.outlet')
            ->orderByDesc('id')->limit(100)->get();
        if (! $owner) {
            $requestRows = $requestRows->filter(fn (AttendanceEvidenceLegalHoldRequest $request): bool => $request->event?->session?->outlet !== null
                && $this->authorization->canManageOutlet($actor, $request->event->session->outlet));
        }
        $requests = $requestRows->map(fn (AttendanceEvidenceLegalHoldRequest $request): array => $this->requestData($request))->all();
        $requestIds = $requestRows->modelKeys();
        $workflowEvents = AttendanceEvidenceLegalHoldWorkflowEvent::query()->forTenant($tenantId)
            ->when(! $owner, fn ($query) => $query->where(function ($query) use ($actor, $requestIds): void {
                $query->where('actor_membership_id', $actor->getKey());
                if ($requestIds !== []) {
                    $query->orWhereIn('request_id', $requestIds);
                }
            }))
            ->orderByDesc('id')->limit(200)->get()
            ->map(fn (AttendanceEvidenceLegalHoldWorkflowEvent $event): array => [
                'id' => (int) $event->getKey(),
                'request_id' => $event->request_id ? (int) $event->request_id : null,
                'evidence_id' => (int) $event->attendance_evidence_id,
                'event_id' => (int) $event->attendance_event_id,
                'hold_reference' => $event->hold_reference,
                'action' => $event->action,
                'actor_membership_id' => $event->actor_membership_id ? (int) $event->actor_membership_id : null,
                'reason' => $event->reason,
                'lease_expires_at' => $event->lease_expires_at?->toIso8601String(),
                'effective_expires_at' => $event->effective_expires_at?->toIso8601String(),
                'occurred_at' => $event->occurred_at?->toIso8601String(),
            ])->all();

        return [
            'requests' => $requests,
            'workflow_events' => $workflowEvents,
            'active_holds' => $owner ? $this->activeHoldData($tenantId) : [],
        ];
    }

    public function hasActiveHold(int $tenantId, int $evidenceId, Carbon $now): bool
    {
        return $this->reader->hasActiveHold($tenantId, $evidenceId, $now);
    }

    public function hasPendingLease(int $tenantId, int $evidenceId, Carbon $now): bool
    {
        return $this->reader->hasPendingPreservationLease($tenantId, $evidenceId, $now);
    }

    public function pendingLeaseExpiry(int $tenantId, int $evidenceId, Carbon $now): ?Carbon
    {
        return $this->reader->pendingLeaseExpiry($tenantId, $evidenceId, $now);
    }

    /** Must be called while the evidence row is locked in the current transaction. */
    public function expireDueForEvidenceLocked(AttendanceEvidence $evidence, AttendanceEvent $event, Carbon $now): int
    {
        $tenantId = (int) $evidence->tenant_id;
        $expired = 0;
        $dueRequests = AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
            ->where('attendance_evidence_id', $evidence->getKey())
            ->where('status', 'pending')->where('lease_expires_at', '<=', $now->format('Y-m-d H:i:s'))
            ->lockForUpdate()->get();
        foreach ($dueRequests as $request) {
            $this->expireRequest($request, $event, $now);
            $expired++;
        }

        $duePlacements = AttendanceEvidenceLegalHoldEvent::query()->forTenant($tenantId)
            ->where('attendance_evidence_id', $evidence->getKey())->where('action', 'placed')
            ->whereNotNull('expires_at')->where('expires_at', '<=', $now->format('Y-m-d H:i:s'))
            ->orderBy('id')->lockForUpdate()->get();
        foreach ($duePlacements as $placement) {
            if (! $this->isLatestHoldEvent($placement)) {
                continue;
            }
            $hasPendingExtension = AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
                ->where('attendance_evidence_id', $evidence->getKey())
                ->where('hold_reference', $placement->hold_reference)
                ->where('request_type', 'extension')->where('status', 'pending')
                ->where('preservation_lease_granted', true)
                ->where('lease_expires_at', '>', $now->format('Y-m-d H:i:s'))->exists();
            if ($hasPendingExtension) {
                continue;
            }

            AttendanceEvidenceLegalHoldEvent::query()->create([
                'tenant_id' => $tenantId,
                'attendance_evidence_id' => $evidence->getKey(),
                'attendance_event_id' => $event->getKey(),
                'hold_reference' => $placement->hold_reference,
                'action' => 'expired',
                'expires_at' => $placement->expires_at,
                'legal_hold_request_id' => $placement->legal_hold_request_id,
                'actor_membership_id' => null,
                'occurred_at' => $now,
            ]);
            $request = $placement->legal_hold_request_id
                ? AttendanceEvidenceLegalHoldRequest::query()->forTenant($tenantId)
                    ->whereKey($placement->legal_hold_request_id)->lockForUpdate()->first()
                : null;
            if ($request && $request->status === 'approved') {
                $request->forceFill(['status' => 'expired', 'decided_at' => $now])->save();
            }
            $this->recordWorkflow($request, $event, null, 'hold_expired', null, $now, (string) $placement->hold_reference, $evidence, $placement->expires_at);
            $evidence->forceFill(['legal_hold_lease_consumed_at' => null])->save();
            $expired++;
        }

        return $expired;
    }

    public function expireDue(int $limit = 1000, ?DateTimeInterface $now = null): int
    {
        $now = $now === null ? now('UTC') : Carbon::instance($now)->utc();
        $requestEvidenceIds = DB::table('attendance_evidence_legal_hold_requests')
            ->where('status', 'pending')->where('lease_expires_at', '<=', $now->format('Y-m-d H:i:s'))
            ->orderBy('attendance_evidence_id')->limit($limit)->pluck('attendance_evidence_id');
        $holdEvidenceIds = DB::table('attendance_evidence_legal_hold_events')
            ->where('action', 'placed')->whereNotNull('expires_at')
            ->where('expires_at', '<=', $now->format('Y-m-d H:i:s'))
            ->orderBy('attendance_evidence_id')->limit($limit)->pluck('attendance_evidence_id');
        $evidenceIds = $requestEvidenceIds->merge($holdEvidenceIds)
            ->map(static fn ($id): int => (int) $id)->unique()->take($limit);
        $count = 0;

        foreach ($evidenceIds as $evidenceId) {
            $count += DB::transaction(function () use ($evidenceId, $now): int {
                $evidence = AttendanceEvidence::query()->whereKey($evidenceId)->lockForUpdate()->first();
                if (! $evidence) {
                    return 0;
                }
                $event = $this->eventForTenant((int) $evidence->tenant_id, (int) $evidence->attendance_event_id);

                return $this->expireDueForEvidenceLocked($evidence, $event, $now);
            }, attempts: 1);
        }

        return $count;
    }

    /** @return array<string, mixed> */
    private function createRequest(
        TenantMembership $actor,
        AttendanceEvent $event,
        AttendanceEvidence $evidence,
        string $type,
        string $reference,
        string $justification,
        int $durationDays,
        Carbon $requestedExpiry,
        Carbon $now,
    ): array {
        if ($durationDays < 1 || $durationDays > self::MAX_GRANT_DAYS) {
            throw new \InvalidArgumentException('Legal hold duration must be between 1 and 90 days.');
        }
        $leaseExpiry = $now->copy()->addHours(self::PRESERVATION_LEASE_HOURS);
        $leaseGranted = $evidence->legal_hold_lease_consumed_at === null;
        if ($leaseGranted) {
            $evidence->forceFill(['legal_hold_lease_consumed_at' => $now])->save();
        }
        $request = AttendanceEvidenceLegalHoldRequest::query()->create([
            'tenant_id' => $actor->tenant_id,
            'attendance_evidence_id' => $evidence->getKey(),
            'attendance_event_id' => $event->getKey(),
            'hold_reference' => $reference,
            'request_type' => $type,
            'status' => 'pending',
            'justification' => $justification,
            'requested_duration_days' => $durationDays,
            'requested_expires_at' => $requestedExpiry,
            'lease_expires_at' => $leaseExpiry,
            'preservation_lease_granted' => $leaseGranted,
            'requested_by_membership_id' => $actor->getKey(),
            'created_at' => $now,
        ]);
        $this->recordWorkflow(
            $request, $event, $actor, $type === 'placement' ? 'request_submitted' : 'extension_requested',
            $justification, $now, $reference, $evidence, $requestedExpiry, $leaseExpiry,
        );

        return $this->requestData($request);
    }

    private function placeHold(
        TenantMembership $actor,
        AttendanceEvidenceLegalHoldRequest $request,
        AttendanceEvent $event,
        AttendanceEvidence $evidence,
        Carbon $now,
    ): void {
        if ($request->request_type === 'extension') {
            $current = $this->latestHoldEvent($evidence, $request->hold_reference);
            if ($current && $current->expires_at === null) {
                AttendanceEvidenceLegalHoldEvent::query()->create([
                    'tenant_id' => $evidence->tenant_id,
                    'attendance_evidence_id' => $evidence->getKey(),
                    'attendance_event_id' => $event->getKey(),
                    'hold_reference' => $request->hold_reference,
                    'action' => 'released',
                    'actor_membership_id' => $actor->getKey(),
                    'occurred_at' => $now,
                ]);
                $this->recordWorkflow(
                    $request, $event, $actor, 'legacy_bounded', $request->justification, $now,
                    $request->hold_reference, $evidence, $request->requested_expires_at,
                );
            }
        }

        AttendanceEvidenceLegalHoldEvent::query()->create([
            'tenant_id' => $evidence->tenant_id,
            'attendance_evidence_id' => $evidence->getKey(),
            'attendance_event_id' => $event->getKey(),
            'hold_reference' => $request->hold_reference,
            'action' => 'placed',
            'expires_at' => $request->requested_expires_at,
            'legal_hold_request_id' => $request->getKey(),
            'actor_membership_id' => $actor->getKey(),
            'occurred_at' => $now,
        ]);
        $evidence->forceFill(['legal_hold_lease_consumed_at' => null])->save();
    }

    private function approvedExpiry(
        AttendanceEvidenceLegalHoldRequest $request,
        AttendanceEvidence $evidence,
        Carbon $now,
    ): Carbon {
        $base = $now->copy();
        if ($request->request_type === 'extension') {
            $current = $this->latestHoldEvent($evidence, $request->hold_reference);
            if ($current?->expires_at) {
                $existingExpiry = Carbon::instance($current->expires_at)->utc();
                if ($existingExpiry->gt($base)) {
                    $base = $existingExpiry;
                }
            }
        }

        return $base->addDays((int) $request->requested_duration_days);
    }

    private function assertCanRequest(TenantMembership $actor, AttendanceEvent $event): void
    {
        if ($this->authorization->isOwner($actor)) {
            return;
        }
        if ($this->authorization->hasRole($actor, TenantRole::Supervisor)
            && $event->session?->outlet
            && $this->authorization->canManageOutlet($actor, $event->session->outlet)) {
            return;
        }
        throw new AuthorizationException('Legal hold request access is not available.');
    }

    private function assertDistinctApprover(TenantMembership $actor, AttendanceEvidenceLegalHoldRequest $request): bool
    {
        if ((int) $actor->getKey() !== (int) $request->requested_by_membership_id) {
            return false;
        }
        $ownerCount = TenantMembership::query()->forTenant((int) $actor->tenant_id)
            ->where('is_active', true)
            ->whereHas('roles', fn ($query) => $query->where('role', TenantRole::Owner->value))
            ->count();
        if ($ownerCount !== 1) {
            throw new AuthorizationException('A different active tenant Owner must decide this request.');
        }

        return true;
    }

    private function assertAvailable(AttendanceEvidence $evidence, int $tenantId): void
    {
        if ($evidence->lifecycle_state !== 'available' || ! $this->storedFileMatches($evidence, $tenantId)) {
            $this->conflict('Evidence is not available to preserve.', 'evidence_not_available');
        }
    }

    private function storedFileMatches(AttendanceEvidence $evidence, int $tenantId): bool
    {
        $path = $evidence->storage_path;
        if (! is_string($path) || ! is_string($evidence->sha256)
            || ! preg_match('#^attendance-evidence/'.preg_quote((string) $tenantId, '#').'/[0-9a-f-]{36}\.(?:jpg|webp)$#D', $path)) {
            return false;
        }
        try {
            $stream = Storage::disk('local')->readStream($path);
            if (! is_resource($stream)) {
                return false;
            }
            $hash = hash_init('sha256');
            while (! feof($stream)) {
                $chunk = fread($stream, 8192);
                if ($chunk === false) {
                    fclose($stream);

                    return false;
                }
                hash_update($hash, $chunk);
            }
            fclose($stream);

            return hash_equals($evidence->sha256, hash_final($hash));
        } catch (\Throwable) {
            return false;
        }
    }

    private function lockEvidence(int $tenantId, int $eventId): AttendanceEvidence
    {
        $evidence = AttendanceEvidence::query()->forTenant($tenantId)
            ->where('attendance_event_id', $eventId)->lockForUpdate()->first();
        if (! $evidence) {
            $this->notFound();
        }

        return $evidence;
    }

    private function eventForTenant(int $tenantId, int $eventId): AttendanceEvent
    {
        $event = AttendanceEvent::query()->forTenant($tenantId)
            ->with(['session.outlet'])->whereKey($eventId)->first();
        if (! $event) {
            $this->notFound();
        }

        return $event;
    }

    private function assertNoPendingLease(AttendanceEvidence $evidence, Carbon $now): void
    {
        $pending = AttendanceEvidenceLegalHoldRequest::query()->forTenant((int) $evidence->tenant_id)
            ->where('attendance_evidence_id', $evidence->getKey())->where('status', 'pending')
            ->lockForUpdate()->get();
        foreach ($pending as $request) {
            if ($request->lease_expires_at->gt($now)) {
                $this->conflict('A preservation request is already awaiting a decision.', 'legal_hold_request_pending');
            }
            $event = $this->eventForTenant((int) $evidence->tenant_id, (int) $evidence->attendance_event_id);
            $this->expireRequest($request, $event, $now);
        }
    }

    private function expireStalePendingRequests(AttendanceEvidence $evidence, AttendanceEvent $event, Carbon $now): void
    {
        $pending = AttendanceEvidenceLegalHoldRequest::query()->forTenant((int) $evidence->tenant_id)
            ->where('attendance_evidence_id', $evidence->getKey())->where('status', 'pending')
            ->where('lease_expires_at', '<=', $now->format('Y-m-d H:i:s'))->lockForUpdate()->get();
        foreach ($pending as $request) {
            $this->expireRequest($request, $event, $now);
        }
    }

    private function expireRequest(AttendanceEvidenceLegalHoldRequest $request, AttendanceEvent $event, Carbon $now): void
    {
        $request->forceFill(['status' => 'expired', 'decided_at' => $now])->save();
        $this->recordWorkflow($request, $event, null, 'request_expired', null, $now, $request->hold_reference, null, null, $request->lease_expires_at);
    }

    private function currentHoldEvent(AttendanceEvidence $evidence, string $reference, Carbon $now): ?AttendanceEvidenceLegalHoldEvent
    {
        $latest = $this->latestHoldEvent($evidence, $reference);
        if (! $latest || $latest->action !== 'placed') {
            return null;
        }
        if ($latest->expires_at && $latest->expires_at->lte($now)) {
            return null;
        }

        return $latest;
    }

    private function latestHoldEvent(AttendanceEvidence $evidence, string $reference): ?AttendanceEvidenceLegalHoldEvent
    {
        return AttendanceEvidenceLegalHoldEvent::query()->forTenant((int) $evidence->tenant_id)
            ->where('attendance_evidence_id', $evidence->getKey())->where('hold_reference', $reference)
            ->orderByDesc('id')->first();
    }

    private function hasLatestUnreleasedPlacement(AttendanceEvidence $evidence, string $reference): bool
    {
        $latest = $this->latestHoldEvent($evidence, $reference);

        return $latest?->action === 'placed';
    }

    private function isLatestHoldEvent(AttendanceEvidenceLegalHoldEvent $placement): bool
    {
        $latestId = AttendanceEvidenceLegalHoldEvent::query()->forTenant((int) $placement->tenant_id)
            ->where('attendance_evidence_id', $placement->attendance_evidence_id)
            ->where('hold_reference', $placement->hold_reference)->max('id');

        return (int) $latestId === (int) $placement->getKey();
    }

    private function recordWorkflow(
        ?AttendanceEvidenceLegalHoldRequest $request,
        AttendanceEvent $event,
        ?TenantMembership $actor,
        string $action,
        ?string $reason,
        Carbon $now,
        ?string $reference = null,
        ?AttendanceEvidence $evidence = null,
        ?DateTimeInterface $expiresAt = null,
        ?DateTimeInterface $leaseExpiresAt = null,
    ): void {
        $evidence ??= $request?->attendance_evidence_id
            ? AttendanceEvidence::query()->forTenant((int) $event->tenant_id)->whereKey($request->attendance_evidence_id)->firstOrFail()
            : $event->evidence()->firstOrFail();
        AttendanceEvidenceLegalHoldWorkflowEvent::query()->create([
            'tenant_id' => $event->tenant_id,
            'attendance_evidence_id' => $evidence->getKey(),
            'attendance_event_id' => $event->getKey(),
            'request_id' => $request?->getKey(),
            'hold_reference' => $reference ?? $request?->hold_reference ?? '',
            'action' => $action,
            'actor_membership_id' => $actor?->getKey(),
            'reason' => $reason,
            'lease_expires_at' => $leaseExpiresAt,
            'effective_expires_at' => $expiresAt,
            'occurred_at' => $now,
        ]);
    }

    /** @return array<string, mixed> */
    private function requestData(AttendanceEvidenceLegalHoldRequest $request): array
    {
        return [
            'id' => (int) $request->getKey(),
            'event_id' => (int) $request->attendance_event_id,
            'evidence_id' => (int) $request->attendance_evidence_id,
            'hold_reference' => $request->hold_reference,
            'type' => $request->request_type,
            'status' => $request->status,
            'justification' => $request->justification,
            'requested_duration_days' => (int) $request->requested_duration_days,
            'preservation_lease_granted' => (bool) $request->preservation_lease_granted,
            'requested_expires_at' => $request->requested_expires_at?->toIso8601String(),
            'lease_expires_at' => $request->lease_expires_at?->toIso8601String(),
            'requested_by_membership_id' => (int) $request->requested_by_membership_id,
            'decided_by_membership_id' => $request->decided_by_membership_id ? (int) $request->decided_by_membership_id : null,
            'decision_reason' => $request->decision_reason,
            'created_at' => $request->created_at?->toIso8601String(),
            'decided_at' => $request->decided_at?->toIso8601String(),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function activeHoldData(int $tenantId): array
    {
        $events = AttendanceEvidenceLegalHoldEvent::query()->forTenant($tenantId)
            ->where('action', 'placed')->with('evidence')->orderByDesc('id')->limit(500)->get();
        $seen = [];
        $active = [];
        $now = now('UTC');
        foreach ($events as $placement) {
            $key = $placement->attendance_evidence_id.':'.$placement->hold_reference;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            if (! $this->currentHoldEvent($placement->evidence, (string) $placement->hold_reference, $now)) {
                continue;
            }
            $active[] = [
                'hold_event_id' => (int) $placement->getKey(),
                'event_id' => (int) $placement->attendance_event_id,
                'evidence_id' => (int) $placement->attendance_evidence_id,
                'hold_reference' => $placement->hold_reference,
                'expires_at' => $placement->expires_at?->toIso8601String(),
                'legacy_unbounded' => $placement->expires_at === null,
            ];
        }

        return $active;
    }

    private function conflict(string $message, string $code): never
    {
        throw new HttpResponseException(response()->json(['code' => $code, 'message' => $message], 409));
    }

    private function notFound(): never
    {
        abort(404, 'Legal hold resource is not available.');
    }
}
