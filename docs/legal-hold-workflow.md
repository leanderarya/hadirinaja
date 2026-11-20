# Attendance Evidence Legal Hold Workflow

## Authorization and scope

- An active Supervisor may request a hold only for an attendance event at an outlet currently in that membership's authorized outlet scopes.
- An active Owner may request, approve, reject, extend, and release holds across the active tenant.
- Employee memberships and SaaS support have no hold-management access.
- A request normally requires approval by a different active Owner. If the requester is the only active Owner in the tenant, that Owner may self-approve; the append-only workflow event is recorded as `single_owner_approved` with the required decision reason.
- Requests and decisions use only the active tenant membership. Evidence, event, outlet, request, and actor references are tenant-scoped in both queries and foreign keys.

## Durations and transitions

Each approval grants at most 90 days. Placement expiry is calculated from the server approval time. An extension adds up to 90 days to the later of the current expiry or approval time. A new approval and current justification are required for every extension. Legacy placements without an expiry remain active until an Owner releases them or approves an extension that replaces the unbounded placement with a bounded one.

`pending → approved | rejected | expired`; an approved request may later become `released` or `expired`. Approved placement/extension creates a `placed` hold event with an explicit `expires_at`. Owner release appends `released`; automatic expiry appends `expired`. Hold and workflow events are append-only; the request row is a current workflow projection and every state change also writes an append-only workflow event.

## Pending preservation lease

A new pending request may receive one 24-hour preservation lease for the current hold cycle. The lease is non-stackable: while a request is pending, another request for that evidence is rejected. After the lease expires, another request may be submitted, but it receives no preservation lease until an Owner approval, release, or hold expiry starts a new cycle. A request without a granted lease does not pause deletion. The API returns `preservation_lease_granted` so callers do not imply otherwise.

The 24-hour lease can temporarily extend retention past the 90-day evidence deadline. It expires automatically and is audited. If a deletion worker obtains the evidence lock first and moves the evidence to `deletion_pending` or `expired`, placement and approval return a conflict; the workflow never restores availability.

## Deletion serialization and evidence integrity

Every hold request, decision, release, automatic expiry, and deletion path locks the evidence row first, then locks or reads related request/hold rows. The deletion worker checks active holds and valid pending leases at both claim and final-delete stages. A request that wins the lock is visible to the worker before deletion; a worker that completes first leaves a tombstone and the request is rejected.

Requests and approvals require `lifecycle_state = available`, a tenant-shaped private storage key, a readable file, and a matching SHA-256. Missing/corrupt files fail closed. `deletion_pending` and `expired` evidence cannot be activated by a hold.

## API

All routes are under authenticated `/api/v1/management` active-tenant middleware and `no-store`:

- `GET /attendance/legal-holds` — authorized request and hold history; Owner sees tenant-wide legacy/current holds.
- `POST /attendance/events/{event}/legal-hold-requests` — `hold_reference`, `justification` (20–2000 chars), and `duration_days` (1–90).
- `POST /attendance/legal-hold-requests/{request}/approve` or `/reject` — required `decision_reason` (10–1000 chars); Owner only.
- `POST /attendance/legal-holds/{hold}/extension-requests` — required justification and `duration_days` (1–90); Supervisor scope or Owner.
- `POST /attendance/legal-holds/{hold}/release` — required Owner reason (10–1000 chars).

Cross-tenant resource IDs return not found. No API accepts `tenant_id`, expiry timestamps, actor IDs, or evidence paths from the client.

## Expiry and tenant lifecycle

`attendance:evidence-holds-expire` records due request/hold expiry hourly and does not delete evidence files. It runs independently from the default-disabled evidence deletion scheduler. The evidence deletion gate remains unchanged.

The current tenant model has no suspended/closed lifecycle state. Existing approved holds are read directly by the deletion worker and remain effective regardless of membership status. This workflow adds no tenant-closure deletion behavior; closure-specific access and deletion remain separate policy work.

## Audit and recovery

The workflow ledger records request, extension, approval, single-Owner exception, rejection, release, request expiry, and hold expiry with tenant, event/evidence, actor membership (null for scheduled actions), reason, and timestamps. It stores no image bytes or storage paths. Existing unbounded legacy holds are listed for Owner review and are not auto-released by migration or scheduled jobs.

If the workflow database is unavailable, request/decision/hold changes fail closed. If a deletion request races with a hold request, the locked evidence row determines the outcome; clients must treat `409 evidence_not_available` as a definitive rejection and must not show a hold as active.
