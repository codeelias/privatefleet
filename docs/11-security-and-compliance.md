# 11 - Security & Compliance

**Status:** Draft v1 - for approval.
**Related:** [07.6](07-database-design.md) (RLS), [09.4](09-realtime-tracking.md) (socket authz), [06.4](06-driver-app-architecture.md) (offline commands).

## 11.1 Threat model (summary)

| Asset | Threat | Primary mitigations |
|-------|--------|---------------------|
| Tenant operational data | Cross-tenant read/write | App-layer roles on every endpoint (default deny); composite FKs; RLS with FORCE (three layers) |
| User sessions | Token theft/replay | Short-lived access JWTs; rotating refresh tokens with reuse detection; secure storage on device |
| Driver actions | Forgery, stale commands | Auth on every command; assignment + state validation; idempotency; no LWW |
| Tracking links | Guessing, replay, over-exposure | 256-bit random token, digest-only storage, expiry + revocation, job-scoped read-only DTO |
| POD media | Public exposure, tampering | Private buckets, short-lived presigned URLs per authorization, size/content checks, SHA-256 in DB |
| GPS stream | Spoofing, flooding | Device sessions + monotonic sequences, rate limits, accuracy/sanity checks |
| Socket abuse | Joining other tenants' rooms | Handshake auth; server-side room derivation from membership only |
| Service abuse | DoS, brute force | Rate limits on auth/tracking/public endpoints; payload caps; timeouts |
| Supply chain | Vulnerable deps, leaked secrets | Lockfiles + Renovate + `pnpm audit` in CI; env-injected secrets only |

A browser-supplied `tenant_id`, a WebSocket room name, or an HTTP header **never** establishes authority. The authenticated session and verified membership do.

## 11.2 Authentication

- Passwords hashed with Argon2id (`@node-rs/argon2`); login rate-limited; generic error messages.
- Access token: short-lived JWT (minutes). Refresh: rotating tokens - digest (SHA-256) stored in `refresh_tokens`, reuse of a rotated token revokes the whole family, expiry enforced.
- Driver app stores tokens in `expo-secure-store`; web app in memory + secure cookie path (decided at implementation; both supported by the same token flow).
- Roles (`owner`, `admin`, `dispatcher`, `driver`, `viewer`) gate endpoint capabilities; every protected route declares its minimum role in the module's `routes.ts`.

## 11.3 Tenant isolation (three layers, all mandatory)

1. **Application:** every handler resolves the tenant from the authenticated membership; URLs/bodies carrying tenant ids must match or are rejected.
2. **Schema:** composite foreign keys `(tenant_id, ...)` make cross-tenant references structurally impossible.
3. **Database:** RLS with `FORCE`, `app_runtime` role without bypass, transaction-local `app.current_tenant_id` (see [07.6](07-database-design.md)).

Integration tests explicitly probe cross-tenant denial on every layer ([12.3](12-testing-and-quality.md)).

## 11.4 Customer tracking & POD security

- `customer_tracking_links`: random 256-bit token; only its SHA-256 digest stored; expiry (default 7 days); revocation; single-job scope; `last_accessed_at` audit.
- The public endpoint (`/public/v1/tracking/{token}`) returns a **minimal DTO**: status timeline, ETA, completion flag. Driver/vehicle identity fields (name, photo, vehicle description) are opt-in per tenant via an explicit branding/privacy toggle - default off - and are the only additional fields the endpoint may expose; other jobs, internal notes, and dispatcher data are never included.
- A tracking token does **not** grant access to signatures/photos/sensitive notes - the POD vault is separately authorized to dispatcher/owner roles.
- Media: private bucket; upload via short-lived presigned PUT (size + content-type constrained); view via short-lived presigned GET issued only after authorization. DB stores keys + metadata, never public URLs.

## 11.5 Custom domains & white-label hosting

- Phase 1-pilot: branded subdomains (`customer.yourplatform.example`) only.
- Custom domains (Phase 6+): domain ownership verification -> tenant resolution from **verified** hostnames (Caddy on-demand TLS with an allowlist) -> every protected operation still authorized independently. An arbitrary `Host` header is never proof of tenant identity.

## 11.6 Data protection (UK GDPR posture)

- Lawful basis and data minimisation documented per processing purpose before pilot data collection.
- **Worker monitoring:** vehicle tracking is subject to ICO worker-monitoring guidance (transparency, proportionality, purpose limitation). Tracking is tied to on-duty shifts ([06.5](06-driver-app-architecture.md)) and disclosed to drivers.
- **Medical transport gate:** health-related data requires an Article 6 basis **plus** an Article 9 condition. Private medical transport processing is **blocked** until: a design partner exists, a DPIA is completed, special-category handling (retention, access, encryption) is implemented and reviewed. This gate is a hard phase requirement in [14](14-roadmap-and-gates.md).
- Retention schedules ([07.8](07-database-design.md)) and data export/deletion capabilities exist before the pilot stores real data.

## 11.7 Secrets & configuration

- Secrets are environment-injected only (CI/CD secret stores; `.env` files are git-ignored and never contain production values).
- No secrets in the repo, images, or logs. Rotation procedures documented with the deployment ([15](15-infrastructure-and-deployment.md)).

## 11.8 Supply chain & scanning

- Lockfiles committed; Renovate for dependency updates; `pnpm audit` (and container scanning when containers ship) in CI; minimal-dependency policy is a review criterion.
- Backups encrypted at rest and off-site ([15.5](15-infrastructure-and-deployment.md)).

## 11.9 Audit

- `job_events` is the immutable operational audit log; `command_receipts` records accepted commands; both carry actor + timestamps.
- Sensitive data (PII, media keys) is redacted from logs via the central pino redaction config.



