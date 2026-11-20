# Backoffice design system

[Back to blueprint](README.md)

Standardize the existing Backoffice components before adding new ones. Keep the shared visual language; do not create a second palette, type scale or set of overlays for Schedule.

| Requirement | Existing source | Mapping |
|---|---|---|
| Color, surface, focus and shape | [`src/styles.css`](../../src/styles.css) defines `primary`, `surface`, `muted`, `border`, `ring`, `destructive`, sidebar and semantic radius tokens. [`design-tokens.tsx`](../../src/components/ui-kit/sections/design-tokens.tsx) documents examples. | IMPLEMENTED as primitives; apply them consistently to the six destinations. |
| Typography | Use `text-display`, `text-title`, `text-subtitle`, `text-lead`, `text-body`, `text-label`, `text-caption`, `text-mono` from [`styles.css`](../../src/styles.css). | IMPLEMENTED; prefer semantic classes in application blocks. |
| Shell and organization context | `ManagementSidebar`, `ManagementTopbar`, `OwnerMobileNavigation`, `OrganizationSwitcher` in [`management-sidebar.tsx`](../../src/components/management-sidebar.tsx). | PARTIAL: usable shell, but current navigation is not the approved Owner model. |
| Headings, scope and feedback | `PageHeading`, `ScopeBanner`, `ContextDrawer` in [`screen-blocks.tsx`](../../src/components/r2c/screen-blocks.tsx); `LabeledControl`, `ContextFilterBar`, `StatusBadge`, `ContextAlert`, `RecordCard` in [`components.tsx`](../../src/components/r2c/components.tsx). | IMPLEMENTED as building blocks. Use text as well as color to distinguish warning, error, draft and published states. |
| Schedule views | `WorkWeekControl`, `ScheduleMatrix` in [`operational-blocks.tsx`](../../src/components/r2c/operational-blocks.tsx); `WeeklyPlannerBoard` in [`weekly-planner-board.tsx`](../../src/components/weekly-planner-board.tsx). | PARTIAL: board and week controls exist. Do not assume an existing named daily list editor or shared view-independent edit model. |
| UI kit | [`/ui-kit` route](../../src/routes/ui-kit.tsx), [`catalog.ts`](../../src/components/ui-kit/catalog.ts) and [`sections/`](../../src/components/ui-kit/sections/). | IMPLEMENTED as inventory. Follow [repository rules](../../AGENTS.md): new or substantially changed reusable components need a catalog entry and a demo that imports the real component. Routes themselves are not UI kit components. |

## Form patterns

- **Dialog:** short decisions with a clear consequence, such as publishing with staffing gaps or discarding unsaved changes. Reuse [`Dialog`](../../src/components/ui/dialog.tsx) and `ConsequenceDialog`. Name the action in the title, show the impact, and provide a safe cancel. Do not put the weekly editor in a modal.
- **Drawer:** small, scoped edits such as assigning one employee to a shift. Reuse [`Drawer`](../../src/components/ui/drawer.tsx), `ContextDrawer`, or the existing `DatedPlacementDrawer` when the interaction matches. Review [`Sheet`](../../src/components/ui/sheet.tsx) only where the existing shell already uses it. A drawer cancel discards that form's changes, not the entire weekly edit state.
- **Page:** workflows with multiple records, heavy validation or review, such as Schedule, permission changes, and policy version history. Keep scope and status visible. Use [`field.tsx`](../../src/components/ui/field.tsx) or `LabeledControl` with visible labels and associated errors.

## Responsive and interaction acceptance

- Desktop: use the existing sidebar and topbar. Keep date, outlet and primary action visible without obscuring records. Weekly overview and daily editing may sit side by side or use tabs, provided both consume the same state.
- Mobile: use existing Owner mobile navigation; show the daily list with a reachable overview switch. At 320 and 390 px, no page-level horizontal overflow; if the calendar needs horizontal scrolling, confine it to a labeled region with a usable list alternative. Use 44 px touch targets for primary controls.
- Both: usable keyboard order and visible focus; accessible overlay title, Escape/cancel and focus return; day and shift controls named unambiguously; error and success feedback announced. Keep loading, empty, forbidden, stale, saving and retry states distinct. Do not clear editable input on a recoverable error or hide validation behind a toast.
- Copy uses the [project writing standard](../ux-writing-standard.md). Terms such as *draft* and *published* represent actual server state, not just visual styling.
