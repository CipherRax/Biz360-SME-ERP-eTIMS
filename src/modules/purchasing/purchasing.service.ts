import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PartyType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CreatePurchaseDto,
  PurchaseLineDto,
  PurchasePaymentDto,
  UpdatePurchaseDto,
  VoidPurchaseDto,
} from './dto/purchase.dto.js';
import {
  round2,
  sum,
  toAmount,
} from '../../common/helpers/money.js';
import { LedgerService } from '../accounting/ledger.service.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const PURCHASE_LINES = {
  id: true,
  itemId: true,
  description: true,
  quantity: true,
  unitPrice: true,
  taxRate: true,
  discountPct: true,
  lineDiscount: true,
  lineAmount: true,
  lineTotal: true,
  taxAmount: true,
  sortOrder: true,
} as const;

const PURCHASE_SAFE_FIELDS = {
  id: true,
  invoiceNumber: true,
  supplierRef: true,
  partyId: true,
  party: { select: { id: true, name: true, type: true, taxId: true } },
  invoiceDate: true,
  dueDate: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  amountPaid: true,
  currency: true,
  notes: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PAYMENT_SAFE = {
  id: true,
  purchaseInvoiceId: true,
  partyId: true,
  amount: true,
  method: true,
  reference: true,
  paidAt: true,
  notes: true,
  createdAt: true,
} as const;

/* -------------------------------------------------------------------------- */
/*  Line computation (same math as sales)                                      */
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
  dto: PurchaseLineDto,
  item: { name: string; sellPrice?: Prisma.Decimal | null; taxCode?: string | null },
  orgTaxRate: number,
  sortOrder: number,
): ComputedLine {
  const qty = toAmount(dto.quantity ?? 1);
  const price = toAmount(dto.unitPrice ?? (item.sellPrice != null ? item.sellPrice.toString() : '0'));
  const taxRate = toAmount(dto.taxRate ?? (item.taxCode ? String(orgTaxRate) : '0'));
  const discountPct = toAmount(dto.discountPct ?? 0);
  const lineDiscount = toAmount(dto.lineDiscount ?? 0);

  const lineAmount = round2(qty * price);
  const afterPctDiscount = round2(lineAmount * (1 - discountPct / 100));
  const lineTotal = round2(afterPctDiscount - lineDiscount);
  const taxAmount = round2(lineTotal * taxRate / 100);

  const dec = (v: number) => new Prisma.Decimal(v.toString());

  return {
    itemId: dto.itemId ?? null,
    description: dto.description ?? item.name,
    quantity: dec(qty),
    unitPrice: dec(price),
    taxRate: dec(taxRate),
    discountPct: dec(discountPct),
    lineDiscount: dec(lineDiscount),
    lineAmount: dec(lineAmount),
    lineTotal: dec(lineTotal),
    taxAmount: dec(taxAmount),
    sortOrder,
  };
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                   */
/* -------------------------------------------------------------------------- */

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.purchaseInvoiceSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `PO-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT)                                                          */
  /* ----------------------------------------------------------------------- */

  async createDraft(
    organizationId: string,
    dto: CreatePurchaseDto,
    userId: string,
  ) {
    const party = await this.prisma.client.party.findFirst({
      where: { id: dto.partyId, organizationId },
      select: { id: true, type: true, name: true },
    });
    if (!party) throw new NotFoundException('Party not found');
    if (party.type === PartyType.CUSTOMER) {
      throw new BadRequestException(
        'Party is a customer; use the sales flow for customer invoices',
      );
    }

    const orgSetting = await this.prisma.client.organizationSetting.findFirst({
      where: { organizationId },
      select: { taxRate: true, currency: true },
    });
    const orgTaxRate = Number(orgSetting?.taxRate ?? 16);

    const itemIds = dto.lines
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
      if (!itemMap.has(id)) throw new NotFoundException(`Item ${id} not found in this organization`);
    }

    const computedLines = dto.lines.map((dtoLine, i) =>
      computeLine(
        dtoLine,
        dtoLine.itemId
          ? itemMap.get(dtoLine.itemId)!
          : { name: 'Item', sellPrice: null, taxCode: null },
        orgTaxRate,
        i,
      ),
    );

    const lineAmounts = computedLines.map((l) => Number(l.lineAmount));
    const lineTotals = computedLines.map((l) => Number(l.lineTotal));
    const taxAmounts = computedLines.map((l) => Number(l.taxAmount));
    const subtotal = sum(lineAmounts);
    const taxTotal = sum(taxAmounts);
    const discountTotal = round2(subtotal - sum(lineTotals));
    const total = round2(sum(lineTotals) + taxTotal);

    return this.prisma.client.$transaction(async (tx) => {
      const invoiceNumber = await this.allocateNumber(organizationId, tx);

      const invoice = await tx.purchaseInvoice.create({
        data: {
          organizationId,
          invoiceNumber,
          supplierRef: dto.supplierRef ?? null,
          partyId: dto.partyId,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(),
          subtotal: new Prisma.Decimal(subtotal.toString()),
          discountTotal: new Prisma.Decimal(discountTotal.toString()),
          taxTotal: new Prisma.Decimal(taxTotal.toString()),
          total: new Prisma.Decimal(total.toString()),
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
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: PURCHASE_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...invoice, party: invoice.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Confirm → increment stock (goods received)                              */
  /* ----------------------------------------------------------------------- */

  async confirmPurchase(
    organizationId: string,
    purchaseId: string,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const purchase = await tx.purchaseInvoice.findFirst({
        where: { id: purchaseId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: { ...PURCHASE_LINES, itemId: true, quantity: true } },
        },
      });
      if (!purchase) throw new NotFoundException('Purchase not found');
      if (purchase.status !== 'DRAFT') {
        throw new ConflictException(
          `Cannot confirm a purchase in ${purchase.status} status`,
        );
      }

      const party = await tx.party.findFirst({
        where: { id: purchase.partyId },
        select: { paymentTermsDays: true },
      });
      const orgSetting = await tx.organizationSetting.findFirst({
        where: { organizationId },
        select: { defaultPaymentTermsDays: true },
      });
      const termsDays =
        party?.paymentTermsDays ??
        orgSetting?.defaultPaymentTermsDays ??
        30;
      const dueDate = new Date(purchase.invoiceDate);
      dueDate.setDate(dueDate.getDate() + termsDays);

      // Increment stock for trackStock items (goods receipt).
      for (const line of purchase.lines) {
        if (!line.itemId) continue;
        const item = await tx.item.findFirst({
          where: { id: line.itemId, organizationId },
          select: { id: true, trackStock: true },
        });
        if (!item || !item.trackStock) continue;
        const qty = Number(line.quantity);
        await tx.item.update({
          where: { id: item.id },
          data: { stockOnHand: { increment: new Prisma.Decimal(qty.toString()) } },
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            itemId: item.id,
            quantity: new Prisma.Decimal(qty.toString()),
            type: 'PURCHASE_IN',
            referenceId: purchaseId,
            userId,
          },
        });
      }

      const cas = await tx.purchaseInvoice.updateMany({
        where: { id: purchaseId, organizationId, status: 'DRAFT' },
        data: { status: 'CONFIRMED', dueDate, updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot confirm a purchase in ${purchase.status} status`,
        );
      }

      const updated = await tx.purchaseInvoice.findFirstOrThrow({
        where: { id: purchaseId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: PURCHASE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      await this.ledger.postPurchaseInvoice(tx, organizationId, {
        id: purchaseId,
        invoiceNumber: purchase.invoiceNumber,
        total: purchase.total,
        taxTotal: purchase.taxTotal,
      }, userId);

      return updated;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Void (DRAFT or CONFIRMED — reverses stock)                              */
  /* ----------------------------------------------------------------------- */

  async voidPurchase(
    organizationId: string,
    purchaseId: string,
    dto: VoidPurchaseDto,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const purchase = await tx.purchaseInvoice.findFirst({
        where: { id: purchaseId, organizationId },
        include: { lines: { select: { itemId: true, quantity: true } } },
      });
      if (!purchase) throw new NotFoundException('Purchase not found');
      if (!(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as InvoiceStatus[]).includes(purchase.status)) {
        throw new ConflictException(`Cannot void a purchase in ${purchase.status} status`);
      }

      const wasReleased =
        purchase.status === 'CONFIRMED' || purchase.status === 'PARTIALLY_PAID' || purchase.status === 'PAID';

      if (wasReleased) {
        for (const line of purchase.lines) {
          if (!line.itemId) continue;
          const item = await tx.item.findFirst({
            where: { id: line.itemId, organizationId },
            select: { id: true, trackStock: true },
          });
          if (!item || !item.trackStock) continue;
          const qty = Number(line.quantity);
          const onHand = Number((await tx.item.findFirst({
            where: { id: item.id },
            select: { stockOnHand: true },
          }))?.stockOnHand ?? 0);
          await tx.item.update({
            where: { id: item.id },
            data: { stockOnHand: { decrement: new Prisma.Decimal(Math.min(qty, onHand).toString()) } },
          });
          await tx.stockMovement.create({
            data: {
              organizationId,
              itemId: item.id,
              quantity: new Prisma.Decimal((-Math.min(qty, onHand)).toString()),
              type: 'VOID',
              referenceId: purchaseId,
              userId,
            },
          });
        }
      }

      const voided = await tx.purchaseInvoice.update({
        where: { id: purchaseId },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidReason: dto.reason ?? null,
          updatedBy: userId,
        },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: PURCHASE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      if (wasReleased) {
        // Purchases are input-side (buyer): KRA eTIMS credit notes are only
        // issued by suppliers, so there is nothing to submit here. The ledger
        // reversal below restores AP and reverses the VAT input/stock bookkeeping.
        await this.ledger.postPurchaseVoid(tx, organizationId, {
          id: purchaseId,
          invoiceNumber: purchase.invoiceNumber,
          total: purchase.total,
          taxTotal: purchase.taxTotal,
        }, userId);

        // Unwind any payments already made so AP doesn't go negative.
        const payments = await tx.payment.findMany({
          where: { purchaseInvoiceId: purchaseId, organizationId },
          select: { id: true, amount: true },
        });
        for (const payment of payments) {
          await this.ledger.postPurchasePaymentReversal(tx, organizationId, {
            id: payment.id,
            invoiceNumber: purchase.invoiceNumber,
            amount: Number(payment.amount),
          }, userId);
        }
      }

      return voided;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Update (DRAFT only)                                                     */
  /* ----------------------------------------------------------------------- */

  async updateDraft(
    organizationId: string,
    purchaseId: string,
    dto: UpdatePurchaseDto,
    userId: string,
  ) {
    const purchase = await this.prisma.client.purchaseInvoice.findFirst({
      where: { id: purchaseId, organizationId },
      select: { id: true, status: true },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    if (purchase.status !== 'DRAFT') {
      throw new ConflictException('Only draft purchases can be edited');
    }

    return this.prisma.client.purchaseInvoice.update({
      where: { id: purchaseId },
      data: {
        ...(dto.invoiceDate ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.supplierRef !== undefined ? { supplierRef: dto.supplierRef } : {}),
        updatedBy: userId,
      },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: PURCHASE_LINES },
        party: { select: { id: true, name: true } },
      },
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Record payment (accounts payable)                                       */
  /* ----------------------------------------------------------------------- */

  async recordPayment(
    organizationId: string,
    dto: PurchasePaymentDto,
    userId: string,
  ) {
    const amount = toAmount(dto.amount);
    if (amount <= 0) throw new BadRequestException('Payment amount must be positive');

    return this.prisma.client.$transaction(async (tx) => {
      const purchase = await tx.purchaseInvoice.findFirst({
        where: { id: dto.purchaseInvoiceId, organizationId },
        select: { id: true, invoiceNumber: true, partyId: true, total: true, amountPaid: true, status: true, currency: true },
      });
      if (!purchase) throw new NotFoundException('Purchase not found');
      if (!(['CONFIRMED', 'PARTIALLY_PAID'] as InvoiceStatus[]).includes(purchase.status)) {
        throw new ConflictException(
          `Cannot record payment for a purchase in ${purchase.status} status`,
        );
      }

      const purchaseTotal = Number(purchase.total);
      const currentPaid = Number(purchase.amountPaid);
      const newPaidTotal = round2(currentPaid + amount);
      const newStatus: InvoiceStatus =
        newPaidTotal >= purchaseTotal ? 'PAID' : 'PARTIALLY_PAID';

      const payment = await tx.payment.create({
        data: {
          organizationId,
          partyId: purchase.partyId,
          purchaseInvoiceId: dto.purchaseInvoiceId,
          amount: new Prisma.Decimal(amount.toString()),
          method: dto.method ?? 'CASH',
          reference: dto.reference ?? null,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          notes: dto.notes ?? null,
          createdBy: userId,
        },
        select: PAYMENT_SAFE,
      });

      const cas = await tx.purchaseInvoice.updateMany({
        where: { id: dto.purchaseInvoiceId, organizationId, amountPaid: purchase.amountPaid },
        data: {
          amountPaid: new Prisma.Decimal(newPaidTotal.toString()),
          status: newStatus,
          updatedBy: userId,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException('Purchase amount paid changed concurrently; retry');
      }

      await this.ledger.postPurchasePayment(tx, organizationId, {
        id: payment.id,
        invoiceNumber: purchase.invoiceNumber,
        amount,
      }, userId);

      return payment;
    });
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
    return this.prisma.client.purchaseInvoice.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as InvoiceStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                { supplierRef: { contains: search, mode: 'insensitive' } },
                { party: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: PURCHASE_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, purchaseId: string) {
    const purchase = await this.prisma.client.purchaseInvoice.findFirst({
      where: { id: purchaseId, organizationId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: PURCHASE_LINES },
        payments: { select: PAYMENT_SAFE, orderBy: { paidAt: 'desc' } },
        party: { select: { id: true, name: true, type: true, taxId: true } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }
}