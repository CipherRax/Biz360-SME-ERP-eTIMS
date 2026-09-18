'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Download,
  FileBadge,
  RefreshCw,
  Scale,
  Settings2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonTable,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
  useToast,
} from '@/components/ui';
import { withholdingTaxApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { WhtRate, WithholdingTaxDeduction } from '@/types/domain';
import { WHT_PAYMENT_TYPES } from '@/lib/utils/status';

interface EligiblePayment {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  reference?: string | null;
  partyId: string;
  party: { name: string; taxId?: string | null };
}

export default function WithholdingTaxPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedPayment, setSelectedPayment] = useState('');
  const [ratesOpen, setRatesOpen] = useState(false);

  const summary = useQuery({
    queryKey: ['wht', 'remittance'],
    queryFn: () => withholdingTaxApi.remittanceSummary(),
  });
  const deductions = useQuery({
    queryKey: ['wht', 'deductions'],
    queryFn: () => withholdingTaxApi.list({ limit: 100 }),
  });
  const rates = useQuery({ queryKey: ['wht', 'rates'], queryFn: () => withholdingTaxApi.rates() });
  const payments = useQuery({
    queryKey: ['wht', 'eligible-payments'],
    queryFn: () => withholdingTaxApi.eligiblePayments(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['wht'] });

  const compute = useMutation({
    mutationFn: (paymentId: string) => withholdingTaxApi.compute(paymentId),
    onSuccess: () => {
      toast({ tone: 'info', title: 'Withholding tax computed for the preview' });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not compute withholding tax',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const record = useMutation({
    mutationFn: (paymentId: string) =>
      withholdingTaxApi.record({ paymentId }, newIdempotencyKey()),
    onSuccess: (deduction) => {
      toast({
        tone: 'success',
        title: `Withholding of ${formatMoney(Number(deduction.whtAmount))} recorded`,
      });
      setSelectedPayment('');
      compute.reset();
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not record deduction',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const certificate = useMutation({
    mutationFn: (deductionId: string) => withholdingTaxApi.certificate(deductionId),
    onSuccess: (deduction) => {
      toast({
        tone: 'success',
        title: `Certificate ${deduction.kraWhtCertificateNumber} issued`,
      });
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not issue certificate',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const eligible = payments.data ?? [];
  const preview = compute.data;
  const remittance = summary.data;
  const rows = deductions.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="Withholding tax"
        description="Quote, withhold and remit statutory withholding tax on supplier payments, with certificates your suppliers can use to offset their own PAYE/VAT."
        actions={
          <>
            <Button variant="secondary" onClick={() => setRatesOpen(true)}>
              <Settings2 className="h-4 w-4" /> Configure rates
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void summary.refetch();
                void deductions.refetch();
              }}
              disabled={summary.isFetching}
            >
              <RefreshCw className={summary.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Withheld (period)"
          value={remittance ? formatMoney(Number(remittance.totals.whtAmount)) : '—'}
          icon={Banknote}
          tone="warning"
          hint="Pending remittance to KRA by the 20th of the following month"
        />
        <StatCard
          label="Gross payments"
          value={remittance ? formatMoney(Number(remittance.totals.grossAmount)) : '—'}
          icon={Scale}
          tone="info"
          hint={`${remittance?.totals.count ?? 0} supplier payment(s)`}
        />
        <StatCard
          label="Deductions on file"
          value={deductions.data ? `${deductions.data.total}` : '—'}
          icon={FileBadge}
          tone="success"
          hint="Certificates issued on request"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview & record withholding</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Supplier payment" htmlFor="payment-select" className="flex-1">
              <Select
                id="payment-select"
                value={selectedPayment}
                onChange={(e) => {
                  setSelectedPayment(e.target.value);
                  if (e.target.value) compute.mutate(e.target.value);
                }}
              >
                <option value="">Select a payment to preview…</option>
                {eligible.map((payment: EligiblePayment) => (
                  <option key={payment.id} value={payment.id}>
                    {payment.party.name} · {formatMoney(payment.amount)} · {formatDate(payment.paidAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              loading={compute.isPending}
              disabled={!selectedPayment}
              onClick={() => compute.mutate(selectedPayment)}
            >
              <Scale className="h-4 w-4" /> Preview
            </Button>
          </div>

          {preview ? (
            <div className="flex flex-col gap-4 rounded-xl border border-ink-100 bg-ink-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-ink-900">
                  Gross {formatMoney(Number(preview.grossAmount))}{' '}
                  <span className="text-ink-500">({preview.ratePercent}% · {preview.rateSource})</span>
                </p>
                <p className="text-ink-700">
                  Withhold <span className="font-semibold text-error">{formatMoney(Number(preview.whtAmount))}</span> · Pay
                  <span className="font-semibold text-ink-900"> {formatMoney(Number(preview.netPayableAmount))}</span>
                </p>
              </div>
              <Button
                loading={record.isPending}
                onClick={() => record.mutate(selectedPayment)}
              >
                <Banknote className="h-4 w-4" /> Record deduction
              </Button>
            </div>
          ) : eligible.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No eligible supplier payments"
              description="Payments that haven't gone through withholding will appear here."
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Withholding deductions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {deductions.isLoading ? (
            <SkeletonTable />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileBadge}
              title="No deductions yet"
              description="Record a deduction above and it will be listed for remittance tracking."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell className="text-right">Gross</TableHeaderCell>
                    <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                    <TableHeaderCell className="text-right">Withheld</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Certificate</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <TableBody>
                  {rows.map((row: WithholdingTaxDeduction) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-ink-900">
                        {row.supplier.name}
                        {row.supplier.taxId ? (
                          <span className="ml-1 block text-xs font-normal text-ink-500">
                            {row.supplier.taxId}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge tone="info">{row.paymentType.replace(/_/g, ' ').toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(Number(row.grossAmount))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.ratePercent}%</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-ink-900">
                        {formatMoney(Number(row.whtAmount))}
                      </TableCell>
                      <TableCell>
                        <Badge tone={row.status === 'REMITTED' ? 'success' : row.status === 'WITHHELD' ? 'warning' : 'info'}>
                          {row.status.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.kraWhtCertificateNumber ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {!row.kraWhtCertificateNumber ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={certificate.isPending && certificate.variables === row.id}
                            onClick={() => certificate.mutate(row.id)}
                          >
                            <Download className="h-4 w-4" /> Issue
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      {remittance && (remittance.byPaymentType ?? []).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Remittance by payment type</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-2 py-2 font-semibold">Type</th>
                    <th className="px-2 py-2 text-right font-semibold">Gross</th>
                    <th className="px-2 py-2 text-right font-semibold">Withheld</th>
                    <th className="px-2 py-2 text-right font-semibold">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {remittance.byPaymentType.map((row) => (
                    <tr key={row.paymentType} className="border-b border-ink-100/70">
                      <td className="px-2 py-2.5 font-medium text-ink-900">
                        {row.paymentType.replace(/_/g, ' ').toLowerCase()}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {formatMoney(Number(row.grossAmount))}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium text-ink-900">
                        {formatMoney(Number(row.whtAmount))}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <RatesModal
        open={ratesOpen}
        onClose={() => setRatesOpen(false)}
        rates={rates.data}
        loading={rates.isLoading}
        onChanges={() => invalidate()}
      />
    </div>
  );
}

function RatesModal({
  open,
  onClose,
  rates,
  loading,
  onChanges,
}: {
  open: boolean;
  onClose: () => void;
  rates?: { systemDefaults: WhtRate[]; organizationOverrides: WhtRate[] } | null;
  loading: boolean;
  onChanges: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingType, setEditingType] = useState<{
    paymentType: string;
    ratePercent: string;
  } | null>(null);

  const saveRate = useMutation({
    mutationFn: (values: { paymentType: string; ratePercent: string }) =>
      withholdingTaxApi.upsertRate(
        {
          paymentType: values.paymentType as WhtRate['paymentType'],
          residency: 'RESIDENT',
          ratePercent: values.ratePercent.trim(),
          defaults: true,
        },
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Custom rate saved for this organization' });
      setEditingType(null);
      void queryClient.invalidateQueries({ queryKey: ['wht', 'rates'] });
      onChanges();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not save rate',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const effective = (paymentType: string): { rate: string; source: 'system' | 'custom' } => {
    const custom = (rates?.organizationOverrides ?? []).find((r) => r.paymentType === paymentType);
    const system = (rates?.systemDefaults ?? []).find((r) => r.paymentType === paymentType);
    if (custom) return { rate: custom.ratePercent, source: 'custom' };
    if (system) return { rate: system.ratePercent, source: 'system' };
    return { rate: '—', source: 'system' };
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withholding tax rates"
      description="Rates apply to resident payees. Override the KRA defaults at organization level as allowed by the Income Tax Act."
    >
      {loading ? (
        <SkeletonTable />
      ) : (
        <div className="flex flex-col gap-2">
          {WHT_PAYMENT_TYPES.map((type) => {
            const meta = effective(type);
            const isEditing = editingType?.paymentType === type;
            return (
              <div
                key={type}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {type.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p className="text-xs text-ink-500">
                    {meta.rate === '—' ? 'No default configured' : `${meta.rate}% · ${meta.source} default`}
                  </p>
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      className="w-24"
                      defaultValue={editingType.ratePercent}
                      onChange={(e) =>
                        setEditingType({ paymentType: type, ratePercent: e.target.value })
                      }
                    />
                    <Button
                      size="sm"
                      loading={saveRate.isPending}
                      disabled={!/^\d{1,4}(\.\d{1,4})?$/.test(editingType.ratePercent)}
                      onClick={() => saveRate.mutate({ paymentType: type, ratePercent: editingType.ratePercent })}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingType(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setEditingType({ paymentType: type, ratePercent: meta.rate === '—' ? '5' : meta.rate })}>
                    <Settings2 className="h-4 w-4" /> Override
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}