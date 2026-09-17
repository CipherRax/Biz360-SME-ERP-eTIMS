'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { inventoryApi, partiesApi, salesApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatMoney } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';

const lineSchema = z.object({
  itemId: z.string().optional().or(z.literal('')),
  description: z.string().max(300).optional().or(z.literal('')),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Required'),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Required'),
  taxRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Required'),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use 0–100').optional().or(z.literal('')),
});

const schema = z
  .object({
    partyId: z.string().min(1, 'Select a customer'),
    invoiceDate: z.string().min(1, 'Required'),
    notes: z.string().max(500).optional().or(z.literal('')),
    lines: z.array(lineSchema).min(1, 'Add at least one line'),
  })
  .superRefine((values, ctx) => {
    values.lines.forEach((line, index) => {
      if (!line.description && !line.itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choose an item or enter a description',
          path: ['lines', index, 'description'],
        });
      }
    });
  });

type FormValues = z.infer<typeof schema>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InvoiceForm() {
  const router = useRouter();
  const { toast } = useToast();

  const customers = useQuery({
    queryKey: ['parties', 'customers'],
    queryFn: () => partiesApi.list({ limit: 200 }),
    select: (parties) => parties.filter((party) => party.type !== 'SUPPLIER'),
  });
  const items = useQuery({
    queryKey: ['items', 'picker'],
    queryFn: () => inventoryApi.items.list({ limit: 200, active: true }),
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      partyId: '',
      invoiceDate: today(),
      notes: '',
      lines: [{ itemId: '', description: '', quantity: '1', unitPrice: '', taxRate: '16', discountPct: '0' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const watchedLines = watch('lines');

  const itemIndex = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, item])),
    [items.data],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let discount = 0;
    for (const line of watchedLines ?? []) {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPrice) || 0;
      const rate = Number(line.taxRate) || 0;
      const disc = Number(line.discountPct) || 0;
      const gross = qty * price;
      const lineDiscount = gross * (disc / 100);
      const net = gross - lineDiscount;
      subtotal += gross;
      discount += lineDiscount;
      tax += net * (rate / 100);
    }
    const total = subtotal - discount + tax;
    return { subtotal, discount, tax, total };
  }, [watchedLines]);

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      salesApi.invoices.create(
        {
          partyId: values.partyId,
          invoiceDate: values.invoiceDate,
          notes: values.notes?.trim() || undefined,
          lines: values.lines.map((line) => ({
            itemId: line.itemId || undefined,
            description: line.description?.trim() || undefined,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            discountPct: line.discountPct?.trim() || '0',
          })),
        },
        newIdempotencyKey(),
      ),
    onSuccess: (invoice) => {
      toast({ tone: 'success', title: `Invoice ${invoice.invoiceNumber} created` });
      router.push(`/sales/invoices/${invoice.id}`);
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not create invoice',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/sales/invoices"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand-deep"
        >
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </Link>
        <PageHeader
          className="mt-2"
          eyebrow="Sales"
          title="New invoice"
          description="The invoice is saved as a draft — confirm it to post the accounting entries and submit to eTIMS."
        />
      </div>

      <form className="grid grid-cols-1 gap-4 lg:grid-cols-3" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoice details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Customer" htmlFor="partyId" error={errors.partyId?.message} required className="sm:col-span-2">
                <Select id="partyId" invalid={Boolean(errors.partyId)} {...register('partyId')}>
                  <option value="">Select a customer…</option>
                  {(customers.data ?? []).map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice date" htmlFor="invoiceDate" error={errors.invoiceDate?.message} required>
                <Input id="invoiceDate" type="date" invalid={Boolean(errors.invoiceDate)} {...register('invoiceDate')} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Line items</CardTitle>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  append({ itemId: '', description: '', quantity: '1', unitPrice: '', taxRate: '16', discountPct: '0' })
                }
              >
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded-lg border border-ink-100 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <Field label="Item" htmlFor={`lines.${index}.itemId`} className="sm:col-span-5">
                      <Select
                        id={`lines.${index}.itemId`}
                        {...register(`lines.${index}.itemId` as const)}
                        onChange={(event) => {
                          const item = itemIndex.get(event.target.value);
                          setValue(`lines.${index}.itemId`, event.target.value);
                          if (item) {
                            setValue(`lines.${index}.description`, item.name);
                            if (item.sellPrice) setValue(`lines.${index}.unitPrice`, Number(item.sellPrice).toFixed(2));
                          }
                        }}
                      >
                        <option value="">Custom / service</option>
                        {(items.data ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Description" htmlFor={`lines.${index}.description`} className="sm:col-span-7">
                      <Input id={`lines.${index}.description`} {...register(`lines.${index}.description` as const)} />
                    </Field>
                    <Field label="Qty" htmlFor={`lines.${index}.quantity`} error={errors.lines?.[index]?.quantity?.message} className="sm:col-span-3">
                      <Input id={`lines.${index}.quantity`} inputMode="decimal" {...register(`lines.${index}.quantity` as const)} />
                    </Field>
                    <Field label="Unit price" htmlFor={`lines.${index}.unitPrice`} error={errors.lines?.[index]?.unitPrice?.message} className="sm:col-span-3">
                      <Input id={`lines.${index}.unitPrice`} inputMode="decimal" {...register(`lines.${index}.unitPrice` as const)} />
                    </Field>
                    <Field label="VAT %" htmlFor={`lines.${index}.taxRate`} error={errors.lines?.[index]?.taxRate?.message} className="sm:col-span-2">
                      <Input id={`lines.${index}.taxRate`} inputMode="decimal" {...register(`lines.${index}.taxRate` as const)} />
                    </Field>
                    <Field label="Disc %" htmlFor={`lines.${index}.discountPct`} error={errors.lines?.[index]?.discountPct?.message} className="sm:col-span-2">
                      <Input id={`lines.${index}.discountPct`} inputMode="decimal" {...register(`lines.${index}.discountPct` as const)} />
                    </Field>
                    <div className="flex items-end sm:col-span-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-error"
                        aria-label="Remove line"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {errors.lines?.message ? (
                <p className="text-xs font-medium text-error" role="alert">
                  {errors.lines.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea rows={3} placeholder="Payment terms, delivery notes…" {...register('notes')} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SummaryRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              <SummaryRow label="Discount" value={`- ${formatMoney(totals.discount)}`} />
              <SummaryRow label="VAT" value={formatMoney(totals.tax)} />
              <div className="my-1 border-t border-ink-100" />
              <SummaryRow label="Total" value={formatMoney(totals.total)} strong />
            </CardContent>
          </Card>
          <Button type="submit" size="lg" loading={create.isPending || isSubmitting}>
            Create invoice
          </Button>
          <p className="text-xs text-ink-500">
            Totals are indicative and recalculated by the server on save.
          </p>
        </div>
      </form>
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums text-ink-900' : 'tabular-nums text-ink-700'}>
        {value}
      </span>
    </div>
  );
}