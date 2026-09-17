'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import type { QueryParams } from '@/types/api';

interface Identifiable {
  id: string;
}

export interface ListPageParams extends QueryParams {
  limit: number;
  cursor?: string;
}

export interface UseCursorListOptions {
  pageSize?: number;
  enabled?: boolean;
  /** Extra query params (filters/search) folded into the cache key. */
  filters?: QueryParams;
}

export interface CursorListResult<T> {
  items: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  isFetchingMore: boolean;
  refetch: () => void;
}

/**
 * Cursor pagination over the backend's `limit` + opaque `cursor` convention.
 * We infer `hasMore` from a full page and use the last item's id as the cursor
 * (backend orders by createdAt desc and returns the raw array).
 */
export function useCursorList<T extends Identifiable>(
  key: readonly unknown[],
  fetchPage: (params: ListPageParams) => Promise<T[]>,
  options: UseCursorListOptions = {},
): CursorListResult<T> {
  const pageSize = options.pageSize ?? 25;
  const { filters, enabled = true } = options;

  const query = useInfiniteQuery({
    queryKey: [...key, filters ?? {}],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const rows = await fetchPage({ limit: pageSize, cursor: pageParam });
      return {
        items: rows,
        nextCursor: rows.length === pageSize ? rows[rows.length - 1]?.id : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasMore: Boolean(query.hasNextPage),
    loadMore,
    isFetchingMore: query.isFetchingNextPage,
    refetch: () => void query.refetch(),
  };
}

export function LoadMore({
  hasMore,
  isLoading,
  onClick,
}: {
  hasMore: boolean;
  isLoading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="secondary" size="sm" onClick={onClick} disabled={isLoading}>
        {isLoading ? <Spinner className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Load more
      </Button>
    </div>
  );
}