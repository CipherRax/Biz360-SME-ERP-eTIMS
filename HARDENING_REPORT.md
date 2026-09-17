# Production Hardening Report

A systematic audit of the Biz360 SME ERP + eTIMS (KRA) API against a
production-readiness checklist, plus the fixes applied in this pass.

Legend: ✅ done · ⚠️ partial / residual risk · ❌ not done (planned or accepted)

Test evidence at time of writing: 35 unit tests, 110 e2e tests passing,
`nest build` clean, `oxlint` clean.

---

## 1. Server bootstrap & transport (`src/main.ts`)

| Check | Status | Notes |
| --- | --- | --- |
| CORS fail-closed | ✅ | Empty `CORS_ORIGINS` in production aborts startup instead of falling back to `*`. Non-production still defaults to `*` for local tooling. |
| Swagger gated | ✅ | `/api/v1/docs` is only mounted when `NODE_ENV !== 'production'`. |
| Helmet | ✅ | Enabled with a strict CSP (`default-src 'self'`) in production; relaxed in dev. `crossOriginEmbedderPolicy` disabled for API ergonomics. |
| Body size limits | ✅ | `useBodyParser('json', { limit: '1mb' })` rejects oversized payloads. |
| Graceful shutdown | ✅ | `app.enableShutdownHooks()` — in-flight requests / outbox dispatches drain on SIGTERM/SIGINT. |
| Global prefix + validation pipe | ✅ | `Whitelist` + `forbidNonWhitelisted` + `transform` on all routes. |

## 2. Authentication & authorization

| Check | Status | Notes |
| --- | --- | --- |
| Global JWT guard | ✅ | Every route authenticated unless `@Public()`. |
| JWT issuer/audience/algorithms | ✅ | Tokens signed with `issuer: biz360-erp`, `audience: biz360-erp-api`, `HS256` only; strategy verifies all three. |
| Refresh-token rotation + reuse detection | ✅ | Rotates per use; replay revokes the whole family. |
| User status on every request | ✅ | `JwtAuthGuard` re-checks `status = ACTIVE` + `deletedAt IS NULL` from the DB per request, so suspensions take effect immediately (not at token expiry). |
| Account lockout | ✅ | After `AUTH_LOGIN_LOCKOUT_THRESHOLD` failed logins the account is locked for `AUTH_LOGIN_LOCKOUT_MS`; counters reset on success. Login is also IP-throttled. |
| Password hashing | ✅ | Argon2id. |
| API key auth | ✅ | `erp_` keys validated on every use; presented as `READ_ONLY`. |
| API key *scopes* enforced per-route | ⚠️ | Scopes are carried but route-level enforcement still keys off `@Roles()`. Fine-grained scope checks are future work. |
| RBAC via `@Roles()` | ✅ | Admin/Manager/Accountant write routes gated; STAFF read-only. |
| Development verification-token leak | ✅ | `devVerificationToken` returned only in `development`/`test` (removed for staging too). |
| `ParseUUIDPipe` on session route | ✅ | `DELETE /auth/sessions/:id` now rejects malformed IDs early. |
| SSRF-safe eTIMS trigger | ✅ | `POST /etims/sales/:id/trigger` scoped to the caller's org; UUID validated. |

## 3. Tenant isolation & data integrity

| Check | Status | Notes |
| --- | --- | --- |
| Global tenant scoping (`TENANT_MODELS`) | ✅ | Prisma extension auto-injects `organizationId` on create/read/update/delete via the request scope. |
| Scoping of `findUnique`/`aggregate` | ⚠️ | Extension covers list/detail/update paths; raw `findUnique` on related models is not auto-scoped. Enforce org checks in queries (done in controllers/feeds reviewed). |
| Soft deletes (`SOFT_DELETE_MODELS`) | ✅ | `user.deletedAt` respected by the extension and login/guard. |
| Audit columns | ✅ | `createdBy`/`updatedBy` + AuditLog via interceptor. |
| Money as `Decimal` | ✅ | No floating-point money anywhere. |

## 4. Reliability: outbox worker (`src/events/outbox`)

