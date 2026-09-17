import { api } from './http';
import type { CursorListParams } from './params';
import type { GoodsReceipt, Payment, PurchaseInvoice, PurchaseOrder } from '@/types/domain';
import type {
  GoodsReceiptInput,
  PurchaseInvoiceInput,
  PurchaseOrderInput,
  PurchasePaymentInput,
} from '@/types/inputs';

export interface PurchaseListParams extends CursorListParams {
  status?: string;
  partyId?: string;
}

export interface GoodsReceiptListParams extends CursorListParams {
  status?: string;
  partyId?: string;
  purchaseOrderId?: string;
}

export const purchasingApi = {
  purchaseOrders: {
    list: (params: PurchaseListParams = {}) =>
      api.get<PurchaseOrder[]>('/purchase-orders', { query: params }),
    get: (id: string) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
    create: (input: PurchaseOrderInput, idempotencyKey?: string) =>
      api.post<PurchaseOrder>('/purchase-orders', input, { idempotencyKey }),
    update: (id: string, input: Partial<PurchaseOrderInput>) =>
      api.patch<PurchaseOrder>(`/purchase-orders/${id}`, input),
    submit: (id: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/submit`),
    approve: (id: string, idempotencyKey?: string) =>
      api.post<PurchaseOrder>(`/purchase-orders/${id}/approve`, undefined, { idempotencyKey }),
    reject: (id: string, reason: string) =>
      api.post<PurchaseOrder>(`/purchase-orders/${id}/reject`, { reason }),
    cancel: (id: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`),
  },
  goodsReceipts: {
    list: (params: GoodsReceiptListParams = {}) =>
      api.get<GoodsReceipt[]>('/goods-receipts', { query: params }),
    get: (id: string) => api.get<GoodsReceipt>(`/goods-receipts/${id}`),
    create: (input: GoodsReceiptInput, idempotencyKey?: string) =>
      api.post<GoodsReceipt>('/goods-receipts', input, { idempotencyKey }),
    confirm: (id: string, input?: { receivedDate?: string; notes?: string }) =>
      api.post<GoodsReceipt>(`/goods-receipts/${id}/confirm`, input),
    cancel: (id: string) => api.post<GoodsReceipt>(`/goods-receipts/${id}/cancel`),
  },
  purchaseInvoices: {
    list: (params: PurchaseListParams = {}) =>
      api.get<PurchaseInvoice[]>('/purchase-invoices', { query: params }),
    get: (id: string) => api.get<PurchaseInvoice>(`/purchase-invoices/${id}`),
    create: (input: PurchaseInvoiceInput, idempotencyKey?: string) =>
      api.post<PurchaseInvoice>('/purchase-invoices', input, { idempotencyKey }),
    update: (id: string, input: { invoiceDate?: string; notes?: string; supplierRef?: string }) =>
      api.patch<PurchaseInvoice>(`/purchase-invoices/${id}`, input),
    confirm: (id: string, idempotencyKey?: string) =>
      api.post<PurchaseInvoice>(`/purchase-invoices/${id}/confirm`, undefined, { idempotencyKey }),
    void: (id: string, reason?: string, idempotencyKey?: string) =>
      api.post<PurchaseInvoice>(`/purchase-invoices/${id}/void`, { reason }, { idempotencyKey }),
    recordPayment: (input: PurchasePaymentInput, idempotencyKey?: string) =>
      api.post<Payment>('/purchase-invoices/payments', input, { idempotencyKey }),
  },
};