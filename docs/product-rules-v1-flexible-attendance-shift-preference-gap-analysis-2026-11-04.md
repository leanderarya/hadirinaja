# Product Rules V1 — Flexible Attendance and Shift Preference: Gap Analysis

Assessment date: 2026-11-04, Asia/Jakarta. Status: **done — documentation and static assessment only**. Implementation execution requires separate explicit Owner approval.

Baseline: [Product Rules V1](product-rules-v1-flexible-attendance-shift-preference.md). Repository: `/Users/aryaajisadda/Development/hadirinaja`. HEAD at assessment start: `3115ff9adb55fe80212b0f4a47fa8b094216ef57`.

## Documentation-freeze reconciliation — 2026-11-05

[Owner-authoritative Product Rules](product-rules-v1-flexible-attendance-shift-preference.md#owner-authoritative-freeze--2026-11-05) and [current blueprint contract](implementation-blueprint-v1-flexible-attendance-shift-preference.md#0-wp-01wp-02-documentation-freeze--2026-11-05) supersede conflicting product assumptions in the original assessment below. Original F01–F48 findings/counts, source evidence and verification chronology are retained as the 2026-11-04 snapshot; they are not current acceptance results or unresolved Owner questions.

| Historical item / assumption | Reconciled status against approved target | Supersession / implementation gap |
| --- | --- | --- |
| F24, unspecified correction deadline | MISSING target enforcement | G12 fixes Work Date/actual timezone/end H+N inclusive/later historical-current deadline, Owner exemption and Owner approval of Supervisor out-of-window proposals. |
| F25–F28, session-only correction and incomplete reconstruction options | PARTIAL / CONFLICT | G10 requires complete claimed start/end for full reconstruction; actual-time check-in plus start correction and normal checkout when still working. Do not fabricate session/events. |
| F27/F31, blanket independent reviewer/self-approval prohibition | CONFLICT against G08 | Owner direct approval including self is approved. Supervisor does not inherit self-approval. Historical assignment exceptions and reversals remain Owner-only. |
| F28/F30, immutable history/finalization foundations | PARTIAL | Extend with immutable revisions/reversal/effective-chain conflict handling and versioned re-finalization; preserve old snapshots and expose authorized comparison. |
| F29, unspecified evidence applicability/types/retention | MISSING complete G14 workflow | Routine attachments optional, reasons/applicable approval mandatory; special review may require evidence. JPEG/PNG/WebP/PDF; 5 MB/file, 3/request; private immutable evidence; Owner-configurable 90-day minimum, 365-day default, 5-year maximum retention, hold protection. |
| F32, unknown Employee scope / independent grants option | PARTIAL; product gate CLOSED | G03 requires active Primary/Temporary assignment for physical attendance. Historical no-assignment reconstruction uses an audited Owner exception, not synthetic grants. |
| F33–F36, origin-only checkout / G02 unresolved | CONFLICT / MISSING provenance; product gate CLOSED | G02 permits assigned same-tenant destination checkout at current time; destination mode/geofence validated for personal/kiosk; kiosk destination derived from authenticated device. Keep fixed session Outlet/one active session and immutable destination provenance. |
| G17 AND-scope/general-history assumptions | CONFLICT | Current Supervisor authorization at historical Primary OR Actual Outlet, one final decision, request-scoped disclosure. Destination independently qualifying as Actual Outlet is the explicitly OPEN semantic boundary, not silently approved. |
| F46, absence of historical compensation rates | SUPERSEDED — no longer a V1 gap | G15 Attendance Only excludes payroll engine, historical wage rates, impact ledger and integration. Current effective attendance plus immutable historical finalization comparison remains required (PARTIAL). |
| Old kiosk no-GPS checkout exception | SUPERSEDED target rule | G02 requires destination geofence for personal and kiosk checkout; pairing is not verified geofence evidence. Unrelated kiosk check-in policy is unchanged. |

**Status:** documentation reconciliation PASS with explicit G17 reservation; implementation readiness FAIL / NOT READY; runtime/concurrency UNVERIFIED. Eight product decisions are authoritative; none is reopened. Remaining destination-only G17 authorization cannot be activated until explicitly resolved. This update does not implement or rerun the original tests. See blueprint section 0 for authorization matrix, lifecycle, migrations, reporting and acceptance order.

The remainder is the preserved historical gap analysis; any recommendations to settle these eight gates, retain wage-rate dependencies, or universally prohibit Owner self-approval are superseded by this overlay.

## 1. Executive Summary

The current working tree already contains a reusable attendance engine, effective schedule resolver, versioned Attendance Policy, Weekly Planner with draft/publication/revision controls, correction approvals, effective attendance projections, scoped reporting, and private photo evidence. Flexible attendance is substantially present: unscheduled work, REST work, lateness, and schedule conflicts become review indicators rather than automatic schedule-based rejection. Preserve these foundations.

V1 is not fully implemented. The largest gaps are missed check-in reconstruction without an existing session, enforcement of Employee correction deadlines, explicit Cross-Outlet classification and Primary Outlet snapshots, the complete Shift Preference module, and the approved personal navigation/verification flow. Historical compensation rates have no implementation in the inspected backend. Runtime, deployed schemas, operational policy values, and real-device behavior were not inspected.

**48 assessment items:** **24 PASS, 7 PARTIAL, 9 MISSING, 4 CONFLICT, 4 UNVERIFIED**. These include **35 existing capabilities/behaviors verified statically** (PASS + PARTIAL + CONFLICT), nine search-bounded missing capabilities, and four unresolved/unverified items. A PASS means source-level alignment for the stated item, not a passing execution test or production acceptance. Existing test definitions were inspected; no application tests were executed.

Scope interpretation: Phase 1 creates only the Product Rules document. Phase 2 performs read-only inspection of implementation; writing this requested assessment report is the sole additional deliverable write. No application code, schema, data, configuration, service, commit, merge, or deployment is part of this task. No graph was present at `graphify-out/graph.json`; generating one would exceed the two-document write scope, so direct source inspection was used.

Evidence labels below distinguish:

- **Verified:** directly observed in the current tracked and untracked source, not inferred from existing documentation.
- **Search-bounded absence:** no matching implementation found in the named application/model/migration/route surfaces; not proof about external systems.
- **Recommendation:** a proposed future change, not an approved new product decision.
- **UNVERIFIED:** Owner decision or runtime evidence is unavailable within this assessment.

## 2. Existing Architecture and Workflow

### 2.1 Personal attendance and transaction lifecycle

The React/TanStack route `/attendance` loads authentication, `/api/v1/attendance/me`, request summaries, and pending operation metadata. The current response provides the linked Employee, assignment-derived Outlet options, schedule, active session, server time, eligibility, next operation, location policy, recent sessions, and effective attendance. `AttendanceController::personalCurrent()` adds **today minus six days through today**, not a Monday–Sunday current-week projection. See E01–E04.

`AttendancePage::startAttendance()` obtains GPS first, checks client geofence eligibility, then opens a camera dialog. The camera effect requests a live stream and starts preview; the Employee manually captures, retakes, and confirms within that dialog. There is no separate verification page underlying a second confirmation modal. See E05–E07.

Submission stores recoverable metadata/photo, rechecks identity, posts multipart data with `Idempotency-Key`, and accepts success only from a completed server operation. Network uncertainty invokes the operation-status endpoint; an identical payload/key can be resent after `not_found`. Pending/unknown operations block new attendance. See E08–E10.

Backend flow: controller resolves the actor from the active membership and Employee link; `AttendanceService::mutate()` prepares evidence, creates/reuses a durable operation record, locks the Employee and operation, and dispatches check-in or check-out. Check-in requires an active assignment at the actual Outlet, allowed attendance mode, valid required location, and no active session. It resolves schedule context, records indicators, freezes snapshots, creates a session/event, and acquires the unique active-session owner. Check-out locks that session, uses its original Outlet and schedule, evaluates current Outlet policy/location, records the physical event, and releases ownership. See E11–E15.

### 2.2 Scheduling and policy

Shift Templates are tenant-owned and versioned. Legacy weekly rules/date exceptions and published Weekly Planner revisions feed **one EffectiveScheduleResolver**. Legacy rules remain relevant before per-Outlet cutover. After cutover, only the current published revision is used for that Outlet/date; an absent applicable publication resolves unscheduled with `planner_unpublished` provenance. Explicit selection of another Outlet can produce `outlet_filter`/unscheduled context rather than Cross-Outlet classification. See E16–E18.

Weekly Planner persists weeks, revisions, entries, and durable scheduling operations. Publication validates a draft against its base revision, staffing warnings/checksum, assignments, intervals, and historical-entry restrictions; it freezes shift/timezone/calendar snapshots and switches the published pointer transactionally. Owner-only cutover is explicit. Supervisor publication is Outlet-scoped. Current staffing rules include a prohibition on the 11:00–19:00 shift on weekends. These are existing implementation constraints, not additional approved V1 decisions. See E19–E22.

Attendance Policy supports dated tenant defaults and dated Outlet overrides. Owner writes are audited; effective policy is merged for the requested date. Existing fields include `late_tolerance_minutes`, `check_in_window.early_minutes`, `check_in_window.late_minutes`, attendance mode, geofence, and `retroactive_request_limit_days`. The last field is stored/exposed but is not consumed by the inspected correction workflow. See E23–E24, E28.

### 2.3 Corrections, reviews, and payroll boundary

`ApprovalWorkflowService` handles leave, overtime, attendance corrections, review discovery, decisions, and finalization. Employee correction submissions always start pending/sensitive. Management has a distinct session-based administrative endpoint: qualifying Supervisor changes may apply as routine; other cases remain sensitive/pending. Both paths require an existing attendance session. See E25–E29.

Corrections store original and proposed values; decisions store effective values, actor, reason, and decision time. The projection overlays approved corrections while retaining physical events. An approved missed checkout can mark a session `administratively_resolved` and release active ownership **without inserting a physical checkout event or filling its original checkout timestamp**. Review discovery creates cases for indicators/potential absence; unreviewed indicators and pending corrections prevent finalization. See E29–E32.

The projection separates actual duration, effective duration, overtime requests, review outcomes, and finalization. No payroll/rate ledger or compensation API was found in the inspected backend surfaces. Demo text mentioning salary in a template dashboard is not payroll integration evidence. See E32, N02.

## 3. Feature-by-Feature Gap Analysis

Statuses are mutually exclusive per numbered item: PASS = aligned in inspected source; PARTIAL = reusable implementation with material missing coverage/semantics; MISSING = capability absent in inspected surfaces; CONFLICT = current behavior differs from an approved requirement; UNVERIFIED = decision/runtime proof intentionally unavailable. Evidence IDs resolve to exact repository paths and symbols in section 15.

### A. Employee Personal Attendance UX

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F01 | Home shows Outlet, compact schedule, and simple attendance status | PARTIAL | Outlet, today's schedule and active/completed status exist. Home does not provide the complete current-week compact schedule. `AttendancePage`, E01–E03. |
| F02 | Home current-week first check-in / last check-out | MISSING | Server supplies rolling seven-day effective attendance and ten recent sessions; Home uses latest day/session and detailed history, not the approved current-week first/last summary. E02–E03. |
| F03 | Both Check-in and Check-out remain visible | CONFLICT | The JSX renders one button for `currentOperation`, changing its label, or no action button. E03. |
| F04 | Server attendance state controls enabled action | PASS | `allowed_next_operation`, active-session state, and eligibility are server-provided; client additionally disables during uncertainty, stale state, or unsafe local photo storage. E02–E03, E06. |
| F05 | Four separate Home, Schedule, History, Profile menus | CONFLICT | Destinations are Home, Schedule, Requests, and Profile; History is an anchor inside the Profile panel, not its own menu. Existing navigation test asserts this older contract. E04, T06. |
| F06 | Schedule is a weekly daily list | PASS | `PersonalSchedule` renders all returned days as daily rows with date, time and status, alongside the week picker/selected-day card. E17. |
| F07 | GPS and camera automatically checked when verification opens | CONFLICT | Action starts GPS; only after eligibility succeeds does the camera dialog open/request camera. No verification-page entry lifecycle exists. E05–E06. |
| F08 | Clear GPS/geofence/camera loading and error states | PASS | `locating`, permission-denied/unavailable verdicts, geofence messages, camera readiness/loading, and denied/missing-device errors are implemented. Source-level only; real permission prompts were not exercised. E05–E07, E14. |
| F09 | Immediate live preview after camera permission | PASS | The camera effect attaches `srcObject`, calls `play()`, and updates readiness. Device latency/compatibility remains runtime-unverified. E05. |
| F10 | Manual photo capture and retake | PASS | Capture requires a usable frame; canvas encoding creates the Blob; preview supports retake. E07. |
| F11 | Confirmation modal over verification page | PARTIAL | Accessible camera dialog and preview confirmation exist, but capture and confirmation replace content within the same dialog over Home. The approved page-plus-modal composition is absent. E07. |
| F12 | Prevent duplicate transactions | PASS | Durable payload-hashed idempotency, Employee/operation locks, one active owner, unique event/operation constraints, and client pending guards exist. E08–E11, E15; test definitions T01/T03. |
| F13 | Results show server-confirmed timestamps | PASS | Physical events use server `now('UTC')`; `attendanceConfirmation()` uses event `recorded_at` or returned session time, not a device success time. E12–E13, E33; T06. |
| F14 | Reconcile uncertain outcome before retry | PASS | Status lookup precedes identical-key/photo retry; pending/unknown blocks new mutation. Reauthentication/photo loss is handled conservatively. E08–E10; T06. |

### B. Flexible Attendance Policy

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F15 | Separate eligibility from schedule compliance | PASS | Identity, assignment, attendance mode, active-session invariant and required location gate the transaction; schedule mismatches become indicators. No blanket `scheduled` requirement in `performCheckIn()`. E02, E12, E14, E16. |
| F16 | Allow unscheduled attendance with classification | PASS | `unscheduled_work` indicator is persisted; client label is “Kerja tanpa jadwal”. No approved API enum spelling requires renaming. E16, E33; T01. |
| F17 | Unpublished planner must not automatically block | PASS | Resolver returns unscheduled/`planner_unpublished`; check-in still proceeds if eligibility gates pass. This conclusion joins two verified code paths; combined runtime behavior was not executed. E12, E18; T05. |
| F18 | REST work allowed, classified, and reviewed | PASS | `rest_day_work` persists; discovery makes review cases; projection tracks unreviewed indicators and finalization rejects unresolved review. E16, E30, E32; T01. |
| F19 | Grace Period permits policy-based classification | PASS | Owner-configured `late_tolerance_minutes` determines `late_arrival`; no schedule rejection within grace. Existing checkout also reuses this tolerance. E13, E16, E23–E24. |
| F20 | Extreme Late allowed with review flag | PARTIAL | Late/outside-window attendance is allowed and flagged, but no distinct Extreme Late threshold or classification exists. Do not equate `late_minutes` to the undecided Extreme Late threshold. E12, E16, E23. |
| F21 | Allow early check-in within Owner-configured window | PARTIAL | Window configuration and adjacent-day candidate selection exist. Outside-window check-in is also accepted with a flag; the field is not a hard eligibility cutoff. Baseline does not explicitly settle outside-window behavior, so automatic rejection is not recommended without clarification. E16, E23–E24. |
| F22 | Early checkout allowed and flagged | PASS | Checkout records the event and adds `early_departure` when before scheduled end minus tolerance. Exact grace semantics for early departure deserve Owner confirmation if changed. E13. |
| F23 | Owner configures grace, early window, correction window | PASS | All three knobs have Owner-only validated policy APIs, versioning, overrides, and editor fields. This PASS covers configuration capability only; correction-window enforcement is separately F24. E23–E24. |
| F24 | Employee correction deadline enforced from policy | CONFLICT | `retroactive_request_limit_days` exists but no read/enforcement occurs in submit/correction validation. Old non-future claims can pass the inspected time validation. Management's separate authorization path should remain independent. E25, E27–E28; N03. |

### C. Attendance Corrections

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F25 | Employee missed checkout request and management approval | PASS | Pending correction of an open session is reviewed, then reconciles ownership without fake physical event. E25, E27, E29; T02. |
| F26 | Employee missed check-in when no session exists | MISSING | Service lookup requires a session owned by the Employee; schema requires non-null session FK; UI disables correction without session selection. Editing an existing check-in is not reconstruction of a wholly missed check-in. E26–E27, E31. |
| F27 | Owner/Supervisor reconstruction of missed in/out | PARTIAL | Authorized session-based correction can repair missed checkout/claimed times. No sessionless reconstruction route/model exists. Existing routine/sensitive rules are not an approved resolution of detailed V1 reconstruction approval rules. E26–E29. |
| F28 | Preserve originals, claim time, submission time, actor, reason | PASS | Request/correction/decision rows retain claim values, originals, server creation/decision times and actor identities; projections overlay rather than rewrite physical times. Application models reject update/delete of event/correction/decision rows. This covers existing session-based paths. E27–E29, E31–E32. |
| F29 | Supporting correction/reconstruction evidence where applicable | MISSING | Correction request validation and correction schema have no attachment/evidence relation. Attendance photos attach to physical events and cannot safely represent a sessionless correction. Applicability rules remain to be specified. E25–E26, E31, E34. |
| F30 | Reviewer decision/time and complete correction history | PASS | Separate correction/request rows and append-only decisions retain decisions and expose `decision_history`; request lists preserve correction payloads. No claim of privileged-SQL immutability. E29, E31, E35. |
| F31 | Management authorization separate from Employee submission | PASS | Distinct endpoint/service path, Owner/scoped Supervisor checks, mandatory reason, and independent reviewer/self-approval checks exist. Detailed reconstruction rules remain open. E26, E28–E29. |

### D. Cross-Outlet Attendance

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F32 | Allow authorized cross-Outlet attendance; classify and review | PARTIAL | Primary/temporary assignments allow attendance at more than one Outlet, but no comparison with Primary Outlet or explicit Cross-Outlet indicator exists. A schedule at another Outlet may become generic unscheduled context. Authorized-scope policy is unresolved; assignment access must not silently become tenant-wide access. E12, E16, E18, E36–E37. |
| F33 | Preserve Primary and actual Outlet separately | PARTIAL | Actual session/event Outlet and effective-dated assignment history exist. Session snapshots store only the selected actual-Outlet assignment, not a separate contemporaneous Primary Outlet snapshot. E12, E16, E31, E37. |
| F34 | Geofence uses actual check-in Outlet | PASS | Explicit check-in Outlet is tenant/assignment checked and supplied to resolver/policy; the resulting actual-Outlet policy drives server geofence. Client coordinates are checked again server-side. E12, E14, E18. |
| F35 | One active session with Outlet fixed at check-in | PASS | Unique tenant/Employee active-owner key; checkout derives session Outlet and physical events reference it. No automatic transfer/multi-location model in inspected flow. This is one active session at a time, not an approved one-session-per-day rule. E12–E13, E15. |
| F36 | Checkout performed at another Outlet | UNVERIFIED | Product decision explicitly unresolved. Current personal API has no destination Outlet input and validates against session-origin policy/geofence; kiosk rejects other-Outlet sessions. This is observed behavior, not approval of that behavior for V1. E13, E38. |

### E. Shift Preference

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F37 | Multiple available Shift Templates per day | MISSING | No preference API, model, migration, or Employee selection module found. Current planner entry represents one official work/rest/unscheduled decision per revision/Employee/day. E19, E22; N01. |
| F38 | Employee preference priorities | MISSING | No ranked template alternatives or ranking contract found. Official planner entries and swap/replacement requests do not represent priorities. E22, E39; N01. |
| F39 | Employee unavailable on specific days | MISSING | No independent Employee availability declaration found. REST is a management-authored official schedule state, not a preference declaration. E19, E22, E39; N01. |
| F40 | Preferences are advisory, distinct from official schedules | MISSING | The separate input module does not exist. Preserve resolver inputs; do not encode preferences as draft/published entries, REST, or schedule exceptions. E18–E22; N01. |
| F41 | Owner/Supervisor reviews preference input in Weekly Planner | MISSING | Planner board/editor has no preference read/overlay or submission review workflow. Existing shift changes concern future published entries and may publish revisions, so cannot substitute for preference collection. E39–E40; N01. |
| F42 | Reuse templates, planner, revisions, resolver; no third engine | PASS | All foundations exist and are connected. Add preference input around them; leave official schedule resolution on the current path. E17–E22, E39–E40. |
| F43 | Preference deadline/edit/non-submission/review lifecycle | UNVERIFIED | Explicitly unresolved in the baseline. No implementation found; no default deadline, lock, automatic assignment, or penalty is approved. N01; baseline E/G. |

### F–G. Payroll, unresolved policy, operational evidence

| ID | Requirement | Status | Verified behavior, gap, and evidence |
| --- | --- | --- | --- |
| F44 | Separate actual events, planned work, review, payroll | PASS | Distinct physical events/snapshots, schedule revisions, requests/decisions and projections exist. This PASS covers the existing attendance/scheduling/review boundary; payroll is absent. E15, E19, E31–E32; N02. |
| F45 | No automatic overtime or compensation adjustments from mismatch | PASS | Indicators do not create overtime approvals/pay entries in inspected attendance paths. Projection exposes approved overtime requests separately from actual/effective durations. E12–E13, E16, E32; N02. |
| F46 | Historical corrections preserve applicable historical rates | MISSING | No rate history, payroll valuation, or compensation snapshot/link found. Policy/shift snapshots preserve attendance context, not compensation rates. E12, E22, E31–E32; N02. |
| F47 | Special closures/holiday behavior | UNVERIFIED | Existing calendar exceptions/holiday references and `outlet_closed` review behavior exist, but target product decisions are explicitly unresolved. Existing handling must not be promoted to approved V1 policy. E18, E16; T01. |
| F48 | Real-device, deployed policy/schema and operational correctness | UNVERIFIED | Source and test inspection cannot establish deployment state, actual permissions, production values, load or successful execution. No runtime/network/database inspection or application tests performed. T01–T07 show available verification surfaces only. |

## 4. Existing Capabilities That Can Be Reused

1. **Attendance engine and operation protocol:** keep `AttendanceService`, durable operation status, payload hash, locking, and one active owner. Reuse for the approved personal flow without weakening retry safety (F12–F15, E08–E15).
2. **Schedule/policy provenance:** keep `EffectiveScheduleResolver`, effective-dated policies, published snapshots, per-Outlet cutover, and historical-entry guards (F17/F23/F42, E18–E24).
3. **Correction overlay:** extend request/correction/decision/projection behavior rather than manufacturing `AttendanceEvent` rows. Existing missing-checkout resolution is the correct provenance pattern (F25/F28/F30, E27–E32).
4. **Review queue and audit:** reuse scoped approval decisions, review discovery, unreviewed-indicator finalization gate, and audit report infrastructure (F18/F30/F31, E29–E32, E41).
5. **Evidence and identity isolation:** reuse MIME/image normalization, private storage, audited retrieval and browser identity-scoped recovery. Correction attachments need their own association and retention design, not fake physical-event linkage (F29, E08/E34/E38).
6. **Planner UI and templates:** add preference context to the existing board and template vocabulary. Preserve manual scheduling authority and publication checks (F37–F43, E19–E22/E40).

## 5. Partial Implementations

- Home has today's summary and attendance history, but lacks the approved complete weekly summary (F01/F02).
- Capture, preview, retake and confirmation are usable building blocks; verification page lifecycle/composition differs (F07/F11).
- Late/grace/early-window fields and review indicators exist; Extreme Late is not distinct and early-window cutoff semantics are unsettled (F20/F21).
- Session-based administrative corrections exist; sessionless reconstruction and its evidence provenance are missing (F26/F27/F29).
- Multi-Outlet assignments and actual Outlet storage exist; explicit cross classification and Primary Outlet snapshot are absent (F32/F33).
- Correction limit configuration exists with no runtime enforcement in correction service paths (F23/F24). Do not describe the presence of an editor field as deadline support.

## 6. Missing Capabilities

Verified missing or search-bounded absent capabilities are F02, F26, F29, F37–F41 and F46. The minimum additions are a weekly first/last summary, correction/reconstruction independent of physical sessions, evidence attachments for claims where applicable, a standalone advisory Shift Preference input/review surface, and a defined historical-rate preservation contract when payroll integration is introduced.

“Missing historical-rate support” does not authorize building payroll now. The compensation source, rate owner, effective date and downstream integration are unknown. Document that dependency before a correction could affect real payroll (F46, N02).

## 7. Conflicts Between Approved Rules and Existing Behavior

| Item | Conflict | Smallest safe direction, subject to later implementation approval |
| --- | --- | --- |
| F03 | One changing action button vs two visible actions | Keep server `allowed_next_operation`; render both actions with independent disabled states and the existing pending guards. |
| F05 | Requests occupies History's menu position; Profile links to History | Adopt the four approved destinations and retain access to request workflows through an appropriate secondary entry. Destination/URL details need design, not a new scheduling engine. |
| F07/F11 | GPS-before-camera dialog vs automatic verification-page checks plus confirmation modal | Recompose existing capture/recovery logic around a verification surface; preserve manual capture, same-key retries, and camera cleanup. |
| F24 | Configured Employee correction window is not enforced | Read applicable policy at the Employee correction trust boundary; apply deadline only to that path. Historical policy date/timezone and deadline boundary semantics require explicit agreement. |

Additional semantic caveats are not classified as conflicts without a product decision: allowing outside early-window attendance (F21), current origin-Outlet checkout (F36), current closure handling (F47), and existing routine/sensitive administrative approval thresholds (F27). None is silently adopted or changed here.

## 8. Backend and Frontend Impact Assessment

| Area | Backend impact | Frontend impact | Relative size / blast radius |
| --- | --- | --- | --- |
| Personal Home/navigation/verification | Reuse attendance state/status APIs; add or compose a current-week summary with correct Outlet timezone | `attendance.tsx`, `employee-shell.tsx`, history display and verification composition; update old navigation tests | M; employee flow/shared shell. Component changes would require `/ui-kit` catalog/demos per repo instructions. |
| Flexible classification/policy | Preserve eligibility gates; add only agreed classification semantics; enforce Employee correction deadline | Policy descriptions, review badges and eligibility messaging must match server behavior | M; shared attendance/policy/approval contracts. No automatic runtime policy changes. |
| Corrections/reconstruction | Add independently attributable claims when no session exists; extend projection/review/overlap checks; maintain physical-event integrity | Separate missed check-in/out flows, claim/evidence entry, management reconstruction and decision history | L; additive schema, approval API, projections, reporting and concurrency. Blocking for full corrections scope. |
| Cross-Outlet | Add Primary Outlet provenance and explicit cross classification; keep approved authorization and actual-Outlet geofence | Authorized Outlet selection, Primary vs actual labels, review context; checkout awaits decision | M–L depending on scope/checkout decision; auth, sessions, reports and review visibility. |
| Shift Preference | Add advisory input persistence/read authorization using existing templates; expose submissions to managers without resolver input changes | Employee multi-choice/ranking/unavailable UI and manager planner context | L as a complete module; additive tables/API and planner board. Deadline/edit workflow scope still open. |
| Payroll rate preservation | Agree downstream historical-rate link/snapshot contract before compensation-consuming corrections | No payroll UI required by this task | Unknown/L if a new payroll engine were required; outside current implementation authorization. |

Sizes are assessment estimates, not commitments or approved work packages. Do not refactor shared architecture just to add these capabilities.

## 9. Data Model and API Impact Assessment

### 9.1 Current contracts verified

All paths below include the `/api/v1` prefix. Route evidence: E42.

| Domain | API / storage | Reuse and limitation |
| --- | --- | --- |
| Personal state | `GET /attendance/me?outlet_id=…`; `attendance_sessions`, snapshots, active owners | Existing eligibility/action contract; rolling seven-day projection is not current-week summary. E01–E02/E15. |
| Physical operations | `POST /attendance/me/check-in`, `POST /attendance/me/check-out`; `GET /attendance/me/operations/{operation}/{key}` | Preserve durable result/status and original server timestamps. Checkout accepts no actual destination Outlet. E08–E15/E38. |
| Employee corrections | `GET/POST /attendance/me/requests`, `POST /attendance/me/requests/{approvalRequest}/cancel`, `GET /attendance/me/effective` | Existing typed requests require a session for corrections; no attachment input. E25/E27/E31. |
| Management review/correction | `GET /management/approvals`, `GET /management/approvals/{approvalRequest}`, `POST /management/approvals/{approvalRequest}/decision`, `POST /management/attendance/sessions/{session}/corrections` | Scoped decisions and session-based reconstruction only. E26/E28–E29. |
| Review/finalization | `POST /management/attendance/reviews/discover`, `GET /management/attendance/effective`, `POST /management/attendance/finalizations` | Reuse pending-indicator gates; discovery itself writes records and was not called. E30/E32. |
| Policy | `GET /management/scheduling/policies`, `POST /management/scheduling/policies/tenant`, `POST /management/scheduling/outlets/{outlet}/policy` | Dated JSON defaults/overrides; existing bounds are implementation limits, not newly approved product bounds. E23–E24. |
| Schedule/templates | `GET /management/scheduling/me/week`; `GET /management/scheduling/shifts`; template creation/version endpoints | Employee week is self-linked. Shift catalogue is currently manager-gated; a preference module needs a deliberately Employee-authorized available-template read contract. E17/E21/E43. |
| Planner | `/management/scheduling/planner/outlets/{outlet}/weeks/{weekStart}` with GET, PUT `/draft`, POST `/copy`, `/validate`, `/publish` | Maintain expected versions, idempotency, immutable publication history and staffing validation. E19–E22. |
| Shift changes | `/management/scheduling/me/changes` plus `/options` and `/{change}/respond` | Swap/replacement of published future entries, not advisory availability input. E39. |
| Evidence/audit | `GET /management/attendance/events/{event}/evidence`; `/management/reports/audit` and `/{source}/{entry}` | Private event evidence and scoped audit can inform attachment access design; do not call evidence GET during read-only assessment because retrieval writes an audit row. E38/E41/E42. |

### 9.2 Recommended additive model/API direction — not approved schema or endpoint design

- **Sessionless corrections:** represent a reported actual event time as a claim with nullable physical-session linkage or another explicitly separate reconstruction entity. Keep immutable claim/revision provenance, submitter, management reconstruction marker, reason, reviewer and decision time. Extend effective projection to approved claims without inventing physical events. Current non-null `attendance_corrections.attendance_session_id` and non-null physical `check_in_at` prevent simply reusing the current model unchanged (E15/E31).
- **Correction evidence:** attach privately stored supporting evidence to the claim/request, preserving uploader, receipt time, hash, authorization and retention state. Existing evidence points to a physical attendance event; inventing an event just to satisfy that FK violates V1 (E34).
- **Primary/actual Outlet:** snapshot Primary Outlet as of the approved attendance event context separately from actual session Outlet and its assignment provenance. Do not rely solely on querying mutable assignment history later (E12/E16/E37).
- **Preference input:** an advisory Employee/week submission with daily availability plus multiple ordered template choices is sufficient conceptually. Actual storage shape, template-vs-version references, priority uniqueness/ties, editing/version rules and submission states require a detailed approved contract. Preserve tenant, Employee, date and authorized Outlet boundaries. Do not overload `schedule_entries` or add a resolver for preferences (E19/E22).
- **Weekly summary:** the existing self-projection range endpoint can provide days; any first/last aggregate must retain original/effective distinction, multiple sessions, overnight work dates and server/Outlet timezone. Avoid lossy updates to the underlying events (E01/E32).
- **Rates:** an agreed historical compensation version reference or immutable valuation snapshot may satisfy F46; no rate source is established by this repository. Keep that contract separate from attendance eligibility/review (N02).

New API names and schema details are deliberately not specified as approved decisions. Reuse authentication, active tenant, request validation, idempotency and scoped access patterns.

## 10. Security, Authorization, and Audit Risks

| Risk / evidence | Verified protection or limitation | Required direction before implementation acceptance |
| --- | --- | --- |
| Authorized Outlet scope (F32/F36, E36–E38) | Employee attendance uses current assignments; management uses Owner/scoped Supervisor. These are distinct authorization concepts. | Owner must define cross-Outlet scope; never grant an Employee all tenant Outlets merely because they share a tenant or reviewer scope. |
| Sessionless claim attribution (F26/F29, E25–E31) | Existing corrections inherit Employee/Outlet identity from a real session. | Validate subject ownership, authorized Outlet/date, chronology, overlap, evidence association and reviewer independence for claims without that session anchor. |
| Correction deadline bypass (F24, E27–E28/N03) | Past/future chronology checks exist; configurable age limit is not enforced. | Enforce on server Employee path; management bypass must be explicit authorization/provenance rather than an Employee-controlled flag. |
| Self-approval and reconstruction dead-end (F27/F31, E28–E29) | Submitter/linked subject cannot decide their own request; routine path is tightly classified. | Keep self-review protection. Owner-created sensitive corrections can require a different eligible reviewer; do not bypass this implicitly when choosing detailed reconstruction rules. |
| Fact vs claim (F25/F28, E29/E32) | Missing-checkout approval changes effective projection/session administrative state without physical event fabrication. | Extend the same separation to missed check-in; server submission time cannot masquerade as claimed historical event time. |
| Evidence privacy/retention (F29, E34/E38) | Private image normalization, authorized/audited event retrieval, and lifecycle availability checks exist. | Design claim-evidence retention and holds deliberately; “complete correction history” must not silently promise indefinite photo retention. Policy choice remains explicit. |
| Local recovery and identity (F12/F14, E08–E10) | Pending photos/metadata are identity scoped and uncertain operations block new mutation. | Preserve this when separating Home/verification/modal routes; ensure navigation/unmount does not discard an unresolved operation. |
| Historical Primary Outlet (F33, E16/E37) | Assignment history exists; session stores actual assignment only. | Freeze approved Primary/actual provenance at event time to keep later reviews/reports historically accurate. |
| Audit immutability (F28/F30, E31/E35) | Models reject update/delete and rows have tenant FKs; workflow uses append-only decisions. | Do not claim protection from privileged SQL/query-builder writes or verified database grants. Those were not inspected. |
| Preference disclosure/tampering (F37–F43, E19/E36/E40) | No preference-specific access model exists. | Employees edit only their own authorized input; managers read only approved scope; advisory preferences must not publish schedules or influence eligibility directly. |

These are task-related design dependencies, not an authorization to change security, grants, retention, or policy now.

## 11. Dependencies and Implementation Risks

| Dependency | Size | Blast radius | Blocking status / decision |
| --- | --- | --- | --- |
| Sessionless reconstruction and correction evidence (F26/F27/F29) | L | Additive schema, approval API, effective projection, reporting, overlaps and races | Blocking full C compliance. Define reconstruction approval/evidence contract first, then implement only after approval. |
| Correction policy semantics/enforcement (F24) | M | Employee request validation, effective dated policy and timezone boundaries | Blocking deadline claim. Agree deadline basis and historical/current policy selection; preserve management authorization path. |
| Cross-Outlet authorization/checkout (F32/F36) | M–L | Auth, geofence, session state and audit | Blocking complete D design. Obtain Owner decisions; do not widen assignments or silently select origin/actual checkout rules. |
| Preference lifecycle contract (F37–F43) | L | New input APIs/tables, Employee UI, manager planner context | Blocking complete E workflow. Leave deadline/edit/non-submission/SLA decisions open. |
| Existing planner template constraints (E20/E40) | M if generalized; otherwise reuse | Shared publication/staffing and available-choice UI | Potential blocker for offering a template on an ineligible date. Current weekend middle-shift restriction and required staffing mapping must inform available choices; changing those rules needs a separate decision. |
| Publication vs attendance concurrency (E11/E19–E20; T03/T05) | M verification effort | Employee locking, snapshot/history, schedule revisions | Required acceptance gate if touched. Preserve existing lock order and historical schedule safeguards; large-tenant lock contention remains unverified. |
| Payroll historical-rate source (F46, N02) | Unknown | Downstream compensation/data history | Blocking any claim of compensation-safe historical correction. Determine integration owner/source; do not expand this task into payroll implementation. |
| Existing dirty working tree | M integration discipline | Many tracked and untracked implementation files | Non-blocking for assessment; blocking claims that HEAD alone represents this report. Review/rebase/commit decisions belong to later authorized work. |
| Runtime proof (F48) | M | Real devices, target DB/schema, services and operational policy | Blocking release acceptance, not this documentation task. Separate authorized test/rehearsal required. |

No unrelated material issue was fixed. No new dependencies or broad rewrites are recommended. Existing docs were consulted only for conventions/context and cross-checked against source; their previous test/deployment claims were not adopted as current proof.

## 12. Recommended Implementation Priorities

The following is a proposed sequence for later Owner review, not implementation authorization.

1. **P0 — Resolve narrow product gates:** the nine decisions in section 13; clarify correction-deadline basis and outside-early-window semantics. Preserve the approved baseline without substituting existing defaults for decisions.
2. **P1 — Corrections integrity and deadline:** implement safe sessionless claims/reconstruction with history/evidence and correct projection semantics; enforce the Employee deadline independently of management authority. These are correctness and audit dependencies (F24/F26/F27/F29).
3. **P1 — Cross-Outlet provenance and review:** once scope/checkout are approved, freeze Primary vs actual Outlet, add explicit classification and review context, and retain actual-Outlet geofence/one active session (F32/F33/F36).
4. **P2 — Personal UX alignment:** expose both actions, approved navigation, weekly first/last summary, automatic verification checks and confirmation modal. Reuse recovery/photo/geofence logic; update the old navigation contract test rather than treating it as V1 acceptance (F01–F14).
5. **P2 — Advisory Shift Preference:** add the separate input module and manager planner context after lifecycle decisions. Keep template availability aligned with current publish validation and leave official publication/resolver behavior authoritative (F37–F43).
6. **P3 — Compensation boundary and operational acceptance:** establish historical-rate preservation before downstream payroll consumption; run separately authorized focused regression/concurrency and real-device acceptance. No deployment/cutover is implied (F46/F48).

After implementation approval, focused acceptance should include: grace and early-window exact boundaries; extreme lateness only after a threshold decision; REST/unpublished/unscheduled attendance; wrong/unauthorized Outlet; Primary Outlet changes; overnight dates; late/missing checkout; no-session missed check-in; deadline cutoff and management path; supporting evidence ownership; rejection/self-approval; conflicting corrections vs real checkout; duplicate submits and lost responses; preference multiple choices/ranks/unavailable state, unauthorized template/date and advisory-only publication behavior. Reuse existing harnesses; do not install a new framework just for these changes.

## 13. Unresolved Product Decisions Requiring Owner Input

The following nine baseline decisions remain unresolved. No values or default workflows have been invented.

| Baseline item | Owner input needed | Related impact |
| --- | --- | --- |
| 1. Extreme Late threshold | Threshold and classification semantics | F20; do not repurpose `check_in_window.late_minutes` as the answer. |
| 2. Cross-Outlet checkout | Allowed physical Outlet, geofence and review behavior while session Outlet stays fixed | F36; existing personal/kiosk origin behavior is only implementation evidence. |
| 3. Authorized Outlet scope configuration | Source, granularity and effective timing of permitted Outlets | F32/F33; existing assignments are a reusable option, not an approved scope decision. |
| 4. Preference submission deadline | Week/timezone cutoff and period selection | F37/F43. |
| 5. Preference editing rules | Changes after submit/deadline/review and history requirements | F38/F43; no assumed locking or auto-acceptance. |
| 6. Employees with no preference submission | Display/planning behavior, without inventing penalties/default availability | F39/F43. |
| 7. Review SLA and escalation | Review ownership, due dates and escalation | F18/F27/F41/F43; existing queue is not an SLA system. |
| 8. Detailed reconstruction approval rules | Routine/sensitive classification, independent reviewer, evidence and finalized-period rules | F26–F31; existing 15-minute/seven-day routine thresholds are not newly approved product rules. |
| 9. Special Outlet closure and holiday policies | Attendance/review treatment and any scheduling implications | F47; existing holiday references and closed-Outlet flags do not settle compensation. |

Additional implementation clarifications, distinct from those nine: whether out-of-window early attendance is rejected or recorded for review (F21); correction window measured from event/work date and in which timezone/policy version (F24); whether weekly first/last uses physical or approved effective times (F02); and ownership/versioning of historical compensation rates (F46). These are questions for contract design, not silent additions to the baseline.

## 14. Verification, Provenance and Change Boundary

The Product Rules document contains the entire approved A–G baseline verbatim: **114 baseline lines** copied from the supplied attachment and compared for exact text equality, including tables and unresolved decisions. Its decision labels are outside that preserved text. The report does not alter those approved rules.

Verification consists of read-only `git status --short`, `git ls-files`, `git diff --cached --binary`, `rg --files`, `rg -n`, `nl -ba`/`sed` source and test inspection, plus Python document/evidence/count/content-integrity checks. No Laravel bootstrapping, HTTP calls, browser execution, tests, migrations, seeders, build, formatting command or service control was performed. Test files use database-writing fixtures/`RefreshDatabase` (T02/T07), so execution would violate this task's read-only data boundary. No executable application check is necessary to verify these Markdown-only changes; runtime behavior remains F48 UNVERIFIED.

Initial Git status had **268 entries**. A SHA-256 aggregate was recorded over **27,736 existing Git-tracked and non-ignored untracked paths**, including existing deletions as missing markers. This includes pre-existing generated/dependency artifacts not excluded by this checkout's ignore rules; it is a preservation set, not a count of inspected source files. Status and staged-diff hashes were also recorded. Only the two new documents are excluded from the post-assessment comparison. Ignored runtime/data files are not covered by this digest and were not accessed through application/runtime commands.

Initial content digest: `ff71072ea3e44800fa7521a082adf5aea6cc08d4cf8a181fe03c55e91159e8e7`.

Initial status digest: `d2935cd6e6ce0f3321f2c2f2b7522db6c3ae6018c5379e4e61730f736ed80c53`.

Initial staged-diff digest: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty staged diff).

