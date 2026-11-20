# V1.0 Restricted Scope: Decision & Readiness Assessment

**Assessment date:** 2026-11-15  
**Status:** Scope documented. **NO-GO for attendance activation** until the backend and configuration gates below are satisfied and separately authorized.

## Decision

V1.0 is limited to one operational tenant and exactly two operational Outlets. Every attendance-eligible Employee must have exactly one distinct effective Outlet assignment at a time. Check-in and check-out must occur at that assigned Outlet. Checkout must also remain at the Outlet recorded on the active session; it cannot move or transfer the session.

This is an operational V1.0 boundary, not a platform-wide tenant or Outlet cap. The application still supports multiple tenants and Outlets. Test-only foreign-tenant fixtures remain valid for tenant-isolation testing.

The decision supersedes, for V1.0 only, the earlier permission for cross-Outlet attendance and checkout in [Product Rules G02 and section D](product-rules-v1-flexible-attendance-shift-preference.md). The earlier baseline and 2026-11-05 freeze are preserved unchanged; the append-only scope addendum at the end of that document establishes precedence. Other protections, including same-tenant checks, fixed session attribution, verified geofence checks, and immutable checkout provenance, remain applicable.

**Conservative interpretation used for implementation planning:** “the assigned Outlet” means the single currently effective assignment, and no physical event may be recorded at a different Outlet than the active session's origin. An assignment transfer must not become effective while a session is still active at the old Outlet. This avoids authorizing a cross-Outlet close or leaving an active session with no valid assigned checkout Outlet. Confirm this transition rule before source implementation; it is not a separate runtime behavior verified by the reviewed evidence.

## Evidence reviewed

| Evidence | Finding and limitation |
|---|---|
| [Product Rules V1](product-rules-v1-flexible-attendance-shift-preference.md), 2026-11-04 baseline and 2026-11-05 freeze | Historical D permits attendance at another authorized Outlet. G02 permits checkout at another currently assigned Outlet. Both are contradicted by the new V1.0 scope and are superseded only for this operating profile. |
| [Read-only pilot snapshot](../output/attendance-current-state-20261104/pilot-readonly.json), observed 2026-11-04 11:29 UTC | Tenant had Outlet 1 Karangawen and Outlet 2 Kaliceret. Both policies were `kiosk`. Outlet 2 had `personal_location_validation.required=true`, radius 50 m, latitude `-7.108091590922301`, longitude `110.65293944717297`; policy version 3, effective 2026-11-02. The accompanying report records zero attendance sessions/events/evidence and zero paired kiosks. This proves captured configuration, not present-day runtime state, physical GPS accuracy, or operational attendance. |
| [Employee eligibility snapshot](../output/attendance-current-state-20261104/arya-personal-readonly.json) and [attendance current-state report](attendance-current-state-20261104.md) | On 2026-11-04, the linked Employee's selected Outlet was Kaliceret (ID 2), personal attendance was `kiosk_only`, and no active session existed. That report also records a future assignment change effective 2026-11-05. It cannot establish current assignments on 2026-11-15. |
| [Operational readiness](v1-operational-readiness.md) and [pilot readiness](pilot-readiness.md) | Existing assessments keep external activation/production NO-GO pending their independent operational, hosting, restore, and device gates. This scope update does not close them. |
| [Employee UAT setup](employee-uat.md) and [`EmployeeUatSeeder`](../backend/database/seeders/EmployeeUatSeeder.php) | The fixture has two main-tenant Employees and two Outlets, but each Employee receives a Primary assignment to UAT Central and an overlapping Temporary assignment to UAT Riverside. Both Outlet policies are `hybrid` with geofence `required=false`; the synthetic active checkout session is at UAT Central. Existing acceptance checks are explicitly not to POST check-in/out. |
| Backend implementation and focused tests | Inspected the API controller, attendance service, assignment service, assignment schema, attendance and geofence tests, and the November 5 checkout-contract migrations. This was source inspection only; no test command or runtime/Pilot/production access was used. |

## Backend enforcement gap matrix

