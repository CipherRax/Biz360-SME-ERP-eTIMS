import { api } from './http';
import type { CursorListParams } from './params';
import type {
  EtimsExposureSummary,
  ScanJobStatus,
  ScanResult,
  SupplierEtimsInvoice,
  UnmatchedExpense,
  WithholdingTaxDeduction,
  WhtComputeResult,
  WhtRate,
  WhtRatesResponse,
  WhtRemittanceSummary,
} from '@/types/domain';
import type {
  CaptureSupplierEtimsInput,
  MatchSupplierEtimsInput,
  RecordWhtInput,
  ScanSupplierEtimsInput,
  UpsertWhtRateInput,
} from '@/types/inputs';

export interface UnmatchedExpenseParams extends CursorListParams {
  limit?: number;
}

export interface SupplierEtimsListParams extends CursorListParams {
  limit?: number;
  supplierId?: string;
  matchStatus?: 'UNMATCHED' | 'MATCHED' | 'DISPUTED';
}

export interface ListWhtDeductionsParams extends Record<string, string | number | boolean | undefined> {
  paymentId?: string;
  supplierId?: string;
  limit?: number;
  offset?: number;
}

/** A1 – supplier eTIMS capture, matching and expense-exposure. */
export const supplierEtimsApi = {
  capture: (input: CaptureSupplierEtimsInput, idempotencyKey?: string) =>
    api.post<SupplierEtimsInvoice>('/etims/supplier-invoices', input, { idempotencyKey }),
  scan: (input: ScanSupplierEtimsInput, idempotencyKey?: string) =>
    api.post<ScanResult>('/etims/supplier-invoices/scan', input, { idempotencyKey }),
  scanStatus: (jobId: string) =>
    api.get<ScanJobStatus>(`/etims/supplier-invoices/scan/${jobId}`),
  verify: (id: string, idempotencyKey?: string) =>
    api.post<{ invoiceId: string; status: string; message: string }>(
      `/etims/supplier-invoices/${id}/verify`,
      undefined,
      { idempotencyKey },
    ),
  match: (id: string, input: MatchSupplierEtimsInput, idempotencyKey?: string) =>
    api.post<SupplierEtimsInvoice>(`/etims/supplier-invoices/${id}/match`, input, { idempotencyKey }),
  unmatched: (params: UnmatchedExpenseParams = {}) =>
    api.get<{ data: UnmatchedExpense[]; nextCursor?: string }>('/etims/supplier-invoices/unmatched', {
      query: params,
    }),
  list: (params: SupplierEtimsListParams = {}) =>
    api.get<{ data: SupplierEtimsInvoice[]; nextCursor?: string }>('/etims/supplier-invoices', {
      query: params,
    }),
};

/** A1 – KRA expense-exposure dashboard widgets. */
export const expenseExposureApi = {
  summary: () =>
    api.get<EtimsExposureSummary>('/etims/compliance/exposure-summary'),
};

/** A2 – withholding tax. */
export const withholdingTaxApi = {
  rates: () => api.get<WhtRatesResponse>('/withholding-tax/rates'),
  eligiblePayments: (limit = 50) =>
    api.get<Array<{ id: string; amount: number; method: string; paidAt: string; reference?: string | null; partyId: string; party: { name: string; taxId?: string | null } }>>(
      '/withholding-tax/payments',
      { query: { limit } },
    ),
  upsertRate: (input: UpsertWhtRateInput, idempotencyKey?: string) =>
    api.post<WhtRate>('/withholding-tax/rates', input, { idempotencyKey }),
  compute: (paymentId: string) =>
    api.post<WhtComputeResult>('/withholding-tax/compute', { paymentId }),
  record: (input: RecordWhtInput, idempotencyKey?: string) =>
    api.post<WithholdingTaxDeduction>('/withholding-tax/record', input, { idempotencyKey }),
  list: (params: ListWhtDeductionsParams = {}) =>
    api.get<{ items: WithholdingTaxDeduction[]; total: number }>('/withholding-tax/deductions', {
      query: params,
    }),
  certificate: (deductionId: string) =>
    api.get<WithholdingTaxDeduction>('/withholding-tax/certificate', { query: { deductionId } }),
  remittanceSummary: (from?: string, to?: string) =>
    api.get<WhtRemittanceSummary>('/withholding-tax/remittance-summary', {
      query: { from, to },
    }),
};