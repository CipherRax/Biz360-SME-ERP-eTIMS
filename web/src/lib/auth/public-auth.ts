import { ApiError } from '@/lib/api/http';

type Envelope<T> = {
  success: boolean;
  message: string;
  errors?: Array<{ message: string; path?: string }>;
  data: T | null;
};

/**
 * Posts to a same-origin `/api/auth/*` route handler. The Next server forwards
 * to the backend, so these public auth flows work regardless of the backend's
 * CORS allowlist. Errors surface as {@link ApiError} just like the API client.
 */
async function postPublicAuth<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    envelope = null;
  }

  if (!res.ok || !envelope || !envelope.success) {
    throw new ApiError(
      res.status,
      envelope?.message || 'Something went wrong. Please try again.',
      envelope?.errors ?? [],
    );
  }

  return envelope.data as T;
}

export function verifyEmail(token: string): Promise<{ message: string }> {
  return postPublicAuth('/api/auth/verify-email', { token });
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return postPublicAuth('/api/auth/password/forgot', { email });
}

export function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return postPublicAuth('/api/auth/password/reset', { token, newPassword });
}
