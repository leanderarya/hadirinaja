# HadirinAja API

Laravel 13 API foundation for the HadirinAja TanStack Start frontend. API routes are versioned under `/api/v1`. This slice has no Blade frontend, login, token issuance, or business-domain modules.

## Runtime

- PHP 8.3 or newer with `pdo_mysql`, `mbstring`, `openssl`, `tokenizer`, `xml`, and `ctype`.
- Composer 2.
- MySQL or compatible MariaDB with InnoDB and `utf8mb4`.
- Bun for the existing frontend, which is controlled by the repository-root `bun.lock`.

Verified locally: Laravel 13.38.0, Composer 2.10.2 and backend tests on PHP 8.3.16, the HTTP smoke test on PHP 8.5.9, Bun 1.3.14, and MySQL 9.7.1 (Homebrew). Both PHP runtimes meet the minimum requirement. MariaDB compatibility is configured but has not been verified against a MariaDB server.

## Local setup

1. From the repository root, install the existing frontend lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

   The local frontend API base defaults to `/api/v1`. To make it explicit or override it, copy the root example to the ignored `.env` file and edit `VITE_API_BASE_URL`:

   ```sh
   cp .env.example .env
   ```

2. In a privileged local MySQL session, create the dedicated development schema and account. Replace the password placeholder with a password used only for this local account:

   ```sql
   CREATE DATABASE hadirinaja_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'hadirinaja_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-local-password';
   GRANT ALL PRIVILEGES ON hadirinaja_dev.* TO 'hadirinaja_app'@'127.0.0.1';
   ```

3. In the privileged local MySQL session, create a separate test schema and grant the local application account access to it:

   ```sql
   CREATE DATABASE hadirinaja_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   GRANT ALL PRIVILEGES ON hadirinaja_test.* TO 'hadirinaja_app'@'127.0.0.1';
   ```

   Laravel tests are pinned to this local schema and refuse to run against another database. Test setup may recreate tables in `hadirinaja_test`; it must never be pointed at `hadirinaja_dev`.

4. In `backend/`, copy the example file, set `DB_PASSWORD` to the local account password, install the locked Composer dependencies, and generate a local app key:

   ```sh
   cd backend
   cp .env.example .env
   composer install
   php artisan key:generate
   ```

   The example contains placeholders only. Real database credentials and the generated application key stay in the ignored `.env`.

5. Apply the forward migrations to the dedicated development schema, then start Laravel from `backend/`:

   ```sh
   php artisan migrate
   php artisan serve --host=127.0.0.1 --port=8000
   ```

6. In a second terminal at the repository root, start TanStack Start:

   ```sh
   bun run dev
   ```

7. Open `http://localhost:3000/api-health` and choose **Check API**. The browser uses the same-origin `/api` Vite proxy by default.
8. The API can also be checked directly at `http://127.0.0.1:8000/api/v1/health`.
9. Run backend tests from `backend/` with `composer test`. Run frontend checks from the repository root with `bun run typecheck`, `bun run check`, `bun run test`, and `bun run build`.

## API and frontend configuration

`GET /api/v1/health` returns HTTP 200 with `{"status":"healthy","checks":{"database":"available"}}` only after the configured MySQL connection completes `SELECT 1`. A database failure returns HTTP 503 with `{"status":"unhealthy","checks":{"database":"unavailable"}}`. Driver errors, credentials, paths, and stack traces are not returned.

The browser client in `src/lib/api.ts` reads the public `VITE_API_BASE_URL`. Its local default is `/api/v1`, forwarded by Vite to `http://127.0.0.1:8000`. For split-origin deployment, set the frontend build variable to an absolute API base such as `https://api.example.com/api/v1`. A `VITE_` variable is included in the browser bundle; do not place credentials or server-only secrets there.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of exact frontend origins. It defaults to `http://localhost:3000`; production must replace it with the deployed frontend origin. Credentialed CORS is enabled for this allowlist only; wildcard origins are not used. The Vite development server forwards both `/api/*` and `/sanctum/*` to Laravel.

## S1 organization and identity foundation

S1 stores a tenant-owned organization as `Tenant → Business Unit → Outlet`. Employees are separate from login Users; each User can have a distinct membership in multiple tenants. Tenant IDs use Laravel's unsigned 64-bit integer keys, and composite foreign keys keep organization, role, supervisor-scope, employee-link, and outlet-assignment relationships inside one tenant. S1 tables use InnoDB. User email is trimmed and lowercased; optional phone values are stored in canonical E.164 form with a unique index.

Owner, Supervisor, and Employee roles are assigned per membership. Owners manage their tenant. Supervisors can manage only explicitly scoped outlets. Employee links are explicit, one-to-one within a tenant, and do not infer identity from names or email. Primary and temporary outlet assignments keep effective-time history. Primary changes lock the employee row, close the previous interval, and reject overlapping primary history. An open-ended primary interval uses `9999-12-31 23:59:59` as its exclusive end sentinel.

S1 organization and identity operations remain application services; S2 exposes only the small authenticated management routes listed below. No public tenant, outlet, employee, membership, or role-management routes are registered.

## Authentication and session configuration

