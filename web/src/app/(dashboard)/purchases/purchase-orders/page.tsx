'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SearchInput,
  Textarea,
  useToast,
} from '@/components/ui';
import { purchasingApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { useCursorList } from '@/hooks/use-cursor-list';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { PURCHASE_ORDER_STATUS } from '@/lib/utils/status';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { PurchaseOrder } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

const rejectSchema = z.object({ reason: z.string().min(3, 'Provide a reason').max(300) });
type RejectValues = z.infer<typeof rejectSchema>;

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [rejecting, setRejecting] = useState<PurchaseOrder | null>(null);

  const list = useCursorList<PurchaseOrder>(
    ['purchase-orders'],
    (params) => purchasingApi.purchaseOrders.list(params),
    { pageSize: 25 },
  );

  const rejectForm = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '' },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });

  const onError = (error: unknown) =>
    toast({
      tone: 'error',
      title: 'Action failed',
      description: error instanceof ApiError ? error.message : 'Please try again.',
    });

  const submit = useMutation({
    mutationFn: (id: string) => purchasingApi.purchaseOrders.submit(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Purchase order submitted for approval' });
      invalidate();
    },
    onError,
  });

  const approve = useMutation({
    mutationFn: (id: string) => purchasingApi.purchaseOrders.approve(id, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Purchase order approved' });
      invalidate();
    },
    onError,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      purchasingApi.purchaseOrders.reject(id, reason),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Purchase order rejected' });
      setRejecting(null);
      rejectForm.reset();
      invalidate();
    },
    onError,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => purchasingApi.purchaseOrders.cancel(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Purchase order cancelled' });
      invalidate();
    },
    onError,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return list.items;
    return list.items.filter((po) =>
      [po.poNumber, po.party?.name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [list.items, search]);

  const columns = useMemo<ColumnDef<PurchaseOrder, unknown>[]>(
    () => [
      { accessorKey: 'poNumber', header: 'PO', cell: ({ row }) => <span className="font-medium text-ink-900">{row.original.poNumber}</span> },
      { accessorKey: 'party', header: 'Supplier', cell: ({ row }) => row.original.party?.name ?? '—' },
      { accessorKey: 'orderDate', header: 'Ordered', cell: ({ row }) => formatDate(row.original.orderDate) },
      { accessorKey: 'expectedDate', header: 'Expected', cell: ({ row }) => (row.original.expectedDate ? formatDate(row.original.expectedDate) : '—') },
      { accessorKey: 'total', header: 'Total', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.total)}</span> },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const meta = PURCHASE_ORDER_STATUS[row.original.status];
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const po = row.original;
          return (
            <div className="flex justify-end gap-2">
              {po.status === 'DRAFT' ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => submit.mutate(po.id)}>
                    Submit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-error" onClick={() => cancel.mutate(po.id)}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {po.status === 'SUBMITTED' ? (
                <>
                  <Button variant="primary" size="sm" loading={approve.isPending} onClick={() => approve.mutate(po.id)}>
                    Approve
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => { setRejecting(po); rejectForm.reset({ reason: '' }); }}>
                    Reject
                  </Button>
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approve.isPending],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Purchases"
        title="Purchase orders"
        description="Raise orders to suppliers, route them for approval and receive goods against them."
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search purchase orders…" className="max-w-sm" />
      {list.isError ? (
        <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          Could not load purchase orders. Please refresh.
        </div>
      ) : list.items.length === 0 && !list.isLoading ? (
        <EmptyState
          icon={ClipboardList}
          title="No purchase orders"
          description="Purchase orders you raise for suppliers will appear here."
        />
      ) : (
        <DataTable columns={columns} data={rows} isLoading={list.isLoading} emptyMessage="No purchase orders match your search." />
      )}

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.poNumber ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={reject.isPending}
              onClick={rejectForm.handleSubmit((values) => {
                if (rejecting) reject.mutate({ id: rejecting.id, reason: values.reason });
              })}
            >
              Reject order
            </Button>
          </>
        }
      >
        <form onSubmit={rejectForm.handleSubmit((v) => { if (rejecting) reject.mutate({ id: rejecting.id, reason: v.reason }); })} noValidate>
          <Field label="Reason" htmlFor="reason" error={rejectForm.formState.errors.reason?.message} required>
            <Textarea id="reason" rows={3} placeholder="Why is this order being rejected?" {...rejectForm.register('reason')} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}