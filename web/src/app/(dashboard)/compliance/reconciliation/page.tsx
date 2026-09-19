'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Scale,
  XCircle,
} from 'lucide-react';
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
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui';
import { reconciliationApi } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils/format';

export default function ReconciliationPage() {
  const reconciliation = useQuery({
    queryKey: ['compliance', 'reconciliation'],
    queryFn: () => reconciliationApi.get(),
  });

  const data = reconciliation.data;
  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="Purchase ledger reconciliation"
        description="Surfaces unpaid purchases and voided entries that may still carry KRA eTIMS receipts or WHT deductions — the most likely sources of year-end audit drift."
        actions={
          <Button
            variant="secondary"
            onClick={() => void reconciliation.refetch()}
            disabled={reconciliation.isFetching}
          >
            <RefreshCw className={reconciliation.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unpaid purchases"
          value={summary ? `${summary.unpaidCount}` : '—'}
          icon={AlertTriangle}
          tone="warning"
          hint={summary ? `Ksh ${Number(summary.unpaidTotal).toLocaleString()} outstanding` : undefined}
        />
        <StatCard
          label="Outstanding total"
          value={summary ? formatMoney(Number(summary.unpaidTotal)) : '—'}
          icon={Scale}
          tone="info"
        />
        <StatCard
          label="Voided purchases"
          value={summary ? `${summary.voidedCount}` : '—'}
          icon={XCircle}
          tone="error"
        />
        <StatCard
          label="Voided with eTIMS"
          value={summary ? `${summary.voidedWithEtimsCount}` : '—'}
          icon={AlertTriangle}
          tone="brand"
          hint="Purchase voided but supplier eTIMS receipt still linked"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unpaid purchases</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {reconciliation.isLoading ? (
            <SkeletonTable />
          ) : !data || data.unpaid.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All purchases paid"
              description="No outstanding purchase invoices found."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell className="text-right">Total</TableHeaderCell>
                    <TableHeaderCell className="text-right">Paid</TableHeaderCell>
                    <TableHeaderCell className="text-right">Outstanding</TableHeaderCell>
                    <TableHeaderCell>eTIMS</TableHeaderCell>
                    <TableHeaderCell>Due</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {data.unpaid.map((r) => (
                    <TableRow key={r.purchaseInvoiceId}>
                      <TableCell className="font-mono text-xs font-medium text-ink-900">
                        {r.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink-900">{r.supplier}</span>
                        {r.supplierTaxId ? (
                          <span className="ml-1 text-xs text-ink-500">{r.supplierTaxId}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(Number(r.total))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(Number(r.amountPaid))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-ink-900">
                        {formatMoney(Number(r.outstanding))}
                      </TableCell>
                      <TableCell>
                        {r.etimsMatched ? (
                          <Badge tone="success">matched</Badge>
                        ) : (
                          <Badge tone="warning">no match</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-ink-500">
                        {r.dueDate ? formatDate(r.dueDate) : '—'}
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
          <CardTitle>Voided purchases</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {reconciliation.isLoading ? (
            <SkeletonTable />
          ) : !data || data.voided.length === 0 ? (
            <EmptyState
              icon={XCircle}
              title="No voided purchases"
              description="No voided purchase invoices found."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell>Voided</TableHeaderCell>
                    <TableHeaderCell>Reason</TableHeaderCell>
                    <TableHeaderCell>eTIMS receipt</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {data.voided.map((r) => (
                    <TableRow key={r.purchaseInvoiceId}>
                      <TableCell className="font-mono text-xs font-medium text-ink-900">
                        {r.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink-900">{r.supplier}</span>
                        {r.supplierTaxId ? (
                          <span className="ml-1 text-xs text-ink-500">{r.supplierTaxId}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-ink-500">
                        {r.voidedAt ? formatDate(r.voidedAt) : '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-ink-500">
                        {r.voidReason ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.etimsReceiptLinked ? (
                          <Badge tone="error">
                            <AlertTriangle className="mr-1 h-3 w-3" /> Linked
                          </Badge>
                        ) : (
                          <Badge tone="neutral">none</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}