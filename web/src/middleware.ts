import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/auth/cookies';
import type { Role } from '@/types/domain';

const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

// Any path not listed here and not an auth page is a protected app route.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/customers',
  '/suppliers',
  '/products',
  '/inventory',
  '/sales',
  '/purchases',
  '/accounting',
  '/etims',
  '/reports',
  '/settings',
];

// Role map enforced at the edge. Hidden nav links are not security — a Staff
// user typing an Admin URL must be turned away before any data fetch fires.
// (The backend enforces real RBAC independently; this is defense-in-depth.)
const ROLE_GUARDS: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: '/settings', roles: ['ADMIN'] },
  { prefix: '/etims/certificate', roles: ['ADMIN'] },
  { prefix: '/accounting', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/purchases', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/reports', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/sales', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'] },
];

interface SessionDescriptor {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
}

function parseSession(raw: string | undefined): SessionDescriptor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionDescriptor;
    if (!parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function requiredRoles(pathname: string): Role[] | null {
  const match = ROLE_GUARDS.find(
    (guard) => pathname === guard.prefix || pathname.startsWith(`${guard.prefix}/`),
  );
  return match ? match.roles : null;
}

function buildCsp(isDev: boolean): string {
  // Next.js hydration/bootstrapping uses inline scripts. A nonce-based policy
  // would force every page to dynamic rendering and, on statically prerendered
  // pages, the request nonce would not match the prebuilt HTML — breaking the
  // app. We therefore allow 'unsafe-inline' for scripts. XSS is mitigated at
  // the source: tokens are httpOnly/in-memory, and no user-supplied HTML is
  // rendered. Everything else stays strict.
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:3000 https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== 'production';

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  const isAuthenticated = Boolean(refreshToken && session);

  const redirectToLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return url;
  };

  if (!isAuthenticated && isProtected(pathname)) {
    return NextResponse.redirect(redirectToLogin());
  }

  if (isAuthenticated && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && session) {
    const allowed = requiredRoles(pathname);
    if (allowed && !allowed.includes(session.role)) {
      const url = request.nextUrl.clone();
      url.pathname = '/forbidden';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', buildCsp(isDev));
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
  ],
};