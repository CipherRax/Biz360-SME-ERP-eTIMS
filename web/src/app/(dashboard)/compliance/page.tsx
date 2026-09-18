'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Clock3,
  FileWarning,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import {
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
} from '@/components/ui';
import { expenseExposureApi, supplierEtimsApi } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils/format';

export default function CompliancePage() {
  const exposure = useQuery({
    queryKey: ['compliance', 'exposure-summary'],
    queryFn: () => expenseExposureApi.summary(),
  });
  const unmatched = useQuery({
    queryKey: ['compliance', 'unmatched'],
    queryFn: () => supplierEtimsApi.unmatched({ limit: 5 }),
  });

  const summary = exposure.data;
  const open = unmatched.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="Compliance center"
        description="Kenya revenue-compliant expense capturing, withholding tax and eTIMS coverage at a glance."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Unmatched expenses"
          value={summary ? `${summary.unmatchedCount}` : '—'}
          icon={FileWarning}
          tone={(summary?.unmatchedCount ?? 0) > 0 ? 'warning' : 'success'}
          hint="Purchase invoices without a matched supplier eTIMS receipt"
        />
        <StatCard
          label="Total exposure"
          value={summary ? formatMoney(summary.totalExposure) : '—'}
          icon={AlertTriangle}
          tone={(Number(summary?.totalExposure ?? 0)) > 0 ? 'warning' : 'success'}
          hint="CES payout risk if not backed by compliant receipts"
        />
        <StatCard
          label="Oldest pending"
          value={summary?.oldestUnmatchedAt ? String(summary.agesInDays) : '—'}
          icon={Clock3}
          tone="info"
          hint={
            summary?.oldestUnmatchedAt
              ? `days since ${formatDate(summary.oldestUnmatchedAt)}`
              : 'No open flags'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-brand" /> Expense matching
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-ink-600">
              Capture supplier eTIMS receipts from photos, PDFs or manual entry, then match them to
              purchase invoices. Unmatched expenses are flagged so they can be resolved before
              eTIMS filing.
            </p>
            <Link
              href="/compliance/expenses"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-deep hover:underline"
            >
              Open expense matching <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-brand" /> Withholding tax
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-ink-600">
              Apply statutory withholding rates to supplier payments, preview the net payable before
              paying, issue WHT certificates and track monthly remittances to KRA.
            </p>
            <Link
              href="/compliance/wht"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-deep hover:underline"
            >
              Open withholding tax <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recently flagged expenses</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {unmatched.isLoading ? (
            <SkeletonTable />
          ) : open.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No unmatched expenses"
              description="Every purchase invoice is backed by a captured supplier eTIMS receipt."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {open.map((item) => (
                    <TableRow key={item.purchaseInvoiceId}>
                      <TableCell className="font-medium text-ink-900">
                        {item.invoiceNumber}
                      </TableCell>
                      <TableCell>{item.supplier}</TableCell>
                      <TableCell>{formatDate(item.invoiceDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {open.length === 0 ? <TableEmpty colSpan={4}>Nothing flagged.</TableEmpty> : null}
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}