'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Modal,
  PageLoader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { etimsApi, salesApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils/format';
import { INVOICE_STATUS, etimsMeta } from '@/lib/utils/status';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Invoice, PaymentMethod } from '@/types/domain';

const paymentSchema = z.object({
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 1500.00'),
  method: z.enum(['CASH', 'M_PESA', 'BANK_TRANSFER', 'CARD', 'CHEQUE']),
  reference: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type PaymentValues = z.infer<typeof paymentSchema>;

const voidSchema = z.object({ reason: z.string().min(2, 'Provide a reason for voiding').max(200) });
type VoidValues = z.infer<typeof voidSchema>;

export function InvoiceDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const invoice = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => salesApi.invoices.get(id),
  });

  const paymentForm = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: '', method: 'M_PESA', reference: '', notes: '' },
  });
  const voidForm = useForm<VoidValues>({
    resolver: zodResolver(voidSchema),
    defaultValues: { reason: '' },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  const confirm = useMutation({
    mutationFn: () => salesApi.invoices.confirm(id, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Invoice confirmed' });
      invalidate();
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'Please try again.';
      const creditLimit = message.toLowerCase().includes('credit limit');
      const stock = message.toLowerCase().includes('insufficient stock');
      toast({
        tone: 'error',
        title: creditLimit
          ? 'Credit limit reached'
          : stock
            ? 'Not enough stock'
            : 'Could not confirm invoice',
        description: message,
        durationMs: creditLimit || stock ? 12000 : undefined,
      });
    },
  });

  const recordPayment = useMutation({
    mutationFn: (values: PaymentValues) =>
      salesApi.invoices.recordPayment(
        {
          invoiceId: id,
          amount: values.amount,
          method: values.method as PaymentMethod,
          reference: values.reference?.trim() || undefined,
          notes: values.notes?.trim() || undefined,
        },
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Payment recorded' });
      setPaymentOpen(false);
      paymentForm.reset();
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not record payment',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const voidInvoice = useMutation({
    mutationFn: (values: VoidValues) => salesApi.invoices.void(id, values.reason, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Invoice voided' });
      setVoidOpen(false);
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not void invoice',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const submitEtims = useMutation({
    mutationFn: () => etimsApi.trigger(id, newIdempotencyKey()),
    onSuccess: (result) => {
      toast({
        tone: result.alreadySubmitted ? 'info' : 'success',
        title: result.alreadySubmitted
          ? 'Already submitted to eTIMS'
          : result.enqueued
            ? 'Queued for eTIMS submission'
            : 'eTIMS submission requested',
      });
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'eTIMS submission failed',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  if (invoice.isLoading) return <PageLoader label="Loading invoice…" />;

  if (invoice.isError || !invoice.data) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
        Invoice not found or you do not have access to it.
      </div>
    );
  }

  const data: Invoice = invoice.data;
  const statusMeta = INVOICE_STATUS[data.status];
  const etims = etimsMeta(data.etimsSubmittedAt);
  const outstanding = Math.max(data.total - data.amountPaid, 0);
  const isVoid = data.status === 'VOID';
  const isDraft = data.status === 'DRAFT';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/sales/invoices"
            className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand-deep"
          >
            <ArrowLeft className="h-4 w-4" /> Back to invoices
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-sans text-2xl font-bold text-ink-900">{data.invoiceNumber}</h1>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            <Badge tone={etims.tone}>{etims.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {data.party?.name} · Issued {formatDate(data.invoiceDate)}
            {data.dueDate ? ` · Due ${formatDate(data.dueDate)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
              <CheckCircle2 className="h-4 w-4" /> Confirm invoice
            </Button>
          ) : null}
          {!isVoid && !isDraft ? (
            <>
              <Button loading={submitEtims.isPending} onClick={() => submitEtims.mutate()}>
                <ShieldCheck className="h-4 w-4" />
                {data.etimsSubmittedAt ? 'Re-submit to eTIMS' : 'Submit to eTIMS'}
              </Button>
              {outstanding > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    paymentForm.setValue('amount', outstanding.toFixed(2));
                    setPaymentOpen(true);
                  }}
                >
                  <CreditCard className="h-4 w-4" /> Record payment
                </Button>
              ) : null}
            </>
          ) : null}
          {!isVoid ? (
            <Button variant="danger" onClick={() => setVoidOpen(true)}>
              <Ban className="h-4 w-4" /> Void
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="py-2 text-left">Description</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Unit price</th>
                    <th className="py-2 text-right">VAT</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {(data.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className="py-3 text-ink-900">{line.description ?? 'Item'}</td>
                      <td className="py-3 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-3 text-right tabular-nums">{formatMoney(line.unitPrice)}</td>
                      <td className="py-3 text-right tabular-nums">{formatMoney(line.taxAmount)}</td>
                      <td className="py-3 text-right font-medium tabular-nums">
                        {formatMoney(line.lineTotal)}
                      </td>
                    </tr>
                  ))}
                  {(data.lines ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-ink-500">
                        No line items.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Row label="Subtotal" value={formatMoney(data.subtotal)} />
              <Row label="Discount" value={`- ${formatMoney(data.discountTotal)}`} />
              <Row label="VAT" value={formatMoney(data.taxTotal)} />
              <div className="my-1 border-t border-ink-100" />
              <Row label="Total" value={formatMoney(data.total)} strong />
              <Row label="Paid" value={formatMoney(data.amountPaid)} />
              <Row label="Outstanding" value={formatMoney(outstanding)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>eTIMS</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-ink-700">
              <Row label="Control number" value={data.etimsCtrlNo ?? '—'} />
              <Row
                label="Submitted"
                value={data.etimsSubmittedAt ? formatDateTime(data.etimsSubmittedAt) : '—'}
              />
            </CardContent>
          </Card>

          {data.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-ink-700">{data.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title="Record payment"
        description={`Outstanding balance: ${formatMoney(outstanding)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={recordPayment.isPending}
              onClick={paymentForm.handleSubmit((values) => recordPayment.mutate(values))}
            >
              Save payment
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={paymentForm.handleSubmit((v) => recordPayment.mutate(v))} noValidate>
          <Field label="Amount (KES)" htmlFor="amount" error={paymentForm.formState.errors.amount?.message} required>
            <Input id="amount" inputMode="decimal" {...paymentForm.register('amount')} />
          </Field>
          <Field label="Method" htmlFor="method">
            <Select id="method" {...paymentForm.register('method')}>
              <option value="M_PESA">M-Pesa</option>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          </Field>
          <Field label="Reference" htmlFor="reference" error={paymentForm.formState.errors.reference?.message} hint="M-Pesa code, cheque number, etc.">
            <Input id="reference" {...paymentForm.register('reference')} />
          </Field>
          <Field label="Notes" htmlFor="notes" error={paymentForm.formState.errors.notes?.message}>
            <Textarea id="notes" rows={2} {...paymentForm.register('notes')} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Void invoice"
        description="Voiding reverses the accounting entries. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidOpen(false)}>
              Keep invoice
            </Button>
            <Button
              variant="danger"
              loading={voidInvoice.isPending}
              onClick={voidForm.handleSubmit((values) => voidInvoice.mutate(values))}
            >
              Void invoice
            </Button>
          </>
        }
      >
        <form onSubmit={voidForm.handleSubmit((v) => voidInvoice.mutate(v))} noValidate>
          <Field label="Reason" htmlFor="reason" error={voidForm.formState.errors.reason?.message} required>
            <Textarea id="reason" rows={3} placeholder="Why is this invoice being voided?" {...voidForm.register('reason')} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums text-ink-900' : 'tabular-nums text-ink-700'}>
        {value}
      </span>
    </div>
  );
}