Only files created by this task:

- `docs/product-rules-v1-flexible-attendance-shift-preference.md`
- `docs/product-rules-v1-flexible-attendance-shift-preference-gap-analysis-2026-11-04.md`

Final verification results:

| Check actually performed | Result |
| --- | --- |
| Inline `python3` extraction/equality check against the supplied attachment | PASS: all 114 baseline lines A–G match exactly, including unresolved decisions. |
| Inline `python3` finding-ID/status count | PASS: 48 unique F01–F48; 24 PASS, 7 PARTIAL, 9 MISSING, 4 CONFLICT, 4 UNVERIFIED. 35 existing behaviors statically verified. |
| Inline `python3` Markdown link-target and source-line-bound check | PASS: all local links resolve and source anchors are within file length. This validates reference shape; findings were also manually checked against the cited source. |
| Inline `python3` post-assessment SHA-256 content/status/index comparison, excluding only the two new documents | PASS: all 27,736 pre-existing paths, prior 268-entry Git status, staged diff and HEAD match the recorded baseline. |
| `git diff --no-index --check /dev/null <document>` for each new document | Initial baseline document check found one surplus blank line at EOF; removed only that trailing blank line. Final check has no whitespace diagnostics. With `--no-index`, exit 1 also represents the expected file-addition difference; the final wrapper distinguishes this from diagnostics. |

