import { NextRequest, NextResponse } from 'next/server';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  refreshCookieOptions,
} from '@/lib/auth/cookies';
import { decodeAccessToken } from '@/lib/auth/jwt';
import { backendApiBase } from '@/lib/server/api-base';
import type { ApiEnvelope } from '@/types/api';
import type { TokenPair } from '@/types/domain';
import type { SessionUser } from '@/lib/auth/session';

type LoginEnvelope = ApiEnvelope<TokenPair>;

function attachCookies(response: NextResponse, refreshToken: string, user: SessionUser) {
  response.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
  response.cookies.set(SESSION_COOKIE, JSON.stringify(user), sessionCookieOptions);
}

export async function POST(request: NextRequest) {
  let credentials: { email?: string; password?: string };
  try {
    credentials = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, data: null, message: 'Invalid request body', errors: [] },
      { status: 400 },
    );
  }

  const backendRes = await fetch(`${backendApiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(credentials),
    cache: 'no-store',
  });

  const envelope = (await backendRes.json()) as LoginEnvelope;
  if (!backendRes.ok || !envelope.success || !envelope.data) {
    return NextResponse.json(envelope, { status: backendRes.status });
  }

  const { accessToken, refreshToken, expiresIn } = envelope.data;
  const claims = decodeAccessToken(accessToken);
  const user: SessionUser = {
    sub: claims?.sub ?? '',
    email: claims?.email ?? credentials.email ?? '',
    role: claims?.role ?? 'STAFF',
    orgId: claims?.orgId ?? '',
  };

  const response = NextResponse.json({
    success: true,
    data: { accessToken, expiresIn, user },
    message: 'OK',
    timestamp: new Date().toISOString(),
    errors: [],
  });
  attachCookies(response, refreshToken, user);
  return response;
}