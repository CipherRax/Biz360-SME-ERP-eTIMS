import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartyType,
  Prisma,
  QuotationStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CreateQuotationDto,
  QuotationLineDto,
  UpdateQuotationDto,
} from './dto/quotation.dto.js';
import {
  round2,
  sum,
  toAmount,
} from '../../common/helpers/money.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const QUOTATION_LINES = {
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

const QUOTATION_SAFE_FIELDS = {
  id: true,
  quoteNumber: true,
  partyId: true,
  party: { select: { id: true, name: true, type: true, taxId: true } },
  quoteDate: true,
  validUntil: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  currency: true,
  notes: true,
  convertedInvoiceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

/* -------------------------------------------------------------------------- */
/*  Quotation line computation (same math as sales)                            */
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
  dto: QuotationLineDto,
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
export class QuotationsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ----------------------------------------------------------------------- */
  /*  Numbering                                                               */
  /* ----------------------------------------------------------------------- */

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.quotationNumberSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `QT-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  /** The converted invoice reuses the sales numbering sequence. */
  private async allocateInvoiceNumber(
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
  /*  Expiry (validUntil based)                                               */
  /* ----------------------------------------------------------------------- */

  /** Lazy-expires an overdue quotation and makes the current action fail. */
  private async expireIfPast(
    quotation: { id: string; status: QuotationStatus; validUntil: Date | null },
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (!quotation.validUntil) return;
    if (quotation.validUntil > new Date()) return;
    if (
      quotation.status === 'EXPIRED' ||
      quotation.status === 'CONVERTED' ||
      quotation.status === 'CANCELLED'
    ) {
      return;
    }
    await this.prisma.client.quotation.updateMany({
      where: { id: quotation.id, organizationId, status: quotation.status },
      data: { status: 'EXPIRED', updatedBy: userId },
    });
    throw new ConflictException('Quotation has expired');
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT)                                                          */
  /* ----------------------------------------------------------------------- */

  async createDraft(
    organizationId: string,
    dto: CreateQuotationDto,
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
      const quoteNumber = await this.allocateNumber(organizationId, tx);

      const quotation = await tx.quotation.create({
        data: {
          organizationId,
          quoteNumber,
          partyId: dto.partyId,
          quoteDate: dto.quoteDate ? new Date(dto.quoteDate) : new Date(),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
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
          lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...quotation, party: quotation.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Send (DRAFT → SENT)                                                     */
  /* ----------------------------------------------------------------------- */

  async send(
    organizationId: string,
    quotationId: string,
    userId: string,
  ) {
    const current = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      select: { id: true, status: true, validUntil: true },
    });
    if (!current) throw new NotFoundException('Quotation not found');
    await this.expireIfPast(current, organizationId, userId);

    return this.prisma.client.$transaction(async (tx) => {
      // Optimistic concurrency: only flip DRAFT → SENT if still DRAFT.
      const cas = await tx.quotation.updateMany({
        where: { id: quotationId, organizationId, status: 'DRAFT' },
        data: { status: 'SENT', updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot send a quotation in ${current.status} status`,
        );
      }

      const updated = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...updated, party: updated.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Accept (SENT → ACCEPTED)                                                */
  /* ----------------------------------------------------------------------- */

  async accept(
    organizationId: string,
    quotationId: string,
    userId: string,
  ) {
    const current = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      select: { id: true, status: true, validUntil: true },
    });
    if (!current) throw new NotFoundException('Quotation not found');
    await this.expireIfPast(current, organizationId, userId);

    return this.prisma.client.$transaction(async (tx) => {
      // Optimistic concurrency: only flip SENT → ACCEPTED if still SENT.
      const cas = await tx.quotation.updateMany({
        where: { id: quotationId, organizationId, status: 'SENT' },
        data: { status: 'ACCEPTED', updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot accept a quotation in ${current.status} status`,
        );
      }

      const updated = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...updated, party: updated.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Cancel (DRAFT or SENT → CANCELLED)                                      */
  /* ----------------------------------------------------------------------- */

  async cancel(
    organizationId: string,
    quotationId: string,
    userId: string,
  ) {
    const current = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      select: { id: true, status: true, validUntil: true },
    });
    if (!current) throw new NotFoundException('Quotation not found');

    return this.prisma.client.$transaction(async (tx) => {
      // Only quotes that have not been accepted or converted can be cancelled.
      const cas = await tx.quotation.updateMany({
        where: {
          id: quotationId,
          organizationId,
          status: { in: ['DRAFT', 'SENT'] as QuotationStatus[] },
        },
        data: { status: 'CANCELLED', updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot cancel a quotation in ${current.status} status`,
        );
      }

      const updated = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...updated, party: updated.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Convert to sale invoice (ACCEPTED → CONVERTED)                          */
  /* ----------------------------------------------------------------------- */

  async convertToInvoice(
    organizationId: string,
    quotationId: string,
    userId: string,
  ) {
    const current = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      select: { id: true, status: true, validUntil: true },
    });
    if (!current) throw new NotFoundException('Quotation not found');
    await this.expireIfPast(current, organizationId, userId);

    return this.prisma.client.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({
        where: { id: quotationId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      if (!quotation) throw new NotFoundException('Quotation not found');
      if (quotation.status !== 'ACCEPTED') {
        throw new ConflictException(
          `Cannot convert a quotation in ${quotation.status} status`,
        );
      }

      // Optimistic concurrency: only flip ACCEPTED → CONVERTED if still
      // ACCEPTED. A concurrently-started convert loses here and the whole
      // transaction — including the invoice row — rolls back.
      const cas = await tx.quotation.updateMany({
        where: { id: quotationId, organizationId, status: 'ACCEPTED' },
        data: { status: 'CONVERTED', updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot convert a quotation in ${quotation.status} status`,
        );
      }

      // Create the invoice as a DRAFT: confirming it (stock, eTIMS, ledger)
      // stays a separate step owned by the sales module.
      const invoiceNumber = await this.allocateInvoiceNumber(organizationId, tx);

      const invoice = await tx.saleInvoice.create({
        data: {
          organizationId,
          invoiceNumber,
          partyId: quotation.partyId,
          invoiceDate: quotation.quoteDate,
          subtotal: quotation.subtotal,
          discountTotal: quotation.discountTotal,
          taxTotal: quotation.taxTotal,
          total: quotation.total,
          currency: quotation.currency,
          notes: quotation.notes,
          createdBy: userId,
          updatedBy: userId,
          lines: {
            create: quotation.lines.map((l) => ({
              organizationId,
              itemId: l.itemId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              discountPct: l.discountPct,
              lineDiscount: l.lineDiscount,
              lineAmount: l.lineAmount,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
              sortOrder: l.sortOrder,
            })),
          },
        },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: INVOICE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      await tx.quotation.update({
        where: { id: quotationId },
        data: { convertedInvoiceId: invoice.id, updatedBy: userId },
      });

      return { ...invoice, party: invoice.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Update (DRAFT only — quoteDate / validUntil / notes)                    */
  /* ----------------------------------------------------------------------- */

  async updateDraft(
    organizationId: string,
    quotationId: string,
    dto: UpdateQuotationDto,
    userId: string,
  ) {
    const quotation = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      select: { id: true, status: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== 'DRAFT') {
      throw new ConflictException('Only draft quotations can be edited');
    }

    return this.prisma.client.quotation.update({
      where: { id: quotationId },
      data: {
        ...(dto.quoteDate ? { quoteDate: new Date(dto.quoteDate) } : {}),
        ...(dto.validUntil !== undefined
          ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: userId,
      },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
        party: { select: { id: true, name: true } },
      },
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
    return this.prisma.client.quotation.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as QuotationStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(search
          ? {
              OR: [
                { quoteNumber: { contains: search, mode: 'insensitive' } },
                { party: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: QUOTATION_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, quotationId: string) {
    const quotation = await this.prisma.client.quotation.findFirst({
      where: { id: quotationId, organizationId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: QUOTATION_LINES },
        party: { select: { id: true, name: true, type: true, taxId: true } },
      },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }
}