S2 uses Sanctum's first-party SPA session flow with Laravel's `web` guard. Browser mutations initialize `/sanctum/csrf-cookie` and send `X-XSRF-TOKEN`; Vite proxies that endpoint in local development. Session IDs are regenerated on login and tenant selection. Logout invalidates the session and rotates the CSRF token. Session and rate-limit state use the database driver so they work without Redis or a continuously running worker.

Set these values together for a future first-party deployment. The domains below are examples; replace them with the actual HTTPS frontend origin and parent cookie domain:

```dotenv
APP_URL=https://api.example.com
CORS_ALLOWED_ORIGINS=https://app.example.com
SANCTUM_STATEFUL_DOMAINS=app.example.com
SESSION_DOMAIN=.example.com
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax
SESSION_DRIVER=database
CACHE_STORE=database
```

The frontend's public `VITE_API_BASE_URL` may point to `https://api.example.com/api/v1`. Do not put credentials in `VITE_` variables. Cross-subdomain cookies require HTTPS and a shared registrable domain. Production domain, certificate, hosting configuration, and browser behavior have not been deployed or verified.

Run `php artisan hadirinaja:bootstrap-owner` from `backend/` once from a trusted interactive server session to create the first Owner and Tenant. It confirms before writing, accepts the password only through hidden prompts, validates the identity and password, and refuses to run when a tenant already exists. Do not pass passwords as command arguments. The command creates no default account during migrations or startup.

## S2 API inventory

Public application routes are limited to `GET /api/v1/health`, `POST /api/v1/auth/login`, and `POST /api/v1/kiosk/pair`. Login and pairing have independent IP and identity/code throttles. `GET /sanctum/csrf-cookie` is Sanctum's CSRF bootstrap endpoint.

Personal-session routes require Sanctum authentication: `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `GET /api/v1/auth/tenants`, and `POST /api/v1/auth/tenant`. Tenant selection is bound to the authenticated User's active membership; protected management routes re-read membership status and roles on every request.

Management routes require an authenticated session and active tenant membership: `GET /api/v1/management/organization`, `GET /api/v1/management/employees`, `GET /api/v1/management/employees/{id}`, `POST /api/v1/management/business-units`, `POST /api/v1/management/outlets`, `GET /api/v1/management/kiosks`, `POST /api/v1/management/kiosks/pairing-codes`, `POST /api/v1/management/kiosks/{id}/revoke`, and `POST /api/v1/management/employees/{id}/pin-enrollment`. Owner-only operations use existing S1 authorization services; employee and supervisor reads are outlet- or identity-scoped. Tenant and role authority are never accepted from request data.

Kiosk routes are separate from personal sessions. Pairing codes are single-use, expire after five minutes, and are stored as HMAC hashes. A paired device receives a random HttpOnly cookie scoped to `/api/v1/kiosk`; middleware resolves and checks revocation on every kiosk request. PIN enrollment codes expire after 15 minutes and are also stored as hashes. Employees enter and confirm their PIN on the paired kiosk; only a Laravel password hash is stored. PIN verification is restricted to the paired device's tenant and outlet, an active assignment, and a rate limit of five failures per device/employee in fifteen minutes. The Owner shares the one-time activation code with the intended employee; delivery remains an operational responsibility. PIN verification returns a limited identity result only; it does not create an employee session or record attendance.

Management and kiosk responses use `Cache-Control: private, no-store`. Personal sessions and kiosk cookies have distinct names and routes. Revoking a kiosk immediately invalidates its cookie at the next protected request. Login, pairing, and PIN credentials are not written to application logs by these flows.

## Hostinger Business considerations

- Laravel 13 requires PHP 8.3 or newer. Hostinger currently documents PHP 8.3–8.5 for Web hosting; confirm the actual plan and extensions before deployment.
- Hostinger documents MySQL and PDO MySQL support on Web hosting. The local integration was verified against MySQL 9.7.1; the production database version, privileges, and MariaDB compatibility remain untested.
- Hostinger Business supports Node.js web apps and currently lists Node 18, 20, 22, and 24. It does not support Bun for those apps, while this repository currently has only a Bun lockfile. The production frontend install/build workflow for Hostinger is unresolved.
- Hostinger managed Node.js apps do not support custom listening ports, inbound WebSockets, Docker, Redis services, or always-running workers. S0-B does not require those services. Production should use the configurable API origin rather than assume a reverse proxy.
- Deployment has not been attempted. Confirm Laravel's `public/` document root and rewrite setup, PHP extensions, Node build entry/output, database host and privileges, HTTPS, exact CORS origins, and future Sanctum cookie/CSRF settings before release.

Official references: [Laravel 13 release notes](https://laravel.com/docs/13.x/releases), [Hostinger PHP versions](https://www.hostinger.com/support/1575755-how-to-change-the-php-version-of-your-hostinger-hosting-plan/), [Hostinger supported databases](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/), [Hostinger Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), and [Hostinger Node.js limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/).

## Existing frontend baseline

Before S0-B changes, `bun run typecheck` reported 12 existing diagnostics in `src/components/footer.tsx`, `src/components/infrastructure-section.tsx`, `src/components/ui/spinner.tsx`, `src/routes/dashboard-1.tsx`, and `src/routes/dashboard-3.tsx`. `bun run test` exited because no frontend test files were configured. `bun run check` reported 158 errors and 12 warnings, including existing line-ending/format diagnostics. These are baseline findings; S0-B does not normalize line endings or edit Dashboard 3.
