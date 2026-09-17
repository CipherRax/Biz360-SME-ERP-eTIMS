'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SearchInput,
  useToast,
} from '@/components/ui';
import { salesApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { useCursorList } from '@/hooks/use-cursor-list';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { QUOTATION_STATUS } from '@/lib/utils/status';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Quotation } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  const list = useCursorList<Quotation>(
    ['quotations'],
    (params) => salesApi.quotations.list(params),
    { pageSize: 25 },
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return list.items;
    return list.items.filter((quote) =>
      [quote.quoteNumber, quote.party?.name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [list.items, search]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['quotations'] });

  const send = useMutation({
    mutationFn: (id: string) => salesApi.quotations.send(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Quotation marked as sent' });
      invalidate();
    },
    onError: (error) =>
      toast({ tone: 'error', title: 'Action failed', description: error instanceof ApiError ? error.message : 'Try again.' }),
  });

  const convert = useMutation({
    mutationFn: (id: string) => salesApi.quotations.convert(id, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Converted to invoice' });
      invalidate();
    },
    onError: (error) =>
      toast({ tone: 'error', title: 'Could not convert', description: error instanceof ApiError ? error.message : 'Try again.' }),
  });

  const columns = useMemo<ColumnDef<Quotation, unknown>[]>(
    () => [
      { accessorKey: 'quoteNumber', header: 'Quote', cell: ({ row }) => <span className="font-medium text-ink-900">{row.original.quoteNumber}</span> },
      { accessorKey: 'party', header: 'Customer', cell: ({ row }) => row.original.party?.name ?? '—' },
      { accessorKey: 'quoteDate', header: 'Date', cell: ({ row }) => formatDate(row.original.quoteDate) },
      { accessorKey: 'validUntil', header: 'Valid until', cell: ({ row }) => (row.original.validUntil ? formatDate(row.original.validUntil) : '—') },
      { accessorKey: 'total', header: 'Total', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.total)}</span> },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const meta = QUOTATION_STATUS[row.original.status];
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            {row.original.status === 'DRAFT' ? (
              <Button variant="secondary" size="sm" onClick={() => send.mutate(row.original.id)}>
                Send
              </Button>
            ) : null}
            {['SENT', 'ACCEPTED'].includes(row.original.status) ? (
              <Button variant="outline" size="sm" loading={convert.isPending} onClick={() => convert.mutate(row.original.id)}>
                Convert
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convert.isPending],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Sales"
        title="Quotations"
        description="Send quotes to customers and convert accepted ones into invoices."
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search quotations…" className="max-w-sm" />
      {list.items.length === 0 && !list.isLoading ? (
        <EmptyState
          icon={FileSignature}
          title="No quotations yet"
          description="Create quotations to track deals before they become invoices."
        />
      ) : (
        <DataTable columns={columns} data={rows} isLoading={list.isLoading} emptyMessage="No quotations match your search." />
      )}
    </div>
  );
}