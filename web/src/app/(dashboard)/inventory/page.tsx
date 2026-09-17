'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, RefreshCw, TrendingDown, Warehouse } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
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
import { inventoryApi } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/utils/format';

export default function InventoryPage() {
  const [lowOnly, setLowOnly] = useState(false);

  const summary = useQuery({
    queryKey: ['inventory', 'stock-summary'],
    queryFn: () => inventoryApi.stock.summary({ limit: 200 }),
  });

  const items = summary.data?.items ?? [];
  const rows = lowOnly ? items.filter((item) => item.lowStock) : items;
  const totals = summary.data?.totals;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        description="Live stock on hand, valuation and reorder alerts across your catalogue."
        actions={
          <Button variant="secondary" onClick={() => void summary.refetch()} disabled={summary.isFetching}>
            <RefreshCw className={summary.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Stock valuation"
          value={formatMoney(totals?.valuation ?? 0)}
          icon={Warehouse}
          tone="brand"
          hint="At current unit cost"
        />
        <StatCard
          label="Units on hand"
          value={formatNumber(totals?.units ?? 0, 0)}
          icon={Package}
          tone="info"
        />
        <StatCard
          label="Low-stock lines"
          value={formatNumber(items.filter((item) => item.lowStock).length, 0)}
          icon={TrendingDown}
          tone={items.some((item) => item.lowStock) ? 'warning' : 'success'}
          hint="At or below reorder level"
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Stock summary</CardTitle>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(event) => setLowOnly(event.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand focus:ring-brand/30"
            />
            Low stock only
          </label>
        </CardHeader>
        <CardContent className="pt-0">
          {summary.isError ? (
            <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
              Could not load inventory. Please refresh.
            </div>
          ) : rows.length === 0 && !summary.isLoading ? (
            <EmptyState
              icon={Package}
              title={lowOnly ? 'Nothing needs reordering' : 'No stock recorded'}
              description={
                lowOnly
                  ? 'All items are above their reorder levels.'
                  : 'Add products and receive stock to see your inventory here.'
              }
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Product</TableHeaderCell>
                    <TableHeaderCell>Category</TableHeaderCell>
                    <TableHeaderCell className="text-right">On hand</TableHeaderCell>
                    <TableHeaderCell className="text-right">Unit cost</TableHeaderCell>
                    <TableHeaderCell className="text-right">Valuation</TableHeaderCell>
                    <TableHeaderCell className="text-right">Reorder</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {summary.isLoading ? (
                    <TableEmpty colSpan={6}>Loading stock…</TableEmpty>
                  ) : rows.length === 0 ? (
                    <TableEmpty colSpan={6}>No items match this filter.</TableEmpty>
                  ) : (
                    rows.map((item) => (
                      <TableRow key={item.itemId}>
                        <TableCell className="font-medium text-ink-900">{item.name}</TableCell>
                        <TableCell>{item.category ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(item.stockOnHand, 0)}
                          {item.lowStock ? (
                            <Badge tone="warning" className="ml-2">
                              Low
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.unitCost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.valuation)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.reorderLevel ? formatNumber(item.reorderLevel, 0) : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}