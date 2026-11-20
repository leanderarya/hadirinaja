# HadirinAja V1.0 Backoffice blueprint

**Owner-approved product decisions. Implementation is not authorized by this document.**

The redesign organizes Owner work around six destinations: **Home, Schedule, Attendance, Employees, Outlets, Settings**. Reuse the existing Backoffice design system. Schedule gets a daily list editor and a weekly calendar overview backed by one edit state. A new week starts empty or copies the previous week. Missing staffing is a warning requiring explicit confirmation; invalid conflicts block publication. Edits to a published week take effect only after a validated, explicit **Save Changes**.

## Read in this order

| Document | Use it for |
|---|---|
| [Design system](design-system.md) | Existing tokens, components, form patterns and responsive behavior |
| [Navigation](navigation.md) | Six destinations, current routes, access and deep-link behavior |
| [Scheduling UX](scheduling-ux.md) | Interaction states, copy/publish/direct-edit contracts and existing APIs |
| [Cepat Kopi reference](cepat-kopi-reference.md) | Approved operating rules, fixtures and baseline incompatibilities |
| [Implementation plan](implementation-plan.md) | P0–P3 order, acceptance tests, failure recovery and exact starting point |

## Authority and evidence

The Owner decisions in this folder define the redesign. Use [Weekly Planner Core](../weekly-planner-core.md) and [Weekly Planner Supervisor](../weekly-planner-supervisor.md) for the revision and publication model, [V1.0 restricted scope](../v1-restricted-scope-reconciliation-2026-11-15.md) for the origin-bound attendance boundary, and the [UX writing standard](../ux-writing-standard.md) for Indonesian interface text. Historical reports describe their capture date; they are not current operational settings.

Source links refer to the current working repository and describe what was inspected, not what is deployed or committed. The isolated UAT workspace at `/Users/aryaajisadda/Development/hadirinaja-v1.0-local-uat` is a separate runtime and evidence source, not the authoritative source repository. Carry forward the Owner-reported **Cepat Kopi master-data UAT 4/4 PASS**, seeder no-op on repeat, and legacy-tenant preservation. These do not establish complete attendance or redesign acceptance.

| Mapping label | Meaning |
|---|---|
| IMPLEMENTED | Source path exists and implements the stated capability; not a runtime test result. |
| PARTIAL | Some of the requirement exists; the documented gap remains. |
| MISSING | No matching capability was found in the inspected source paths. |
| UNVERIFIED | Behavior or provenance is not established for the intended implementation baseline. |

Employee navigation, Supervisor scope, Kiosk paths and data retention are not redesign permissions. Local implementation comes first, then Owner UAT, then separately authorized **manual staging**. No GitHub Actions activation.
