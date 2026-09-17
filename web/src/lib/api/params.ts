import type { QueryParams } from '@/types/api';

// Backend list convention: `limit` + opaque `cursor`, ordered createdAt desc.
export interface CursorListParams extends QueryParams {
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface DatedParams extends QueryParams {
  from?: string;
  to?: string;
  asOf?: string;
}