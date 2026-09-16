import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditNoteStatus,
  PartyType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OutboxService } from '../../events/outbox/outbox.service.js';
import {
  round2,
  sum,
  toAmount,
} from '../../common/helpers/money.js';
import { LedgerService } from '../accounting/ledger.service.js';
import {
  CreateCreditNoteDto,
  CreateCreditNoteLineDto,
  IssueCreditNoteDto,
} from './dto/credit-note.dto.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const CREDIT_NOTE_LINES = {
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

const CREDIT_NOTE_SAFE_FIELDS = {
  id: true,
  noteNumber: true,
  partyId: true,
  party: { select: { id: true, name: true, type: true, taxId: true } },
  referenceInvoiceId: true,
  noteDate: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  currency: true,
  reason: true,
  etimsCtrlNo: true,
  etimsReceipt: true,
  etimsSubmittedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/* -------------------------------------------------------------------------- */
/*  Credit note line computation                                              */
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
  dto: CreateCreditNoteLineDto,
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
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
  ) {}

  /* ----------------------------------------------------------------------- */
  /*  Numbering                                                               */
  /* ----------------------------------------------------------------------- */

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.creditNoteNumberSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `CN-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT)                                                          */
  /* ----------------------------------------------------------------------- */

  async createDraft(
    organizationId: string,
    dto: CreateCreditNoteDto,
    userId: string,
  ) {
    const party = await this.prisma.client.party.findFirst({
      where: { id: dto.partyId, organizationId },
      select: { id: true, type: true, name: true },
    });
    if (!party) throw new NotFoundException('Party not found');
    if (party.type === PartyType.SUPPLIER) {
      throw new BadRequestException(
        'Party is a supplier; credit notes are raised for customers',
      );
    }

    // The credit note parties must mirror the referenced invoice when set.
    if (dto.referenceInvoiceId) {
      const reference = await this.prisma.client.saleInvoice.findFirst({
        where: { id: dto.referenceInvoiceId, organizationId },
        select: { id: true, partyId: true, total: true, status: true },
      });
      if (!reference) {
        throw new NotFoundException('Reference invoice not found');
      }
      if (reference.partyId !== dto.partyId) {
        throw new BadRequestException(
          'Credit note party must match the referenced invoice party',
        );
      }
      if (reference.status === 'VOID') {
        throw new ConflictException(
          'Cannot credit note a voided invoice',
        );
      }
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
          : { name: 'Credit note line', sellPrice: null, taxCode: null },
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
      const noteNumber = await this.allocateNumber(organizationId, tx);

      const note = await tx.creditNote.create({
        data: {
          organizationId,
          noteNumber,
          partyId: dto.partyId,
          referenceInvoiceId: dto.referenceInvoiceId ?? null,
          noteDate: dto.noteDate ? new Date(dto.noteDate) : new Date(),
          subtotal: new Prisma.Decimal(subtotal.toString()),
          discountTotal: new Prisma.Decimal(discountTotal.toString()),
          taxTotal: new Prisma.Decimal(taxTotal.toString()),
          total: new Prisma.Decimal(total.toString()),
          currency: dto.currency ?? orgSetting?.currency ?? 'KES',
          reason: dto.reason ?? null,
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
          lines: { orderBy: { sortOrder: 'asc' }, select: CREDIT_NOTE_LINES },
          party: { select: { id: true, name: true } },
        },
      });
      return { ...note, party: note.party.name };
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Issue → restore stock, unwind invoice, post ledger, submit to eTIMS     */
  /* ----------------------------------------------------------------------- */

  async issue(
    organizationId: string,
    noteId: string,
    dto: IssueCreditNoteDto,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const note = await tx.creditNote.findFirst({
        where: { id: noteId, organizationId },
        include: {
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { ...CREDIT_NOTE_LINES, itemId: true, quantity: true },
          },
        },
      });
      if (!note) throw new NotFoundException('Credit note not found');
      if (note.status !== CreditNoteStatus.DRAFT) {
        throw new ConflictException(
          `Cannot issue a credit note in ${note.status} status`,
        );
      }

      // Restore stock for trackStock items, reversing the original sale.
      for (const line of note.lines) {
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
            type: 'VOID',
            referenceId: note.referenceInvoiceId ?? noteId,
            userId,
          },
        });
      }

      // Unwind any amount already paid on the referenced invoice (never below 0).
      let referenceInvoiceNumber: string | null = null;
      if (note.referenceInvoiceId) {
        const invoice = await tx.saleInvoice.findFirst({
          where: { id: note.referenceInvoiceId, organizationId },
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            amountPaid: true,
            status: true,
          },
        });
        if (!invoice) throw new NotFoundException('Reference invoice not found');

        const invoiceTotal = Number(invoice.total);
        const currentPaid = Number(invoice.amountPaid);
        const newPaid = round2(Math.max(0, currentPaid - Number(note.total)));
        const newStatus =
          newPaid >= invoiceTotal
            ? invoice.status
            : newPaid > 0
              ? 'PARTIALLY_PAID'
              : 'CONFIRMED';

        const cas = await tx.saleInvoice.updateMany({
          where: { id: invoice.id, organizationId, amountPaid: invoice.amountPaid },
          data: {
            amountPaid: new Prisma.Decimal(newPaid.toString()),
            status: newStatus,
            updatedBy: userId,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('Invoice balance changed concurrently; retry');
        }
        referenceInvoiceNumber = invoice.invoiceNumber;
      }

      // Optimistic concurrency: only flip DRAFT → ISSUED if still DRAFT. A
      // concurrent issue loses here and the whole transaction (stock + ledger
      // + outbox) rolls back.
      const cas = await tx.creditNote.updateMany({
        where: { id: noteId, organizationId, status: 'DRAFT' },
        data: {
          status: CreditNoteStatus.ISSUED,
          ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          updatedBy: userId,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot issue a credit note in ${note.status} status`,
        );
      }

      const updated = await tx.creditNote.findFirstOrThrow({
        where: { id: noteId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: CREDIT_NOTE_LINES },
          party: { select: { id: true, name: true } },
        },
      });

      // A KRA credit note must reverse a control-numbered invoice, so only
      // enqueue the eTIMS submission when the note references one.
      if (note.referenceInvoiceId && referenceInvoiceNumber) {
        await this.outbox.enqueue(tx, {
          type: 'ETIMS_CREDIT_NOTE_SUBMIT',
          aggregateType: 'CreditNote',
          aggregateId: noteId,
          organizationId,
          payload: {
            invoiceId: note.referenceInvoiceId,
            invoiceNumber: referenceInvoiceNumber,
          },
        });
      }

      await this.ledger.post({
        tx,
        organizationId,
        sourceType: 'CREDIT_NOTE',
        sourceId: noteId,
        description: `Credit note ${note.noteNumber}`,
        entryDate: note.noteDate,
        lines: [
          { accountCode: LedgerService.VAT_OUTPUT, debit: Number(note.taxTotal) },
          { accountCode: LedgerService.REVENUE, debit: round2(Number(note.total) - Number(note.taxTotal)) },
          { accountCode: LedgerService.AR, credit: Number(note.total) },
        ],
        userId,
      });

      return updated;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Cancel (DRAFT only)                                                     */
  /* ----------------------------------------------------------------------- */

  async cancel(
    organizationId: string,
    noteId: string,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const note = await tx.creditNote.findFirst({
        where: { id: noteId, organizationId },
        select: { id: true, status: true },
      });
      if (!note) throw new NotFoundException('Credit note not found');
      if (note.status !== CreditNoteStatus.DRAFT) {
        throw new ConflictException(
          `Cannot cancel a credit note in ${note.status} status`,
        );
      }

      const cas = await tx.creditNote.updateMany({
        where: { id: noteId, organizationId, status: 'DRAFT' },
        data: {
          status: CreditNoteStatus.CANCELLED,
          updatedBy: userId,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot cancel a credit note in ${note.status} status`,
        );
      }

      return tx.creditNote.findFirstOrThrow({
        where: { id: noteId, organizationId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' }, select: CREDIT_NOTE_LINES },
          party: { select: { id: true, name: true } },
        },
      });
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
    return this.prisma.client.creditNote.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as CreditNoteStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(search
          ? {
              OR: [
                { noteNumber: { contains: search, mode: 'insensitive' } },
                { party: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: CREDIT_NOTE_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, noteId: string) {
    const note = await this.prisma.client.creditNote.findFirst({
      where: { id: noteId, organizationId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' }, select: CREDIT_NOTE_LINES },
        party: { select: { id: true, name: true, type: true, taxId: true } },
        referenceInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            amountPaid: true,
            etimsCtrlNo: true,
          },
        },
      },
    });
    if (!note) throw new NotFoundException('Credit note not found');
    return note;
  }
}