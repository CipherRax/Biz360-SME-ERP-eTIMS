import { api } from './http';
import type { CursorListParams } from './params';
import type {
  ApiKey,
  BankAccount,
  Notification,
  Organization,
  OrganizationSetting,
  StatementLine,
  UserRecord,
} from '@/types/domain';
import type {
  ApiKeyInput,
  BankAccountInput,
  OrganizationInput,
  OrganizationSettingsInput,
  UpdateUserInput,
  UserInput,
} from '@/types/inputs';

export type UserListParams = CursorListParams;

export interface NotificationListParams extends CursorListParams {
  status?: string;
}

export interface BankAccountListParams extends CursorListParams {
  type?: string;
}

export const usersApi = {
  list: (params: UserListParams = {}) => api.get<UserRecord[]>('/users', { query: params }),
  me: () => api.get<UserRecord>('/users/me'),
  get: (id: string) => api.get<UserRecord>(`/users/${id}`),
  create: (input: UserInput, idempotencyKey?: string) =>
    api.post<UserRecord>('/users', input, { idempotencyKey }),
  updateMe: (input: { name?: string; preferences?: Record<string, unknown> }) =>
    api.patch<UserRecord>('/users/me', input),
  update: (id: string, input: UpdateUserInput) => api.patch<UserRecord>(`/users/${id}`, input),
  remove: (id: string) => api.delete<void>(`/users/${id}`),
};

export const organizationsApi = {
  me: () => api.get<Organization>('/organizations/me'),
  update: (input: OrganizationInput) => api.patch<Organization>('/organizations/me', input),
  settings: () => api.get<OrganizationSetting>('/organizations/settings'),
  updateSettings: (input: OrganizationSettingsInput) =>
    api.patch<OrganizationSetting>('/organizations/settings', input),
};

export const apiKeysApi = {
  list: () => api.get<ApiKey[]>('/api-keys'),
  create: (input: ApiKeyInput, idempotencyKey?: string) =>
    api.post<ApiKey>('/api-keys', input, { idempotencyKey }),
  revoke: (id: string) => api.delete<void>(`/api-keys/${id}`),
};

export const notificationsApi = {
  list: (params: NotificationListParams = {}) =>
    api.get<Notification[]>('/notifications', { query: params }),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  get: (id: string) => api.get<Notification>(`/notifications/${id}`),
  markRead: (id: string) => api.patch<Notification>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ count: number }>('/notifications/read-all'),
};

export const bankingApi = {
  accounts: {
    list: (params: BankAccountListParams = {}) =>
      api.get<BankAccount[]>('/bank-accounts', { query: params }),
    get: (id: string) => api.get<BankAccount>(`/bank-accounts/${id}`),
    create: (input: BankAccountInput, idempotencyKey?: string) =>
      api.post<BankAccount>('/bank-accounts', input, { idempotencyKey }),
    update: (id: string, input: Partial<BankAccountInput>) =>
      api.patch<BankAccount>(`/bank-accounts/${id}`, input),
    remove: (id: string) => api.delete<void>(`/bank-accounts/${id}`),
    statementLines: (id: string, params: CursorListParams & { reconciled?: boolean } = {}) =>
      api.get<StatementLine[]>(`/bank-accounts/${id}/statement-lines`, { query: params }),
    importStatement: (
      id: string,
      lines: Array<{
        transactionDate: string;
        description?: string;
        reference?: string;
        debit?: number;
        credit?: number;
      }>,
      idempotencyKey?: string,
    ) =>
      api.post<{ imported: number; lines: StatementLine[] }>(
        `/bank-accounts/${id}/import-statement`,
        { lines },
        { idempotencyKey },
      ),
    reconcile: (
      id: string,
      input: { periodStart: string; periodEnd: string; statementLineIds: string[]; notes?: string },
      idempotencyKey?: string,
    ) => api.post<unknown>(`/bank-accounts/${id}/reconcile`, input, { idempotencyKey }),
    reconciliations: (id: string, params: CursorListParams = {}) =>
      api.get<unknown[]>(`/bank-accounts/${id}/reconciliations`, { query: params }),
  },
};
