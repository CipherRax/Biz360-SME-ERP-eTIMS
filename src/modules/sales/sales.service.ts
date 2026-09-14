import {
  ConflictException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PartyType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OutboxService } from '../../events/outbox/outbox.service.js';
import {
  CreateInvoiceDto,
  InvoiceLineDto,
  PaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoice.dto.js';
import {
  round2,
  sum,
  toAmount,
} from '../../common/helpers/money.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const INVOICE_LINES = {
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

const INVOICE_SAFE_FIELDS = {
  id: true,
  invoiceNumber: true,
  type: true,
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
  etimsSubmittedAt: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PAYMENT_SAFE = {
  id: true,
  invoiceId: true,
  partyId: true,
  amount: true,
  method: true,
  reference: true,
  paidAt: true,
  notes: true,
  createdAt: true,
} as const;

/* -------------------------------------------------------------------------- */
/*  Invoice line computation                                                  */
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
  dto: InvoiceLineDto,
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
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /* ----------------------------------------------------------------------- */
  /*  Numbering                                                               */
  /* ----------------------------------------------------------------------- */

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.invoiceNumberSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `INV-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT)                                                          */
  /* ----------------------------------------------------------------------- */

  async createDraft(
    organizationId: string,
    dto: CreateInvoiceDto,
    userId: string,
  ) {
    // Validate party exists and is allowed as a customer.
    const party = await this.prisma.client.party.findFirst({
      where: { id: dto.partyId, organizationId },
      select: { id: true, type: true, name: true },
    });
    if (!party) throw new NotFoundException('Party not found');
    if (party.type === PartyType.SUPPLIER) {
      throw new BadRequestException(
        'Party is a supplier; use the purchasing flow for supplier invoices',
      );
    }

    // Fetch organization settings for default tax rate.
    const orgSetting = await this.prisma.client.organizationSetting.findFirst({
      where: { organizationId },
      select: { taxRate: true, currency: true },
    });
    const orgTaxRate = Number(orgSetting?.taxRate ?? 16);

    // Validate items and compute lines.
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

      const invoice = await tx.saleInvoice.create({
        data: {
          organizationId,
          invoiceNumber,
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
          lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...invoice, party: invoice.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Confirm → decrement stock                                               */
  /* ----------------------------------------------------------------------- */

  async confirmInvoice(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: {
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { ...INVOICE_LINES, itemId: true, quantity: true },
          },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'DRAFT') {
        throw new ConflictException(
          `Cannot confirm an invoice in ${invoice.status} status`,
        );
      }

      // Load party for payment terms.
      const party = await tx.party.findFirst({
        where: { id: invoice.partyId },
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
      const dueDate = new Date(invoice.invoiceDate);
      dueDate.setDate(dueDate.getDate() + termsDays);

      // Decrement stock for trackStock items.
      for (const line of invoice.lines) {
        if (!line.itemId) continue;
        const item = await tx.item.findFirst({
          where: { id: line.itemId, organizationId },
          select: { id: true, stockOnHand: true, trackStock: true },
        });
        if (!item || !item.trackStock) continue;
        const onHand = Number(item.stockOnHand);
        const qty = Number(line.quantity);
        if (onHand < qty) {
          throw new ConflictException(
            `Insufficient stock for item ${item.id}: on hand ${onHand}, requested ${qty}`,
          );
        }
        await tx.item.update({
          where: { id: item.id },
          data: { stockOnHand: { decrement: new Prisma.Decimal(qty.toString()) } },
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            itemId: item.id,
            quantity: new Prisma.Decimal((-qty).toString()),
            type: 'SALE_OUT',
            referenceId: invoiceId,
            userId,
          },
        });
      }

      const updated = await tx.saleInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CONFIRMED',
          dueDate,
          updatedBy: userId,
        },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      // Register the KRA submission in the same transaction as the confirm.
      await this.outbox.enqueue(tx, {
        type: 'ETIMS_INVOICE_SUBMIT',
        aggregateType: 'SaleInvoice',
        aggregateId: invoiceId,
        organizationId,
        payload: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
        },
      });

      return updated;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Void (DRAFT or CONFIRMED — reverses stock)                              */
  /* ----------------------------------------------------------------------- */

  async voidInvoice(
    organizationId: string,
    invoiceId: string,
    dto: VoidInvoiceDto,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: {
          lines: { select: { itemId: true, quantity: true } },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (!(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID'] as InvoiceStatus[]).includes(invoice.status)) {
        throw new ConflictException(`Cannot void an invoice in ${invoice.status} status`);
      }

      const wasReleased =
        invoice.status === 'CONFIRMED' || invoice.status === 'PARTIALLY_PAID';

      if (wasReleased) {
        // Reverse stock.
        for (const line of invoice.lines) {
          if (!line.itemId) continue;
          const item = await tx.item.findFirst({
            where: { id: line.itemId, organizationId },
            select: { id: true, trackStock: true },
          });
          if (!item || !item.trackStock) continue;
          await tx.item.update({
            where: { id: item.id },
            data: { stockOnHand: { increment: new Prisma.Decimal(Number(line.quantity).toString()) } },
          });
          await tx.stockMovement.create({
            data: {
              organizationId,
              itemId: item.id,
              quantity: new Prisma.Decimal(Number(line.quantity).toString()),
              type: 'VOID',
              referenceId: invoiceId,
              userId,
            },
          });
        }
      }

      const voided = await tx.saleInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidReason: dto.reason ?? null,
          updatedBy: userId,
        },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      // Reversing a released invoice is a credit note in KRA's eyes.
      if (wasReleased) {
        await this.outbox.enqueue(tx, {
          type: 'ETIMS_CREDIT_NOTE_SUBMIT',
          aggregateType: 'SaleInvoice',
          aggregateId: invoiceId,
          organizationId,
          payload: {
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
          },
        });
      }

      return voided;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Update (DRAFT only — invoiceDate / notes)                               */
  /* ----------------------------------------------------------------------- */

  async updateDraft(
    organizationId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
    userId: string,
  ) {
    const invoice = await this.prisma.client.saleInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'DRAFT') {
      throw new ConflictException('Only draft invoices can be edited');
    }

    return this.prisma.client.saleInvoice.update({
      where: { id: invoiceId },
      data: {
        ...(dto.invoiceDate ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: userId,
      },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
        party: { select: { id: true, name: true } },
      },
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Record payment                                                          */
  /* ----------------------------------------------------------------------- */

  async recordPayment(
    organizationId: string,
    dto: PaymentDto,
    userId: string,
  ) {
    const amount = toAmount(dto.amount);
    if (amount <= 0) throw new BadRequestException('Payment amount must be positive');

    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findFirst({
        where: { id: dto.invoiceId, organizationId },
        select: { id: true, partyId: true, total: true, amountPaid: true, status: true, currency: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (!(['CONFIRMED', 'PARTIALLY_PAID'] as InvoiceStatus[]).includes(invoice.status)) {
        throw new ConflictException(
          `Cannot record payment for an invoice in ${invoice.status} status`,
        );
      }

      const invoiceTotal = Number(invoice.total);
      const currentPaid = Number(invoice.amountPaid);
      const newPaidTotal = round2(currentPaid + amount);
      const newStatus: InvoiceStatus = newPaidTotal >= invoiceTotal ? 'PAID' : 'PARTIALLY_PAID';

      const payment = await tx.payment.create({
        data: {
          organizationId,
          partyId: invoice.partyId,
          invoiceId: dto.invoiceId,
          amount: new Prisma.Decimal(amount.toString()),
          method: dto.method ?? 'CASH',
          reference: dto.reference ?? null,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          notes: dto.notes ?? null,
          createdBy: userId,
        },
        select: PAYMENT_SAFE,
      });

      await tx.saleInvoice.update({
        where: { id: dto.invoiceId },
        data: {
          amountPaid: new Prisma.Decimal(newPaidTotal.toString()),
          status: newStatus,
          updatedBy: userId,
        },
      });

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
    return this.prisma.client.saleInvoice.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as InvoiceStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                { party: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: INVOICE_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.client.saleInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
        payments: { select: PAYMENT_SAFE, orderBy: { paidAt: 'desc' } },
        party: { select: { id: true, name: true, type: true, taxId: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}