| Check | Status | Notes |
| --- | --- | --- |
| Transactional enqueue | ✅ | Side-effects are written in the same DB transaction as the state change. |
| At-least-once, atomic claim | ✅ | `PENDING → PROCESSING` with re-read to skip rows another worker claimed (TOCTOU-safe). |
| Retry with exponential backoff | ✅ | Attempts incremented, `nextAttemptAt` backed off, `FAILED` at `maxAttempts`. |
| Stale-PROCESSING reaper | ✅ | Rows stuck in `PROCESSING` past `OUTBOX_STALE_PROCESSING_MS` are reclaimed to `PENDING` (or `FAILED` once exhausted) so a crashed worker can't strand events forever. |
| In-flight dedupe | ✅ | Partial unique index `outbox_events_inflight_aggregate_unique` on `(organizationId, aggregateType, aggregateId, eventType) WHERE status IN (PENDING, PROCESSING)` prevents duplicate KRA submissions under concurrency. |
| Decoupled polling (DB, no BullMQ broker) | ⚠️ | Poll-based worker is fine for this scale; a broker (BullMQ/SQS) is the path if latency/backpressure becomes a problem. |

## 5. eTIMS (KRA) integration

| Check | Status | Notes |
| --- | --- | --- |
| HTTP timeouts | ✅ | `ETIMS_TIMEOUT_MS` (10s default) on every call. |
| Idempotent submission | ✅ | Concurrent triggers are deduped by the outbox partial index. |
| Circuit breaker / provider health flag | ⚠️ | Not implemented — repeated KRA timeouts still burn attempts before backoff. Recommended: trip to `disabled`, surface in `/health` and `/etims/status`. |
| Drift detection / reconciliation job | ❌ | No scheduled job reconciles KRA state vs. local `etimsSubmittedAt` on outages. Recommended before real traffic. |
| Config validation | ✅ | `/etims/status` reports missing `taxPin`/device serial/live config. |
| M-Pesa / STK push payments | ❌ | Out of scope for this pass — payment module is cash/bank-transfer only. |

## 6. Error handling & observability

| Check | Status | Notes |
| --- | --- | --- |
| Global exception filter | ✅ | Uniform `{ success, data, message, errors }` envelope + correlationId. |
| No stack traces leaked | ✅ | 500s return a generic message; details only in pino logs (with `err` object). |
| Prisma → HTTP translation | ✅ | `P2002` → 409, `P2025`/`P2023` → 404, `P2003` → 409, other codes → generic 500. |
| No raw SQL exposure | ✅ | Prisma queries; no raw SQL in request paths. |
| Correlation IDs | ✅ | Middleware + pino `genReqId`. |
| Health checks | ⚠️ | Terminus basics present; no deep checks (outbox lag, KRA reachability). Recommended: add explicit `liveness`/`readiness`. |
| Structured logging | ✅ | pino; `req.headers.authorization` and `cookie` redacted. |

## 7. Database & schema

| Check | Status | Notes |
| --- | --- | --- |
| Migrations versioned | ✅ | Prisma migrations; DB in sync. |
| `organizationId` indexes | ✅ | Added on `email_verification_tokens` and `password_reset_tokens` (already present on `refresh_tokens`, outbox, idempotency, etc.). |
| Connection pooling | ⚠️ | Single Prisma client; scale out with PgBouncer in transaction-pooling mode if replicas multiply. |
| Partial-index drift caveat | ⚠️ | The outbox partial index lives only in SQL (Prisma DSL has no partial indexes); `prisma migrate diff` will report it as drift. Do not let tooling drop it. |

## 8. Config & secrets

| Check | Status | Notes |
| --- | --- | --- |
| Boot-time Joi validation | ✅ | Fails fast on missing/malformed vars. |
| `.env` gitignored | ✅ | `.env` + `.env.local` ignored. |
| Secure defaults documented | ✅ | See updated `.env.example` (random secrets via `openssl rand -base64 48`, CORS guidance). |

---

## Before You Go Live (checklist)

1. `NODE_ENV=production`, and set `CORS_ORIGINS` to your real frontend origin(s) — the app refuses to start otherwise.
2. Generate fresh `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (`openssl rand -base64 48`); never reuse dev values.
3. Keep `EMAIL_VERIFICATION_REQUIRED=true` and configure real `SMTP_*` (the outbox worker delivers the emails).
4. Decide eTIMS mode: for `live`, provision KRA credentials (`ETIMS_CLIENT_ID`/`ETIMS_CLIENT_SECRET`), sign the device serial, and set the org's `taxPin`.
5. Set a sane `OUTBOX_STALE_PROCESSING_MS` (≥ 3× `ETIMS_TIMEOUT_MS`).
6. Monitor `OutboxEvent` for `FAILED` rows and `/health` for worker liveness before trusting financial automations.
7. Before real revenue flows, implement the eTIMS reconciliation job (section 5) and review the API-key scope matrix (section 2).
8. Run one worker even with N replicas (`OUTBOX_WORKER_ENABLED=false` on all but one) or wire a real broker.