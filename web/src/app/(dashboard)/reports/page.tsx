'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, HandCoins, Receipt, TrendingUp } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  SkeletonTable,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui';
import { reportingApi } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/utils/format';
import type { AgedPartiesRow } from '@/types/domain';

function startOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [range] = useState({ startDate: startOfMonth(), endDate: today() });

  const dashboard = useQuery({ queryKey: ['reports', 'dashboard'], queryFn: () => reportingApi.dashboard() });
  const receivables = useQuery({
    queryKey: ['reports', 'receivables', 'aged'],
    queryFn: () => reportingApi.agedReceivables(),
  });
  const payables = useQuery({
    queryKey: ['reports', 'payables', 'aged'],
    queryFn: () => reportingApi.agedPayables(),
  });
  const tax = useQuery({
    queryKey: ['reports', 'tax', range],
    queryFn: () => reportingApi.taxSummary(range.startDate, range.endDate),
  });
  const topItems = useQuery({
    queryKey: ['reports', 'top-items', range],
    queryFn: () => reportingApi.topItems({ from: range.startDate, to: range.endDate, limit: 10 }),
  });

  const agedColumns = useMemo(
    () => ['Current', '1–30 days', '31–60 days', '90+ days'] as const,
    [],
  );

  const renderAged = (data: { parties: AgedPartiesRow[]; totalOutstanding: number } | undefined, loading: boolean, empty: string) => {
    if (loading) return <SkeletonTable rows={4} columns={6} />;
    if (!data || !Array.isArray(data.parties) || data.parties.length === 0) {
      return <EmptyState icon={HandCoins} title="Nothing outstanding" description={empty} />;
    }
    return (
      <TableWrapper className="border-0">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Party</TableHeaderCell>
              {agedColumns.map((column) => (
                <TableHeaderCell key={column} className="text-right">
                  {column}
                </TableHeaderCell>
              ))}
              <TableHeaderCell className="text-right">Total</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {data.parties.map((row) => (
              <TableRow key={row.partyId}>
                <TableCell className="font-medium text-ink-900">{row.partyName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.current)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.days30)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.days60)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.over90)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(row.totalOutstanding)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-ink-100/60 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell colSpan={4} />
              <TableCell className="text-right tabular-nums">{formatMoney(data.totalOutstanding)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableWrapper>
    );
  };

  const kpis = dashboard.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Sales, cash flow, tax position and stock performance."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales this month" value={formatMoney(kpis?.salesThisMonth ?? 0)} icon={TrendingUp} tone="brand" />
        <StatCard label="Receivables" value={formatMoney(kpis?.receivables ?? 0)} icon={Receipt} tone="info" />
        <StatCard label="Payables" value={formatMoney(kpis?.payables ?? 0)} icon={Receipt} tone="warning" />
        <StatCard label="Stock valuation" value={formatMoney(kpis?.stockValuation ?? 0)} icon={BarChart3} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aged receivables</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {renderAged(receivables.data, receivables.isLoading, 'Customers are all paid up.')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Aged payables</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {renderAged(payables.data, payables.isLoading, 'No outstanding supplier balances.')}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>VAT position</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Line label="Output VAT" value={formatMoney(tax.data?.outputVat ?? 0)} />
            <Line label="Input VAT" value={formatMoney(tax.data?.inputVat ?? 0)} />
            <div className="border-t border-ink-100 pt-3">
              <Line
                label="Net VAT payable"
                value={formatMoney(tax.data?.netVat ?? 0)}
                strong
              />
            </div>
            <p className="text-xs text-ink-500">
              {formatNumber(tax.data?.salesInvoiceCount ?? 0, 0)} sales and{' '}
              {formatNumber(tax.data?.purchaseInvoiceCount ?? 0, 0)} purchase invoices in this period.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top items by revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {topItems.isLoading ? (
              <SkeletonTable rows={5} columns={4} />
            ) : (topItems.data ?? []).length === 0 ? (
              <EmptyState icon={BarChart3} title="No sales yet" description="Top-selling items will appear after you issue invoices." />
            ) : (
              <TableWrapper className="border-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Item</TableHeaderCell>
                      <TableHeaderCell className="text-right">Qty sold</TableHeaderCell>
                      <TableHeaderCell className="text-right">Revenue</TableHeaderCell>
                      <TableHeaderCell className="text-right">VAT</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(topItems.data ?? []).map((item) => (
                      <TableRow key={item.itemId}>
                        <TableCell className="font-medium text-ink-900">{item.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(item.qty, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(item.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(item.tax)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums text-ink-900' : 'tabular-nums text-ink-700'}>
        {value}
      </span>
    </div>
  );
}