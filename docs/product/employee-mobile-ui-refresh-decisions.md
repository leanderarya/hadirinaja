# HadirinAja — Employee Mobile UI Refresh

## Owner-Approved Design Decisions (M01–M12)

**Status:** APPROVED — Design Baseline  
**Source:** Explicit Owner decisions in the HadirinAja UI/UX brainstorming conversation, 7 November 2026  
**Scope:** Employee Mobile App Shell and Personal Attendance presentation  
**Implementation stage:** Phase 2A Employee Shell operational integration is authorized by the 7 November 2026 Owner objective. Phase 2B remains out of scope.

### M01 — Attendance History Bottom Sheet

On mobile, selecting a Work Date opens its attendance sessions in a bottom sheet rather than an inline accordion or separate detail page. The sheet supports multiple sessions, proper focus management, safe areas, and scroll containment. Tablet/desktop may use an appropriate dialog or side panel.

### M02 — Summary First, Details on Demand

The bottom sheet initially displays concise session information: status, check-in/out times, and Outlet. Original/effective values, evidence, and eligible correction actions appear in expandable sections only when needed.

### M03 — Shared Outlet Context

The Employee Top Bar contains an Outlet selector that provides shared viewing context for relevant pages, including Attendance, Schedule, and Requests where supported. The selected context must never grant permissions or silently replace the explicitly selected checkout destination. Backend authorization and attendance eligibility remain authoritative.

### M04 — Top Bar Utilities

The Top Bar contains an Outlet selector, notification icon, and profile/account menu. The existing four-item Bottom Navigation remains the primary module navigation.

### M05 — Notification Placeholder

Display the notification icon, but defer Notification Center functionality to a later release. Clicking it shows a short “Notifikasi belum tersedia” message. Do not create notification storage, APIs, fabricated unread counts, or notification history. SweetAlert2 continues handling transactional feedback.

### M06 — Compact Attendance Status

Display one compact card summarizing the current attendance state, available check-in time, and relevant context. Place both Check-in and Check-out actions directly beneath the card. Both actions remain visible; the backend determines eligibility. Ineligible actions remain disabled without adjacent explanations.

### M07 — Compact Weekly History List

Display weekly attendance history as a compact vertical list of Work Dates, not a horizontal seven-day strip. Each row shows a concise status and available time information. Selecting a date opens M01's bottom sheet. Avoid implying continuous work when multiple sessions exist.

### M08 — Newest-First History

Show the current Work Date first, followed by earlier dates down to Monday of the current week. Do not display future dates. Use backend-defined Work Dates and relevant Outlet-local time semantics rather than the device clock to classify records.

### M09 — Sticky Top Bar

Keep the Top Bar visible during scrolling throughout Employee pages. Use a solid background, respect device safe areas, and keep overlays correctly layered above it. Do not auto-hide during scroll.

### M10 — Outlet Selector Popover

Open a dropdown/popover directly beneath the Top Bar Outlet selector. Show only authorized Outlets, indicate the selected Outlet, handle long names, and support scrolling/search when necessary. Close on selection, outside interaction, or Escape. Changing viewing context must not modify an active session, original Work Date/Outlet, or checkout destination.

### M11 — Quick Account Menu

The Top Bar profile icon opens a popover showing authenticated Employee identity, a link to the existing Profile page, and Logout. Reuse existing authentication/session invalidation. Do not introduce another Profile page.

### M12 — Persistent Bottom Navigation

Keep the four Employee destinations — Beranda, Jadwal, Permintaan, Profil — visible at the bottom while scrolling. Reserve content space and respect iPhone safe areas and virtual keyboards. Disable background interaction while modal bottom sheets are open. Desktop may adapt the layout without changing destinations.

---

## Existing Functional Baseline

Preserve the separately approved Personal Attendance V1.1 UX01–UX12 decisions, including:

- Outlet photo policies, explicit checkout destination validation, and backend-authoritative eligibility.
- Contextual correction and authorized evidence access with retention restrictions.
- Multiple valid sessions per Work Date and safe unfinished-session recovery.
- Simplified GPS presentation, direct submission, camera fail-closed behavior, and idempotent recovery.
- Both attendance buttons permanently visible, with ineligible actions disabled.
- SweetAlert2 as the shared notification standard, without additional confirmation before physical attendance submission.

## Visual Prototype Boundaries

- Create an isolated, development-only prototype using clearly labeled synthetic data.
- Use existing HadirinAja design tokens, typography, and navigation patterns.
- Prototype Empty, Not Checked In, Working, Completed, Multiple Sessions, and Unresolved Session states.
- Make interactions meaningful, or clearly disable unavailable actions.
- Do not change operational Attendance, Schedule, Requests, Profile, backend APIs, authentication, or database.
- No attendance events, production deployment, commits, or merges.

## Acceptance Criteria

