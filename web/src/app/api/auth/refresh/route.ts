import { NextRequest, NextResponse } from 'next/server';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  refreshCookieOptions,
  sessionCookieOptions,
} from '@/lib/auth/cookies';
import { decodeAccessToken } from '@/lib/auth/jwt';
import { backendApiBase } from '@/lib/server/api-base';
import type { ApiEnvelope } from '@/types/api';
import type { RefreshResult } from '@/types/domain';
import type { SessionUser } from '@/lib/auth/session';

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(REFRESH_COOKIE, '', { ...refreshCookieOptions, maxAge: 0 });
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = NextResponse.json(
      { success: false, data: null, message: 'No active session', errors: [] },
      { status: 401 },
    );
    clearAuthCookies(response);
    return response;
  }

  const backendRes = await fetch(`${backendApiBase()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  const envelope = (await backendRes.json()) as ApiEnvelope<RefreshResult>;
  if (!backendRes.ok || !envelope.success || !envelope.data) {
    const response = NextResponse.json(envelope, { status: backendRes.status });
    clearAuthCookies(response);
    return response;
  }

  const { accessToken, refreshToken: rotated, expiresIn } = envelope.data;
  const claims = decodeAccessToken(accessToken);
  const user: SessionUser = {
    sub: envelope.data.user?.sub ?? claims?.sub ?? '',
    email: envelope.data.user?.email ?? claims?.email ?? '',
    role: envelope.data.user?.role ?? claims?.role ?? 'STAFF',
    orgId: envelope.data.user?.orgId ?? claims?.orgId ?? '',
  };

  const response = NextResponse.json({
    success: true,
    data: { accessToken, expiresIn, user },
    message: 'OK',
    timestamp: new Date().toISOString(),
    errors: [],
  });
  response.cookies.set(REFRESH_COOKIE, rotated, refreshCookieOptions);
  response.cookies.set(SESSION_COOKIE, JSON.stringify(user), sessionCookieOptions);
  return response;
}