'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, SlidersHorizontal } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SearchInput,
  Textarea,
  useToast,
} from '@/components/ui';
import { inventoryApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { useCursorList } from '@/hooks/use-cursor-list';
import { formatMoney, formatNumber } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Item } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  sku: z.string().max(60).optional().or(z.literal('')),
  categoryId: z.string().optional().or(z.literal('')),
  baseUnit: z.string().max(20).optional().or(z.literal('')),
  buyPrice: z.string().regex(/^\d*(\.\d{0,2})?$/, 'Use a number like 1200.00').optional().or(z.literal('')),
  sellPrice: z.string().regex(/^\d*(\.\d{0,2})?$/, 'Use a number like 1500.00').optional().or(z.literal('')),
  taxCode: z.string().max(20).optional().or(z.literal('')),
  reorderLevel: z.string().regex(/^\d*(\.\d{0,2})?$/, 'Use a number').optional().or(z.literal('')),
  description: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

const stockSchema = z.object({
  quantity: z
    .string()
    .regex(/^-?\d+(\.\d{1,3})?$/, 'Use a number, e.g. 10 or -2.5'),
  reason: z.string().max(200).optional().or(z.literal('')),
});

type StockValues = z.infer<typeof stockSchema>;

export function ItemManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [stockItem, setStockItem] = useState<Item | null>(null);

  const list = useCursorList<Item>(['items'], (params) => inventoryApi.items.list(params), {
    pageSize: 100,
  });
  const categories = useQuery({
    queryKey: ['item-categories'],
    queryFn: () => inventoryApi.categories.list(),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return list.items;
    return list.items.filter((item) =>
      [item.name, item.sku, item.category?.name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [list.items, search]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      sku: '',
      categoryId: '',
      baseUnit: '',
      buyPrice: '',
      sellPrice: '',
      taxCode: '',
      reorderLevel: '',
      description: '',
    },
  });

  const stockForm = useForm<StockValues>({
    resolver: zodResolver(stockSchema),
    defaultValues: { quantity: '', reason: '' },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    setModalOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    form.reset({
      name: item.name,
      sku: item.sku ?? '',
      categoryId: item.categoryId ?? '',
      baseUnit: item.baseUnit ?? '',
      buyPrice: item.buyPrice ?? '',
      sellPrice: item.sellPrice ?? '',
      taxCode: item.taxCode ?? '',
      reorderLevel: item.reorderLevel ?? '',
      description: item.description ?? '',
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        sku: values.sku?.trim() || undefined,
        categoryId: values.categoryId || undefined,
        baseUnit: values.baseUnit?.trim() || undefined,
        buyPrice: values.buyPrice?.trim() || undefined,
        sellPrice: values.sellPrice?.trim() || undefined,
        taxCode: values.taxCode?.trim() || undefined,
        reorderLevel: values.reorderLevel?.trim() || undefined,
        description: values.description?.trim() || undefined,
      };
      return editing
        ? inventoryApi.items.update(editing.id, payload)
        : inventoryApi.items.create(payload, newIdempotencyKey());
    },
    onSuccess: () => {
      toast({ tone: 'success', title: editing ? 'Product updated' : 'Product created' });
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not save product',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const adjust = useMutation({
    mutationFn: ({ item, values }: { item: Item; values: StockValues }) =>
      inventoryApi.items.adjustStock(
        item.id,
        values.quantity,
        values.reason?.trim() || undefined,
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Stock adjusted' });
      setStockItem(null);
      stockForm.reset();
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not adjust stock',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const columns = useMemo<ColumnDef<Item, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Product',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-ink-900">{row.original.name}</p>
            {row.original.sku ? <p className="text-xs text-ink-500">SKU {row.original.sku}</p> : null}
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => row.original.category?.name ?? '—',
      },
      {
        accessorKey: 'sellPrice',
        header: 'Sell price',
        cell: ({ row }) =>
          row.original.sellPrice ? formatMoney(Number(row.original.sellPrice)) : '—',
      },
      {
        accessorKey: 'stockOnHand',
        header: 'On hand',
        cell: ({ row }) => {
          const reorder = row.original.reorderLevel ? Number(row.original.reorderLevel) : 0;
          const low = reorder > 0 && row.original.stockOnHand <= reorder;
          return (
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{formatNumber(row.original.stockOnHand, 0)}</span>
              {low ? <Badge tone="warning">Low</Badge> : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'active',
        header: 'Status',
        cell: ({ row }) => (
          <Badge tone={row.original.active ? 'success' : 'muted'}>
            {row.original.active ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Adjust stock"
              onClick={() => {
                setStockItem(row.original);
                stockForm.reset({ quantity: '', reason: '' });
              }}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Products & services"
        description="Define what you sell, its pricing, tax treatment and reorder level."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New product
          </Button>
        }
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search products…" className="max-w-sm" />

      {list.isError ? (
        <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          Could not load products. Please refresh.
        </div>
      ) : list.items.length === 0 && !list.isLoading ? (
        <EmptyState
          title="No products yet"
          description="Add the items and services you sell to start invoicing."
          action={<Button onClick={openCreate}>Add your first product</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={list.isLoading}
          emptyMessage="No products match your search."
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit product' : 'New product'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((values) => save.mutate(values))}>
              {editing ? 'Save changes' : 'Create product'}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message} required className="sm:col-span-2">
            <Input id="name" invalid={Boolean(form.formState.errors.name)} {...form.register('name')} />
          </Field>
          <Field label="SKU" htmlFor="sku" error={form.formState.errors.sku?.message}>
            <Input id="sku" {...form.register('sku')} />
          </Field>
          <Field label="Category" htmlFor="categoryId">
            <Select id="categoryId" {...form.register('categoryId')}>
              <option value="">Uncategorised</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Buy price (KES)" htmlFor="buyPrice" error={form.formState.errors.buyPrice?.message}>
            <Input id="buyPrice" inputMode="decimal" placeholder="0.00" {...form.register('buyPrice')} />
          </Field>
          <Field label="Sell price (KES)" htmlFor="sellPrice" error={form.formState.errors.sellPrice?.message}>
            <Input id="sellPrice" inputMode="decimal" placeholder="0.00" {...form.register('sellPrice')} />
          </Field>
          <Field label="Unit" htmlFor="baseUnit" error={form.formState.errors.baseUnit?.message}>
            <Input id="baseUnit" placeholder="e.g. pcs, kg, box" {...form.register('baseUnit')} />
          </Field>
          <Field label="Tax code" htmlFor="taxCode" error={form.formState.errors.taxCode?.message} hint="e.g. VAT16, EXEMPT, ZERO">
            <Input id="taxCode" {...form.register('taxCode')} />
          </Field>
          <Field label="Reorder level" htmlFor="reorderLevel" error={form.formState.errors.reorderLevel?.message}>
            <Input id="reorderLevel" inputMode="decimal" placeholder="0" {...form.register('reorderLevel')} />
          </Field>
          <Field label="Description" htmlFor="description" error={form.formState.errors.description?.message} className="sm:col-span-2">
            <Textarea id="description" rows={3} {...form.register('description')} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(stockItem)}
        onClose={() => setStockItem(null)}
        title={`Adjust stock — ${stockItem?.name ?? ''}`}
        description="Use a positive number to add stock, negative to remove. Adjustments are recorded in the stock ledger."
        footer={
          <>
            <Button variant="secondary" onClick={() => setStockItem(null)}>
              Cancel
            </Button>
            <Button
              loading={adjust.isPending}
              onClick={stockForm.handleSubmit((values) => {
                if (stockItem) adjust.mutate({ item: stockItem, values });
              })}
            >
              Apply adjustment
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={stockForm.handleSubmit((values) => { if (stockItem) adjust.mutate({ item: stockItem, values }); })} noValidate>
          <Field label="Quantity change" htmlFor="quantity" error={stockForm.formState.errors.quantity?.message} required>
            <Input id="quantity" inputMode="decimal" placeholder="10 or -2" {...stockForm.register('quantity')} />
          </Field>
          <Field label="Reason" htmlFor="reason" error={stockForm.formState.errors.reason?.message}>
            <Input id="reason" placeholder="Stock count, damage, supplier return…" {...stockForm.register('reason')} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}