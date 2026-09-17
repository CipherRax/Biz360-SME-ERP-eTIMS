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
import type { TokenPair } from '@/types/domain';
import type { SessionUser } from '@/lib/auth/session';

interface RegisterResult {
  userId: string;
  organizationId: string;
  requiresEmailVerification: boolean;
  tokens?: TokenPair | null;
  devVerificationToken?: string;
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, data: null, message: 'Invalid request body', errors: [] },
      { status: 400 },
    );
  }

  const backendRes = await fetch(`${backendApiBase()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const envelope = (await backendRes.json()) as ApiEnvelope<RegisterResult>;
  if (!backendRes.ok || !envelope.success || !envelope.data) {
    return NextResponse.json(envelope, { status: backendRes.status });
  }

  const result = envelope.data;
  const response = NextResponse.json(envelope);

  if (result.tokens) {
    const { accessToken, refreshToken } = result.tokens;
    const claims = decodeAccessToken(accessToken);
    const user: SessionUser = {
      sub: claims?.sub ?? result.userId,
      email: claims?.email ?? '',
      role: claims?.role ?? 'ADMIN',
      orgId: claims?.orgId ?? result.organizationId,
    };
    response.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    response.cookies.set(SESSION_COOKIE, JSON.stringify(user), sessionCookieOptions);
    response.headers.set('x-session-established', 'true');
  }

  return response;
}