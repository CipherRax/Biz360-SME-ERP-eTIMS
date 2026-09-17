import { NextRequest, NextResponse } from 'next/server';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  refreshCookieOptions,
  sessionCookieOptions,
} from '@/lib/auth/cookies';
import { backendApiBase } from '@/lib/server/api-base';

// Revokes server-side, then clears both cookies. Best-effort: we clear local
// state even if the backend call fails, so the user is never stuck "logged in".
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const authorization = request.headers.get('authorization');

  if (refreshToken) {
    try {
      await fetch(`${backendApiBase()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      // Ignore — cookie is cleared regardless.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(REFRESH_COOKIE, '', { ...refreshCookieOptions, maxAge: 0 });
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}