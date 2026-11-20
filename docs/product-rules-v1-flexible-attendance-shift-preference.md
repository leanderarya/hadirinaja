# Product Rules V1 — Flexible Attendance and Shift Preference

Status: approved product baseline supplied by Owner. Preserved on 2026-11-04 (Asia/Jakarta). This document records product intent, not a claim of implementation or release readiness.

## Decision labels

- **Current approved decisions:** the Owner-authoritative freeze below plus unchanged A–F decisions in the historical baseline. Conflicts are resolved by the 2026-11-05 freeze.
- **Unresolved decisions:** the explicit G17 semantic reservation below and baseline decisions not closed by the eight Owner decisions. Historical unresolved wording is retained for chronology, not reopened.
- **Implementation constraints:** Preserve original events and correction history, server-authoritative transaction outcomes, authorized Outlet scope, one fixed-Outlet session, payroll separation, and the existing scheduling foundation. Multi-location sessions, automatic transfers and a third scheduling engine are out of scope. The current freeze takes precedence over conflicting historical baseline wording.

## Owner-authoritative freeze — 2026-11-05

**Documentation status: FROZEN WITH EXPLICIT G17 RESERVATION. Implementation readiness: NOT READY; runtime verification: UNVERIFIED.** The eight Owner decisions below are authoritative and supersede conflicting wording in the preserved 2026-11-04 baseline and prior planning/audit documents. This is a documentation-only freeze, not implementation, migration, testing or deployment authorization.

| Decision | Authoritative approved rule |
| --- | --- |
| G02 | Checkout at another Outlet is permitted only with an active Primary or Temporary Assignment at the destination at checkout time. Destination must belong to the same tenant; validate destination geofence and attendance-mode controls. Preserve the original session Outlet, one active session per Employee, and immutable checkout Outlet provenance. Applies to personal and kiosk attendance; kiosk destination comes from its authenticated paired device, never arbitrary Outlet selection. |
| G03 | Physical attendance requires an active Primary or Temporary Outlet Assignment. Owner may approve historical reconstruction without an existing historical assignment only through an explicitly audited exception. Never fabricate assignments, physical events or geofence evidence. |
| G08 | Owner may directly approve corrections, including their own Employee attendance. Approved corrections can be revised or reversed through immutable audit history; only Owner approves reversal. Corrections affecting finalized periods require versioned re-finalization preserving previous snapshots. |
| G10 | Full missed-attendance reconstruction requires a completed work interval with claimed start and end, one request and approval. If still working after missing check-in, Employee checks in at actual current time, requests a start-time correction, then checks out normally. No partial reconstruction or synthetic physical session is needed. |
| G12 | Employee deadlines use Work Date and actual Outlet timezone, inclusive through the end of H+N. Use the later deadline from historical and currently effective policies. Owner is exempt. Supervisor may propose out-of-window corrections, requiring Owner approval. |
| G14 | Routine correction attachments, including full reconstruction, are optional; reasons and applicable approvals remain mandatory. Special reviews may require additional evidence. Private immutable evidence supports JPEG/PNG/WebP/PDF, maximum 5 MB per file and three files per request. Owner-configurable retention: minimum 90 days, default 365 days, maximum five years, with hold protection. |
| G15 | Attendance Only: no payroll engine, historical wage rates, payroll impact ledger or payroll integration in V1. Show current effective attendance and permit authorized comparison against immutable historical finalization versions. |
| G17 | Dual-Scope Review: currently authorized Supervisors of the historical Primary or Actual Outlet may review ordinary corrections, with one final decision. Cross-Outlet disclosure is request-scoped, not general access to another Outlet's Employee history. Historical assignment exceptions and approved-correction reversals remain Owner-only. |

### Unresolved G17 semantic boundary

**OPEN: Whether Checkout Destination can independently qualify as Actual Outlet for historical review.** This freeze does not decide that question. G02 physical checkout permission does not itself grant destination Supervisors historical review access. The destination-only review authorization branch cannot be finalized or activated until this boundary is explicitly resolved; the approved historical Primary/Actual OR rule remains authoritative. Do not convert unknown legacy Primary provenance into a fabricated assignment or permission.

### Precedence and superseded rules

- G02 replaces origin-only checkout restrictions and supersedes the kiosk no-GPS exception for checkout covered by G02. Device pairing alone is not a verified geofence result. This does not silently change unrelated kiosk check-in policy.
- G03 closes the attendance-scope configuration question: use active Primary/Temporary assignments for physical operations, not independent attendance grants. Historical exceptions are Owner-only reconstruction decisions.
- G08 replaces blanket Owner self-review prohibitions and the assumption that every Owner correction needs a different reviewer. It does not grant Supervisor self-approval. Reversal is never deletion or mutation of a previous decision.
- G10 replaces start-only/partial reconstruction proposals. Correcting an active physical session's start must not close the session or fabricate a checkout.
- G12 replaces an unspecified deadline basis or a blanket management bypass: apply the approved role-specific deadline/approval rules.
- G14 closes routine attachment applicability, formats, file/count limits and retention range. Immutable content/bindings/history coexist with authorized byte expiry: retain metadata/tombstones and audit; hold prevents deletion.
- G15 supersedes the original requirement to preserve historical wage rates and removes rate-provider/valuation dependencies from V1. Their absence is not a V1 defect.
- G17 replaces an AND/both-Outlets review requirement with historical Primary OR Actual scope, evaluated against current reviewer authorization, with request-scoped disclosure. The destination-only semantic boundary above stays open.

Remaining unrelated product decisions (such as Extreme Late, preference lifecycle, and special closure/holiday policies) remain outside this WP-01/WP-02 documentation freeze's resolved decision set. No implementation capability is asserted by this section.

