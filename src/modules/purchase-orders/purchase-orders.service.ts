import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartyType, Prisma, PurchaseOrderStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { round2, sum, toAmount } from '../../common/helpers/money.js';
import {
  CreatePurchaseOrderDto,
  RejectPurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const PO_LINES = {
  id: true,
  itemId: true,
  description: true,
  quantity: true,
  receivedQty: true,
  unitPrice: true,
  taxRate: true,
  discountPct: true,
  lineDiscount: true,
  lineAmount: true,
  lineTotal: true,
  taxAmount: true,
  sortOrder: true,
} as const;

const PO_SAFE_FIELDS = {
  id: true,
  poNumber: true,
  partyId: true,
  party: { select: { id: true, name: true, type: true, taxId: true } },
  orderDate: true,
  expectedDate: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  currency: true,
  notes: true,
  approvedBy: true,
  approvedAt: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
} as const;

const PO_WITH_LINES = {
  ...PO_SAFE_FIELDS,
  lines: { orderBy: { sortOrder: 'asc' as const }, select: PO_LINES },
};

/* -------------------------------------------------------------------------- */
/*  Line computation (same math as purchasing)                                 */
/* -------------------------------------------------------------------------- */

interface ComputedLine {
  itemId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  lineAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  sortOrder: number;
}

function computeLine(
  dto: {
    itemId?: string;
    description?: string;
    quantity: string;
    unitPrice: string;
    taxRate?: string;
    discountPct?: string;
    lineDiscount?: string;
  },
  item: { name: string; sellPrice?: Prisma.Decimal | null; taxCode?: string | null },
  orgTaxRate: number,
  sortOrder: number,
): ComputedLine {
  const qty = dto.quantity ? Number.parseFloat(dto.quantity) : 1;
  const price = toAmount(dto.unitPrice ?? (item.sellPrice != null ? item.sellPrice.toString() : '0'));
  const taxRate = toAmount(dto.taxRate ?? (item.taxCode ? String(orgTaxRate) : '0'));
  const discountPct = toAmount(dto.discountPct ?? 0);
  const lineDiscount = toAmount(dto.lineDiscount ?? 0);

  const lineAmount = round2(qty * price);
  const afterPctDiscount = round2(lineAmount * (1 - discountPct / 100));
  const lineTotal = round2(afterPctDiscount - lineDiscount);
  const taxAmount = round2((lineTotal * taxRate) / 100);

  const dec = (v: number) => new Prisma.Decimal(Number.isInteger(v) ? v.toString() : v.toFixed(3));

  return {
    itemId: dto.itemId ?? null,
    description: dto.description ?? item.name,
    quantity: dec(qty),
    unitPrice: new Prisma.Decimal(price.toFixed(2)),
    taxRate: new Prisma.Decimal(taxRate.toFixed(2)),
    discountPct: new Prisma.Decimal(discountPct.toFixed(2)),
    lineDiscount: new Prisma.Decimal(lineDiscount.toFixed(2)),
    lineAmount: new Prisma.Decimal(lineAmount.toFixed(2)),
    lineTotal: new Prisma.Decimal(lineTotal.toFixed(2)),
    taxAmount: new Prisma.Decimal(taxAmount.toFixed(2)),
    sortOrder,
  };
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                   */
/* -------------------------------------------------------------------------- */

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.purchaseOrderNumberSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `PO-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  private async assertSupplierOrBoth(organizationId: string, partyId: string) {
    const party = await this.prisma.client.party.findFirst({
      where: { id: partyId, organizationId },
      select: { id: true, type: true },
    });
    if (!party) throw new NotFoundException('Party not found');
    if (party.type === PartyType.CUSTOMER) {
      throw new BadRequestException(
        'Party is a customer; purchase orders require a supplier',
      );
    }
  }

  private async loadLinesAndItems(
    organizationId: string,
    dtoLines: Array<{
      itemId?: string;
      description?: string;
      quantity: string;
      unitPrice: string;
      taxRate?: string;
      discountPct?: string;
      lineDiscount?: string;
    }>,
    orgTaxRate: number,
  ): Promise<ComputedLine[]> {
    const itemIds = dtoLines
      .filter((l) => l.itemId)
      .map((l) => l.itemId!) as string[];
    const items = itemIds.length
      ? await this.prisma.client.item.findMany({
          where: { id: { in: itemIds }, organizationId },
          select: { id: true, name: true, sellPrice: true, taxCode: true },
        })
      : [];
    const itemMap = new Map(items.map((i) => [i.id, i]));

    for (const id of itemIds) {
      if (!itemMap.has(id)) {
        throw new NotFoundException(`Item ${id} not found in this organization`);
      }
    }

    return dtoLines.map((dtoLine, i) =>
      computeLine(
        dtoLine,
        dtoLine.itemId
          ? itemMap.get(dtoLine.itemId)!
          : { name: 'Item', sellPrice: null, taxCode: null },
        orgTaxRate,
        i,
      ),
    );
  }

  private computeTotals(lines: ComputedLine[]) {
    const subtotal = sum(lines.map((l) => Number(l.lineAmount)));
    const lineTotals = lines.map((l) => Number(l.lineTotal));
    const taxTotal = sum(lines.map((l) => Number(l.taxAmount)));
    const discountTotal = round2(subtotal - sum(lineTotals));
    const total = round2(sum(lineTotals) + taxTotal);
    return { subtotal, discountTotal, taxTotal, total };
  }

  private async readOne(organizationId: string, purchaseId: string) {
    const purchaseOrder = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: purchaseId, organizationId },
      select: PO_WITH_LINES,
    });
    if (!purchaseOrder) throw new NotFoundException('Purchase order not found');
    return purchaseOrder;
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT)                                                          */
  /* ----------------------------------------------------------------------- */

  async create(
    organizationId: string,
    dto: CreatePurchaseOrderDto,
    userId: string,
  ) {
    if (dto.partyId !== undefined) {
      await this.assertSupplierOrBoth(organizationId, dto.partyId);
    }

    const orgSetting = await this.prisma.client.organizationSetting.findFirst({
      where: { organizationId },
      select: { taxRate: true, currency: true },
    });
    const orgTaxRate = Number(orgSetting?.taxRate ?? 16);

    const computedLines = await this.loadLinesAndItems(organizationId, dto.lines, orgTaxRate);
    const { subtotal, discountTotal, taxTotal, total } =
      this.computeTotals(computedLines);

    return this.prisma.client.$transaction(async (tx) => {
      const poNumber = await this.allocateNumber(organizationId, tx);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          organizationId,
          poNumber,
          partyId: dto.partyId,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          status: PurchaseOrderStatus.DRAFT,
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          discountTotal: new Prisma.Decimal(discountTotal.toFixed(2)),
          taxTotal: new Prisma.Decimal(taxTotal.toFixed(2)),
          total: new Prisma.Decimal(total.toFixed(2)),
          currency: dto.currency ?? orgSetting?.currency ?? 'KES',
          notes: dto.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
          lines: {
            create: computedLines.map((cl) => ({
              organizationId,
              itemId: cl.itemId,
              description: cl.description,
              quantity: cl.quantity,
              unitPrice: cl.unitPrice,
              taxRate: cl.taxRate,
              discountPct: cl.discountPct,
              lineDiscount: cl.lineDiscount,
              lineAmount: cl.lineAmount,
              lineTotal: cl.lineTotal,
              taxAmount: cl.taxAmount,
              sortOrder: cl.sortOrder,
            })),
          },
        },
        select: PO_WITH_LINES,
      });

      return purchaseOrder;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Update (DRAFT only)                                                     */
  /* ----------------------------------------------------------------------- */

  async update(
    organizationId: string,
    purchaseId: string,
    dto: UpdatePurchaseOrderDto,
    userId: string,
  ) {
    if (dto.partyId !== undefined) {
      await this.assertSupplierOrBoth(organizationId, dto.partyId);
    }

    const orgTaxRate = Number(
      (
        await this.prisma.client.organizationSetting.findFirst({
          where: { organizationId },
          select: { taxRate: true },
        })
      )?.taxRate ?? 16,
    );

    let computedLines: ComputedLine[] | undefined;
    let totals: ReturnType<PurchaseOrdersService['computeTotals']> | undefined;
    if (dto.lines) {
      computedLines = await this.loadLinesAndItems(organizationId, dto.lines, orgTaxRate);
      totals = this.computeTotals(computedLines);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: purchaseId, organizationId },
        select: { id: true, status: true },
      });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('Only draft purchase orders can be edited');
      }

      if (computedLines) {
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: purchaseId } });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id: purchaseId },
        data: {
          ...(dto.partyId !== undefined ? { partyId: dto.partyId } : {}),
          ...(dto.orderDate !== undefined ? { orderDate: new Date(dto.orderDate) } : {}),
          ...(dto.expectedDate !== undefined
            ? { expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null }
            : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(computedLines
            ? {
                lines: {
                  create: computedLines.map((cl) => ({
                    organizationId,
                    itemId: cl.itemId,
                    description: cl.description,
                    quantity: cl.quantity,
                    unitPrice: cl.unitPrice,
                    taxRate: cl.taxRate,
                    discountPct: cl.discountPct,
                    lineDiscount: cl.lineDiscount,
                    lineAmount: cl.lineAmount,
                    lineTotal: cl.lineTotal,
                    taxAmount: cl.taxAmount,
                    sortOrder: cl.sortOrder,
                  })),
                },
                subtotal: new Prisma.Decimal(totals!.subtotal.toFixed(2)),
                discountTotal: new Prisma.Decimal(totals!.discountTotal.toFixed(2)),
                taxTotal: new Prisma.Decimal(totals!.taxTotal.toFixed(2)),
                total: new Prisma.Decimal(totals!.total.toFixed(2)),
              }
            : {}),
          updatedBy: userId,
        },
        select: PO_WITH_LINES,
      });

      return updated;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Status transitions (optimistic compare-and-swap on status)              */
  /* ----------------------------------------------------------------------- */

  private async transition(
    organizationId: string,
    purchaseId: string,
    expected: PurchaseOrderStatus,
    next: PurchaseOrderStatus,
    data: Prisma.PurchaseOrderUpdateManyMutationInput,
  ) {
    const cas = await this.prisma.client.purchaseOrder.updateMany({
      where: { id: purchaseId, organizationId, status: expected },
      data: { ...data, status: next },
    });
    if (cas.count === 1) return this.readOne(organizationId, purchaseId);

    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: purchaseId, organizationId },
      select: { status: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    throw new ConflictException(
      `Cannot transition a purchase order from ${po.status} to ${next}; expected ${expected}`,
    );
  }

  async submit(organizationId: string, purchaseId: string, userId: string) {
    return this.transition(
      organizationId,
      purchaseId,
      PurchaseOrderStatus.DRAFT,
      PurchaseOrderStatus.SUBMITTED,
      { updatedBy: userId },
    );
  }

  async approve(organizationId: string, purchaseId: string, userId: string) {
    return this.transition(
      organizationId,
      purchaseId,
      PurchaseOrderStatus.SUBMITTED,
      PurchaseOrderStatus.APPROVED,
      { updatedBy: userId, approvedBy: userId, approvedAt: new Date() },
    );
  }

  async reject(
    organizationId: string,
    purchaseId: string,
    dto: RejectPurchaseOrderDto,
    userId: string,
  ) {
    return this.transition(
      organizationId,
      purchaseId,
      PurchaseOrderStatus.SUBMITTED,
      PurchaseOrderStatus.REJECTED,
      { updatedBy: userId, rejectedReason: dto.reason },
    );
  }

  async cancel(organizationId: string, purchaseId: string, userId: string) {
    const cas = await this.prisma.client.purchaseOrder.updateMany({
      where: {
        id: purchaseId,
        organizationId,
        status: { in: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SUBMITTED] },
      },
      data: { status: PurchaseOrderStatus.CANCELLED, updatedBy: userId },
    });
    if (cas.count === 1) return this.readOne(organizationId, purchaseId);

    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: purchaseId, organizationId },
      select: { status: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    throw new ConflictException(
      `Only DRAFT or SUBMITTED purchase orders can be cancelled (current: ${po.status})`,
    );
  }

  /* ----------------------------------------------------------------------- */
  /*  Read                                                                    */
  /* ----------------------------------------------------------------------- */

  list(
    organizationId: string,
    limit: number,
    cursor?: string,
    search?: string,
    status?: string,
    partyId?: string,
  ) {
    return this.prisma.client.purchaseOrder.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as PurchaseOrderStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(search
          ? {
              OR: [
                { poNumber: { contains: search, mode: 'insensitive' as const } },
                { party: { name: { contains: search, mode: 'insensitive' as const } } },
                { notes: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: PO_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(organizationId: string, purchaseId: string) {
    return this.readOne(organizationId, purchaseId);
  }
}