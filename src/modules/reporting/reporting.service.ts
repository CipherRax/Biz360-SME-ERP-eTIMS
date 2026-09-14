import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

const OPEN_SALE_STATUS = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'];
const OPENABLE_SALE_STATUS = ['CONFIRMED', 'PARTIALLY_PAID'];

/**
 * Read-only aggregate reports. Uses raw SQL for date-grouped aggregations that
 * Prisma's typed query builder can't express; every query is scoped to the
 * tenant via a bound `organizationId` parameter.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private dateRange(from?: string, to?: string): { from: Date; to: Date } {
    const now = new Date();
    const start = from
      ? new Date(from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = to ? new Date(to) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid date range');
    }
    return { from: start, to: end };
  }

  async salesSummary(organizationId: string, from?: string, to?: string) {
    const { from: f, to: t } = this.dateRange(from, to);
    const rows = await this.prisma.client.$queryRaw(Prisma.sql`
      SELECT DATE("invoiceDate") AS day,
             COUNT(*)::int AS invoices,
             COALESCE(SUM("total"), 0) AS revenue,
             COALESCE(SUM("taxTotal"), 0) AS tax,
             COALESCE(SUM("discountTotal"), 0) AS discount
      FROM sale_invoices
      WHERE "organizationId" = ${organizationId}
        AND "status" IN (${Prisma.join(OPEN_SALE_STATUS)})
        AND "invoiceDate" >= ${f}
        AND "invoiceDate" < ${t}
      GROUP BY DATE("invoiceDate")
      ORDER BY day ASC
    `);
    const days = (rows as Array<{
      day: Date;
      invoices: number;
      revenue: Prisma.Decimal;
      tax: Prisma.Decimal;
      discount: Prisma.Decimal;
    }>).map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      invoices: Number(row.invoices),
      revenue: Number(row.revenue),
      tax: Number(row.tax),
      discount: Number(row.discount),
    }));
    return {
      from: f.toISOString(),
      to: t.toISOString(),
      days,
      totals: {
        invoices: days.reduce((a, d) => a + d.invoices, 0),
        revenue: days.reduce((a, d) => a + d.revenue, 0),
        tax: days.reduce((a, d) => a + d.tax, 0),
        discount: days.reduce((a, d) => a + d.discount, 0),
      },
    };
  }

  /** Open receivables grouped by customer (CONFIRMED / PARTIALLY_PAID). */
  async receivables(organizationId: string) {
    const rows = await this.prisma.client.$queryRaw(Prisma.sql`
      SELECT p.id AS party_id, p.name, p."taxId" AS tax_id,
             COALESCE(SUM(si."total" - si."amountPaid"), 0) AS outstanding,
             COUNT(*)::int AS open_invoices
      FROM sale_invoices si
      JOIN parties p ON p.id = si."partyId"
      WHERE si."organizationId" = ${organizationId}
        AND si."status" IN (${Prisma.join(OPENABLE_SALE_STATUS)})
      GROUP BY p.id, p.name, p."taxId"
      HAVING SUM(si."total" - si."amountPaid") > 0
      ORDER BY outstanding DESC
    `);
    const customers = (rows as Array<{
      party_id: string;
      name: string;
      tax_id: string | null;
      outstanding: Prisma.Decimal;
      open_invoices: number;
    }>).map((r) => ({
      customerId: r.party_id,
      name: r.name,
      taxId: r.tax_id,
      outstanding: Number(r.outstanding),
      openInvoices: Number(r.open_invoices),
    }));
    return {
      customers,
      totalOutstanding: customers.reduce((a, c) => a + c.outstanding, 0),
    };
  }

  /** Open payables grouped by supplier (CONFIRMED / PARTIALLY_PAID). */
  async payables(organizationId: string) {
    const rows = await this.prisma.client.$queryRaw(Prisma.sql`
      SELECT p.id AS party_id, p.name, p."taxId" AS tax_id,
             COALESCE(SUM(pi."total" - pi."amountPaid"), 0) AS outstanding,
             COUNT(*)::int AS open_invoices
      FROM purchase_invoices pi
      JOIN parties p ON p.id = pi."partyId"
      WHERE pi."organizationId" = ${organizationId}
        AND pi."status" IN (${Prisma.join(OPENABLE_SALE_STATUS)})
      GROUP BY p.id, p.name, p."taxId"
      HAVING SUM(pi."total" - pi."amountPaid") > 0
      ORDER BY outstanding DESC
    `);
    const suppliers = (rows as Array<{
      party_id: string;
      name: string;
      tax_id: string | null;
      outstanding: Prisma.Decimal;
      open_invoices: number;
    }>).map((r) => ({
      supplierId: r.party_id,
      name: r.name,
      taxId: r.tax_id,
      outstanding: Number(r.outstanding),
      openInvoices: Number(r.open_invoices),
    }));
    return {
      suppliers,
      totalOutstanding: suppliers.reduce((a, s) => a + s.outstanding, 0),
    };
  }

  /** Top selling items by revenue over a period. */
  async topItems(organizationId: string, from?: string, to?: string, limit = 10) {
    const { from: f, to: t } = this.dateRange(from, to);
    const k = Math.max(1, Math.min(limit, 50));
    const rows = await this.prisma.client.$queryRaw(Prisma.sql`
      SELECT il."itemId" AS item_id,
             MAX(i.name) AS name,
             SUM(il."quantity") AS qty,
             SUM(il."lineTotal") AS revenue,
             SUM(il."taxAmount") AS tax
      FROM sale_invoice_lines il
      JOIN sale_invoices si ON si.id = il."invoiceId"
      JOIN items i ON i.id = il."itemId"
      WHERE il."organizationId" = ${organizationId}
        AND si."status" IN (${Prisma.join(OPEN_SALE_STATUS)})
        AND si."invoiceDate" >= ${f}
        AND si."invoiceDate" < ${t}
      GROUP BY il."itemId"
      ORDER BY revenue DESC
      LIMIT ${k}
    `);
    return (rows as Array<{
      item_id: string;
      name: string;
      qty: Prisma.Decimal;
      revenue: Prisma.Decimal;
      tax: Prisma.Decimal;
    }>).map((r) => ({
      itemId: r.item_id,
      name: r.name,
      qty: Number(r.qty),
      revenue: Number(r.revenue),
      tax: Number(r.tax),
    }));
  }

  private async countLowStock(organizationId: string): Promise<number> {
    const rows = await this.prisma.client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM items
      WHERE "organizationId" = ${organizationId}
        AND "stockOnHand" <= "reorderLevel"
        AND active = true
    `);
    return Number((rows as Array<{ n: number }>)[0].n);
  }

  /** Dashboard KPIs. */
  async dashboard(organizationId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [salesThisMonth, salesToday, receivables, payables, lowStock, unsubmitted, summary] =
      await Promise.all([
        this.prisma.client.saleInvoice.aggregate({
          _sum: { total: true },
          _count: true,
          where: {
            organizationId,
            status: { in: OPEN_SALE_STATUS as never },
            invoiceDate: { gte: monthStart },
          },
        }),
        this.prisma.client.saleInvoice.aggregate({
          _sum: { total: true },
          where: {
            organizationId,
            status: { in: OPEN_SALE_STATUS as never },
            invoiceDate: { gte: dayStart },
          },
        }),
        this.receivables(organizationId),
        this.payables(organizationId),
        this.countLowStock(organizationId),
        this.prisma.client.saleInvoice.count({
          where: {
            organizationId,
            status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
            etimsSubmittedAt: null,
          },
        }),
        this.inventory.stockSummary(organizationId, undefined, 500),
      ]);

    return {
      salesToday: Number(salesToday._sum.total ?? 0),
      salesThisMonth: Number(salesThisMonth._sum.total ?? 0),
      invoicesThisMonth: salesThisMonth._count,
      receivables: Number(receivables.totalOutstanding),
      payables: Number(payables.totalOutstanding),
      stockValuation: summary.totals.valuation,
      stockUnits: summary.totals.units,
      lowStockItems: Number(lowStock),
      unsubmittedEtimsInvoices: Number(unsubmitted),
    };
  }
}