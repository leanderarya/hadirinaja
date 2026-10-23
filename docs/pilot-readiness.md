# HadirinAja — Pilot Readiness

**Assessment date:** 2026-10-23

**Scope:** S7 local readiness only. No Hostinger account, live domain, production data, deployment, remote Git, or physical tablet was accessed.

## Decision

| Gate | Result | Evidence |
|---|---|---|
| Local engineering ready | **YES** | TypeScript, frontend builds, PHP checks, full backend suite, repeated approval race test, reporting tests, and local Node 24 SSR smoke passed. Recovery steps are documented below; restore rehearsal remains pending. |
| Hostinger verified | **NO** | Provider documentation is compatible in principle, but this account, managed Node entrypoint, PHP web runtime, MariaDB version, storage permissions, HTTPS, and backup behavior were not exercised. |
| Physical kiosk verified | **NO** | No physical tablet or camera was connected. Local API evidence tests do not establish camera/device readiness. |
| Pilot decision | **NO-GO** | Wait for the target-host, database, security-topology, recovery, and physical-device gates below, then obtain the Owner's separate pilot authorization. |

This is a local readiness decision, not permission to deploy. Dashboard 3 remains a template/demo route; keep it out of the pilot workflow until its demo content is removed or explicitly accepted.

## Evidence and remaining gates

| Area | Status | Evidence / next gate |
|---|---|---|
| TypeScript | PASS | `bun run typecheck` completed successfully. |
| Frontend production build | PASS | `bun run build` completed with the Nitro server output. Dependency `use client` warnings were non-fatal. |
| Node production runtime | PASS locally | Node `v24.22.1`; clean npm install and production build passed; `npm start` served `/`, `/login`, `/reports/attendance`, `/kiosk`, `/workspace`, `/dashboard-3`, and a CSS asset with HTTP 200. Server stopped cleanly. |
| Client bundle secret scan | PASS, narrow scan | 59 built client assets scanned for high-confidence private-key/token patterns; 0 matching files. This is not a general-purpose secret audit. |
| PHP / Composer | PASS locally | PHP `8.3.16`; `composer check-platform-reqs --no-dev`, changed-file PHP lint, and Pint checks passed. Local extensions include `fileinfo`, `gd`, `mbstring`, `openssl`, and `pdo_mysql`. |
| Backend regression suite | PASS | Three full-suite passes; each reported 65 tests and 914 assertions. The final pass used PHP 8.3.16. |
| Approval race | PASS locally | The focused missing-checkout race test passed 20/20 after changing the physical-checkout lookup to a locking read. Before the fix, a bounded diagnostic reproduced the same incorrect approval outcome 3 times in 20 runs. |
| Attendance concurrency | PASS | S4 focused concurrency suite: 4 tests, 65 assertions. |
| Reporting / CSV | PASS | S6 suite: 5 tests, 106 assertions. Tests cover status filtering before the 500-row export limit, explicit overflow rejection, and assignment actor provenance. Export still rejects overflow; it does not silently truncate. |
| Frontend lint | PARTIAL | Focused checks on the changed footer, report page, and Vite config passed. A wider changed-file check still reports existing accessibility diagnostics in template regions of `infrastructure-section.tsx` and `dashboard-1.tsx`; those diagnostics were not expanded into S7 work. |
| Local browser | PARTIAL | Production SSR route and asset smoke passed. UI smoke confirmed login, report, kiosk, and workspace shells. Authenticated browser/API flows were not exercised against a running Laravel server in this final smoke. |
| MariaDB migrations / locking | NOT VERIFIED | Local MySQL `9.7.1` tests passed. No isolated MariaDB instance was available; do not infer MariaDB correctness from MySQL. |
| Hostinger runtime / PHP web SAPI / domain | NOT VERIFIED | No account or target environment access was used. |
| Backup and restore | NOT VERIFIED | A safe isolated restore target was unavailable. Restore procedure is documented below. |
| Physical camera and tablet | NOT VERIFIED | Complete the device checklist below at an HTTPS pilot outlet. |
| Performance / plan capacity | NOT VERIFIED | No target-plan load or throughput test was run. |

### Hostinger compatibility matrix

