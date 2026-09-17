'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SearchInput,
} from '@/components/ui';
import { salesApi } from '@/lib/api';
import { useCursorList } from '@/hooks/use-cursor-list';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { INVOICE_STATUS, etimsMeta } from '@/lib/utils/status';
import type { Invoice, InvoiceStatus } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

const STATUS_FILTERS: Array<{ label: string; value: InvoiceStatus | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Partially paid', value: 'PARTIALLY_PAID' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Void', value: 'VOID' },
];

export function InvoiceList() {
  const router = useRouter();
  const [status, setStatus] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const list = useCursorList<Invoice>(
    ['invoices'],
    (params) => salesApi.invoices.list({ ...params, status: status === 'ALL' ? undefined : status }),
    { pageSize: 25, filters: { status } },
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return list.items;
    return list.items.filter((invoice) =>
      [invoice.invoiceNumber, invoice.party?.name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [list.items, search]);

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice',
        cell: ({ row }) => (
          <span className="font-medium text-ink-900">{row.original.invoiceNumber}</span>
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
        accessorKey: 'dueDate',
        header: 'Due',
        cell: ({ row }) => (row.original.dueDate ? formatDate(row.original.dueDate) : '—'),
      },
      {
        accessorKey: 'total',
        header: 'Total',
        cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.total)}</span>,
      },
      {
        accessorKey: 'amountPaid',
        header: 'Paid',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(row.original.amountPaid)}</span>
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
      {
        id: 'etims',
        header: 'eTIMS',
        cell: ({ row }) => {
          const meta = etimsMeta(row.original.etimsSubmittedAt);
          return (
            <Badge tone={meta.tone} title={row.original.etimsCtrlNo ?? undefined}>
              {meta.label}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Sales"
        title="Invoices"
        description="Issue tax invoices, record payments and track KRA eTIMS submissions."
        actions={
          <Link href="/sales/invoices/new">
            <Button>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-ink-300/60 bg-white p-1">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={
                status === filter.value
                  ? 'rounded-md bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-deep'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" className="sm:w-72" />
      </div>

      {list.isError ? (
        <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          Could not load invoices. Please refresh.
        </div>
      ) : list.items.length === 0 && !list.isLoading ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="Create your first tax invoice to start tracking sales and VAT."
          action={
            <Link href="/sales/invoices/new">
              <Button>Create invoice</Button>
            </Link>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={list.isLoading}
          onRowClick={(invoice) => router.push(`/sales/invoices/${invoice.id}`)}
          getRowId={(invoice) => invoice.id}
          emptyMessage="No invoices match your search."
        />
      )}
    </div>
  );
}