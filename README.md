# SME ERP + eTIMS API

Multi-tenant SME ERP backend with Kenya Revenue Authority (KRA) eTIMS integration.
Built with **NestJS 12**, **Prisma 7**, **PostgreSQL**, and **Valkey/Redis**.

> Phase 1 — Foundation: multi-tenancy, auth + token rotation, RBAC, audit
> logging, outbox pattern, request/response envelopes, Swagger, health checks.

## Tech stack

- **Runtime/HTTP:** Node 24+, NestJS 12 (ESM, TypeScript strict)
- **Database:** PostgreSQL via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`)
- **Cache/Tokens:** Valkey/Redis (`ioredis`)
- **Auth:** JWT access tokens + opaque rotating refresh tokens (hashed at rest), Argon2id passwords
- **Validation:** `class-validator` + Joi env schema (fail-fast at boot)
- **Observability:** `nestjs-pino` structured logging, correlation IDs
- **API docs:** Swagger at `/api/v1/docs`
- **Tests:** Vitest (unit) + Supertest (e2e), oxlint

## Architecture highlights

- **Multi-tenant isolation** — a Prisma client extension injects `organizationId`
  (and `createdBy`/`updatedBy`) from a request-scoped `AsyncLocalStorage` into every
  query. Services cannot accidentally read or write across organization boundaries.
- **Soft deletes** — rows are excluded from reads/mutations automatically once
  `deletedAt` is set. Services perform logical deletes explicitly:
  `update({ data: { deletedAt: new Date() } })`.
- **Refresh token rotation** — every refresh issues a new token in the same family
  and revokes the old row. Reuse/expiry of a rotated token revokes the **entire family**
  (theft detection).
- **Outbox pattern** — side effects (email verification, password reset, and
  later eTIMS submissions/webhooks) are written to `outbox_events` inside the
  same transaction as the primary write. An **outbox worker** polls the table
  and dispatches to registered handlers with at-least-once semantics: atomic
  row claiming (safe for multiple instances), exponential backoff, and a hard
  failure state after max attempts.
- **API keys** — orgs expose machine-readable credentials (`erp_…`, hashed at
  rest) for eTIMS / webhook / external clients. Admin-managed with scopes and
  optional expiry.
- **RBAC** — `Role` enum (`ADMIN`, `MANAGER`, `ACCOUNTANT`, `STAFF`, `READ_ONLY`)
  enforced via guards, e.g. `@Roles(Role.ADMIN)`.
- **Audit trail** — `@Audit('User')` records actor/action/entity metadata to
  `audit_logs` for compliance-relevant mutations.
- **Response envelope** — every response is wrapped as
  `{ success, data, message, timestamp, errors }`.

## Prerequisites

- Node.js 20+ (24 recommended)
- PostgreSQL 15+
- Valkey or Redis

> Docker Compose (`docker-compose.yml`) starts Postgres 17 + Redis 8 if Docker is
> available; otherwise point `DATABASE_URL`/`REDIS_URL` at local services.

## Setup

```bash
npm install
cp .env.example .env   # then edit secrets (JWT secrets must be >= 32 chars)
```

Start infrastructure (or use your own Postgres/Redis):

```bash
docker compose up -d
```

Apply the schema and seed an admin user:

```bash
npx prisma migrate dev
npm run seed
```

Run migrations against a specific environment (Prisma 7 config file):

```bash
npx prisma migrate deploy
npx prisma migrate status
```

## Run

```bash
npm run start         # compiled mode (nest start)
npm run start:dev     # watch mode
npm run start:prod    # node dist/main.js
```

Prisma 7 generates the client at build time; regenerate after schema changes:

```bash
npm run db:generate
```

## Test & lint

```bash
npm test              # unit tests (Vitest)
npm run test:e2e      # e2e tests (require DB + services)
npm run lint          # oxlint
npx tsc --noEmit      # typecheck
```

## Health checks

| Endpoint        | Purpose                 |
| --------------- | ----------------------- |
| `/health`       | Overall liveness        |
| `/health/db`    | Prisma ↔ PostgreSQL     |
| `/health/redis` | ioredis ↔ Valkey/Redis  |

## Feature overview

| Area       | Endpoints (under `/api/v1`)                              |
| ---------- | -------------------------------------------------------- |
| Auth       | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/verify-email`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /auth/me` |
| Sessions   | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` |
| Users      | `GET /users` (ADMIN/MANAGER/ACCOUNTANT), `GET /users/me`, `GET /users/:id`, `PATCH /users/me`, `POST /users` (ADMIN), `PATCH /users/:id` (ADMIN), `DELETE /users/:id` (ADMIN) |
| API keys   | `POST /api-keys` (ADMIN), `GET /api-keys` (ADMIN), `DELETE /api-keys/:id` (ADMIN) |
| Inventory  | `GET/POST /items`, `GET/PATCH/DELETE /items/:id` (write: ADMIN/MANAGER), `GET/POST /items/categories`, `DELETE /items/categories/:id`, `GET/POST /items/units`, `DELETE /items/units/:id` |
| Parties    | `GET/POST /parties`, `GET/PATCH/DELETE /parties/:id` (write: ADMIN/MANAGER/ACCOUNTANT), filter `?type=CUSTOMER\|SUPPLIER\|BOTH&status=ACTIVE` |
| Sales      | `GET/POST /invoices`, `GET/PATCH /invoices/:id`, `POST /invoices/:id/confirm`, `POST /invoices/:id/void`, `POST /invoices/payments` (writes: ADMIN/MANAGER/ACCOUNTANT) — confirm decrements stock, void restores it, payments track receivables |
| Stock      | `POST /items/:id/stock`, `GET /items/:id/stock/movements`, `GET /inventory/stock/summary`, `GET /inventory/stock/movements` (write: ADMIN/MANAGER) — append-only movement ledger, valuation at cost, low-stock flags, org totals |
| eTIMS      | `GET /etims/status`, `POST /etims/sales/:id/trigger` (write: ADMIN/MANAGER/ACCOUNTANT) — confirm enqueues KRA E-TIMS submission via the outbox; `ETIMS_MODE=mock` (default) synthesizes receipts offline, `live` speaks the KRA TMS API; voiding a released invoice enqueues a credit note |
| Reporting  | `GET /reports/sales/summary`, `GET /reports/receivables`, `GET /reports/payables`, `GET /reports/top-items`, `GET /reports/dashboard` (any authenticated) — daily sales totals, open receivables/payables by party, top-selling items, KPIs (sales today/this month, stock valuation, low-stock and unsubmitted-eTIMS counts) |

## Utility scripts

`scripts/dev-server.sh` starts/stops/restarts the compiled server with a PID file:

```bash
./scripts/dev-server.sh start|stop|restart|status
```

## Outbox worker

`src/events/` implements an at-least-once dispatcher:

- `OutboxService.enqueue(tx, …)` — write a pending event inside your transaction.
- `OutboxWorker` — polls due rows (atomic PENDING→PROCESSING claim), dispatches
  to a handler, marks `DONE` on success, retries with exponential backoff,
  `FAILED` at `maxAttempts`.
- Register a handler per `OutboxEventType` (see `NotificationHandlerRegistrar`
  for the placeholder mail handler — swap in nodemailer/Resend when SMTP is set).

Config: `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`.

## Phase 2+ preview

Entities ready in the schema: `Organization`, `OrganizationSetting` (billing/preferences),
`ApiKey` (eTIMS), `OutboxEvent` (async workers, live). Planned: purchasing approvals,
multi-currency, quotes, credit management, XBRL filing. KRA eTIMS `live` mode,
idempotent webhook receipt of KRA responses, and shipped notification templates
(live mail handler) land once real credentials are configured.

## License

MIT. Create with `<3` at `opencode`.