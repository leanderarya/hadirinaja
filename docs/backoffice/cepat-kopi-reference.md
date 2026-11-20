# Cepat Kopi implementation reference

[Back to blueprint](README.md) · [Schedule UX](scheduling-ux.md)

## Approved operating rules

Two outlets use `Asia/Jakarta`, personal attendance, and one effective outlet assignment per employee. The reference tenant has six active employees and one synthetic Owner with tenant-wide management access. These are UAT master records, not deployment instructions; no credentials belong in this document.

| Outlet | Site reference | Employees |
|---|---|---|
| Kaliceret | SPBU 4458124 | Vita, Adam, Rizal |
| Karangawen | SPBU 4459513 | Intan, Nejwa, Nejla |

Use the approved outlet points from the local fixture rather than copying coordinates from an older Pilot report. The site reference is descriptive: the inspected [`Outlet` model](../../backend/app/Models/Outlet.php) does not expose a dedicated address/site-label field. The timezone comes from each outlet's versioned calendar, not a tenant timezone column.

| Days | Operating hours | Staffing target per outlet and day |
|---|---|---|
| Monday–Thursday | 08:00–22:00 | Pagi 08:00–16:00 (1), Middle 11:00–18:00 (1), Sore 16:00–22:00 (1) |
| Friday–Sunday | 08:00–23:00 | Pagi 08:00–16:00 (2), Sore 16:00–23:00 (2); no Middle |

Schedule assignments are manual. Pocokan can rotate between weeks, but only real, authorized employees with effective placement can be assigned. Do not invent a pocokan identity or auto-fill gaps, infer rest days from missing rows, or convert a staffing shortfall into a permission to use an invalid employee. Operating hours and staffing targets describe Cepat Kopi, not defaults for other tenants. Do not add an operating-hours field simply to record this reference or imply that shift templates enforce storefront opening times.

Personal check-in requires GPS within 25 m and a new photo. Personal checkout also requires a new photo and stays at the active session's origin outlet. Grace is 15 minutes for a scheduled arrival. Without a scheduled start, a valid check-in can carry `unscheduled_work`, not automatic `late_arrival`. Geofence, photo and assignment checks still apply on an unscheduled day.

## What the source baseline does not yet prove

| Area | Mapping | Minimum required work |
|---|---|---|
| Weekend and staffing | PARTIAL: [`PlannerStaffingService`](../../backend/app/Services/PlannerStaffingService.php), [`WeeklyPlannerService`](../../backend/app/Services/WeeklyPlannerService.php), and [`weekly-planner.ts`](../../src/lib/weekly-planner.ts) assume Sat–Sun and standard 11:00–19:00 middle / 16:00–22:00 evening mappings. Friday is a weekday in the inspected baseline. | Use one versioned, tenant-scoped rule for staffing targets, shift options and validation; give legacy tenants their existing default. Use the same effective-rule selection for copy, review, publish and direct-save. |
| Photo | MISSING as scoped policy: [`AttendanceController`](../../backend/app/Http/Controllers/Api/V1/AttendanceController.php), [`AttendanceService`](../../backend/app/Services/AttendanceService.php), and [`attendance_evidence.php`](../../backend/config/attendance_evidence.php) use an instance-global requirement. | Resolve requirement per effective tenant/outlet policy for server writes and Employee UI. Preserve the global default for legacy tenants. Check both arrival and origin checkout; keep evidence private. |
| 25 m geofence | PARTIAL: effective JSON can carry outlet settings, but [`SchedulingController`](../../backend/app/Http/Controllers/Api/V1/SchedulingController.php), [`AttendanceService`](../../backend/app/Services/AttendanceService.php), [`geofence.ts`](../../src/lib/geofence.ts) and [`policy-editor.ts`](../../src/lib/policy-editor.ts) use a 50 m minimum in the inspected source. Storing 25 m does not make it valid at runtime. | Align settings validation, runtime and UI at 25 m without relaxing actual distance, GPS accuracy, bounds or origin checks. Test inclusive/exclusive edges and failure without an event or session change. |
| Grace and unscheduled work | IMPLEMENTED at capability level: [`SchedulingDefaults`](../../backend/app/Support/SchedulingDefaults.php) and [`AttendanceService`](../../backend/app/Services/AttendanceService.php) support late tolerance and indicators tied to a scheduled start. | Preserve the 15-minute value in effective outlet policy and test an unscheduled day. Do not enable an automatic rest policy. |
| Origin checkout | PARTIAL across baselines. [Restricted scope reconciliation](../v1-restricted-scope-reconciliation-2026-11-15.md) distinguishes legacy origin-pinned recovery from the older verified destination-bound paths. | Resolve the intended candidate and contract versions before implementation. Require destination = origin plus current placement and policy for new writes. Preserve idempotent response recovery without permitting departure at another outlet. |
| Fixture and runtime provenance | Owner master-data UAT 4/4 PASS is carried forward; redesign, native attendance and source promotion are UNVERIFIED. | The isolated workspace's `CEPAT-KOPI-POLICY-UAT.md` records an experimental local policy overlay and derived chunks. It is not the inspected project source, a rebuilt frozen frontend, or staging evidence. Review exact deltas and tests before any deliberate port; this blueprint does not close the baseline gaps above. |

Existing evidence entry points: [Employee UAT](../employee-uat.md), [restricted V1.0 scope](../v1-restricted-scope-reconciliation-2026-11-15.md), [`GeofenceEnforcementTest`](../../backend/tests/Feature/S4/GeofenceEnforcementTest.php), and [`AttendanceEngineTest`](../../backend/tests/Feature/S4/AttendanceEngineTest.php).
