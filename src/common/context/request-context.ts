import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestScope {
  correlationId?: string;
  /** Authenticated actor (null for anonymous / system calls). */
  userId?: string;
  /** Tenant scope for the current operation. */
  organizationId?: string;
  tokenVersion?: string;
}

/**
 * Correlates every DB mutation, log line and outbox dispatch with the request
 * that caused it. The Prisma extension reads tenant/actor identity from here so
 * row-level isolation and audit columns are applied implicitly.
 */
export const requestScope = new AsyncLocalStorage<RequestScope>();

export function getScope(): RequestScope | undefined {
  return requestScope.getStore();
}

export function scopeUser():
  | { userId: string; organizationId: string }
  | undefined {
  const scope = getScope();
  if (!scope?.userId || !scope.organizationId) return undefined;
  return { userId: scope.userId, organizationId: scope.organizationId };
}