# Backoffice implementation plan

[Back to blueprint](README.md)

## Work order

| Priority | Deliverable | Acceptance gate |
|---|---|---|
| **P0: foundation + Schedule** | Implement Owner navigation on the existing shell, standardize shared states and form patterns, and deliver the [Schedule UX](scheduling-ux.md). Characterize current planner APIs before adding the explicit direct-save contract. Reconcile tenant weekend/staffing rules with copy, validation and publication. | Six destinations with authorized existing links; no dead links for later phases. Both edits and review use one candidate. New week, copy, draft, warning/confirm publish, direct-save, and Employee visibility acceptance pass. No silent planner cutover. |
| **P1: Attendance + Employees** | Unify attendance reads/reviews and employee list/detail/placement/access entry points. Resolve scoped photos, 25 m validation, checkout origin and single placement for the intended candidate as described in the [Cepat Kopi reference](cepat-kopi-reference.md). | Authorized owners see the right employees and evidence; employee scope remains intact. Both outlets pass valid and invalid personal attendance scenarios, including origin-bound checkout and absent photo. No global flag change for legacy tenants. |
| **P2: Home + Outlets** | Make Home an operational overview of work that actually needs action; split outlet management out of Settings without duplicating endpoints. Preserve old deep links. | Data and actions reflect the current tenant/outlet and role. Empty, forbidden and failed state distinguishable. Effective timezone, policy and geofence context displayed accurately. |
| **P3: Settings** | Organize existing policies, calendars, shift templates, kiosk and access controls. Use dedicated pages for versioned workflows and confirmation for consequential changes. | Changes show effective dates, override/inheritance and validation. Existing auth, retention, scope and audit behavior remain intact. |

P0 can implement the Schedule flow with synthetic data while P1 attendance gaps are open. Do not claim general Cepat Kopi rollout or stage the redesign while a critical policy or scope gap remains unresolved.

## Acceptance checklist for the implementation phase

| Scenario | Evidence required |
|---|---|
| Desktop and mobile | At desktop width and at 320/390 px, select outlet/week, use both Schedule views and edit a shift without losing edits or focus. Navigate using keyboard and touch. Verify labels and error states per the [design system](design-system.md). |
| Tenant and outlet isolation | Owner can access only their tenant; scoped Supervisor cannot cross outlet boundaries; Employee cannot mutate Owner schedules. Test guessed foreign IDs, stale request after switching tenant and wrong-scope dates, including on retry. UI does not display previous-tenant data. |
| Start Empty and copy | Start Empty has no server write or implicit rest. Copy immediate prior published week, preserve original, remap dates, and never publish. Check absent source, different outlet, stale source revision, week with an existing draft, and old placement or unavailable shift. |
| Save Draft and Publish | Saved draft is not effective. Understaffing lists exact deficits; cancel preserves state; confirmation works only for the matching candidate. Revalidate after concurrent change. Overlap, invalid references or forbidden weekday/shift combinations cannot be acknowledged away. |
| Direct edit | After changing a future assignment on a published, cut-over week, Employee read remains old before Save Changes and returns the replacement after successful commit. Audit shows actor, reason and both revisions. Old revision and attendance evidence/snapshots remain intact. Verify started-entry protection and conflict with an existing unrelated draft. |
| Failure recovery | Inject failure after candidate preparation and before pointer/audit/result commit; prove no partial effective change. Retry identical payload after a simulated timeout with the same key; changed payload under that key fails. Test two writers with the same version, one succeeds, the other receives a conflict and keeps editable input. |
| Cepat Kopi and legacy | Test Thu versus Fri/Sat/Sun on both outlets, middle/evening slot differences, and other-tenant default. Verify 25 m and GPS accuracy boundaries, mandatory fresh photo on both operations, no automatic late flag without a start, and no cross-outlet close. Verify no rest days or pocokan created automatically. |

## Start here after separate authorization

1. In a clean, named V1.0 implementation copy, establish a reviewed source baseline with the repository Owner. Do not implement on dirty `main`, assume the frozen frontend can be rebuilt from source that is unavailable, or copy the local overlay wholesale. Compare the current route/API/schema contracts with the selected baseline, including the three [Cepat Kopi gaps](cepat-kopi-reference.md).
2. Start **P0 Schedule characterization** at [`src/routes/-weekly-planner.tsx`](../../src/routes/-weekly-planner.tsx), [`src/components/weekly-planner-board.tsx`](../../src/components/weekly-planner-board.tsx) and [`backend/app/Services/WeeklyPlannerService.php`](../../backend/app/Services/WeeklyPlannerService.php). Add focused characterization for authorized outlet/week reads, old-to-new revision visibility and prior-week copy. Then establish the view-independent edit model and direct-save transaction before reshaping forms. Extend existing planner UI, backend acceptance and concurrency suites rather than writing a second planner.
3. Run local tests only on a verified disposable DB, then present local browser evidence and the Owner UAT checklist. After explicit Owner acceptance, prepare a separate manual staging request with configuration, data and rollback review. No automation activation, migration, deployment or operational data changes are implied.
