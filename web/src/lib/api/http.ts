import { tokenStore } from '@/lib/auth/access-token';
import { refreshSession } from '@/lib/auth/session';
import type { ApiEnvelope, ApiErrorDetail, RequestOptions } from '@/types/api';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  readonly status: number;
  readonly errors: ApiErrorDetail[];
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    message: string,
    errors: ApiErrorDetail[] = [],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get fieldErrors(): Record<string, string> {
    return this.errors.reduce<Record<string, string>>((acc, detail) => {
      if (detail.path) acc[detail.path] = detail.message;
      return acc;
    }, {});
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || !envelope.success) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '');
    throw new ApiError(
      response.status,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.errors ?? [],
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  return envelope.data as T;
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, idempotencyKey, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };

  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Financial mutations carry a client-generated UUID so the backend can
  // dedupe a retried request safely (see SECURITY.md).
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  return fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
    signal,
  });
}

/**
 * Single gateway for every authenticated API call. Behavior on 401:
 * attempt a silent refresh exactly once, retry the original request, and only
 * then surface the error (the auth provider listens for the thrown ApiError).
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawFetch(path, options);

  if (response.status === 401 && !options.skipAuth) {
    const user = await refreshSession();
    if (user) {
      response = await rawFetch(path, options);
    }
  }

  if (response.status === 401 && typeof window !== 'undefined') {
    // Refresh already failed (or was skipped): the session is dead. Let the
    // AuthProvider sign out and bounce to login instead of every caller
    // handling 401 individually.
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }

  return parseEnvelope<T>(response);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
} as const;