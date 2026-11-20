# Static SPA runtime

HadirinAja uses TanStack Start's official SPA mode. Node 24 is a **build tool**; the production frontend consists of static files. Laravel remains the only application backend. Nitro may still generate a server bundle for build/prerender tooling; that bundle is not deployed for this topology.

## Build and publish

1. Install the existing npm lock with Node 24: `npm ci`.
2. Supply `VITE_API_BASE_URL` at build time, pointing to the separately hosted Laravel `/api/v1` origin. It is public configuration; never include secrets. Use an actual authorized hostname for deployment. The localhost build used in the PoC is not a production artifact.
3. Run `npm run build`. Publish **only `.output/public/`**, including its hidden `.htaccess`, `_shell.html`, assets and fonts.
4. Serve that directory with a static web server. Do not run `npm start`, Vite, or `.output/server/index.mjs` in this topology. The existing `start` script is the legacy Node adapter, not the static production startup command.
5. Confirm `/`, refreshed deep links and asset MIME types. Publish HTML and its matching hashed assets together; keep prior hashed assets available during a safe transition for already-open clients. Revalidate the shell rather than indefinitely caching it.

The frontend `.htaccess` is for a **separate static document root**. Do not copy it over Laravel's `public/.htaccess`. It deliberately does not proxy `/api` or `/sanctum`; configure the browser to call the actual API origin. The local PoC serves Apache on localhost:3000 and Laravel on localhost:8000, without a Node request handler.

## Fallback contract

- `/` uses `_shell.html` as DirectoryIndex.
- Existing files/directories are served normally.
- `/api`, `/sanctum` and `/_serverFn` are excluded from SPA fallback, even when the client accepts HTML.
- Missing `/assets/*` and file-like paths remain errors.
- Only GET/HEAD document navigation accepting `text/html` may fall back to the shell. JSON requests and POST requests to nonexistent route paths do not receive a fallback.
- Apache must allow the Options, DirectoryIndex and rewrite directives used by the supplied file, including disabling MultiViews. Verify the actual LiteSpeed/Apache hosting configuration instead of ignoring rewrite errors.

## Laravel and security

Keep Laravel's public document root, private environment, vendor and private evidence storage separate from the static frontend. Evidence stays under Laravel private storage and is retrieved through authorized API endpoints. Session, tenant/Outlet authorization, geofence, kiosk expiry/revocation, PIN, idempotency and image validation continue to execute in Laravel.

For an HTTPS app/API subdomain topology under the same trusted parent domain, verify exact CORS origin, Sanctum stateful host, credentials, readable XSRF cookie, appropriate cookie domain and SameSite policy. Enable Secure and HttpOnly for session/kiosk cookies. Do not broaden CORS or change to bearer auth to work around a configuration failure. Kiosk cookie path remains `/api/v1/kiosk`. Protected-evidence links resolve against the configured API base and use `noopener` with `strict-origin` referrer policy: the API receives only the trusted origin needed by Sanctum stateful authentication, without exposing the page path/query or granting opener access.

Camera and geolocation require a secure context: localhost is a local exception, not proof of deployed HTTPS. Session expiry, login/logout, tenant switching, camera upload, protected evidence, reports/CSV and network recovery must be tested on the final hostname.

## Hostinger Premium preflight

Static SPA + Laravel can fit a PHP/HTML hosting topology without managed Node hosting. Actual account capability remains unverified. Before any separately authorized deployment, verify PHP >=8.3 (web and CLI), GD/fileinfo/PDO and other Composer requirements, document roots, private storage and upload limits, HTTPS, cron, database version/privileges/SQL mode, resource limits and backup/restore.

The scheduler still runs evidence-hold expiry and conditionally evidence expiration. Configure and verify Laravel `schedule:run` using the host's PHP binary. Existing V1 source does not require a persistent queue worker; the example environment uses `QUEUE_CONNECTION=sync`. Do not introduce a queue-worker dependency as part of SPA conversion.

Hostinger uses MariaDB; local MySQL success does not establish migration/locking compatibility. Preserve the prior release gates for legacy timestamp transition, schema compatibility, managed Outlet devices, backup/restore and Owner UX acceptance. This document does not authorize migration or deployment.

Official references:
- https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode
- https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/
- https://www.hostinger.com/support/which-file-transfer-and-server-access-options-are-supported-at-hostinger/
- https://laravel.com/framework/docs/13.x/sanctum