Verify responsive presentation at 320, 390, 768, and 1440 CSS pixels; keyboard navigation, focus management, overlay behavior, scrolling, and iPhone safe areas.

Deliver a locally accessible prototype URL, screenshots, changed-file list, test results, and identified limitations. Stop before operational integration.

---

## Owner-Approved Updates After M12

### M13 — Centered Minimal Home

**Status:** APPROVED — Current Home presentation

Remove outer cards around the live clock, attendance status, and weekly history. Center the clock and status with tabular numerals and deliberate whitespace. Keep equal-width attendance actions in one row with scenario-dependent visual emphasis while prototype actions remain disabled. Show newest-first history as separated rows. Keep synthetic controls in a collapsed development panel. Preserve M01–M12 and UX01–UX12.

### M14 — Two-Level Mobile Top Bar

**Status:** SUPERSEDED

The earlier M14 variant used a two-row mobile header: product branding and utilities on the first row, Outlet selection on the second row. This variant is superseded by the latest Owner decision below and must not be restored.

### M14 — Context-First Single-Row Mobile Top Bar

**Status:** APPROVED — Current Top Bar direction; supersedes the two-level variant

Use one compact sticky row. Make the active Outlet context the dominant left-side control, with a building icon, compact “Outlet” label, safely truncated Outlet name, and dropdown indicator. The entire context control opens the existing accessible Outlet popover. Keep the full name available through its accessible label and title. Place the notification placeholder and Quick Account Menu on the right. Respect safe areas and preserve a clean boundary above page content, the fixed Bottom Navigation, M13 Home styling, the session bottom sheet, and UX01–UX12. The Owner's 7 November 2026 Phase 2A objective authorizes applying this shell to operational Employee pages while keeping the synthetic prototype isolated.

### M15 — Borderless Navigation Control

**Status:** APPROVED — Current Outlet control treatment

Replace the bordered Outlet selector with a borderless, navigation-style control in the M14 Context-First single-row sticky header. Keep the building icon, compact “Outlet” label, truncated active name, and chevron. Make the entire control clickable with a minimum 44×44px target, visible keyboard focus, and pressed/open state feedback. Preserve the existing accessible Outlet popover, selection behavior, full-name accessible label and title, semantic design tokens, fixed Bottom Navigation, M01–M14, and UX01–UX12. The Owner's 7 November 2026 Phase 2A objective supersedes the earlier prototype-only boundary for this shell; Phase 2A integration is authorized without backend, API, authentication, or database changes.

## Phase 2A Integration Boundary

The Owner's 7 November 2026 objective authorizes integration of the approved top bar, account utilities, and four-item Employee navigation into operational Employee pages. Outlet lists may come only from existing authorized route data. A page without an existing shared-view filter keeps the selector read-only and reports that cross-page filtering is unsupported; an attendance action Outlet or checkout destination must not be repurposed as a viewing filter. Phase 2B remains out of scope.


## Owner-Approved Verification Presentation Updates

### M16 — Dedicated Verification Page

**Status:** APPROVED — Check-in/Check-out verification presentation

Run the Check-in/Check-out verification flow on a dedicated page, separate from the Attendance Home surface.

### M17 — Safe-Area Sticky Submit Bar

**Status:** APPROVED — Verification submission control

Keep the primary submit action in a sticky bar at the bottom of the verification page. Respect the device's bottom safe area and keep the bar distinct from the scrollable page content.

### M18 — Verification Focus Mode

**Status:** APPROVED — Dedicated verification page only

Hide global Employee navigation while the dedicated verification page is active. This Focus Mode exception applies only to that page; M12's persistent Bottom Navigation remains in effect elsewhere.

### M19 — Always-Visible Map

**Status:** APPROVED — Verification location presentation

Keep the map area visible throughout the verification page. Present GPS status, distance, and accuracy as specified in M24.

### M20 — Clean, Flat, Structured

**Status:** APPROVED — Current verification presentation principle

Use existing typography and semantic tokens, concise Indonesian copy, whitespace, and subtle dividers. Keep corner radii restrained at approximately 6–10px. Use minimal surfaces, no nested cards, and no unnecessary introductory or repeated explanatory copy. Preserve clear section boundaries and accessible controls. Apply this presentation to the verification page in line with M16–M19.

### M21 — Today First + Weekly List

**Status:** APPROVED — Employee Schedule presentation

Show today's schedule prominently in one subtle surface, followed by seven Monday–Sunday rows without an outer card. Selecting a day opens its details in a mobile bottom sheet or a suitable desktop panel. Support chronological multiple shifts, overnight shifts, multiple Outlets, unknown or unpublished schedules, confirmed days off, loading errors, and accessible empty states. Never infer a day off from missing data.

### M22 — Persistent Today Summary

**Status:** APPROVED — Employee Schedule behavior

