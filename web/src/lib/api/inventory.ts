import { api } from './http';
import type { DatedParams, CursorListParams } from './params';
import type {
  AccountType,
  Item,
  StockMovement,
  StockSummary,
  StockSummaryEntry,
} from '@/types/domain';
import type { ItemInput } from '@/types/inputs';

export interface ItemListParams extends CursorListParams {
  active?: boolean;
}

export interface MovementListParams extends CursorListParams {
  itemId?: string;
  type?: string;
  from?: string;
  to?: string;
}

export interface StockSummaryParams extends CursorListParams {
  categoryId?: string;
}

export interface CategoryInput {
  name: string;
  description?: string;
}

export interface UnitInput {
  name: string;
  symbol: string;
}

export const inventoryApi = {
  items: {
    list: (params: ItemListParams = {}) => api.get<Item[]>('/items', { query: params }),
    get: (id: string) => api.get<Item>(`/items/${id}`),
    create: (input: ItemInput, idempotencyKey?: string) =>
      api.post<Item>('/items', input, { idempotencyKey }),
    update: (id: string, input: Partial<ItemInput>) => api.patch<Item>(`/items/${id}`, input),
    remove: (id: string) => api.delete<void>(`/items/${id}`),
    adjustStock: (id: string, quantity: string, reason?: string, idempotencyKey?: string) =>
      api.post<{ movement: StockMovement; stockOnHand: number }>(
        `/items/${id}/stock`,
        { quantity, reason },
        { idempotencyKey },
      ),
    movements: (id: string, params: MovementListParams = {}) =>
      api.get<StockMovement[]>(`/items/${id}/stock/movements`, { query: params }),
  },
  categories: {
    list: () => api.get<Array<{ id: string; name: string; description?: string }>>('/items/categories'),
    create: (input: CategoryInput) => api.post<{ id: string; name: string }>('/items/categories', input),
    remove: (id: string) => api.delete<void>(`/items/categories/${id}`),
  },
  units: {
    list: () => api.get<Array<{ id: string; name: string; symbol: string }>>('/items/units'),
    create: (input: UnitInput) => api.post<{ id: string }>('/items/units', input),
    remove: (id: string) => api.delete<void>(`/items/units/${id}`),
  },
  stock: {
    summary: (params: StockSummaryParams = {}) =>
      api.get<StockSummary>('/inventory/stock/summary', { query: params }),
    movements: (params: MovementListParams = {}) =>
      api.get<StockMovement[]>('/inventory/stock/movements', { query: params }),
  },
};

export type { AccountType, StockSummaryEntry };
export type { DatedParams };
