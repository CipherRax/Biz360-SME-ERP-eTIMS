'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  FileText,
  Package,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Badge,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Skeleton,
  StatCard,
} from '@/components/ui';
import { HeroBand } from '@/components/layout/hero-band';
import { reportingApi, salesApi } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/utils/format';
import { INVOICE_STATUS } from '@/lib/utils/status';
import { useAuth } from '@/lib/auth/auth-context';
import type { Invoice } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

const invoiceColumns: ColumnDef<Invoice, unknown>[] = [
  {
    accessorKey: 'invoiceNumber',
    header: 'Invoice',
    cell: ({ row }) => (
      <Link
        href={`/sales/invoices/${row.original.id}`}
        className="font-medium text-brand hover:underline"
      >
        {row.original.invoiceNumber}
      </Link>
    ),
  },
  {
    accessorKey: 'party',
    header: 'Customer',
    cell: ({ row }) => row.original.party?.name ?? '—',
  },
  {
    accessorKey: 'invoiceDate',
    header: 'Date',
    cell: ({ row }) => formatDate(row.original.invoiceDate),
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) => (
      <span className="tabular-nums">{formatMoney(row.original.total)}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const meta = INVOICE_STATUS[row.original.status];
      return <Badge tone={meta.tone}>{meta.label}</Badge>;
    },
  },
];

export default function DashboardPage() {
  const { user } = useAuth();

  const kpis = useQuery({ queryKey: ['reports', 'dashboard'], queryFn: () => reportingApi.dashboard() });
  const recent = useQuery({
    queryKey: ['invoices', 'recent'],
    queryFn: () => salesApi.invoices.list({ limit: 8 }),
  });

  const data = kpis.data;

  return (
    <div className="flex flex-col gap-6">
      <HeroBand
        eyebrow={`Karibu${user?.email ? `, ${user.email.split('@')[0]}` : ''}`}
        title="Your business at a glance"
        description="Track sales, cash, stock and KRA eTIMS compliance from one dashboard."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/sales/invoices/new" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-white/90">
            New invoice
          </Link>
          <Link href="/reports" className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
            View reports
          </Link>
        </div>
      </HeroBand>

      {kpis.isError ? (
        <Card className="border-error/30 bg-error/5">
          <CardContent className="py-6 text-sm text-error">
            Could not load dashboard metrics. Please refresh the page.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.isLoading || !data ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)
        ) : (
          <>
            <StatCard
              label="Sales this month"
              value={formatMoney(data.salesThisMonth)}
              icon={TrendingUp}
              tone="brand"
              hint={`${formatNumber(data.invoicesThisMonth, 0)} invoices issued`}
            />
            <StatCard
              label="Receivables"
              value={formatMoney(data.receivables)}
              icon={Users}
              tone="info"
              hint="Outstanding from customers"
            />
            <StatCard
              label="Stock valuation"
              value={formatMoney(data.stockValuation)}
              icon={Package}
              tone="success"
              hint={`${formatNumber(data.stockUnits, 0)} units on hand`}
            />
            <StatCard
              label="Pending eTIMS"
              value={formatNumber(data.unsubmittedEtimsInvoices, 0)}
              icon={ShieldCheck}
              tone={data.unsubmittedEtimsInvoices > 0 ? 'warning' : 'neutral'}
              hint="Invoices awaiting KRA submission"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Recent invoices</CardTitle>
              </div>
              <Link href="/sales/invoices" className="text-sm font-semibold text-brand hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent className="pt-0">
              <DataTable
                columns={invoiceColumns}
                data={recent.data ?? []}
                isLoading={recent.isLoading}
                emptyMessage="No invoices yet."
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Cash & credit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Sales today</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {formatMoney(data?.salesToday ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Payables</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {formatMoney(data?.payables ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Low-stock items</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {formatNumber(data?.lowStockItems ?? 0, 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          {data && data.lowStockItems > 0 ? (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="flex items-start gap-3 py-5">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {formatNumber(data.lowStockItems, 0)} item
                    {data.lowStockItems === 1 ? '' : 's'} at or below reorder level
                  </p>
                  <Link
                    href="/inventory"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-warning hover:underline"
                  >
                    Review stock <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="flex flex-col gap-2 py-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Banknote className="h-4 w-4 text-brand" aria-hidden />
                Quick actions
              </p>
              <Link href="/sales/invoices/new" className={buttonClasses({ variant: 'secondary', size: 'sm' }) + ' justify-start'}>
                <FileText className="h-4 w-4" /> New invoice
              </Link>
              <Link href="/etims" className={buttonClasses({ variant: 'secondary', size: 'sm' }) + ' justify-start'}>
                <ShieldCheck className="h-4 w-4" /> eTIMS queue
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}