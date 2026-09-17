import { api } from './http';
import type { DatedParams } from './params';
import type {
  AgedParties,
  DashboardKpis,
  TaxSummary,
  TopItem,
} from '@/types/domain';

export interface SalesSummary {
  from: string;
  to: string;
  days: Array<{ day: string; invoices: number; revenue: number; tax: number; discount: number }>;
  totals: { invoices: number; revenue: number; tax: number; discount: number };
}

export const reportingApi = {
  dashboard: () => api.get<DashboardKpis>('/reports/dashboard'),
  salesSummary: (params: DatedParams = {}) =>
    api.get<SalesSummary>('/reports/sales/summary', { query: params }),
  receivables: () => api.get<AgedParties>('/reports/receivables'),
  payables: () => api.get<AgedParties>('/reports/payables'),
  agedReceivables: () => api.get<AgedParties>('/reports/receivables/aged'),
  agedPayables: () => api.get<AgedParties>('/reports/payables/aged'),
  taxSummary: (startDate: string, endDate: string) =>
    api.get<TaxSummary>('/reports/tax-summary', { query: { startDate, endDate } }),
  topItems: (params: DatedParams & { limit?: number } = {}) =>
    api.get<TopItem[]>('/reports/top-items', { query: params }),
};