// Backend response envelope — every endpoint returns exactly this shape.
export interface ApiErrorDetail {
  message: string;
  path?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message: string;
  timestamp: string;
  errors: ApiErrorDetail[];
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  /** Opaque cursor — pass to the next request as `cursor`. */
  nextCursor?: string;
}

// Backend list convention: `limit` + `cursor` (opaque id), ordered by
// createdAt desc. No pagination metadata is returned; the next cursor is the
// last item's id.
export interface ListQuery {
  limit?: number;
  cursor?: string;
}

export interface SearchListQuery extends ListQuery {
  search?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON body for mutations. Decimal-valued strings, not floats. */
  body?: unknown;
  query?: QueryParams;
  /** Client-generated UUID (see SECURITY.md) for financial mutations. */
  idempotencyKey?: string;
  /** Do not attempt a silent refresh on 401 (e.g. the login call itself). */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface ApiClientErrorShape {
  status: number;
  message: string;
  errors: ApiErrorDetail[];
  timestamp?: string;
}