| Area | Existing protection | Gap against restricted V1.0 |
|---|---|---|
| Tenant and Outlet boundary | Personal check-in resolves an Outlet within the active tenant; the service rechecks that the Employee belongs to that tenant. Kiosk operations use the authenticated paired device's tenant and Outlet. | The one-tenant/two-Outlet limit is not an application-wide hard cap. `OrganizationService` and management routes can create tenants and Outlets. Treat this as operational scope and verify configuration, not as an existing backend constraint. |
| Personal check-in assignment | `AttendanceService::performCheckIn` requires an assignment active at transaction time for the requested Outlet, checks the Outlet policy/mode, and serializes attendance on the Employee row. | The check is “any matching active assignment,” not “the only active assignment.” If the Employee has active assignments at both Outlets, both check-in destinations are authorized. |
| Kiosk check-in assignment | The paired device fixes the Outlet; check-in requires the Employee to be assigned there and the policy to permit kiosk. | The same multiple-assignment gap applies. Kiosk check-in passes no GPS location and intentionally does not evaluate the geofence. Device pairing is Outlet binding, not proof the device remains physically there. |
| Assignment cardinality | `assignPrimaryOutlet` serializes on the Employee and prevents overlapping Primary history. The schema enforces tenant FKs and `effective_until > effective_from`. | There is no cross-type or cross-Outlet “one distinct effective Outlet” invariant in the service or schema. `assignTemporaryOutlet` inserts without checking overlap. The public Employee update path can add a new Primary while an existing Temporary assignment remains active. The UAT seeder demonstrates assignments overlapping across two Outlets. |
| Personal checkout destination | The verified Personal checkout contract binds a destination and session into idempotency. It checks a current assignment at the destination, destination-local policy/mode, required geofence, and stores immutable destination provenance while retaining the session's original Outlet. | This is correctly enforcing the older G02 rule, which permits a different assigned destination. It does not require destination = active session Outlet. Under restricted V1.0, an assigned cross-Outlet destination must be rejected. |
| Kiosk checkout destination | The verified Kiosk contract derives destination from the authenticated paired device, rejects client-supplied destination fields, and checks current assignment, destination policy/mode, required geofence, and verified location evidence. | An Employee assigned at both Outlets can close a session from the other Outlet's paired kiosk. Restricting destination to the session Outlet and single active assignment is missing. |
| Legacy Personal checkout | Older destination-bound requests are pinned to the session's original Outlet; changed destinations cannot silently reuse an idempotency key. | The non-verified compatibility path does not run the current `activeAssignment` check used by verified contracts. It is origin-pinned, not a cross-Outlet bypass, but fresh legacy writes do not prove current sole assignment. Preserve old result recovery while making new writes fail closed under the revised rule. |
| Geofence | Personal check-in evaluates the effective Outlet geofence when policy requires it. Verified Personal and Kiosk checkout require a configured destination geofence and a verified location; failed location does not close the session. The service accepts configured radii from 50 m through 5,000 m and validates coordinate bounds. | The configured point must be the actual Outlet location. The 2026-11-04 snapshot is not a current read or a physical GPS test. Kiosk check-in remains outside geofence enforcement. |
| Active session | Employee-level active-session ownership and the transaction lock prevent concurrent active sessions and double closure. Session `outlet_id` remains fixed; checkout destination is separately recorded. | One active session is not equivalent to one active Outlet assignment. Existing protections do not prevent cross-Outlet attendance under the old G02 rules. |

### Relevant source evidence