| Component | Documentation / local evidence | Target environment status |
|---|---|---|
| Business Web Hosting | Hostinger currently lists Business Web Hosting for managed Node.js web apps. | Plan entitlement, app count, and actual resource limits require checking in the Owner's hPanel. |
| PHP / Laravel | Laravel requires PHP `^8.3`; local PHP 8.3.16 and Composer platform checks pass. Hostinger documents PHP 8.2–8.5. | Verify the selected PHP version and required extensions in the **web** runtime, not only CLI. Set `backend/public` as the document root. |
| Node / TanStack Start | Node 24.22.1 build, start, SSR routes, deep links, assets, and clean restart passed locally. `package.json` provides `npm start`; `package-lock.json` supports `npm ci`; Bun remains the local development tool. | Hostinger documents Node 18/20/22/24. TanStack Start is not explicitly listed among the managed framework examples; configure as `Other` if required and verify `.output/server/index.mjs` as the entrypoint in an authorized staging deployment. |
| MariaDB | Static migration review plus MySQL 9.7.1 integration tests; migrations use composite FKs, CHECK constraints, JSON functions, and transactional row locks. | Hostinger Web/Cloud uses MariaDB, but the account's version is unknown. Run fresh forward migrations and focused isolation/concurrency tests against a separate disposable MariaDB database before pilot. Verify rollback syntax separately; do not use `hadirinaja_dev`. |
| Private file storage | Laravel `local` disk points to `storage/app/private`; evidence tests verify validated, normalized images and protected retrieval. | Verify writable permissions and that private storage is outside the public document root. Confirm backup coverage for that directory. |
| GD / image processing | Local PHP 8.3.16 has GD; evidence validation tests pass. | Verify GD in Hostinger's web/CLI PHP versions and test a real upload and private retrieval. Configure upload limits above the app's 5 MB image limit (for example, `upload_max_filesize >= 6M` and `post_max_size >= 8M`). |
| Session / CORS / CSRF | Local configuration uses Sanctum stateful sessions, credentialed CORS with an explicit origin list, and `credentials: include`; `localhost:3000` is the supported local origin. `127.0.0.1:3000` was not compatible. | For separate HTTPS app/API subdomains, set exact app origin and Sanctum stateful host; set secure cookies and the shared parent cookie domain only if required. Verify CSRF, login, tenant switching, logout, and kiosk isolation on the real topology. Never use wildcard credentialed CORS. |
| HTTPS / domain | Local HTTP only. | Configure and verify TLS for both app and API hosts before sending session or kiosk credentials. |
| Cron / workers | Laravel queue is `sync`; no always-on worker, Redis, or WebSocket is a V1 requirement. | Hostinger documents no always-running background workers or inbound WebSockets. Keep long work out of HTTP requests; confirm any future scheduled task uses supported cron. |
| Shared resource limits | Reports are bounded to 31 days and 5,000 employee-workdays; CSV is capped at 500 filtered rows. | Hostinger documents a 120-second request limit and shared process/memory limits. No plan-specific performance result exists; check hPanel resource graphs during authorized staging and pilot. |

