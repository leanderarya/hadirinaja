# AGENTS.md

## Project rules

- Always use skill `shadcn` when building or designing ui & components.
- Always use skill `lobe-icons` when needs a brand or app logo / icon, before create a custom SVG.
- When adding or significantly changing a component/block under `src/components/` (including `ui/`), update the UI kit at `/ui-kit`:
  1. Add entry to `src/components/ui-kit/catalog.ts`
  2. Add a demo in the matching `src/components/ui-kit/sections/*.tsx` file using `UiKitSection`
  3. Import the real component from `@/components/...` — never duplicate component code in UI kit
  4. Follow shadcn composition rules for demos (Dialog needs Title, Avatar needs Fallback, etc.).
- Do not add routes/pages to the UI kit unless they are reusable layout blocks in `src/components/`.
- In app blocks under `src/components/` (excluding `ui/`), prefer semantic typography utilities from `src/styles.css` (`text-display`, `text-title`, `text-subtitle`, `text-lead`, `text-body`, `text-label`, `text-caption`, `text-mono`) over composing raw `text-*`, `font-heading`, and `tracking-*` classes.

## Workflow & Safety

### 1. Folder layout

HadirinAja folders in `~/Development` are limited to the entries below. Other projects in `~/Development` are out of scope: never read, modify, move, or delete them.

- `hadirinaja/` — the single git repository (`main` = V1.0 Cepat Kopi pilot line).
- `hadirinaja-wt/<track>/` — git worktrees, one per track. At most 3 active; remove one when its milestone closes.
- `hadirinaja-runtime/` — databases, `.env` files, storage, passwords. Outside git.
- `hadirinaja-evidence/<yyyymmdd>-<topic>/` — UAT reports, screenshots, network captures.
- `hadirinaja-archive/` — superseded tarballs and provenance folders. Read-only.

These existing non-git folders are frozen. Never move, rename, or modify them, and do not create new non-git folders:

- `hadirinaja-v1.1-candidate` — legacy V1.1 candidate, frozen. New V1.1 work happens in a worktree created from branch `v1.1/frontend-candidate`.
- `hadirinaja-v1.0-cepat-kopi-pilot-20261119` — pilot runtime on 127.0.0.1:18084 / DB 3309.
- `hadirinaja-v1.0-local-uat` — protected UAT on 18083 / DB 3307.
- `hadirinaja-v1.0-p0-candidate-20261118` — P0 clone / DB 3308.

The three runtime folders contain hardcoded absolute paths.

### 2. Branch and worktree

Start new work with:

```bash
git worktree add ../hadirinaja-wt/<track> -b <type>/<scope>
```

Allowed branch types: `feat/`, `fix/`, `chore/`, `v1.1/`, `archive/`.

Forbidden:

- Copying source with `cp` or `rsync`, or creating `mktemp`-style folder names.
- Creating any new `hadirinaja-*` folder in `~/Development`.
- Copying or symlinking `node_modules` or `vendor` between folders — install dependencies per worktree with `bun install` (`bun.lock` is authoritative; do not regenerate `package-lock.json` unless the task says so).

Never work on `main`. Never merge `archive/v1.0-p0-schedule-ux-fail` into V1.0; it is reference only.

### 3. Commits

- Commit small and often, with conventional messages (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`).
- Never commit `.env*`, `.runtime/`, passwords, credentials, DB dumps, `node_modules`, `vendor`, or large evidence. Screenshots and captures go to `hadirinaja-evidence/`.
- Push, merge to `main`, tags, and any force operation require explicit Owner approval.

### 4. Paths

No hardcoded `/Users/...` paths in scripts. Use environment variables (`HADIRINAJA_ROOT`, `HADIRINAJA_RUNTIME`) or paths relative to the script file.

### 5. Closing a milestone

1. Commit on the track branch.
2. Move evidence to `hadirinaja-evidence/<yyyymmdd>-<topic>/`.
3. `git worktree remove ../hadirinaja-wt/<track>`.
4. Delete anything only after archiving it with a verified checksum.

### 6. Safety boundaries

Do not, under any task:

- Access production or any Hostinger site other than hadirinaja-staging.cahayaarkana.site.
- Access hadirinaja-staging.cahayaarkana.site unless the task prompt explicitly authorizes it, names the allowed scope (read-only discovery, backup, or a specific deploy step), and lists forbidden actions. Without such a prompt, staging is off-limits.
- Expose anything to LAN or a tunnel.
- Activate the live system.
- Perform attendance check-in or check-out.
- Publish, or change the business roster.
- Reseed, migrate, or reset a protected database.
- Bypass the DB isolation guard, authentication, CSRF, CORS, or origin restrictions.
- Fake attendance or worker identity.
- Never run migrate:fresh, db:wipe, --refresh-fixtures, reseed or reset on any database without the Owner's explicit approval for that specific run.
- Production data: hadirinaja-staging.cahayaarkana.site holds real attendance data from 2026-11-30. Back up first, record the reason, and prefer in-app correction over direct DB edits.
- Before stopping or restarting any DB or server, inspect the running process environment (ps eww) to identify every dependent service.

### 6a. Staging (go-live 2026-11-30)

- Staging holds real attendance data from 2026-11-30 and is treated as production.
- Read-only discovery: only SELECT/SHOW, file listing, version checks, `php artisan --version` and `php artisan migrate:status`; .env values reported as <set>/<empty> except non-secret keys named in the task.
- Any write (files, database, cron, .env) requires a backup taken and verified in the same task, an explicit Owner authorization for that step, and a recorded reason.
- Never touch hadirinaja-pilot.cahayaarkana.site or other sites on the account.

STOP and report if:

- DB identity is ambiguous.
- A network capture is incomplete.
- Protected data changed.
- A guard would have to be relaxed to proceed.

### 7. Process

- One objective per task, with a measurable END STATE.
- Structure work in phases: prepare → test → execute → verify.
- Finish with a short LEDGER UPDATE: what moved from OPEN to VERIFIED or DECIDED, with the command that proved it and its invalidation trigger.
- Do not re-verify VERIFIED items unless their trigger occurred.
- Mark uncertainty as `[BELUM PASTI]`.
- Treat agent reports as agent-reported, not proof.
- Run agents in parallel only over disjoint file ownership. Browser, session, and DB work is a single sequential agent.

### 8. Language

Discuss with the Owner in Indonesian. Write agent prompts and code comments in English. UI copy follows `docs/ux-writing-standard.md`.

### 9. Known open item

The pilot frontend overlay (25 m minimum in the geofence and policy editor, Fri–Sun weekend shift options in the planner) exists only as patched compiled chunks. Port it back into TypeScript source in a separate task.
