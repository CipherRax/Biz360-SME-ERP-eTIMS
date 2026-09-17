import { NextRequest, NextResponse } from 'next/server';
import { backendApiBase } from './api-base';

/**
 * Forwards a public (unauthenticated) auth POST to the backend from the Next
 * server. Keeping these calls same-origin means the browser never needs the
 * backend's CORS allowlist for auth, and the flow mirrors the login/register
 * route handlers. The backend envelope and status are passed through untouched
 * so the client keeps its existing ApiError handling.
 */
export async function proxyPublicAuthPost(
  request: NextRequest,
  path: string,
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, data: null, message: 'Invalid request body', errors: [] },
      { status: 400 },
    );
  }

  const authorization = request.headers.get('authorization');

  let backendRes: Response;
  try {
    backendRes = await fetch(`${backendApiBase()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        data: null,
        message: 'The server could not reach the API. Please try again.',
        errors: [],
      },
      { status: 502 },
    );
  }

  const text = await backendRes.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (payload === null) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        message: `Request failed (${backendRes.status})`,
        errors: [],
      },
      { status: backendRes.status },
    );
  }

  return NextResponse.json(payload, { status: backendRes.status });
}
