import { AccountType, Prisma } from '../../generated/prisma/client.js';

export interface ChartAccountSeed {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  description?: string;
}

/**
 * Standard chart of accounts seeded for every tenant at registration.
 * Non-header accounts are the auto-posting targets used by `LedgerService`.
 */
export const CHART_OF_ACCOUNTS: ChartAccountSeed[] = [
  { code: '1000', name: 'Current Assets', type: 'ASSET', description: 'Assets expected to be realized within a year' },
  { code: '1100', name: 'Cash and Bank', type: 'ASSET', parentCode: '1000', description: 'Cash on hand and bank balances' },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET', parentCode: '1000', description: 'Amounts owed by customers' },
  { code: '1300', name: 'Inventory', type: 'ASSET', parentCode: '1000', description: 'Stock on hand valuation' },
  { code: '1400', name: 'VAT Input', type: 'ASSET', parentCode: '1000', description: 'Recoverable input VAT on purchases' },
  { code: '2000', name: 'Current Liabilities', type: 'LIABILITY', description: 'Obligations due within a year' },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY', parentCode: '2000', description: 'Amounts owed to suppliers' },
  { code: '2200', name: 'VAT Output', type: 'LIABILITY', parentCode: '2000', description: 'Output VAT payable to the tax authority' },
  { code: '3000', name: 'Equity', type: 'EQUITY', description: 'Owner interest in the business' },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY', parentCode: '3000', description: 'Accumulated profits less distributions' },
  { code: '4000', name: 'Income', type: 'INCOME', description: 'Revenue accounts' },
  { code: '4100', name: 'Sales Revenue', type: 'INCOME', parentCode: '4000', description: 'Revenue from goods and services sold' },
  { code: '5000', name: 'Expenses', type: 'EXPENSE', description: 'Operating expense accounts' },
  { code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE', parentCode: '5000', description: 'Direct cost of products sold' },
  { code: '5200', name: 'Other Operating Expenses', type: 'EXPENSE', parentCode: '5000', description: 'Rent, utilities, wages and other operating costs' },
];

/**
 * Creates the standard chart of accounts. Must run inside a registration
 * transaction so a tenant never exists without its ledger setup.
 */
export async function seedChartOfAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId?: string,
): Promise<number> {
  const byCode = new Map<string, string>();
  for (const seed of CHART_OF_ACCOUNTS) {
    const account = await tx.account.create({
      data: {
        organizationId,
        code: seed.code,
        name: seed.name,
        type: seed.type,
        description: seed.description ?? null,
        parentId: seed.parentCode ? byCode.get(seed.parentCode) ?? null : null,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
      select: { id: true },
    });
    byCode.set(seed.code, account.id);
  }
  return CHART_OF_ACCOUNTS.length;
}