Provider references (checked 2026-10-23): [Node.js app deployment and supported plans/frameworks](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [Node.js versions](https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/), [Node.js plan limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/), [database engine](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/), [PHP versions](https://www.hostinger.com/support/1575755-how-to-change-the-php-version-of-your-hostinger-hosting-plan/), and [backup restoration](https://www.hostinger.com/support/4283700-how-to-restore-backups-at-hostinger/). MariaDB CHECK constraint syntax is documented in the [MariaDB constraints reference](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint). These references do not prove the Owner's plan configuration or app deployment.

## Future deployment blueprint — requires separate authorization

Anticipated topology: `app.example.com` for the TanStack Start Node app, `api.example.com` for Laravel, and the Hostinger MariaDB database. These are placeholders. Hostinger's documentation treats a Node subdomain as a separate website; confirm the existing domain/site arrangement before creating one.

1. Confirm Business plan Node.js entitlement, app slots, process/resource limits, PHP version/extensions, database version, custom document-root support, storage access, and backup coverage in hPanel.
2. Create separate app and API hostnames and TLS certificates only after authorization. Keep Laravel's `backend/public` as the only web-exposed backend directory; keep `.env`, `vendor`, logs, and `storage/app/private` out of public access.
3. Build the frontend from the committed npm lock with Node 24 using `npm ci` and `npm run build`. Configure the managed Node app's start command as `npm start` (which runs `node .output/server/index.mjs`). Do not use Bun as the production runtime. Verify the managed `Other` framework/entrypoint configuration because TanStack Start is not named in Hostinger's framework list.
4. Install backend Composer dependencies for production, configure the Laravel environment through protected hosting settings, create a dedicated MariaDB database/user, and verify the API health endpoint before onboarding. Set `APP_ENV=production`, `APP_DEBUG=false`, a protected `APP_KEY`, exact `APP_URL`, and production `LOG_LEVEL`; do not use `.env.example` values as production secrets.
5. Configure `CORS_ALLOWED_ORIGINS=https://app.example.com`, `SANCTUM_STATEFUL_DOMAINS=app.example.com`, `SESSION_SECURE_COOKIE=true`, `SESSION_SAME_SITE=lax`, and `SESSION_DOMAIN=.example.com` only for the two-subdomain cookie design. Keep HttpOnly enabled. Set `VITE_API_BASE_URL=https://api.example.com/api/v1` at frontend build time; it is public configuration and must contain no secret.
6. Set filesystem permissions for `backend/storage` and `backend/bootstrap/cache`; test private evidence write/read without making `storage/app/private` publicly reachable. Confirm upload size limits and GD in both CLI and web PHP.
7. Create a backup and verify an isolated restore plan before any production migration. Review migrations, then apply forward migrations only after a matching backup and explicit release approval. Do not run `db:seed` in production: the current default seeder creates a `test@example.com` user. Provision the first Owner with `php artisan hadirinaja:bootstrap-owner` from a trusted interactive server session; its password is prompted through hidden input. Never pass it as a command argument or put it in logs.
8. Verify public health, login, CSRF, authenticated API, tenant switching, scoped Supervisor access, personal and kiosk attendance, photo retrieval, logout, reporting, CSV, audit view, deep-link refresh, and process restart on the actual HTTPS topology. Review logs and resource usage. Keep the pilot closed until all external gates below pass and the Owner separately approves.

No deployment, hosting change, migration, or live data operation was performed for this assessment.

## Operational setup and pilot workflow

### Before first attendance

- Provision one Owner with the hidden-prompt bootstrap command above. Restrict the server session and retain the password only in the Owner's approved password manager.
- Verify the initial Tenant created by bootstrap; create the Business Unit and Outlet, then verify the outlet timezone and location policy.
- Add employee identities and memberships; grant Owner/Supervisor roles and explicit Outlet scopes. Verify each Supervisor sees only authorized Outlets.
- Configure shift templates, weekly schedules, date exceptions, and Tenant/Outlet policy overrides. Test an overnight shift and an unscheduled-work rule.
- Pair a dedicated kiosk for the intended Outlet. Deliver the one-time activation code through an approved private channel, enroll each Employee PIN on the paired kiosk, and verify device revocation before opening the kiosk to staff.
- Explain what kiosk photos are collected, their purpose, who can retrieve them, the approved retention period, and the incident contact before pilot use. The retention period is an Owner/legal decision; no automatic evidence or audit deletion is enabled by this runbook.

### Pilot acceptance sequence

1. Personal check-in and check-out; confirm server-authoritative time and the employee's own session.
2. Kiosk PIN check-in and check-out; verify a fresh camera capture for each event and private evidence retrieval by an authorized manager.
3. Hybrid flows in both directions (Personal → Kiosk and Kiosk → Personal); retry the same request after an intentionally interrupted response and confirm no duplicate event.
4. Overnight and unscheduled shifts; verify work date, outlet timezone, and effective schedule.
5. Missing checkout; submit and independently approve/reject a correction; compare original and effective attendance and confirm finalization behavior.
6. Reports and CSV: exercise date, status, employee, and outlet filters; verify totals and rows agree, the CSV is tenant/outlet scoped, and more than 500 matching rows are rejected explicitly.
7. Audit investigation: verify actor, action, time, and source record. Historical assignment rows with no actor remain “Not recorded”; do not backfill an inferred person.
8. Revoke the kiosk and confirm it can no longer authenticate. Verify logout and session expiration on Owner/Supervisor devices.

### Device acceptance — pending physical hardware

On the actual supported tablet and HTTPS Outlet network, record device model/OS/browser, app build, test time, Outlet, and pass/fail evidence for: camera prompt and permission; fresh check-in and check-out photos (no gallery substitution in the normal flow); PIN; double-submit; kiosk/Owner session separation; device revocation; denied permission; missing camera; network interruption and idempotent recovery; both hybrid directions; authorized private evidence retrieval; camera stream cleanup; readability/usability at the kiosk position. Do not attach employee images to general support tickets. A failed case blocks kiosk pilot use.

## Operations, recovery, privacy, and retention

### Logs and incident handling

- Inspect Laravel's application log and the Hostinger Node app log using the provider console. Record timestamp, request/correlation identifier if available, route, sanitized error, affected tenant/outlet, and operator action; do not copy passwords, PINs, cookies, authorization headers, private session tokens, full request bodies, or unnecessary location data into tickets.
- In production set `APP_DEBUG=false`; keep stack traces out of HTTP responses. Keep attendance/API responses private and non-cacheable. Do not put authenticated SSR responses behind shared page/CDN caching until user/session isolation is verified on the actual host.
- For a failed or uncertain attendance response, check the authoritative session/event and reuse the same idempotency key for the same operation; do not submit a new logical event until its outcome is known. Escalate repeated deadlocks, mismatched report totals, evidence access failures, or revoked-device access to the Owner and preserve audit records.
- If the network or camera is unavailable, the system has no offline attendance mode. Use only a separately approved manual fallback; reconcile through the application's correction/approval workflow and preserve the actual reported time and provenance. Do not fabricate server timestamps or delete audit history.

### Backup and restore procedure — not rehearsed

1. Set Owner-approved recovery point (RPO), recovery time (RTO), retention duration, encryption, and backup access roles before pilot. Confirm the backup includes both the MariaDB database and `backend/storage/app/private` evidence, plus deployment configuration without exposing secrets.
2. Take/identify a consistent database + private-file backup and record its timestamp and integrity metadata. Hostinger documents restoring files and databases separately; choose a matching snapshot time for both.
3. Restore only into a separately isolated, disposable environment. Never validate by overwriting `hadirinaja_dev`, `hadirinaja_test`, another project, or production.
4. Verify migration state, representative attendance/event/audit rows, private evidence metadata and retrieval authorization, login/tenant scope, health endpoint, and report reconciliation. Record restore duration and discrepancies.
5. Keep restored test data private and securely remove the isolated copy only under its approved cleanup process. Do not declare recovery ready until the Owner has witnessed and accepted a successful rehearsal.

### Retention decisions required

The application stores attendance records, kiosk evidence, approvals, and audit provenance. No automatic retention/deletion policy for legitimate evidence or audit history was added. Owner/legal review must set evidence, attendance, audit, and export-metadata retention periods, privacy notice, access roles, deletion/hold procedure, and session lifetime. Temporary evidence staging cleanup is not a substitute for a retention policy. Laravel session lifetime is currently 120 minutes; verify expiry and cleanup on the target environment.

### Rollback and release safety

- Keep a reviewed copy of the previous application artifact and a matching pre-release database/private-file backup.
- Roll application code back only after confirming schema compatibility. Use forward-compatible migration plans; do not blindly run `migrate:rollback` or restore only one half of the database/evidence pair.
- If data integrity is uncertain, stop attendance writes and escalate to the Owner. Preserve logs and audit data. Resume only after reconciliation and an explicit operational decision.

## Known product restrictions

- Online-only attendance; no offline synchronization.
- No payroll or salary calculation.
- No face recognition.
- No mandatory Personal selfie; kiosk attendance requires fresh photo evidence.
- No automatic final absence marking.
- Reports are limited to 31 days and 5,000 employee-workdays; CSV exports are limited to 500 matching filtered rows and reject overflow.
- Hostinger plan compatibility, managed TanStack Start SSR, actual MariaDB behavior, target backup recovery, and physical camera behavior remain unverified until tested in the Owner-authorized environments.

## Owner decisions and next gates

- **Before authorized staging:** confirm exact Hostinger plan and limits, API/app domains, PHP web version/extensions/document root, MariaDB version, private storage and backup coverage, HTTPS/cookie topology, and an isolated disposable MariaDB/restore target.
- **Before pilot:** pass fresh-migration and focused concurrency/isolation tests on that MariaDB; test real Hostinger Node 24 start/SSR/restart and PHP API; complete HTTPS/auth/tenant/kiosk smoke; rehearse database + private-file restore; complete physical-device acceptance; select retention/RPO/RTO and fallback policy; then provide explicit Owner pilot authorization.
- If Hostinger cannot run the documented Node entrypoint or keep private Laravel storage outside the public root, stop and reassess hosting topology before any upload.
