import { api } from './http';
import type { CursorListParams } from './params';
import type { Party } from '@/types/domain';
import type { PartyInput } from '@/types/inputs';

export interface PartyListParams extends CursorListParams {
  type?: string;
  status?: string;
}

export const partiesApi = {
  list: (params: PartyListParams = {}) => api.get<Party[]>('/parties', { query: params }),
  get: (id: string) => api.get<Party>(`/parties/${id}`),
  create: (input: PartyInput, idempotencyKey?: string) =>
    api.post<Party>('/parties', input, { idempotencyKey }),
  update: (id: string, input: Partial<PartyInput>) => api.patch<Party>(`/parties/${id}`, input),
  remove: (id: string) => api.delete<void>(`/parties/${id}`),
  verifyKraPin: (id: string, idempotencyKey?: string) =>
    api.post<{ verified: boolean; party: Party }>(`/parties/${id}/kra-pin/verify`, undefined, {
      idempotencyKey,
    }),
};

export type { PartyInput };