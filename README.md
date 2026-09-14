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
- **Outbox pattern** — side effects (e.g. email verification) are written to
  `outbox_events` in the same transaction as the primary write; a worker (later phase)
  publishes them. No external calls happen inline.
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

## Utility scripts

`scripts/dev-server.sh` starts/stops/restarts the compiled server with a PID file:

```bash
./scripts/dev-server.sh start|stop|restart|status
```

## Phase 2+ preview

Entities ready in the schema: `Organization`, `OrganizationSetting` (billing/preferences),
`ApiKey` (eTIMS), `OutboxEvent` (async workers). Planned: items/inventory, sales,
KRA eTIMS invoice submission, idempotent receipt of KRA responses.

## License

MIT. Create with `<3` at `opencode`.