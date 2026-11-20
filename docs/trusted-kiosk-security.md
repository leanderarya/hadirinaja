# Trusted kiosk V1 security contract

Owner approval in this conversation: maximum credential lifetime **30 days**, with minimal schema changes allowed in development/test. Production migration/deployment remains separately authorized. Historical rule: the kiosk GPS exception was approved. **Superseded for G02 checkout on 2026-11-05:** destination geofence and attendance-mode validation now apply to personal and kiosk checkout. Unrelated kiosk check-in policy remains unchanged.

## G02 checkout freeze — 2026-11-05

[Owner-authoritative Product Rules](product-rules-v1-flexible-attendance-shift-preference.md#owner-authoritative-freeze--2026-11-05) and [blueprint section 0](implementation-blueprint-v1-flexible-attendance-shift-preference.md#0-wp-01wp-02-documentation-freeze--2026-11-05) control checkout. This is a target contract, not a claim of deployed capability.

- Kiosk checkout destination is its authenticated paired Outlet; reject arbitrary destination selection. Employee needs an active Primary/Temporary assignment there at checkout time, same tenant, destination attendance mode and validated destination geofence. Pairing/cookie possession is not physical location proof. No assignment/geofence bypass follows from an Owner role.
- Permit closing an active session opened at another assigned Outlet without changing that session's Outlet, work date or one-active-session invariant. Revalidate device expiry/revocation and assignment/policy under transaction locks; keep PIN/photo controls.
- Record immutable destination, assignment basis, actor/device, server time, policy/timezone and actual geofence result separately from fixed session attribution. Include destination in idempotency/recovery identity; changed destination cannot reuse a key.
- Current implementation rejects other-Outlet sessions ([service](../backend/app/Services/AttendanceService.php#L502)) and submits null kiosk location ([controller](../backend/app/Http/Controllers/Api/V1/AttendanceController.php#L186)); these are implementation conflicts, not approved exceptions. Do not fabricate a verified verdict.
- Cross-Outlet evidence/review disclosure remains request-scoped under G17. **OPEN:** whether Checkout Destination independently qualifies as Actual Outlet for historical review. Checkout permission alone grants no such review/history permission.

Credential lease/rotation and historical test evidence below remain unchanged. No source, config, tests, DB or runtime changes were made by this freeze. Documentation reconciliation PASS with G17 reservation; implementation readiness NOT READY; G02 runtime acceptance UNVERIFIED.

## Credential lifecycle

- Pairing code: Owner-issued, tenant/Outlet-bound, single-use, five-minute server expiry.
- Device credential: random bearer token, SHA-256 hash stored on the device row; HttpOnly cookie scoped to `/api/v1/kiosk`, SameSite/session domain/Secure setting inherited from deployment configuration. Cookie lifetime and `credential_expires_at` are bounded to 30 days. Requests do not extend the lease.
- Missing expiry fails closed. Expired/revoked credentials are rejected before kiosk handlers and their cookie is cleared. Attendance persistence rechecks revocation, expiry and credential generation under a device row lock, including requests that passed middleware before a concurrent lifecycle change. Such failures leave a terminal rejected idempotency response, no attendance or evidence.
- An active browser must use a renewal code targeted at its registered device. A normal pairing code on an active browser, or a renewal code for a different active device, returns `409 kiosk_renewal_required` without consuming the code. A client that deliberately omits a bearer cookie cannot be identified as the same physical browser; this is not hardware attestation.
- Renewal: Owner supplies optional `device_id` to the existing pairing-code issuance endpoint. Tenant/Outlet/device ownership is validated. New pending renewal supersedes previous unused renewal codes for that device. Issuance does not extend credentials. Redeem rotates the hash on that device and sets expiry to server redeem time +30 days; device identity and original paired_at stay intact. Old token copies immediately fail lookup.
- Revoked devices cannot renew, including codes issued before revocation. Re-pairing after revocation creates a new device identity; old device and copied tokens remain revoked. Rotation and revocation are not undone by a pending code.
- Anyone with a valid token copy can still act as that logical device during its remaining lease, subject to PIN, assignment, image, mode and attendance checks. Renewal/expiry limit that risk; they do not bind a cookie to hardware or prove location.

## Durable audit and authorized views

Issuance and first revocation are committed atomically with append-only `management_change_events`. Their action (`issued`, `renewal_issued`, `revoked`) encodes successful outcome. Actor user/membership, tenant, Outlet, source ID and server timestamp are retained. Audit details expose `outcome: succeeded`, actor membership and device association, never token, code or credential hash.

For initial issuance, a device does not yet exist: subject is the pairing ID; after redemption its device association becomes available. For renewal, target device is available immediately. Issuer Owner is recorded as authorizing issuance, not as the unidentified person redeeming the code. Existing pairing `redeemed_at/device_id` links redemption to its device. Revocation retries do not duplicate the successful event. Failed/unauthorized attempts are HTTP rejections, not a new durable security-attempt journal.

Audit failure rolls back issuance/revocation and returns failure; do not treat an uncertain response as success. The existing UI recovery guard remains in effect. Attendance summaries identify kiosk device ID/name; detail lookup preserves tenant/Outlet authorization. No human actor is invented for device-origin attendance.

## Migration and rollout notes

`2026_11_01_000001_bound_kiosk_credentials` adds two nullable fields:

1. `kiosk_devices.credential_expires_at`; existing records backfilled to original paired_at +30 days, without restoring revoked devices or granting a fresh lease.
2. `kiosk_pairing_codes.renewal_device_id`; composite foreign key ensures tenant + device + Outlet binding.

Old devices paired more than 30 days ago will need Owner renewal. No grace period or automatic renewal is introduced. Review this effect before any separately authorized target migration. Null expiry is rejected. The migration is forward-only outside the isolated test database; do not roll it back on production to regain access.

This task exercises schema only on disposable `hadirinaja_test`, using its identity guard and a private pre-test backup. It does not migrate the main development database or production. A target must receive the approved migration before issuance/renewal endpoints use the new columns. Never infer target schema readiness from a green test schema.

## Image replay assessment

Required image/type/size/dimension validation remains. Before persistence, check-in and check-out reject a normalized image hash already retained for the same employee in the same tenant, including previous sessions and other devices. Employee row locking serializes attendance writes. Same-key idempotent retries return the original result. Rejections create no attendance event, session or evidence. No new digest retention is introduced: existing evidence expiry/tombstoning clears hashes; legal holds retain them.

This exact normalized-image comparison can reject legitimate identical frames and can be bypassed by cropping, re-encoding or otherwise changing pixels. It does not prove camera origin, employee identity, liveness or physical presence. Copied active bearer credentials remain usable until expiry, rotation or revocation; they are not hardware-bound.

Before release, separately verify target HTTPS/Secure cookie/origin settings, migration identity, managed Outlet tablet and profile access, actual camera/GPS/network recovery, backup/restore and evidence operations. Physical relocation remains an operational risk; the historical no-GPS policy does not satisfy G02 checkout geofence validation.
