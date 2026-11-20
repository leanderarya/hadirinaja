# Photo Evidence Expiration Operations

## Contract

Evidence becomes eligible at the inclusive UTC boundary `attendance_events.recorded_at + 90 days`. The worker derives eligibility from the immutable event timestamp, not the evidence upload/creation timestamp. Historical JPEG and current WebP evidence use the same private-disk deletion path.

The worker transitions `available → deletion_pending → expired`. The `expired` row remains as a tombstone linked to its original attendance event and session. Evidence file metadata and the storage key are cleared only after deletion is confirmed (or a retry confirms the file is already absent). Attendance events, sessions, projections, corrections, and audit history are not removed.

## Command and activation gate

Inspect without mutation:

```sh
php artisan attendance:evidence-expire --dry-run --limit=100
```

Dry-run reports eligible evidence, legal holds, and old orphan candidates. It does not update lifecycle fields, create audit records, or delete files. Batch limits are 1–1000; the default is 100.

Deletion is guarded in both the scheduler and service by `ATTENDANCE_EVIDENCE_DELETION_ENABLED`, default `false`. A normal command run while disabled exits without querying candidates or changing database/storage. Hourly scheduling is registered with overlap protection but is conditional on that gate. No environment value or deployment was changed for Slice 5.

## Deletion and retry safety

1. A database row lock claims an expired record, increments its attempt count, sets a five-minute lease, changes it to `deletion_pending`, and appends an `expiration_attempt` or `expiration_retry` audit event.
2. A second locked transaction rechecks the event timestamp and legal-hold state before deleting from the private `local` disk.
3. Successful deletion (including a retry that finds the file already absent) clears path/MIME/size/dimensions/hash and writes `expired` plus a success audit event in the same DB transaction.
4. A failure retains `deletion_pending`, preserves the tombstone relationship and retry data, records a bounded error code, and schedules exponential backoff capped at 24 hours. The row is never returned to `available`.

If a process stops after the file is deleted but before the DB transaction commits, the record remains pending and unavailable. A later retry sees the missing file and completes the tombstone. Concurrent workers serialize on the evidence row; the committed retry lease prevents a second worker from claiming the same record.

Audit entries use the system actor and contain tenant/evidence/event references, action, outcome, and UTC timestamp. Orphan cleanup stores a SHA-256 hash of the tenant-scoped storage key, never the path or image bytes. Database audit failure prevents a file deletion when the audit is needed to claim or finalize it.

## Legal holds

`attendance_evidence_legal_hold_events` is the authoritative append-only placement/release history keyed by tenant, evidence, and hold reference. A hold is active when its latest event for that reference is `placed`. The worker checks holds at claim time and again immediately before deletion. An active hold is audited as denied and left available; a hold discovered after claim leaves the evidence pending but not retrievable. When hold status cannot be read, deletion fails closed and schedules a retry.

Slice 5 adds no API, command, or role capable of placing/releasing holds and grants no new permissions. An authorized hold-management workflow and its approval policy must exist and be operational before enabling deletion. Any hold writer must serialize against the evidence row and must reject new holds for already expired tombstones.

The approved local workflow contract is documented in [`legal-hold-workflow.md`](legal-hold-workflow.md). Hold expiry bookkeeping runs independently from photo deletion; the deletion gate remains default-disabled.

## Orphan reconciliation

Only files matching the private key layout `attendance-evidence/{tenant-id}/{uuid}.jpg|webp` are considered. The `.staging` directory and other paths are excluded. A file must be at least 24 hours old, have no matching DB storage reference, and belong to a tenant with no pending idempotency operation. Those checks are repeated immediately before deletion. Listing, metadata, or reference-check errors skip the file; they never authorize deletion. Orphan attempts/results are audited by a hash of the private key.

## Backup, restore, and tenant closure

- Take and restore database plus private evidence storage as a coordinated snapshot. Do not enable the worker while either side is still restoring or being reconciled.
- After restore, run dry-run and reconcile available DB references against private files. Missing files remain unavailable; do not manufacture replacement evidence. Expired DB tombstones stay expired even if a backup contains an older copy.
- Active-store deletion does not erase copies in backups. Backup expiry/purge must follow the separately approved backup lifecycle policy; this worker does not rewrite backup archives.
- Tenant closure does not trigger deletion or alter this worker's retention rules. Closure-specific access shutdown, hold transfer, and data deletion require a separately approved workflow. Foreign keys and tombstones preserve the audit chain.

## Activation prerequisites

Before an Owner separately approves activation: verify the hold placement/release workflow and authorization policy; approve any backup and tenant-closure procedures; confirm private-disk behavior and deletion permissions; inspect a dry-run report; define monitoring/alert ownership for retry backlog and failures; confirm restore reconciliation; then enable the gate and scheduler through a coordinated release. Slice 5 leaves the gate disabled.
