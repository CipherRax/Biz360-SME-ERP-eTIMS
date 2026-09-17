import { api } from './http';
import type { EtimsStatus, EtimsTriggerResult } from '@/types/domain';

export const etimsApi = {
  status: () => api.get<EtimsStatus>('/etims/status'),
  /**
   * Re-queue a sale invoice for KRA submission. Idempotency-Key matters here:
   * without it, a network retry could double-enqueue. The backend also dedupes
   * in-flight submissions, but the client key is the first line of defense.
   */
  trigger: (invoiceId: string, idempotencyKey?: string) =>
    api.post<EtimsTriggerResult>(`/etims/sales/${invoiceId}/trigger`, undefined, {
      idempotencyKey,
    }),
};