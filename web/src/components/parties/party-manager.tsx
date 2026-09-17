'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SearchInput,
  Textarea,
  useToast,
} from '@/components/ui';
import { partiesApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import type { PartyInput } from '@/types/inputs';
import { useCursorList } from '@/hooks/use-cursor-list';
import { formatMoney } from '@/lib/utils/format';
import { PARTY_STATUS } from '@/lib/utils/status';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Party, PartyType } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  taxId: z.string().max(30).optional().or(z.literal('')),
  addressLine1: z.string().max(160).optional().or(z.literal('')),
  city: z.string().max(80).optional().or(z.literal('')),
  creditLimit: z
    .string()
    .regex(/^\d*(\.\d{0,2})?$/, 'Use a number like 50000.00')
    .optional()
    .or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function PartyManager({
  kind,
}: {
  kind: 'CUSTOMER' | 'SUPPLIER';
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);

  const list = useCursorList<Party>(
    ['parties'],
    (params) => partiesApi.list(params),
    { pageSize: 100 },
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return list.items
      .filter((party) =>
        kind === 'CUSTOMER' ? party.type !== 'SUPPLIER' : party.type !== 'CUSTOMER',
      )
      .filter((party) =>
        term
          ? [party.name, party.email, party.phone, party.taxId]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(term))
          : true,
      );
  }, [list.items, kind, search]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', phone: '', taxId: '', addressLine1: '', city: '', creditLimit: '', notes: '' },
  });

  const openCreate = () => {
    setEditing(null);
    reset({ name: '', email: '', phone: '', taxId: '', addressLine1: '', city: '', creditLimit: '', notes: '' });
    setModalOpen(true);
  };

  const openEdit = (party: Party) => {
    setEditing(party);
    reset({
      name: party.name,
      email: party.email ?? '',
      phone: party.phone ?? '',
      taxId: party.taxId ?? '',
      addressLine1: party.addressLine1 ?? '',
      city: party.city ?? '',
      creditLimit: party.creditLimit ?? '',
      notes: party.notes ?? '',
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        type: (editing?.type ?? kind) as PartyType,
        name: values.name.trim(),
        email: values.email?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
        taxId: values.taxId?.trim() || undefined,
        addressLine1: values.addressLine1?.trim() || undefined,
        city: values.city?.trim() || undefined,
        creditLimit: values.creditLimit?.trim() || undefined,
        notes: values.notes?.trim() || undefined,
      } satisfies PartyInput;
      return editing
        ? partiesApi.update(editing.id, payload)
        : partiesApi.create(payload, newIdempotencyKey());
    },
    onSuccess: () => {
      toast({ tone: 'success', title: editing ? 'Contact updated' : 'Contact created' });
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['parties'] });
    },
    onError: (error) => {
      toast({
        tone: 'error',
        title: 'Could not save contact',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: (party: Party) =>
      partiesApi.update(party.id, { status: party.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Status updated' });
      void queryClient.invalidateQueries({ queryKey: ['parties'] });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not update status',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const columns = useMemo<ColumnDef<Party, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-medium text-ink-900">{row.original.name}</span>,
      },
      { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? '—' },
      { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone ?? '—' },
      { accessorKey: 'taxId', header: 'PIN', cell: ({ row }) => row.original.taxId ?? '—' },
      {
        accessorKey: 'creditLimit',
        header: 'Credit limit',
        cell: ({ row }) =>
          row.original.creditLimit ? formatMoney(Number(row.original.creditLimit)) : '—',
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const meta = PARTY_STATUS[row.original.status];
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={row.original.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              onClick={() => toggleStatus.mutate(row.original)}
            >
              <Power className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const noun = kind === 'CUSTOMER' ? 'customer' : 'supplier';
  const plural = kind === 'CUSTOMER' ? 'Customers' : 'Suppliers';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Contacts"
        title={plural}
        description={`Manage the ${noun} records used across invoices, orders and payments.`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New {noun}
          </Button>
        }
      />

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={`Search ${plural.toLowerCase()}…`}
        className="max-w-sm"
      />

      {list.isError ? (
        <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          Could not load {plural.toLowerCase()}. Please refresh.
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={list.isLoading}
        emptyMessage={`No ${plural.toLowerCase()} yet. Create your first one to get started.`}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${noun}` : `New ${noun}`}
        description="Fields marked with an asterisk are required."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending || isSubmitting}
              onClick={handleSubmit((values) => save.mutate(values))}
            >
              {editing ? 'Save changes' : `Create ${noun}`}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <Field label="Name" htmlFor="name" error={errors.name?.message} required className="sm:col-span-2">
            <Input id="name" invalid={Boolean(errors.name)} {...register('name')} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" invalid={Boolean(errors.phone)} {...register('phone')} />
          </Field>
          <Field label="KRA PIN" htmlFor="taxId" error={errors.taxId?.message}>
            <Input id="taxId" invalid={Boolean(errors.taxId)} {...register('taxId')} />
          </Field>
          <Field label="Credit limit (KES)" htmlFor="creditLimit" error={errors.creditLimit?.message}>
            <Input id="creditLimit" inputMode="decimal" placeholder="0.00" invalid={Boolean(errors.creditLimit)} {...register('creditLimit')} />
          </Field>
          <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1?.message} className="sm:col-span-2">
            <Input id="addressLine1" invalid={Boolean(errors.addressLine1)} {...register('addressLine1')} />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city?.message}>
            <Input id="city" invalid={Boolean(errors.city)} {...register('city')} />
          </Field>
          <Field label="Type" htmlFor="type">
            <Select id="type" disabled value={editing?.type ?? kind}>
              <option value="CUSTOMER">Customer</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="BOTH">Both</option>
            </Select>
          </Field>
          <Field label="Notes" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
            <Textarea id="notes" rows={3} {...register('notes')} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}