## Original approved baseline (verbatim, historical)

**A. Employee Personal Attendance UX**

- Home page displays Outlet information, compact work schedule, simple attendance status, and first check-in / last check-out for the current week.
- Both Check-in and Check-out buttons remain visible.
- The server attendance state determines which action is enabled.
- Navigation contains four separate menus: Home, Schedule, History, and Profile.
- Schedule uses a weekly daily-list presentation.
- GPS and camera are automatically checked when the verification page opens.
- GPS permission, geofence status, and camera availability have clear loading and error states.
- Camera preview appears immediately after permission is granted.
- Photo capture is manual, with retake capability.
- Confirmation uses a modal over the verification page.
- Submission must prevent duplicate transactions.
- Results must use server-confirmed timestamps.
- Uncertain transaction outcomes must be reconciled before retrying.

**B. Flexible Attendance Policy**

Separate Attendance Eligibility from Schedule Compliance.

Approved behavior:

| Condition | Expected behavior |
|---|---|
| Unscheduled | Allow attendance; mark Unscheduled Attendance |
| Planner Unpublished | Do not automatically block attendance |
| Scheduled REST | Allow attendance; mark Rest Day Work and require review |
| Within Grace Period | Allow attendance; classify according to policy |
| Extreme Late | Allow check-in; flag for review |
| Early Check-in | Allow within Owner-configured window |
| Early Check-out | Allow; flag for review |
| Cross-Outlet | Allow within authorized Outlet scope; flag for review |

Owner configures:
- Grace Period.
- Early Check-in Window.
- Employee Correction Window.

The extreme-lateness threshold remains undecided.

Schedule mismatch must not automatically invalidate an otherwise eligible attendance transaction.

**C. Attendance Corrections**

Both Employee and authorized Owner/Supervisor can correct:

- Missed Check-in.
- Missed Check-out.

Employee corrections require submission and management approval.

Management reconstruction requires a reason and audit trail.

Every correction must preserve:
- Original attendance records.
- Claimed actual event time.
- Submission/reconstruction timestamp.
- Actor identity.
- Reason.
- Supporting evidence, where applicable.
- Reviewer identity and decision.
- Decision timestamp.
- Complete correction history.

Never fabricate a direct attendance transaction from a correction.

Employee correction deadlines are configurable through Attendance Policy. Management reconstruction is a separate authorization path.

**D. Cross-Outlet Attendance**

- Attendance at another authorized Outlet is permitted with Cross-Outlet Attendance classification and review.
- Preserve Primary Outlet and actual attendance Outlet separately.
- Geofence must use the actual attendance Outlet.
- V1 uses one attendance session, with its Outlet fixed at Check-in.
- Multi-location sessions and automatic session transfers are out of scope.

Check-out behavior when performed at a different Outlet remains unresolved.

**E. Shift Preference**

Introduce a separate Employee Shift Preference module.

- Employees can select multiple available Shift Templates for each day.
- Employees can assign preference priorities.
- Employees can declare themselves unavailable for specific days.
- Preferences are not official schedules.
- Preferences do not guarantee shift assignment.
- Owner/Supervisor reviews submissions and uses them as additional input when preparing the existing Weekly Planner.
- Existing Shift Templates, Weekly Planner, publication/revision workflow, and Effective Schedule Resolver remain the scheduling foundation.
- Do not introduce a third scheduling engine.

Submission deadlines, editing rules, non-submission handling, and detailed review workflows remain unresolved.

**F. Payroll Separation**

Attendance records actual events. Scheduling records planned work. Review records management decisions. Payroll determines compensation.

Do not automatically classify unscheduled work, Rest Day Work, early departure, or lateness as approved overtime or compensation adjustments.

Historical corrections must preserve applicable historical rates.

**G. Explicitly Unresolved Product Decisions**

Do not invent decisions for:

1. Extreme Late threshold.
2. Cross-Outlet Check-out behavior.
3. Authorized Outlet scope configuration.
4. Shift Preference submission deadline.
5. Shift Preference editing rules.
6. Handling employees who do not submit preferences.
7. Review SLA and escalation.
8. Detailed reconstruction approval rules.
9. Special Outlet closure and holiday policies.

## V1.0 restricted-scope addendum — 2026-11-15

**Approval basis:** the newly approved V1.0 scope supplied in the task on 2026-11-15. This append-only addendum controls the V1.0 operating profile and does not rewrite the 2026-11-04 baseline or the 2026-11-05 freeze above.

For V1.0 operations:

1. Use one business tenant and exactly two operational Outlets.
2. Each attendance-eligible Employee has exactly one distinct effective Outlet assignment at a time. Primary and Temporary assignments must not authorize different Outlets concurrently.
3. Check-in and check-out are restricted to that assigned Outlet. Check-out must also remain at the Outlet fixed on the active session; it cannot transfer or retarget the session.
4. No Owner, Supervisor, Personal, or Kiosk path bypasses the assignment restriction.

For V1.0 only, these rules supersede G02's permission to check out at a different assigned Outlet and the historical cross-Outlet allowance in section D. Other G02 provenance and geofence requirements remain in force where compatible. The historical wording remains intact as chronology and is not approval for cross-Outlet attendance in V1.0.

The evidence review, backend enforcement matrix, fixture assessment, minimum configuration plan, acceptance tests, and GO/NO-GO gates are recorded in [V1.0 Restricted Scope: Decision & Readiness Assessment](v1-restricted-scope-reconciliation-2026-11-15.md). This addendum authorizes documentation of scope only. It does not authorize source changes, fixture or policy writes, migrations, deployment, or Pilot/production activity.