No existing files were edited by this task. Existing working-tree changes were preserved. No application code, database schema/data, credentials, configuration or runtime state was changed by task actions. Database/runtime state was not queried, so this is a statement about the actions performed, not independent proof that external processes stayed idle. The assessment stops here; implementation remains subject to explicit Owner approval.

## 15. Source Evidence Index

Paths/anchors refer to the working-tree contents inspected on the assessment date, including pre-existing uncommitted work. Function and line ranges below disambiguate evidence; links point at the first relevant line. Line references may drift after later edits.

| Evidence | Exact source path / symbol / inspected lines |
| --- | --- |
| E01 | [backend/app/Http/Controllers/Api/V1/AttendanceController.php:44](../backend/app/Http/Controllers/Api/V1/AttendanceController.php#L44), `personalCurrent`, lines 44–75; rolling effective range 68–73. |
| E02 | [backend/app/Services/AttendanceService.php:34](../backend/app/Services/AttendanceService.php#L34), `current`, 34–149: assignments, active session, policy mode, server time and next operation. |
| E03 | [src/routes/attendance.tsx:1099](../src/routes/attendance.tsx#L1099), `AttendancePage`, 1099–1191 and 1409–1455: Home schedule, single action, latest-history summary. |
| E04 | [src/components/employee-shell.tsx:16](../src/components/employee-shell.tsx#L16), `destinations`, 16–31; `EmployeeShell` Profile/history panel 227–247. |
| E05 | [src/routes/attendance.tsx:421](../src/routes/attendance.tsx#L421), camera `useEffect`/`startCamera`, 421–479; readiness 236–246. |
| E06 | [src/routes/attendance.tsx:831](../src/routes/attendance.tsx#L831), `captureLocation`/`startAttendance`, 831–897: GPS timeout/errors then camera dialog. |
| E07 | [src/routes/attendance.tsx:934](../src/routes/attendance.tsx#L934), `retakePhoto`/`capturePhoto`, 934–990; Dialog 1511–1641 including readiness 1538–1555 and confirmation 1598–1636. |
| E08 | [src/routes/attendance.tsx:587](../src/routes/attendance.tsx#L587), `recoverStatus`, 587–664; `submitOperation`, 666–829; retry 899–910. |
| E09 | [src/routes/attendance.tsx:265](../src/routes/attendance.tsx#L265), bootstrap/identity-scoped recovery 265–385; identity-change cleanup 388–419. Supporting store: [src/lib/attendance-photo-recovery.ts:1](../src/lib/attendance-photo-recovery.ts#L1). |
| E10 | [backend/app/Services/AttendanceService.php:175](../backend/app/Services/AttendanceService.php#L175), `operationStatus`, 175–193; `replay`/`idempotencyQuery`/`requestHash`, 1062–1117. |
| E11 | [backend/app/Services/AttendanceService.php:279](../backend/app/Services/AttendanceService.php#L279), `mutate`, 279–368: evidence gates, durable operation, locking and retry. |
| E12 | [backend/app/Services/AttendanceService.php:386](../backend/app/Services/AttendanceService.php#L386), `performCheckIn`, 386–465: identity/scope/mode/location gates, flags and session snapshots. |
| E13 | [backend/app/Services/AttendanceService.php:469](../backend/app/Services/AttendanceService.php#L469), `performCheckOut`, 469–575: origin Outlet, policy, timestamps, early departure and ownership release. |
| E14 | [backend/app/Services/AttendanceService.php:752](../backend/app/Services/AttendanceService.php#L752), `normalizeLocation`/`evaluateLocation`/`locationRejection`, 752–868; [src/lib/geofence.ts:30](../src/lib/geofence.ts#L30), `locationEligibility`, 30–106. |
| E15 | [backend/database/migrations/2026_10_23_000006_create_attendance_tables.php:19](../backend/database/migrations/2026_10_23_000006_create_attendance_tables.php#L19), `up`, operation/session/owner/event constraints 19–137; non-null physical check-in at 63. |
| E16 | [backend/app/Services/AttendanceService.php:639](../backend/app/Services/AttendanceService.php#L639), `resolveForCheckIn`, 639–689; `scheduleIndicators`, 893–925; `assignmentSnapshot`, 940–949; assignment eligibility 722–736. |
| E17 | [src/routes/scheduling.tsx:1714](../src/routes/scheduling.tsx#L1714), `PersonalSchedule`, 1714–1918, daily list 1873–1911; [backend/app/Http/Controllers/Api/V1/SchedulingController.php:150](../backend/app/Http/Controllers/Api/V1/SchedulingController.php#L150), `personalWeek`, 150–167. |
| E18 | [backend/app/Services/EffectiveScheduleResolver.php:97](../backend/app/Services/EffectiveScheduleResolver.php#L97), `resolveWeek` published query 97–107; `resolveFromContext`, 146–338: legacy/cutover, outlet filter, unpublished, snapshots, calendar and policy. |
| E19 | [backend/app/Services/WeeklyPlannerService.php:50](../backend/app/Services/WeeklyPlannerService.php#L50), `save`, 50–97; `publish`, 110–150; `copy`, 153–184; `mutate`/`lock`/`outlet`, 253–295. |
| E20 | [backend/app/Services/WeeklyPlannerService.php:367](../backend/app/Services/WeeklyPlannerService.php#L367), `publicationRows`, 367–435: started/history guards, assignment checks, weekend restriction and staffing requirement. |
| E21 | [backend/app/Services/ShiftTemplateService.php:20](../backend/app/Services/ShiftTemplateService.php#L20), `create` and `revise`, 20–88: Owner-controlled, effective-dated versions. |
| E22 | [backend/database/migrations/2026_11_02_000001_create_weekly_planner_core.php:14](../backend/database/migrations/2026_11_02_000001_create_weekly_planner_core.php#L14), `up`, weeks/revisions/entries/operations 14–75; one official entry per Employee/day/revision 58. |
| E23 | [backend/app/Http/Controllers/Api/V1/SchedulingController.php:238](../backend/app/Http/Controllers/Api/V1/SchedulingController.php#L238), `createTenantPolicy`/`createOutletPolicy`, 238–302; [src/lib/policy-editor.ts:60](../src/lib/policy-editor.ts#L60), `policyFields`, 60–119. |
| E24 | [backend/app/Services/AttendancePolicyService.php:21](../backend/app/Services/AttendancePolicyService.php#L21), `createTenantVersion`/`createOutletVersion`/`effective`, 21–106. |
| E25 | [backend/app/Http/Controllers/Api/V1/ApprovalController.php:39](../backend/app/Http/Controllers/Api/V1/ApprovalController.php#L39), `submit`, 39–74: input fields; [backend/app/Services/ApprovalWorkflowService.php:34](../backend/app/Services/ApprovalWorkflowService.php#L34), `submitEmployeeRequest`, 34–72. |
| E26 | [backend/app/Http/Controllers/Api/V1/ApprovalController.php:119](../backend/app/Http/Controllers/Api/V1/ApprovalController.php#L119), `administrativeCorrection`, 119–136; [src/routes/requests.tsx:572](../src/routes/requests.tsx#L572), session selector and disabled submit, 572–665. |
| E27 | [backend/app/Services/ApprovalWorkflowService.php:604](../backend/app/Services/ApprovalWorkflowService.php#L604), `createCorrectionRequest`/`prepareCorrection`, 604–705: required session, pending claim, originals, future/overlap/assignment checks. |
| E28 | [backend/app/Services/ApprovalWorkflowService.php:76](../backend/app/Services/ApprovalWorkflowService.php#L76), `administrativeCorrection`, 76–152; `classifyCorrection`, 708–737: separate role/scope path, routine/sensitive thresholds. |
| E29 | [backend/app/Services/ApprovalWorkflowService.php:799](../backend/app/Services/ApprovalWorkflowService.php#L799), `reconcileMissingCheckout`/`applyApprovedCorrection`, 799–829; `recordDecision`/`assertReviewer`, 956–1003; `decide`, 155–245. |
| E30 | [backend/app/Services/ApprovalWorkflowService.php:290](../backend/app/Services/ApprovalWorkflowService.php#L290), `discoverReviews`, 290–370; `finalize`, 373–433. |
| E31 | [backend/database/migrations/2026_10_23_000007_create_approval_and_finalization_tables.php:22](../backend/database/migrations/2026_10_23_000007_create_approval_and_finalization_tables.php#L22), request/decision/correction/finalization schema 22–125; correction session FK 88–100. |
| E32 | [backend/app/Services/EffectiveAttendanceProjectionService.php:250](../backend/app/Services/EffectiveAttendanceProjectionService.php#L250), `buildProjection`, 250–445: original/effective values, duration, review gates, overtime requests, finalization. |
| E33 | [src/lib/attendance-presentation.ts:14](../src/lib/attendance-presentation.ts#L14), `attendanceConfirmation`, 14–34; `reviewIndicatorLabel`, 36–54. |
| E34 | [backend/app/Services/AttendanceEvidenceStorage.php:25](../backend/app/Services/AttendanceEvidenceStorage.php#L25), `prepare`/`commit`, 25–145; [backend/app/Services/AttendanceService.php:614](../backend/app/Services/AttendanceService.php#L614), `persistEvidence`, 614–636; event-linked evidence schema [2026_10_23_000006_create_attendance_tables.php:139](../backend/database/migrations/2026_10_23_000006_create_attendance_tables.php#L139), 139–161. |
| E35 | [backend/app/Models/AttendanceEvent.php:37](../backend/app/Models/AttendanceEvent.php#L37), append-only model hooks/overrides 37–51; [backend/app/Models/AttendanceCorrection.php:31](../backend/app/Models/AttendanceCorrection.php#L31), 31–45; [backend/app/Models/ApprovalDecision.php:31](../backend/app/Models/ApprovalDecision.php#L31), 31–45; `requestView` history [ApprovalWorkflowService.php:1043](../backend/app/Services/ApprovalWorkflowService.php#L1043), 1043–1071. |
| E36 | [backend/app/Services/TenantAuthorization.php:66](../backend/app/Services/TenantAuthorization.php#L66), `canManageOutlet`, 66–84; `outletsFor`, 116–150: management scope vs Employee assignments. |
| E37 | [backend/app/Services/EmployeeOutletAssignmentService.php:22](../backend/app/Services/EmployeeOutletAssignmentService.php#L22), `assignPrimaryOutlet`, 22–76; `assignTemporaryOutlet`, 79–107. |
| E38 | [backend/app/Http/Controllers/Api/V1/AttendanceController.php:101](../backend/app/Http/Controllers/Api/V1/AttendanceController.php#L101), `personalCheckOut`, 101–114; `evidence`, 281–340 (audited read); [AttendanceService.php:216](../backend/app/Services/AttendanceService.php#L216), kiosk origin guard 216–218 and 502–504. |
| E39 | [backend/app/Services/ShiftChangeService.php:40](../backend/app/Services/ShiftChangeService.php#L40), `entry`/`eligible`/`options`/`create`, 40–129: published future swaps/replacements, not preferences. |
| E40 | [src/routes/-weekly-planner.tsx:1](../src/routes/-weekly-planner.tsx#L1), existing board/editor and [src/components/weekly-planner-board.tsx:1](../src/components/weekly-planner-board.tsx#L1); [src/lib/weekly-planner.ts:1](../src/lib/weekly-planner.ts#L1), existing planner contract. Preference absence search N01. |
| E41 | [backend/app/Services/AuditTrailQueryService.php:65](../backend/app/Services/AuditTrailQueryService.php#L65), `entries`/approval joins, 65–136; schedule-week scope joins 157–160; decision details 288–312. |
| E42 | [backend/routes/api.php:50](../backend/routes/api.php#L50), authenticated active-tenant/no-store management routes 50–155; personal routes 157–178. |
| E43 | [backend/app/Http/Controllers/Api/V1/SchedulingController.php:305](../backend/app/Http/Controllers/Api/V1/SchedulingController.php#L305), `shifts`, manager gate 305–313; `requireManager`, 534–539. |

### Test evidence inspected, not executed

| ID | Exact definitions / relevant assertions |
| --- | --- |
| T01 | [backend/tests/Feature/S4/AttendanceEngineTest.php:60](../backend/tests/Feature/S4/AttendanceEngineTest.php#L60), idempotency/self-scoped unscheduled assertions 60–117; REST 192–217; closed-Outlet test 223; distinct personal evidence 332; historical Outlet 944; append-only event test 968. |
| T02 | [backend/tests/Feature/S5/ApprovalWorkflowTest.php:134](../backend/tests/Feature/S5/ApprovalWorkflowTest.php#L134), correction preserves physical events 134–187; missed-checkout no fake event/ownership release 190–234; routine classification 237; self-review/scope 317. `RefreshDatabase` trait at 33. |
| T03 | [backend/tests/Feature/S4/AttendanceConcurrencyTest.php:45](../backend/tests/Feature/S4/AttendanceConcurrencyTest.php#L45), concurrent active sessions/checkouts/retries 45–130; cross-origin race 205; [backend/tests/Feature/S5/ApprovalConcurrencyTest.php:92](../backend/tests/Feature/S5/ApprovalConcurrencyTest.php#L92), correction/real-checkout race definitions 92–113 onward. |
| T04 | [backend/tests/Feature/S4/GeofenceEnforcementTest.php:48](../backend/tests/Feature/S4/GeofenceEnforcementTest.php#L48), check-in/check-out/location/scope/numeric boundary definitions 48–114 onward. |
| T05 | [backend/tests/Feature/S3/WeeklyPlannerTest.php:73](../backend/tests/Feature/S3/WeeklyPlannerTest.php#L73), draft/cutover/unpublished assertions 73–101; revisions/idempotency 104; scope 164; attendance snapshots 183; frozen calendar 290; staffing 361; [WeeklyPlannerConcurrencyTest.php:29](../backend/tests/Feature/S3/WeeklyPlannerConcurrencyTest.php#L29), publication/attendance locking definition. |
| T06 | [src/routes/-attendance.test.tsx:321](../src/routes/-attendance.test.tsx#L321), multipart/server result test; readiness 356; retake 380; interrupted retry preserves key/photo assertions 421–505; identity/photo recovery 531–598. [src/lib/attendance-presentation.test.tsx:72](../src/lib/attendance-presentation.test.tsx#L72), server timestamp 72–84; old navigation contract 85–103. |
| T07 | [backend/tests/TestCase.php:10](../backend/tests/TestCase.php#L10), `createApplication`, 10–26 restricts local test DB; it does not make `RefreshDatabase` tests read-only. |

### Negative searches and limits

- **N01 — Shift Preference:** `rg -n -i 'shift.?preference|preferensi.?shift|availability|unavailability' backend/app backend/database backend/routes src/routes src/lib src/components` found only generic service-availability error text, no preference domain. A narrower `rg -n 'preference|unavailable' src/lib/weekly-planner.ts src/components/weekly-planner-board.tsx src/routes/-weekly-planner.tsx backend/app/Services/PlannerStaffingService.php` returned no matches (exit 1 means no match). This was corroborated with route inventory E42, official-entry schema E22, and shift-change source E39. No claim about an external preference service.
- **N02 — Payroll/rates:** `rg -n -i 'payroll|salary|wage|compensation|rate_snapshot|historical.rate' backend/app backend/database backend/routes` returned no matches. Inspected session/correction/planner schemas and projection contain no compensation rates (E15/E22/E31/E32). This establishes absence in these backend surfaces, not in external payroll or demo/template frontend content.
- **N03 — Deadline:** `rg -n 'retroactive_request_limit_days' backend/app src/lib/policy-editor.ts` found configuration/default/provisioning/controller/editor occurrences, no correction-service consumer. `submitEmployeeRequest`, `createCorrectionRequest`, and the full `prepareCorrection` body were inspected (E25/E27); no age policy check is performed. No old-dated correction was submitted to any database.