- Personal check-in and checkout request validation: [`AttendanceController`](../backend/app/Http/Controllers/Api/V1/AttendanceController.php#L89-L135).
- Kiosk check-in passes no location; kiosk checkout derives destination from the authenticated device and accepts location input: [`AttendanceController`](../backend/app/Http/Controllers/Api/V1/AttendanceController.php#L169-L223).
- Current Outlet list and requested check-in Outlet are based on all effective assignments: [`AttendanceService::current`](../backend/app/Services/AttendanceService.php#L38-L94).
- Check-in checks an active assignment and evaluates personal geofence; kiosk uses an empty location result: [`performCheckIn`](../backend/app/Services/AttendanceService.php#L424-L465).
- Verified checkout checks destination assignment, mode, and required geofence while preserving the originating session Outlet: [`performCheckOut`](../backend/app/Services/AttendanceService.php#L508-L648).
- Assignment writer behavior: [`EmployeeOutletAssignmentService`](../backend/app/Services/EmployeeOutletAssignmentService.php#L22-L107).
- Assignment schema has effective indexes and a valid-range check, but no overlapping-assignment constraint: [tenant identity migration](../backend/database/migrations/2026_10_23_000002_create_tenant_identity_tables.php#L116-L136).
- Existing test explicitly permits assigned cross-Outlet Personal checkout and separately tests missing assignment/geofence rejection: [`AttendanceEngineTest`](../backend/tests/Feature/S4/AttendanceEngineTest.php#L173-L319).
- Existing geofence tests cover boundary, missing/denied/unavailable location, and preserving an open session on rejection: [`GeofenceEnforcementTest`](../backend/tests/Feature/S4/GeofenceEnforcementTest.php#L25-L100).
- Checkout provenance and verified Personal/Kiosk contracts: [provenance migration](../backend/database/migrations/2026_11_05_000001_add_checkout_provenance.php), [Personal contract migration](../backend/database/migrations/2026_11_05_000002_enable_verified_personal_checkout_contract.php), and [Kiosk contract migration](../backend/database/migrations/2026_11_05_000003_enable_verified_kiosk_checkout_contract.php).

## Existing fixture assessment

**Answer:** no, the current seeded state cannot prove the restricted rule as-is. It intentionally gives each main-tenant Employee both Outlet assignments, so a positive check-in at either Outlet is currently valid; its policy also makes geofence optional. The active checkout fixture starts at UAT Central.

The existing two Employees and two Outlets are sufficient; no additional entity records are required. A future, separately authorized fixture/test change should:

1. Give one Employee only UAT Central and the other only UAT Riverside, with no overlapping Primary/Temporary row.
2. Align the synthetic active checkout session, effective schedule, and assignments to the same Outlet.
3. Configure each test policy with a required, valid geofence so location acceptance and rejection can be distinguished.
4. Keep the current read-only/UI UAT acceptance rule intact. Exercise attendance writes in focused isolated backend tests, not through the existing UAT acceptance flow.

No fixture, seed, or database was changed for this assessment.

## Minimum safe implementation and configuration plan

### Backend changes required before release

1. **Enforce one distinct effective Outlet under the existing Employee lock.** Before an assignment write, reject any result that leaves the Employee assigned to different Outlets concurrently, regardless of Primary/Temporary type. Sequential history can remain. Reconcile existing cross-Outlet overlaps only through a separately authorized, audited data process. Do not delete or silently shorten historical assignments.
2. **Fail closed on ambiguous assignments at attendance time.** For check-in and checkout, require exactly one distinct Outlet assignment effective at the trusted server instant and require the operation Outlet to equal it. Do not fall back to the first Outlet when multiple Outlets are effective.
3. **Pin checkout to the active session's Outlet.** Personal destination must equal both the sole active assignment and `attendance_sessions.outlet_id`. Kiosk destination remains derived from the paired device and must equal both. Preserve the session Outlet, Work Date, idempotency binding, and immutable checkout provenance.
4. **Cover every checkout contract.** Apply the new rule to verified contracts and fresh legacy-compatible writes. Keep same-key status/replay for already accepted operations; never reinterpret an old pending or completed operation as a new destination. Changed destination/session must remain a conflict.
5. **Keep geofence checks Outlet-specific.** Evaluate personal check-in and both checkout channels against the only authorized Outlet. A rejection must not create an event/evidence or close an active session. If V1.0 requires GPS for kiosk check-in too, that needs a separate backend change; the current kiosk check-in has no GPS enforcement.
6. **Add focused acceptance tests** from the matrix below. Update the existing cross-Outlet acceptance expectation that currently approves G02 behavior.

These are proposed source changes, not performed changes. No schema migration is inherently required to enforce overlap through the service's locked write paths, but a database-level invariant would need a separately reviewed design because ordinary unique indexes cannot express arbitrary overlapping time ranges.

### Minimum Outlet 2 configuration

Latest captured evidence identifies Outlet 2 as **Kaliceret (ID 2)** and shows a required 50 m geofence with valid coordinate bounds already configured. On that evidence, the minimum policy change is only a new effective Outlet policy version changing `attendance_mode` from `kiosk` to:

- `personal` if only employee-owned devices should be enabled. This is the minimum recommended choice and makes the geofence apply to Personal check-in and verified checkout.
- `hybrid` only if kiosk use is intentionally retained. Existing kiosk check-in is Outlet-bound by device and assignment but does not validate GPS. If geofence validation is required for every event, hybrid is NO-GO until kiosk check-in enforcement is added or that exception is explicitly accepted.

Preserve `personal_location_validation.required=true`, the Outlet 2 coordinates, and the 50 m radius unless a separately authorized, evidence-based site survey requires a change. Confirm the effective policy and coordinates before issuing any new version; the November 4 snapshot is historical and does not prove current state or physical accuracy. No policy version was created or changed here.

Before activation, perform an authorized read-only inventory of the operational tenant, its two Outlets, and each eligible Employee's effective assignment at the intended start time. Resolve missing or overlapping assignments through a separately authorized, audited process. Do not infer that the November 4 assignment state remains current.

## Focused positive and negative acceptance tests

Run only in an isolated test database. Use the existing two UAT Employee and Outlet identities after the future fixture topology change above; no new Employee or Outlet is needed.

| Case | Positive assertion | Negative assertion |
|---|---|---|
| Outlet 1 check-in (Karangawen / UAT Central) | Sole-assigned Employee checks in with valid location inside Outlet 1 geofence; one active session and one event are attributed to Outlet 1. | Same Employee submits Outlet 2 ID with otherwise valid policy/location; return forbidden, with no session, event, evidence, or active owner. |
| Outlet 2 check-in (Kaliceret / UAT Riverside) | Sole-assigned Employee checks in with valid location inside Outlet 2 geofence; one active session and one event are attributed to Outlet 2. | Same Employee submits Outlet 1 ID; return forbidden, with no attendance side effects. |
| Outlet 1 checkout | Employee with an active Outlet 1 session checks out at Outlet 1 with verified Outlet 1 location; session closes once and provenance identifies Outlet 1. | Destination Outlet 2 is denied even if a stale/overlapping assignment row exists; session stays active and no checkout event/evidence is added. |
| Outlet 2 checkout | Employee with an active Outlet 2 session checks out at Outlet 2 with verified Outlet 2 location; session closes once and provenance identifies Outlet 2. | Destination Outlet 1 is denied with the session and event history unchanged. |
| Assignment cardinality | A sequential transfer to a new Outlet is accepted after the prior assignment/session interval ends. | Overlapping Primary + Temporary assignments at different Outlets are rejected under the Employee lock; attendance also fails closed if legacy data has more than one effective Outlet. |
| Geofence at each Outlet | Center and inclusive radius boundary pass when accuracy is at most the configured radius. | Outside radius, accuracy greater than radius, missing/unavailable/denied GPS, or invalid/missing geofence is rejected. Failed checkout leaves the session active. |
| Tenant and idempotency | Same-tenant, same-Outlet, same-key retry returns the original result without a duplicate event. | Foreign-tenant Outlet is denied; changing Outlet or session while reusing a key conflicts and cannot close a session. |
| Kiosk, if Hybrid is selected | Paired Outlet and sole assignment are required; verified kiosk checkout uses paired Outlet geofence and current session binding. | A different paired Outlet cannot check in or close the session. Separately assert the documented kiosk check-in GPS exception unless that behavior is changed. |

## GO / NO-GO criteria

### Current decision: NO-GO

- Backend assignment cardinality is not enforced.
- Check-in accepts any Outlet with an active assignment; verified Personal and Kiosk checkout permit an assigned destination different from the session Outlet.
- Outlet 2 is kiosk-only in the latest available snapshot; a current runtime read was not performed because Pilot/production access is prohibited by the task.
- Existing UAT fixtures deliberately contain overlapping assignments and optional geofence enforcement.
- Current operational and production readiness documents retain independent NO-GO gates.

### GO only when all are true

1. The approved addendum is reflected in the V1.0 release scope, with older cross-Outlet wording explicitly superseded for this version, and the active-session assignment-transfer rule is confirmed.
2. Backend assignment, check-in, checkout, legacy compatibility, kiosk, geofence, and idempotency tests pass in isolation, including positive and negative cases for both Outlets.
3. A read-only preflight confirms one operational tenant, exactly two Outlets, one distinct effective Outlet per eligible Employee, no unresolved active session/assignment mismatch, and a valid effective Outlet 2 geofence.
4. Outlet 2's effective mode is `personal`, or `hybrid` with the kiosk check-in GPS limitation explicitly accepted or separately fixed.
5. Required runtime/device/security/recovery gates in the existing readiness documents pass, and the Owner separately authorizes any policy change, deployment, or pilot activation.

This assessment did not run tests, query a live database, write fixtures, mutate policy, apply migrations, deploy, or access Pilot/production. Historical UAT and readiness evidence remains unchanged.
