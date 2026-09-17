'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Scale, TrendingUp } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui';
import { accountingApi } from '@/lib/api';
import { formatMoney } from '@/lib/utils/format';

type Tab = 'accounts' | 'trial' | 'pl';

const TABS: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'accounts', label: 'Chart of accounts', icon: BookOpen },
  { id: 'trial', label: 'Trial balance', icon: Scale },
  { id: 'pl', label: 'Profit & loss', icon: TrendingUp },
];

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>('accounts');

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountingApi.accounts.list({ limit: 200, withBalances: true }),
    enabled: tab === 'accounts',
  });
  const trial = useQuery({
    queryKey: ['trial-balance'],
    queryFn: () => accountingApi.reports.trialBalance({}),
    enabled: tab === 'trial',
  });
  const pl = useQuery({
    queryKey: ['profit-loss'],
    queryFn: () => accountingApi.reports.profitLoss({}),
    enabled: tab === 'pl',
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Finance"
        title="Accounting"
        description="Your chart of accounts, double-entry journal and financial statements."
      />

      <div className="flex flex-wrap gap-1 rounded-lg border border-ink-300/60 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={
              tab === item.id
                ? 'inline-flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-deep'
                : 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100'
            }
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'accounts' ? (
        <Card>
          <CardHeader>
            <CardTitle>Chart of accounts</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {accounts.isLoading ? (
              <SkeletonTable />
            ) : accounts.isError ? (
              <p className="text-sm text-error">Could not load accounts.</p>
            ) : (accounts.data ?? []).length === 0 ? (
              <EmptyState icon={BookOpen} title="No accounts" description="Your chart of accounts will appear here." />
            ) : (
              <TableWrapper className="border-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Code</TableHeaderCell>
                      <TableHeaderCell>Account</TableHeaderCell>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell className="text-right">Balance</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(accounts.data ?? []).map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-mono text-xs">{account.code}</TableCell>
                        <TableCell className="font-medium text-ink-900">{account.name}</TableCell>
                        <TableCell>
                          <Badge tone="neutral">{account.type}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(account.balance ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'trial' ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Trial balance</CardTitle>
            {trial.data ? (
              <Badge tone={trial.data.balanced ? 'success' : 'error'}>
                {trial.data.balanced ? 'Balanced' : 'Out of balance'}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            {trial.isLoading ? (
              <SkeletonTable />
            ) : trial.isError ? (
              <p className="text-sm text-error">Could not load the trial balance.</p>
            ) : (
              <TableWrapper className="border-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Code</TableHeaderCell>
                      <TableHeaderCell>Account</TableHeaderCell>
                      <TableHeaderCell className="text-right">Debit</TableHeaderCell>
                      <TableHeaderCell className="text-right">Credit</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(trial.data?.accounts ?? []).map((row) => (
                      <TableRow key={row.accountId}>
                        <TableCell className="font-mono text-xs">{row.code}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.debit ? formatMoney(row.debit) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.credit ? formatMoney(row.credit) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {trial.data ? (
                      <TableRow className="bg-ink-100/60 font-semibold">
                        <TableCell />
                        <TableCell>Totals</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(trial.data.totalDebit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(trial.data.totalCredit)}</TableCell>
                      </TableRow>
                    ) : null}
                    {(trial.data?.accounts ?? []).length === 0 ? (
                      <TableEmpty colSpan={4}>No posted entries in this period.</TableEmpty>
                    ) : null}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'pl' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Income</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {pl.isLoading ? (
                <SkeletonTable rows={4} columns={2} />
              ) : (
                <TableWrapper className="border-0">
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Account</TableHeaderCell>
                        <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {(pl.data?.income ?? []).map((row) => (
                        <TableRow key={row.accountId}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(row.balance)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-ink-100/60 font-semibold">
                        <TableCell>Total income</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(pl.data?.totalIncome ?? 0)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableWrapper>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {pl.isLoading ? (
                <SkeletonTable rows={4} columns={2} />
              ) : (
                <TableWrapper className="border-0">
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Account</TableHeaderCell>
                        <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {(pl.data?.expenses ?? []).map((row) => (
                        <TableRow key={row.accountId}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(row.balance)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-ink-100/60 font-semibold">
                        <TableCell>Total expenses</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(pl.data?.totalExpenses ?? 0)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableWrapper>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2 border-brand/30 bg-brand-soft/40">
            <CardContent className="flex items-center justify-between py-5">
              <span className="font-sans text-sm font-semibold text-ink-900">Net profit</span>
              <span className="font-sans text-xl font-bold tabular-nums text-brand-deep">
                {formatMoney(pl.data?.netIncome ?? 0)}
              </span>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}