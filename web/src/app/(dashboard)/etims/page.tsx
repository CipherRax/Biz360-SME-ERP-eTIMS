'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import {
  Badge,
  Button,
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
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
  useToast,
} from '@/components/ui';
import { etimsApi, salesApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Invoice } from '@/types/domain';

export default function EtimsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const status = useQuery({ queryKey: ['etims', 'status'], queryFn: () => etimsApi.status() });
  const invoices = useQuery({
    queryKey: ['invoices', 'etims-queue'],
    queryFn: () => salesApi.invoices.list({ limit: 100 }),
  });

  const pending = useMemo(
    () =>
      (invoices.data ?? []).filter(
        (invoice: Invoice) => !invoice.etimsSubmittedAt && invoice.status !== 'DRAFT' && invoice.status !== 'VOID',
      ),
    [invoices.data],
  );

  const trigger = useMutation({
    mutationFn: (id: string) => etimsApi.trigger(id, newIdempotencyKey()),
    onSuccess: (result) => {
      toast({
        tone: result.alreadySubmitted ? 'info' : 'success',
        title: result.alreadySubmitted
          ? `${result.invoiceNumber} was already submitted`
          : `${result.invoiceNumber} queued for eTIMS`,
      });
      void queryClient.invalidateQueries({ queryKey: ['etims'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Submission failed',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const info = status.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="KRA eTIMS"
        description="Monitor the connection to KRA and submit outstanding invoices for control numbers."
        actions={
          <Button variant="secondary" onClick={() => void status.refetch()} disabled={status.isFetching}>
            <RefreshCw className={status.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Connection mode"
          value={info ? (info.mode === 'live' ? 'Live' : 'Mock') : '—'}
          icon={ShieldCheck}
          tone={info?.mode === 'live' ? 'success' : 'info'}
          hint={info?.liveReady ? 'Ready to submit to KRA' : 'Live credentials not configured'}
        />
        <StatCard
          label="Pending submissions"
          value={formatNumber(info?.unsubmittedInvoices ?? pending.length, 0)}
          icon={UploadCloud}
          tone={(info?.unsubmittedInvoices ?? pending.length) > 0 ? 'warning' : 'success'}
          hint="Confirmed invoices without a control number"
        />
        <StatCard
          label="Taxpayer PIN"
          value={info?.orgTaxPinPresent ? 'Configured' : 'Missing'}
          icon={info?.orgTaxPinPresent ? CheckCircle2 : AlertTriangle}
          tone={info?.orgTaxPinPresent ? 'success' : 'warning'}
          hint="Set under Settings → Organization"
        />
      </div>

      {info && info.mode === 'mock' ? (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="flex items-start gap-3 py-5 text-sm text-ink-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <div>
              <p className="font-semibold text-ink-900">Running in mock mode</p>
              <p className="mt-1">
                Submissions are simulated end-to-end but no data is sent to KRA. Switch to live mode
                once your device serial and taxpayer PIN are configured.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Submission queue</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {invoices.isLoading ? (
            <SkeletonTable />
          ) : pending.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All caught up"
              description="Confirmed invoices have been submitted to eTIMS."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell className="text-right">Total</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <TableBody>
                  {pending.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium text-ink-900">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{invoice.party?.name ?? '—'}</TableCell>
                      <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(invoice.total)}</TableCell>
                      <TableCell>
                        <Badge tone="warning">Not submitted</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          loading={trigger.isPending && trigger.variables === invoice.id}
                          onClick={() => trigger.mutate(invoice.id)}
                        >
                          <UploadCloud className="h-4 w-4" /> Submit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently submitted</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <TableWrapper className="border-0">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Invoice</TableHeaderCell>
                  <TableHeaderCell>Customer</TableHeaderCell>
                  <TableHeaderCell>Control number</TableHeaderCell>
                  <TableHeaderCell>Submitted</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {(invoices.data ?? [])
                  .filter((invoice) => Boolean(invoice.etimsSubmittedAt))
                  .slice(0, 10)
                  .map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium text-ink-900">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{invoice.party?.name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{invoice.etimsCtrlNo ?? '—'}</TableCell>
                      <TableCell>
                        {invoice.etimsSubmittedAt ? formatDateTime(invoice.etimsSubmittedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                {(invoices.data ?? []).filter((invoice) => Boolean(invoice.etimsSubmittedAt)).length === 0 ? (
                  <TableEmpty colSpan={4}>No submissions yet.</TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>
    </div>
  );
}