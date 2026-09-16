import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankAccountType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { round2 } from '../../common/helpers/money.js';
import {
  CreateBankAccountDto,
  ImportStatementDto,
  ReconcileDto,
  UpdateBankAccountDto,
} from './dto/banking.dto.js';

const ACCOUNT_FIELDS = {
  id: true,
  organizationId: true,
  name: true,
  accountType: true,
  accountCode: true,
  bankName: true,
  accountNumber: true,
  openingBalance: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const STATEMENT_LINE_FIELDS = {
  id: true,
  organizationId: true,
  accountId: true,
  transactionDate: true,
  description: true,
  reference: true,
  debit: true,
  credit: true,
  reconciled: true,
  reconciledAt: true,
  reconciledById: true,
  reconciliationId: true,
  createdAt: true,
} as const;

const RECONCILIATION_FIELDS = {
  id: true,
  organizationId: true,
  accountId: true,
  periodStart: true,
  periodEnd: true,
  reconciledBy: true,
  reconciledAt: true,
  notes: true,
} as const;

interface LineTotals {
  debit: number;
  credit: number;
}

interface AccountRow {
  id: string;
  organizationId: string;
  name: string;
  accountType: BankAccountType;
  accountCode: string | null;
  bankName: string | null;
  accountNumber: string | null;
  openingBalance: Prisma.Decimal;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BankingService {
  constructor(private readonly prisma: PrismaService) {}

  /* ----------------------------------------------------------------------- */
  /*  Bank accounts                                                           */
  /* ----------------------------------------------------------------------- */

  async listAccounts(
    organizationId: string,
    opts: {
      type?: BankAccountType;
      search?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    const accounts = await this.prisma.client.bankAccount.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(opts.type ? { accountType: opts.type } : {}),
        ...(opts.search
          ? {
              OR: [
                { name: { contains: opts.search, mode: 'insensitive' as const } },
                {
                  accountNumber: { contains: opts.search, mode: 'insensitive' as const },
                },
                { bankName: { contains: opts.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: ACCOUNT_FIELDS,
      orderBy: { name: 'asc' as const },
      take: Math.min(opts.limit ?? 50, 100),
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });

    const totals = await this.statementTotals(organizationId);
    return accounts.map((a) => this.presentAccountFromRaw(a, totals.get(a.id)));
  }

  async accountDetail(organizationId: string, accountId: string) {
    const account = await this.findOne(organizationId, accountId);

    const [totals, lineGroups, reconciliationCount] = await Promise.all([
      this.statementTotals(organizationId, accountId),
      this.prisma.client.bankStatementLine.groupBy({
        by: ['reconciled'],
        where: { organizationId, accountId },
        _count: true,
      }),
      this.prisma.client.bankReconciliation.count({ where: { organizationId, accountId } }),
    ]);

    const summary = { totalLines: 0, reconciled: 0, unreconciled: 0 };
    for (const g of lineGroups) {
      if (g.reconciled) summary.reconciled = g._count;
      else summary.unreconciled = g._count;
    }
    summary.totalLines = summary.reconciled + summary.unreconciled;

    const t = totals.get(accountId);
    return {
      ...this.presentAccountFromRaw(account, t),
      statementLineSummary: summary,
      reconciliationCount,
    };
  }

  async createAccount(organizationId: string, dto: CreateBankAccountDto) {
    if (dto.accountCode) {
      const dup = await this.prisma.client.bankAccount.findFirst({
        where: { organizationId, accountCode: dto.accountCode, deletedAt: null },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(`Account code ${dto.accountCode} already exists`);
      }
    }

    const account = await this.prisma.client.bankAccount.create({
      data: {
        organizationId,
        name: dto.name,
        accountType: dto.accountType ?? BankAccountType.BANK,
        accountCode: dto.accountCode ?? null,
        bankName: dto.bankName ?? null,
        accountNumber: dto.accountNumber ?? null,
        openingBalance: dto.openingBalance ?? 0,
        active: dto.active ?? true,
      },
    });
    return this.presentAccountFromRaw(account, undefined);
  }

  async updateAccount(
    organizationId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ) {
    const account = await this.findOne(organizationId, accountId);

    if (dto.accountCode && dto.accountCode !== account.accountCode) {
      const dup = await this.prisma.client.bankAccount.findFirst({
        where: {
          organizationId,
          accountCode: dto.accountCode,
          id: { not: accountId },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(`Account code ${dto.accountCode} already exists`);
      }
    }

    const updated = await this.prisma.client.bankAccount.update({
      where: { id: accountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.accountType !== undefined ? { accountType: dto.accountType } : {}),
        ...(dto.accountCode !== undefined
          ? { accountCode: dto.accountCode || null }
          : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
        ...(dto.accountNumber !== undefined ? { accountNumber: dto.accountNumber } : {}),
        ...(dto.openingBalance !== undefined ? { openingBalance: dto.openingBalance } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return this.presentAccountFromRaw(updated, undefined);
  }

  async removeAccount(organizationId: string, accountId: string): Promise<void> {
    await this.findOne(organizationId, accountId);
    await this.prisma.client.bankAccount.update({
      where: { id: accountId },
      data: { deletedAt: new Date(), active: false },
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Statement lines + import                                                */
  /* ----------------------------------------------------------------------- */

  async listStatementLines(
    organizationId: string,
    accountId: string,
    opts: {
      reconciled?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    await this.findOne(organizationId, accountId);

    return this.prisma.client.bankStatementLine.findMany({
      where: {
        organizationId,
        accountId,
        ...(opts.reconciled !== undefined ? { reconciled: opts.reconciled } : {}),
      },
      select: STATEMENT_LINE_FIELDS,
      orderBy: { transactionDate: 'asc' as const },
      take: Math.min(opts.limit ?? 100, 500),
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  async importStatement(
    organizationId: string,
    accountId: string,
    dto: ImportStatementDto,
  ) {
    await this.findOne(organizationId, accountId);

    const rows = dto.lines.map((line) => {
      const debit = round2(line.debit ?? 0);
      const credit = round2(line.credit ?? 0);
      if (debit === 0 && credit === 0) {
        throw new BadRequestException(
          'Each statement line must have a debit or a credit amount',
        );
      }
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(
          'A statement line cannot have both debit and credit amounts',
        );
      }
      return {
        organizationId,
        accountId,
        transactionDate: new Date(line.transactionDate),
        description: line.description ?? null,
        reference: line.reference ?? null,
        debit,
        credit,
      };
    });

    const created = await this.prisma.client.bankStatementLine.createManyAndReturn({
      data: rows,
      select: STATEMENT_LINE_FIELDS,
    });
    return { imported: created.length, lines: created };
  }

  /* ----------------------------------------------------------------------- */
  /*  Reconciliation                                                          */
  /* ----------------------------------------------------------------------- */

  async reconcile(
    organizationId: string,
    accountId: string,
    dto: ReconcileDto,
    userId: string,
  ) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid reconciliation period dates');
    }
    if (periodStart > periodEnd) {
      throw new BadRequestException('periodStart must be on or before periodEnd');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const account = await tx.bankAccount.findFirst({
        where: { id: accountId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Bank account not found');

      const ids = [...new Set(dto.statementLineIds)];
      const lines = await tx.bankStatementLine.findMany({
        where: { id: { in: ids }, accountId, organizationId },
        select: { id: true, reconciled: true },
      });
      if (lines.length !== ids.length) {
        throw new NotFoundException(
          'One or more statement lines were not found for this account',
        );
      }
      const already = lines.filter((l) => l.reconciled);
      if (already.length > 0) {
        throw new ConflictException(
          `${already.length} statement line(s) are already reconciled`,
        );
      }

      const reconciliation = await tx.bankReconciliation.create({
        data: {
          organizationId,
          accountId,
          periodStart,
          periodEnd,
          reconciledBy: userId,
          notes: dto.notes ?? null,
        },
      });

      await tx.bankStatementLine.updateMany({
        where: { id: { in: ids } },
        data: {
          reconciled: true,
          reconciledAt: new Date(),
          reconciledById: userId,
          reconciliationId: reconciliation.id,
        },
      });

      return tx.bankReconciliation.findUnique({
        where: { id: reconciliation.id },
        select: {
          ...RECONCILIATION_FIELDS,
          statementLines: {
            select: STATEMENT_LINE_FIELDS,
            orderBy: { transactionDate: 'asc' as const },
          },
        },
      });
    });
  }

  async listReconciliations(
    organizationId: string,
    accountId: string,
    opts: {
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    await this.findOne(organizationId, accountId);

    return this.prisma.client.bankReconciliation.findMany({
      where: { organizationId, accountId },
      select: {
        ...RECONCILIATION_FIELDS,
        _count: { select: { statementLines: true } },
      },
      orderBy: { reconciledAt: 'desc' as const },
      take: Math.min(opts.limit ?? 50, 100),
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Internals                                                               */
  /* ----------------------------------------------------------------------- */

  private async findOne(organizationId: string, accountId: string): Promise<AccountRow> {
    const account = await this.prisma.client.bankAccount.findFirst({
      where: { id: accountId, organizationId, deletedAt: null },
      select: ACCOUNT_FIELDS,
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  /** Sum of statement line debits/credits per account (numbers, none if absent). */
  private async statementTotals(
    organizationId: string,
    accountId?: string,
  ): Promise<Map<string, LineTotals>> {
    const groups = await this.prisma.client.bankStatementLine.groupBy({
      by: ['accountId'],
      where: {
        organizationId,
        ...(accountId ? { accountId } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    const totals = new Map<string, LineTotals>();
    for (const g of groups) {
      totals.set(g.accountId, {
        debit: Number(g._sum.debit ?? 0),
        credit: Number(g._sum.credit ?? 0),
      });
    }
    return totals;
  }

  /**
   * currentBalance is computed, never read from the stored column:
   * openingBalance + sum(credits) - sum(debits).
   */
  private presentAccountFromRaw(
    account: AccountRow,
    totals?: LineTotals,
  ) {
    return {
      ...account,
      openingBalance: Number(account.openingBalance),
      currentBalance: this.computeBalance(account.openingBalance, totals),
    };
  }

  private computeBalance(
    openingBalance: Prisma.Decimal | number,
    totals?: LineTotals,
  ): number {
    const opening =
      typeof openingBalance === 'number' ? openingBalance : Number(openingBalance);
    return round2(opening + (totals?.credit ?? 0) - (totals?.debit ?? 0));
  }
}