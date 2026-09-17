import { api } from './http';
import type { CursorListParams } from './params';
import type { CreditNote, Invoice, Payment, Quotation } from '@/types/domain';
import type {
  CreditNoteInput,
  InvoiceInput,
  PaymentInput,
  QuotationInput,
} from '@/types/inputs';

export interface InvoiceListParams extends CursorListParams {
  status?: string;
  partyId?: string;
}

export interface QuotationListParams extends CursorListParams {
  status?: string;
  partyId?: string;
}

export interface CreditNoteListParams extends CursorListParams {
  status?: string;
  partyId?: string;
}

export const salesApi = {
  invoices: {
    list: (params: InvoiceListParams = {}) => api.get<Invoice[]>('/invoices', { query: params }),
    get: (id: string) => api.get<Invoice>(`/invoices/${id}`),
    create: (input: InvoiceInput, idempotencyKey?: string) =>
      api.post<Invoice>('/invoices', input, { idempotencyKey }),
    update: (id: string, input: { invoiceDate?: string; notes?: string }) =>
      api.patch<Invoice>(`/invoices/${id}`, input),
    confirm: (id: string, idempotencyKey?: string) =>
      api.post<Invoice>(`/invoices/${id}/confirm`, undefined, { idempotencyKey }),
    void: (id: string, reason?: string, idempotencyKey?: string) =>
      api.post<Invoice>(`/invoices/${id}/void`, { reason }, { idempotencyKey }),
    recordPayment: (input: PaymentInput, idempotencyKey?: string) =>
      api.post<Payment>('/invoices/payments', input, { idempotencyKey }),
  },
  quotations: {
    list: (params: QuotationListParams = {}) =>
      api.get<Quotation[]>('/quotations', { query: params }),
    get: (id: string) => api.get<Quotation>(`/quotations/${id}`),
    create: (input: QuotationInput, idempotencyKey?: string) =>
      api.post<Quotation>('/quotations', input, { idempotencyKey }),
    update: (id: string, input: { quoteDate?: string; validUntil?: string; notes?: string }) =>
      api.patch<Quotation>(`/quotations/${id}`, input),
    send: (id: string) => api.post<Quotation>(`/quotations/${id}/send`),
    accept: (id: string) => api.post<Quotation>(`/quotations/${id}/accept`),
    cancel: (id: string) => api.post<Quotation>(`/quotations/${id}/cancel`),
    convert: (id: string, idempotencyKey?: string) =>
      api.post<Invoice>(`/quotations/${id}/convert`, undefined, { idempotencyKey }),
  },
  creditNotes: {
    list: (params: CreditNoteListParams = {}) =>
      api.get<CreditNote[]>('/credit-notes', { query: params }),
    get: (id: string) => api.get<CreditNote>(`/credit-notes/${id}`),
    create: (input: CreditNoteInput, idempotencyKey?: string) =>
      api.post<CreditNote>('/credit-notes', input, { idempotencyKey }),
    issue: (id: string, reason?: string, idempotencyKey?: string) =>
      api.post<CreditNote>(`/credit-notes/${id}/issue`, { reason }, { idempotencyKey }),
    cancel: (id: string) => api.post<CreditNote>(`/credit-notes/${id}/cancel`),
  },
};