Keep today's summary tied to the actual current day while the Employee browses other weeks. Show the time and Outlet for each of today's shifts. When there are multiple shifts, show their count and separate shift details; never combine them into a misleading continuous time range.

### M23 — Week Navigation

**Status:** APPROVED — Employee Schedule behavior

Provide previous/next week arrows and an accessible date picker opened from the displayed week range. Selecting any date navigates to that date's Monday–Sunday week.

### M24 — Flat Verification Layout

**Status:** APPROVED — Current Check-in/Check-out Focus Mode layout

Center the action title and Work Date. Present Outlet context as a borderless information section; keep checkout destination selection explicit and original session Work Date/Outlet provenance visible. Present Photo and Location as flat sections separated by subtle dividers. Keep the map area visible, with compact GPS status, distance, and accuracy. Use concise Indonesian labels. Keep simulation status unambiguous and preserve M16–M19 behavior, accessibility, and M17's safe-area-aware sticky Submit Bar.

### M25 — Focused Capture and Checkout Context

**Status:** APPROVED — Verification page composition

Retain M24's centered action title and Work Date, and center the photo-capture control in the Photo section. Use minimal default copy in line with M20 while preserving required labels and status feedback. For checkout, keep the destination explicit and retain the original session Work Date and Outlet as provenance; the destination does not replace or rewrite that session context. This presentation does not resolve G17 or grant historical-review access from checkout destination alone; its destination-only boundary remains open. Preserve UX01–UX12 and the operational Attendance flow's server-derived Check-in/Check-out eligibility, photo/location verification, and pending-operation recovery. This is a presentation decision only; see the [G17 reservation](../product-rules-v1-flexible-attendance-shift-preference.md#unresolved-g17-semantic-boundary), [operational Attendance flow](../../src/routes/attendance.tsx), and [WP-03 implementation blueprint](../implementation-blueprint-v1-flexible-attendance-shift-preference.md#6-wp-03--personal-attendance-ux).

### M26 — Status-First Employee Requests

**Status:** APPROVED — Employee Requests prototype

Lead with request status. Provide All, Processing, and Completed filters, then compact divider-separated request rows. Open request details in an accessible mobile bottom sheet and a suitable desktop panel. Keep the list scannable and use restrained radii, existing typography, semantic colors, and concise Indonesian labels in line with M20.

### M27 — Contextual and Guided Correction Requests

**Status:** APPROVED — Employee Requests prototype

Support a contextual entry from Attendance history that prefills the evaluated Work Date, Outlet, session, and correction type. Also support a New Request path that selects an eligible session before presenting the correction type supported for that session. Show the session summary as read-only, distinguish original and proposed values, collect the reason, and show the evaluated correction deadline. Do not invent correction actions or eligibility; backend authorization, ownership, and correction deadlines remain authoritative in operational flows.

### M28 — Safe Correction Submission and Recovery

**Status:** APPROVED — Employee Requests prototype

Validate proposed values and the required reason before submission. Represent pending, approved, and rejected requests in the list; represent expired and unavailable correction options as blocked entry states. If a submission response is uncertain, keep a persistent status-check action and reconcile the existing attempt without resubmitting or duplicating the request. The prototype simulates all data and outcomes locally and never sends a request to an API.

### M29 — Identity-First Employee Profile

**Status:** APPROVED — Employee Profile prototype

Place the Employee identity first with a centered name, available email, and avatar or initials fallback. Follow it with flat, grouped, read-only employment and account information. Show one authorized Outlet directly. When multiple Outlets are available, summarize them by count and open the authorized list in an accessible mobile bottom sheet or suitable wider-screen panel. Do not expand Outlet visibility or infer assignment access from other data.

### M30 — Read-Only Account Boundary

**Status:** APPROVED — Employee Profile prototype

Keep the profile read-only. Do not add profile editing, password, MFA, or assignment controls unless an existing contract supports them. Reuse only existing account actions; logout may appear in the prototype solely as a clearly labeled non-mutating simulation. Show missing optional attributes without fabricating account or employment capabilities. Keep prototype scenarios synthetic and isolated from authentication and backend services.

## Employee Requests and Profile Prototype Refinements

**Scope:** Isolated prototype presentation only; no operational contracts or capabilities are added.

- Keep request details in the existing mobile sheet and wider panel. Open guided and contextual correction flows as a dedicated full-page view with explicit back navigation. Guided entry selects an eligible session before showing its evaluated correction type; contextual entry retains its Work Date, Outlet, session, type, original/proposed values, reason, and deadline.
- Use compact, flat request metadata and a readable comparison table. State that synthetic request types do not describe verified API capabilities.
- Do not show a raw internal employee record ID as an employee-facing identifier unless an existing contract verifies that meaning. Keep profile information read-only and reduce excess section spacing while preserving the centered identity and Outlet disclosure.
