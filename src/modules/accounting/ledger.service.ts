import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JournalSourceType, Prisma } from '../../generated/prisma/client.js';
import { round2 } from '../../common/helpers/money.js';

/**
 * Auto-posting engine. Bookkeeping entries (sales confirm/payment/void,
 * purchase confirm/payment/void, reversals) are created here inside the SAME
 * transaction as the document mutation so the ledger can never drift from the
 * operational data. Posting is idempotent per (sourceType, sourceId): a retry
 * of the surrounding operation never double-books.
 *
 * Vertically sliced money amounts map to the seeded chart as:
 *   sale confirm     DR AR(total)      CR Revenue(total-tax)  CR VAT Out(tax)
 *   sale payment     DR Cash(amount)   CR AR(amount)
 *   sale void        CR AR(total)      DR Revenue(total-tax)  DR VAT Out(tax)
 *   purchase confirm DR Inventory(total-tax) DR VAT In(tax)   CR AP(total)
 *   purchase payment DR AP(amount)     CR Cash(amount)
 *   purchase void    CR Inventory(total-tax) CR VAT In(tax)   DR AP(total)
 */
@Injectable()
export class LedgerService {
  static readonly CASH = '1100';
  static readonly AR = '1200';
  static readonly INVENTORY = '1300';
  static readonly VAT_INPUT = '1400';
  static readonly AP = '2100';
  static readonly VAT_OUTPUT = '2200';
  static readonly REVENUE = '4100';

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.journalEntrySeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `JE-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  private money(value: number): Prisma.Decimal {
    return new Prisma.Decimal(round2(value).toString());
  }

  /**
   * Post a balanced, immutable journal entry. Throws on sql errors that the
   * DB triggers would surface; returns null when the (sourceType, sourceId)
   * pair was already posted (idempotent).
   */
  async post(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    sourceType: JournalSourceType;
    sourceId?: string | null;
    description: string;
    entryDate?: Date;
    lines: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      memo?: string;
    }>;
    userId?: string;
    status?: 'POSTED' | 'DRAFT';
    reversalOfId?: string | null;
  }) {
    const {
      tx,
      organizationId,
      sourceType,
      sourceId,
      status = 'POSTED',
    } = params;

    if (sourceType !== 'MANUAL' && sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: { organizationId, sourceType, sourceId },
        select: { id: true },
      });
      if (existing) return null;
    }

    const codes = [...new Set(params.lines.map((l) => l.accountCode))];
    const accounts = await tx.account.findMany({
      where: { organizationId, code: { in: codes }, deletedAt: null },
      select: { id: true, code: true, active: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    let totalDebit = 0;
    let totalCredit = 0;
    const resolved: Array<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; memo: string | null }> = [];

    for (const line of params.lines) {
      const account = byCode.get(line.accountCode);
      if (!account) {
        throw new NotFoundException(`Chart account ${line.accountCode} does not exist in this organization`);
      }
      const debit = round2(line.debit ?? 0);
      const credit = round2(line.credit ?? 0);
      if (debit < 0 || credit < 0) {
        throw new BadRequestException('Journal line amounts must be non-negative');
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new BadRequestException('Each journal line must have exactly one of debit or credit');
      }
      totalDebit = round2(totalDebit + debit);
      totalCredit = round2(totalCredit + credit);
      resolved.push({
        accountId: account.id,
        debit: this.money(debit),
        credit: this.money(credit),
        memo: line.memo ?? null,
      });
    }

    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Journal entry must be balanced: debits ${totalDebit} do not match credits ${totalCredit}`,
      );
    }

    const entryNumber = await this.allocateNumber(organizationId, tx);
    return tx.journalEntry.create({
      data: {
        organizationId,
        entryNumber,
        entryDate: params.entryDate ?? new Date(),
        status,
        sourceType,
        sourceId: sourceId ?? null,
        reversalOfId: params.reversalOfId ?? null,
        description: params.description ?? null,
        createdBy: params.userId ?? null,
        updatedBy: params.userId ?? null,
        lines: {
          create: resolved.map((r) => ({
            organizationId,
            accountId: r.accountId,
            debit: r.debit,
            credit: r.credit,
            memo: r.memo,
          })),
        },
      },
      include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } },
    });
  }

  /* ------------------------------ Sales --------------------------------- */

  postSaleInvoice(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; total: Prisma.Decimal | string | number; taxTotal: Prisma.Decimal | string | number },
    userId?: string,
  ) {
    const total = Number(source.total);
    const tax = Number(source.taxTotal);
    return this.post({
      tx,
      organizationId,
      sourceType: 'SALE_INVOICE',
      sourceId: source.id,
      description: `Sales invoice ${source.invoiceNumber}`,
      lines: [
        { accountCode: LedgerService.AR, debit: total },
        { accountCode: LedgerService.REVENUE, credit: round2(total - tax) },
        { accountCode: LedgerService.VAT_OUTPUT, credit: tax },
      ],
      userId,
    });
  }

  postSalePayment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; amount: string | number },
    userId?: string,
  ) {
    return this.post({
      tx,
      organizationId,
      sourceType: 'SALE_PAYMENT',
      sourceId: source.id,
      description: `Payment received for sale ${source.invoiceNumber}`,
      lines: [
        { accountCode: LedgerService.CASH, debit: Number(source.amount) },
        { accountCode: LedgerService.AR, credit: Number(source.amount) },
      ],
      userId,
    });
  }

  postSaleVoid(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; total: Prisma.Decimal | string | number; taxTotal: Prisma.Decimal | string | number },
    userId?: string,
  ) {
    const total = Number(source.total);
    const tax = Number(source.taxTotal);
    return this.post({
      tx,
      organizationId,
      sourceType: 'SALE_VOID',
      sourceId: source.id,
      description: `Reversal of voided sales invoice ${source.invoiceNumber}`,
      lines: [
        { accountCode: '1200', credit: total },
        { accountCode: '4100', debit: round2(total - tax) },
        { accountCode: '2200', debit: tax },
      ],
      userId,
    });
  }

  /* ---------------------------- Purchasing ------------------------------ */

  postPurchaseInvoice(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; total: Prisma.Decimal | string | number; taxTotal: Prisma.Decimal | string | number },
    userId?: string,
  ) {
    const total = Number(source.total);
    const tax = Number(source.taxTotal);
    return this.post({
      tx,
      organizationId,
      sourceType: 'PURCHASE_INVOICE',
      sourceId: source.id,
      description: `Purchase invoice ${source.invoiceNumber}`,
      lines: [
        { accountCode: '1300', debit: round2(total - tax) },
        { accountCode: '1400', debit: tax },
        { accountCode: '2100', credit: total },
      ],
      userId,
    });
  }

  postPurchasePayment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; amount: string | number },
    userId?: string,
  ) {
    return this.post({
      tx,
      organizationId,
      sourceType: 'PURCHASE_PAYMENT',
      sourceId: source.id,
      description: `Payment made for purchase ${source.invoiceNumber}`,
      lines: [
        { accountCode: '2100', debit: Number(source.amount) },
        { accountCode: '1100', credit: Number(source.amount) },
      ],
      userId,
    });
  }

  postPurchaseVoid(
    tx: Prisma.TransactionClient,
    organizationId: string,
    source: { id: string; invoiceNumber: string; total: Prisma.Decimal | string | number; taxTotal: Prisma.Decimal | string | number },
    userId?: string,
  ) {
    const total = Number(source.total);
    const tax = Number(source.taxTotal);
    return this.post({
      tx,
      organizationId,
      sourceType: 'PURCHASE_VOID',
      sourceId: source.id,
      description: `Reversal of voided purchase invoice ${source.invoiceNumber}`,
      lines: [
        { accountCode: '2100', debit: total },
        { accountCode: '1300', credit: round2(total - tax) },
        { accountCode: '1400', credit: tax },
      ],
      userId,
    });
  }
}