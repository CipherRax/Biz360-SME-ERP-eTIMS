'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
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
import { driftApi } from '@/lib/api';
import type { DriftItem, DriftType } from '@/types/domain';

const DRIFT_COLORS: Record<string, string> = {
  UNVERIFIED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  MATCH_STALE: 'bg-orange-100 text-orange-800 border-orange-200',
  MISSING_QR: 'bg-blue-100 text-blue-800 border-blue-200',
  VERIFICATION_FAILED: 'bg-red-100 text-red-800 border-red-200',
};

const DRIFT_ICONS: Record<string, LucideIcon> = {
  UNVERIFIED: Search,
  MATCH_STALE: AlertTriangle,
  MISSING_QR: FileWarning,
  VERIFICATION_FAILED: XCircle,
};

function DriftBadge({ driftType }: { driftType: DriftType }) {
  const Icon = DRIFT_ICONS[driftType] ?? Search;
  const label = driftType.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${DRIFT_COLORS[driftType] ?? 'bg-gray-100 text-gray-800'}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default function DriftReportPage() {
  const {
    data: report,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['compliance', 'drift-report'],
    queryFn: () => driftApi.get(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Compliance"
          title="Drift Report"
          description="Detects verification gaps and stale matches in your eTIMS invoice records."
        />
        <SkeletonTable rows={5} columns={5} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Compliance"
          title="Drift Report"
          description="Detects verification gaps and stale matches in your eTIMS invoice records."
        />
        <EmptyState
          icon={Search}
          title="No drift data available"
          description="No eTIMS invoices to analyze."
        />
      </div>
    );
  }

  const hasNoDrift = report.driftCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          eyebrow="Compliance"
          title="Drift Report"
          description="Detects verification gaps and stale matches in your eTIMS invoice records."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Invoices"
          value={String(report.totalInvoices)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Drift Items"
          value={String(report.driftCount)}
          icon={AlertTriangle}
          tone={report.driftCount > 0 ? 'error' : 'success'}
          hint={report.driftCount > 0 ? 'Attention needed' : 'All clear'}
        />
        {Object.entries(report.byType).map(([type, count]) => (
          <StatCard
            key={type}
            label={type.replace(/_/g, ' ')}
            value={String(count)}
            icon={DRIFT_ICONS[type] ?? Search}
            tone="warning"
          />
        ))}
      </div>

      {hasNoDrift ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-500" />
            <p className="text-sm font-medium text-gray-900">All clear</p>
            <p className="mt-1 text-xs text-gray-500">
              All {report.totalInvoices} invoices are verified and match status is current.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-700">
              {report.driftCount} drift item{report.driftCount !== 1 ? 's' : ''} found
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table>
                <TableHeaderCell>
                  <TableRow>
                    <TableHead>KRA Invoice</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Captured</TableHead>
                  </TableRow>
                </TableHeaderCell>
                <TableBody>
                  {report.drifts.map((d: DriftItem) => (
                    <TableRow key={d.invoiceId}>
                      <TableCell className="font-mono text-xs">{d.kraInvoiceNumber}</TableCell>
                      <TableCell>{d.supplierName}</TableCell>
                      <TableCell className="text-right">KES {d.amount}</TableCell>
                      <TableCell><DriftBadge driftType={d.driftType} /></TableCell>
                      <TableCell className="max-w-xs text-xs text-gray-600">{d.detail}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-gray-400">
        Generated: {new Date(report.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
