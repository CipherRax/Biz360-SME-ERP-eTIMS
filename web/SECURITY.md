# Biz360 SME ERP — Frontend Security

This documents how the Next.js frontend protects credentials, sessions, and
financial mutations, and how it complements the NestJS backend hardening. The
backend remains the source of truth for authentication and authorization; every
control here is **defense in depth**.

## Threat model (in scope)

- Token theft via XSS or malicious extensions.
- Session hijacking / replay of refresh tokens.
- CSRF against cookie-bearing endpoints.
- Unauthorized route access by a lower-privileged role.
- Duplicate financial actions from double-clicks or network retries.
- Clickjacking, MIME sniffing, and other header-level attacks.

## Session & token handling

The refresh token is the long-lived secret. It **never** touches JavaScript.

| Cookie | Contents | Flags |
| --- | --- | --- |
| `erp_refresh` | Opaque refresh token | `httpOnly`, `SameSite=Lax`, `Secure` in prod, `path=/`, 30d |
| `erp_session` | `{ sub, email, role, orgId }` (non-secret claims for edge gating) | `httpOnly`, `SameSite=Lax`, `Secure` in prod, `path=/`, 30d |

- **Access token lives in memory only** (`src/lib/auth/access-token.ts`). It is
  never written to `localStorage`, `sessionStorage`, or a readable cookie, so a
  DOM-injection attack cannot exfiltrate it.
- **Silent refresh** (`src/lib/auth/session.ts`) exchanges the httpOnly refresh
  cookie for a new access token, deduplicating concurrent 401s into a single
  in-flight request. Access tokens are short-lived and refreshed transparently.
- **Bootstrap:** on a full reload the app calls `/api/auth/refresh`; if it fails,
  the user is anonymous. `AuthProvider` also schedules a **20-minute idle
  logout**.
- All auth exchanges go through **Next route handlers** (`src/app/api/auth/*`),
  which hold the tokens, set the cookies (`HttpOnly`), and return only the
  access token + non-secret user descriptor to the client.

## API client

`src/lib/api/http.ts` is the only way the UI talks to the backend.

- Bearer access token attached per request; `credentials: 'omit'` (no ambient
  cookies cross-origin).
- On `401`: attempt one silent refresh, retry the original request once, then
  dispatch an `auth:unauthorized` event that signs the user out and redirects.
- `ApiError` exposes `status`, field errors, and rate-limit metadata so forms can
  surface the backend's message verbatim.

## Authorization at the edge

`src/middleware.ts` runs before any protected page renders:

- Unauthenticated requests to a protected prefix are redirected to
  `/login?next=…`.
- Authenticated users hitting `/login`/`/register` are sent to `/dashboard`.
- **Role guards** reject route prefixes the role may not view
  (`/settings` → ADMIN; `/accounting`, `/purchases`, `/reports` → finance roles;
  etc.) and redirect to `/forbidden`.

Hidden navigation is not security — the edge guard runs even if a user types the
URL. The backend independently enforces the same RBAC on every API call, so a
bypassed edge guard still cannot read or mutate data.

## CSRF

- Data calls are same-origin `fetch` with a **Bearer header** and no cookies, so
  they are not CSRF-able.
- Cookie-bearing endpoints (`/api/auth/login|refresh|logout`) are same-origin,
  `POST`, and the cookies are `SameSite=Lax`. `/api/auth/logout` is the only
  state-changing cookie route reachable cross-site, and its worst case is a
  forced sign-out (no data exposure). Tokens are rotated on refresh and the
  backend revokes the presented refresh token.

## Content Security Policy & headers

Baseline headers are set in `next.config.mjs`; the edge middleware also emits a
CSP on matched HTML routes.

- `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (plus `'unsafe-eval'`
  in dev for the bundler), `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`.
- `connect-src` is limited to `'self'` plus the configured API origin.
- Also set: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` disabling camera/mic/geolocation/payment/usb,
  `X-DNS-Prefetch-Control: off`.

> **Why not a nonce?** Next.js hydration uses inline scripts, and a nonce-based
> policy requires every page to be dynamically rendered — on statically
> prerendered pages the request nonce cannot be injected into prebuilt HTML, so
> scripts would be blocked in production. Since token storage is already
> httpOnly/in-memory and the app never renders user-supplied HTML, we accept
> `'unsafe-inline'` for scripts while keeping every other directive strict.

## Financial mutation integrity

Every create/confirm/void/payment/journal call sends a client-generated
`Idempotency-Key` (`src/lib/utils/idempotency.ts`). Combined with the backend's
24-hour idempotency cache and in-flight outbox uniqueness, a double-click or a
retried request cannot produce a duplicate invoice, payment, or journal entry.
Mutation buttons stay disabled (`loading`) while in flight.

## Environment & secrets

- Only `NEXT_PUBLIC_*` values reach the browser. The backend origin for route
  handlers is the server-only `API_BASE_URL` and is never inlined.
- `.env*` is gitignored; `.env.example` documents every variable. No secret is
  ever committed, logged, or rendered.

## What the frontend does NOT do

- It does not verify JWTs — it decodes claims **without** trusting them, using
  them only for display and edge gating. The backend verifies signatures.
- It does not store the refresh token in JS or make it readable by scripts.
- It is not the authority on permissions; the API is.

## Verification

- Unit tests: `npm test` (Jest + RTL).
- E2E hardening suite: `npm run test:e2e` (Playwright) covers unauthenticated
  redirects, security headers, the Staff-blocked-from-Settings guard, and
  duplicate-submission prevention. Authenticated specs require `E2E_*`
  credentials (see `.env.example`) and a running backend.
