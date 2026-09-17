// Cookie names + options shared by Next route handlers (node) and middleware
// (edge). No secrets live here — the refresh cookie carries the token, the
// session cookie carries only display/role claims so the edge can gate routes.

export const REFRESH_COOKIE = process.env.AUTH_REFRESH_COOKIE ?? 'erp_refresh';
export const SESSION_COOKIE = process.env.AUTH_SESSION_COOKIE ?? 'erp_session';

export const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30d, matches backend

const isProduction = process.env.NODE_ENV === 'production';

// The refresh token: httpOnly so JS can never read it; Secure + SameSite=Lax
// so it is not sent on cross-site subrequests.
export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: REFRESH_MAX_AGE_SECONDS,
};

// Non-sensitive session descriptor (sub/email/role/orgId). httpOnly too, since
// only the edge middleware needs to read it — the client keeps user state in
// memory via /auth/me-equivalent refresh.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: REFRESH_MAX_AGE_SECONDS,
};