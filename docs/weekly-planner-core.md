# Weekly Planner Core — Phase 2 (local only)

> Phase 3 memperluas kontrak publikasi: staffing wajib dan defisit membutuhkan acknowledgement checksum. Lihat [Weekly Planner Supervisor](weekly-planner-supervisor.md). Catatan Phase 2 di bawah tetap merekam fondasi awal.

## Status and compatibility

This is a backend-only foundation. No UI, staffing, swaps, reminders or notifications are included. No pilot/staging migration, deployment or real-Outlet cutover has been performed.

The additive migration `2026_11_02_000001_create_weekly_planner_core.php` adds `outlets.weekly_planner_start_on` (nullable) and four InnoDB tables:

- `schedule_weeks`: unique tenant/Outlet/Monday, draft and published pointers, integer lock version.
- `schedule_revisions`: numbered revisions, base published revision, creator membership, publication timestamp.
- `schedule_entries`: unique revision/Employee/local date, work/rest/unscheduled, tenant-bound shift version, frozen published schedule JSON.
- `scheduling_operations`: membership-scoped idempotency key, canonical request hash and durable response.

Composite foreign keys prevent tenant and week pointer mismatches. Work entries require a shift; rest/unscheduled entries prohibit one. Published revisions and their entries have no application update/delete endpoint. Editing after publication creates a separate draft/revision. This is application-enforced immutability, not protection against privileged SQL access.

## API contract

All routes require existing Sanctum/session authentication, active tenant, CSRF controls and Owner/scoped-Supervisor authorization. Prefix:

`/api/v1/management/scheduling/planner/outlets/{outlet}/weeks/{weekStart}`

`weekStart` must be a Monday in `YYYY-MM-DD` format; entries use local work dates Monday through Sunday. Missing entries mean unscheduled once the Outlet has cut over. A draft is a complete replacement, not a patch.

| Method/suffix | Input | Result |
| --- | --- | --- |
| GET `/` | none | `version`, draft/published IDs and entries; absent week returns version 0 |
| PUT `/draft` | `expected_version`, `reason`, `entries` | Saved draft, incremented version |
| POST `/validate` | `expected_version` | Valid flag/version/count, or validation error; no records written |
| POST `/publish` | `expected_version`, nullable `expected_published_revision_id`, `reason`, optional `activate_cutover` boolean | Atomic publication, incremented version |

Draft entries contain `employee_id`, `work_date`, `status` (`work`, `rest`, `unscheduled`), and nullable `shift_template_version_id`. Dates, tenant references, duplicates and status/shift pairing are checked at save; assignment, effective shift dates, instants and conflicts are revalidated at publication.

Save and publish require `Idempotency-Key` (1–100 characters: letters, numbers, period, underscore, colon or hyphen). Identical membership/key/canonical-payload retries return the stored response, including its original version. Changing payload, operation, Outlet or week with that key returns 409. JSON object key order is canonicalized; entry-list order remains part of the payload. Reload GET for current state after retrying an older operation.

Version checks use required JSON fields, not `If-Match`. Invalid input returns 422; stale versions/base revisions/state conflicts return 409; unauthorized known resources return 403 and foreign/unavailable Outlets return 404. Existing session/CSRF behavior is unchanged.

## Publication, cutover and attendance

1. Lock tenant, target Outlet, all tenant Employees ordered by ID, then week.
2. Recheck authorization and expected versions; validate the complete candidate and external/adjacent schedules.
3. Freeze per-entry shift, timezone, publishing calendar version and start/end instants.
4. Switch the published pointer, clear draft pointer, increment lock version, append audit and durable operation in one transaction.

Locking all tenant Employees is deliberately conservative and includes removed roster members. It serializes against the Employee lock used by attendance check-in. Large-tenant publication latency/lock contention has not been load-tested.

Publication does not activate the planner by default. On first cutover, an Owner must explicitly pass `activate_cutover: true`, with a week starting on a future local Monday. Cutover and publication commit together. Supervisors cannot activate cutover. Existing cutover cannot be moved or cleared through this API.

Before cutover, legacy rules/exceptions remain authoritative even when drafts or published revisions exist. On/after cutover, only the current published revision applies for that Outlet/date. An absent week or entry does not fall back to legacy. Weekly legacy writes extending beyond cutover and date exceptions on/after cutover are rejected. Conflicts between remaining legacy writes and published intervals in other Outlets are checked.

Published intervals remain frozen when calendar timezone versions change. Current policy/calendar operational flags still follow existing resolver behavior. Attendance snapshots gain published week/revision/entry provenance and publishing calendar ID; existing snapshots are not rewritten. Check-out continues using its session snapshot. Existing geofence and trusted-kiosk rules are unchanged.

Republishing must preserve started/historical entries and snapshots. Removing a historical entry or changing an already-started shift is rejected. Future entries are revalidated. The core does not introduce a new prohibition on unscheduled attendance; existing review rules remain in force.

Audit resource `schedule_week` records draft saves, publications and cutover with actor membership, reason and revision references. Report query joins were extended for Outlet scoping. Week-level publication events are not per-Employee audit events and are excluded by an Employee-specific audit filter.

## Local verification and deployment boundaries

Only the verified local MySQL `hadirinaja_test` database is authorized for migration/reset by the test harness. `Tests\TestCase` checks the configuration; connection identity must also be checked before running it. Existing two-process workers retain test-DB guards.

Relevant test commands from `backend/`:

- `vendor/bin/phpunit tests/Feature/S3`
- `vendor/bin/phpunit tests/Feature/S4/AttendanceEngineTest.php tests/Feature/S4/GeofenceEnforcementTest.php tests/Feature/S4/AttendanceConcurrencyTest.php tests/Feature/S5/ApprovalWorkflowTest.php tests/Feature/S5/PersonalEligibilityTest.php tests/Feature/S6/ReportingTest.php tests/Feature/S1/TenantAuthorizationTest.php tests/Feature/S2/AccessManagementTest.php`

Target MariaDB compatibility, deployment duration and hosting load are not established by local MySQL tests. Deployment requires separate authorization, verified target schema, additive migration before serving this code, recovery snapshot and a planner-aware rollback artifact. Do not deploy this code against the old schema.

Before any cutover, reverting application code can restore legacy-only operation while leaving additive tables intact. After cutover, an old legacy-only resolver is unsafe: disable planner writes if necessary but keep published reads active. Correct future schedules through another audited revision; do not clear cutover or restore legacy silently. Published history must be preserved. Migration `down()` is restricted to the isolated test database, never an active pilot rollback procedure.

## Observed verification — 2026-11-02

- Verified connection before tests: local MySQL 9.7.1, actual database `hadirinaja_test`.
- S3 suite: 42 tests, 245 assertions PASS, including Phase 1 regressions and two-process planner publication tests.
- Targeted S4/S5/S6, tenant authorization and access-management regression command above: 96 tests, 1094 assertions PASS.
- PHP syntax checks and Pint on all 10 changed/new PHP files: PASS. Scoped `git diff --check`: PASS.
- A backend-file hash baseline confirmed that only the five intended existing backend files changed; unrelated backend changes were preserved.
- The first post-suite inspection attempted to count Outlet cutovers after the test harness had dropped the table. A schema-aware read then confirmed zero migration rows and no Outlet/planner tables after `DatabaseMigrations` teardown. No cutover remains in that disposable database.
- No main development, pilot or staging database migrations/writes were performed. No remote checks/deployment or browser UI acceptance were performed for this backend-only task.
