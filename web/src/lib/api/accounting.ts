import { api } from './http';
import type { CursorListParams, DatedParams } from './params';
import type {
  Account,
  GeneralLedgerEntry,
  JournalEntry,
  ProfitLossReport,
  TotTaxProfile,
  TotFilingPeriod,
  TrialBalance,
  ListTotPeriodsParams,
  PayTotPeriodInput,
} from '@/types/domain';
import type { AccountInput, JournalEntryInput } from '@/types/inputs';

export interface AccountListParams extends CursorListParams {
  type?: string;
  withBalances?: boolean;
}

export interface JournalListParams extends CursorListParams {
  status?: string;
  sourceType?: string;
  from?: string;
  to?: string;
}

export interface BalanceSheetReport {
  asOf: string;
  assets: Array<{ accountId: string; code: string; name: string; balance: number }>;
  totalAssets: number;
  liabilities: Array<{ accountId: string; code: string; name: string; balance: number }>;
  totalLiabilities: number;
  equity: Array<{ accountId: string; code: string; name: string; balance: number }>;
  totalEquity: number;
  netIncome: number;
  totalEquityIncludingNetIncome: number;
  totalLiabilitiesAndEquity: number;
}

export const accountingApi = {
  accounts: {
    list: (params: AccountListParams = {}) =>
      api.get<Account[]>('/accounting/accounts', { query: params }),
    get: (id: string) => api.get<Account>(`/accounting/accounts/${id}`),
    create: (input: AccountInput) => api.post<Account>('/accounting/accounts', input),
    update: (id: string, input: Partial<AccountInput> & { active?: boolean }) =>
      api.patch<Account>(`/accounting/accounts/${id}`, input),
    remove: (id: string) => api.delete<Account>(`/accounting/accounts/${id}`),
  },
  journalEntries: {
    list: (params: JournalListParams = {}) =>
      api.get<JournalEntry[]>('/accounting/journal-entries', { query: params }),
    get: (id: string) => api.get<JournalEntry>(`/accounting/journal-entries/${id}`),
    create: (input: JournalEntryInput, idempotencyKey?: string) =>
      api.post<JournalEntry>('/accounting/journal-entries', input, { idempotencyKey }),
    approve: (id: string, idempotencyKey?: string) =>
      api.post<JournalEntry>(
        `/accounting/journal-entries/${id}/approve`,
        undefined,
        { idempotencyKey },
      ),
    reverse: (id: string, reason?: string, idempotencyKey?: string) =>
      api.post<JournalEntry>(
        `/accounting/journal-entries/${id}/reverse`,
        { reason },
        { idempotencyKey },
      ),
  },
  reports: {
    trialBalance: (params: DatedParams = {}) =>
      api.get<TrialBalance>('/accounting/trial-balance', { query: params }),
    profitLoss: (params: DatedParams = {}) =>
      api.get<ProfitLossReport>('/accounting/profit-loss', { query: params }),
    balanceSheet: (params: { asOf?: string } = {}) =>
      api.get<BalanceSheetReport>('/accounting/balance-sheet', { query: params }),
    generalLedger: (params: DatedParams & { accountId?: string } = {}) =>
      api.get<{ from: string; to: string; entries: GeneralLedgerEntry[] }>(
        '/accounting/general-ledger',
        { query: params },
      ),
  },
  tot: {
    profile: { get: () => api.get<TotTaxProfile>('/settings/tax-profile') },
    listPeriods: (params: ListTotPeriodsParams = {}) =>
      api.get<TotFilingPeriod[]>('/accounting/tot/periods', { query: params }),
    payPeriod: (periodId: string, input: PayTotPeriodInput, idempotencyKey?: string) =>
      api.post<TotFilingPeriod>(
        `/accounting/tot/periods/${periodId}/pay`,
        input,
        { idempotencyKey },
      ),
  },
};