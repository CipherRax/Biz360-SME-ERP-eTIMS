import { tokenStore } from './access-token';
import type { ApiEnvelope } from '@/types/api';
import type { Role } from '@/types/domain';

export interface SessionUser {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
}

// Deduplicate concurrent refresh attempts: if five API calls 401 at once we
// only hit the refresh endpoint once and everyone awaits the same promise.
let inFlight: Promise<SessionUser | null> | null = null;

async function requestRefresh(): Promise<SessionUser | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      tokenStore.clear();
      return null;
    }
    const json = (await res.json()) as ApiEnvelope<{
      accessToken: string;
      expiresIn: number;
      user: SessionUser;
    }>;
    if (!json.success || !json.data) {
      tokenStore.clear();
      return null;
    }
    tokenStore.set(json.data.accessToken, json.data.expiresIn);
    return json.data.user;
  } catch {
    tokenStore.clear();
    return null;
  }
}

/** Silently exchanges the httpOnly refresh cookie for a fresh access token. */
export function refreshSession(): Promise<SessionUser | null> {
  if (!inFlight) {
    inFlight = requestRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Revokes the refresh token server-side, then clears the cookie + memory. */
export async function endSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {}),
      },
    });
  } finally {
    tokenStore.clear();
  }
}