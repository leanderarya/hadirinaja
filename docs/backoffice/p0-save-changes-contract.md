# P0 Schedule: Save Changes contract

This is the shared API contract for the isolated P0 candidate. It extends the existing weekly planner API. It is not a deployment or production authorization.

## Routes

Existing base:

`/api/v1/management/scheduling/planner/outlets/{outlet}/weeks/{weekStart}`

| Request | Purpose |
|---|---|
| `POST /validate` with `{ expected_version }` | Keep validating the saved draft as today. |
| `POST /validate` with `{ expected_version, expected_published_revision_id, entries }` | Read-only validation preview of a complete proposed replacement for an already published week. Must not create or alter a draft or revision. |
| `POST /save-changes` | Atomically validate and publish a complete replacement for the current published revision. |

All routes retain existing `auth:sanctum`, active-tenant and outlet authorization middleware. `save-changes` requires the existing `Idempotency-Key` header and returns the standard planner-week representation after commit.

## Request bodies

`entries` is the complete target roster, not a patch. Each entry has the existing draft shape:

```json
{
  "employee_id": 123,
  "work_date": "2026-11-23",
  "status": "work",
  "shift_template_version_id": 456
}
```

For a direct edit, `POST /validate` receives:

```json
{
  "expected_version": 4,
  "expected_published_revision_id": 321,
  "entries": []
}
```

It returns the existing validation shape, including `valid`, `version`, `entry_count`, and `staffing_report`. The checksum must bind the active tenant/outlet/week, base version and published revision, candidate entries, effective staffing rules, and deficits.

`POST /save-changes` receives:

```json
{
  "expected_version": 4,
  "expected_published_revision_id": 321,
  "reason": "Penyesuaian jadwal pekan depan",
  "entries": [],
  "warnings_checksum": "sha256-from-latest-preview"
}
```

`warnings_checksum` is required when the candidate has staffing deficits and must match a fresh server calculation inside the transaction. A successful preview is not itself confirmation: the Owner confirms the shown deficit before the UI submits Save Changes. With no deficits, the UI does not ask for warning confirmation.

## Commit and failure behavior

1. Reuse the planner's tenant, outlet, employee, and week lock order. Re-authorize and revalidate under those locks.
2. Require an existing published revision, the exact `expected_version` and `expected_published_revision_id`, no unresolved draft, and active planner cutover for the target week. First cutover remains the existing explicit Publish action.
3. Validate employee/outlet/date eligibility, shift validity, duplicate assignments, overlaps across dates/outlets, started or historical schedule protection, effective staffing policy, and attendance-session safeguards. Invalid conflicts return validation errors and cannot be acknowledged away.
4. In the same transaction, create an immutable replacement revision, write its entries and frozen schedule snapshots, set publication metadata, switch the effective pointer, increment the lock version, record actor/reason/old and new revisions, enqueue existing publication notifications, and persist the idempotent response.
5. Any exception before commit leaves the old published pointer and schedule effective, with no partial revision, audit event, notification, or idempotency result.

Stale versions, a changed published base, an unresolved draft, or a changed deficit checksum return `409` with no partial writes. Invalid candidates return `422`. Foreign or inaccessible outlets retain existing `403`/`404` behavior. Replaying the identical idempotency key and request returns the stored result; reusing the key with a changed request returns `409`.

The frontend keeps an exact request body and key after an ambiguous network failure. It may retry only that same request, then refresh the planner and Employee schedule after success. A click or pending request is never success evidence.
