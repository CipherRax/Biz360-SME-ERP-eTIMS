import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  JournalEntryStatus,
  JournalSourceType,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { round2 } from '../../common/helpers/money.js';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto.js';
import { CreateJournalEntryDto } from './dto/journal-entry.dto.js';
import { LedgerService } from './ledger.service.js';

const NORMAL_DEBIT = new Set<AccountType>([AccountType.ASSET, AccountType.EXPENSE]);

const ENTRY_SAFE = {
  id: true,
  entryNumber: true,
  entryDate: true,
  status: true,
  sourceType: true,
  sourceId: true,
  description: true,
  approvedBy: true,
  approvedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface GroupedBalance {
  debit: number;
  credit: number;
  net: number;
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  private dateRange(from?: string, to?: string): { start: Date; end: Date } {
    const start = from ? new Date(from) : new Date('1970-01-01T00:00:00.000Z');
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    return { start, end };
  }

  private balanceSide(type: AccountType): 'debit' | 'credit' {
    return NORMAL_DEBIT.has(type) ? 'debit' : 'credit';
  }

  /* ----------------------------------------------------------------------- */
  /*  Accounts (chart of accounts)                                            */
  /* ----------------------------------------------------------------------- */

  async listAccounts(
    organizationId: string,
    opts: { type?: string; search?: string; withBalances?: boolean } = {},
  ) {
    const accounts = await this.prisma.client.account.findMany({
      where: {
        organizationId,
        ...(opts.type ? { type: opts.type as AccountType } : {}),
        ...(opts.search
          ? {
              OR: [
                { code: { contains: opts.search, mode: 'insensitive' as const } },
                { name: { contains: opts.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        parentId: true,
        description: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ code: 'asc' }],
    });

    if (!opts.withBalances) return accounts;

    const balances = await this.accountBalances(organizationId);
    return accounts.map((a) => ({ ...a, balance: balances.get(a.id)?.net ?? 0 }));
  }

  async createAccount(
    organizationId: string,
    dto: CreateAccountDto,
    userId: string,
  ) {
    const existing = await this.prisma.client.account.findFirst({
      where: { organizationId, code: dto.code },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Account code ${dto.code} already exists`);
    }
    if (dto.parentId) {
      const parent = await this.prisma.client.account.findFirst({
        where: { id: dto.parentId, organizationId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent account not found');
    }
    return this.prisma.client.account.create({
      data: {
        organizationId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updateAccount(
    organizationId: string,
    accountId: string,
    dto: UpdateAccountDto,
    userId: string,
  ) {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    if (dto.parentId) {
      if (dto.parentId === accountId) {
        throw new BadRequestException('An account cannot be its own parent');
      }
      const parent = await this.prisma.client.account.findFirst({
        where: { id: dto.parentId, organizationId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent account not found');
    }

    if (dto.active === false) {
      const postedCount = await this.prisma.client.journalEntryLine.count({
        where: { organizationId, accountId },
      });
      if (postedCount > 0) {
        throw new ConflictException(
          'Account has journal activity and cannot be deactivated',
        );
      }
    }

    return this.prisma.client.account.update({
      where: { id: accountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedBy: userId,
      },
    });
  }

  async removeAccount(organizationId: string, accountId: string) {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const postedCount = await this.prisma.client.journalEntryLine.count({
      where: { organizationId, accountId },
    });
    if (postedCount > 0) {
      throw new ConflictException(
        'Account has journal entries and cannot be deleted',
      );
    }
    return this.prisma.client.account.update({
      where: { id: accountId },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
  }

  async accountDetail(organizationId: string, accountId: string) {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId },
      include: {
        children: {
          select: { id: true, code: true, name: true, type: true, active: true },
          orderBy: { code: 'asc' },
        },
      },
    });
    if (!account) throw new NotFoundException('Account not found');

    const balances = await this.accountBalances(
      organizationId,
      undefined,
      undefined,
      accountId,
    );
    return { ...account, balance: balances.get(accountId)?.net ?? 0 };
  }

  /* ----------------------------------------------------------------------- */
  /*  Journal entries (manual + approval + reversal)                          */
  /* ----------------------------------------------------------------------- */

  async listEntries(
    organizationId: string,
    opts: {
      status?: string;
      sourceType?: string;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    const { start, end } = this.dateRange(opts.from, opts.to);
    const rows = await this.prisma.client.journalEntry.findMany({
      where: {
        organizationId,
        ...(opts.status ? { status: opts.status as JournalEntryStatus } : {}),
        ...(opts.sourceType ? { sourceType: opts.sourceType as JournalSourceType } : {}),
        entryDate: { gte: start, lte: end },
      },
      select: ENTRY_SAFE,
      take: Math.min(opts.limit ?? 50, 100),
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  async getEntry(organizationId: string, entryId: string) {
    const entry = await this.prisma.client.journalEntry.findFirst({
      where: { id: entryId, organizationId },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  /** Create a manual journal entry in DRAFT (requires approval to post). */
  async createEntry(
    organizationId: string,
    dto: CreateJournalEntryDto,
    userId: string,
  ) {
    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: accountIds }, organizationId, active: true },
      select: { id: true, code: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a.code]));
    for (const id of accountIds) {
      if (!byId.has(id)) {
        throw new NotFoundException(`Chart account ${id} not found in this organization`);
      }
    }

    const entry = await this.ledger.post({
      tx: this.prisma.client,
      organizationId,
      sourceType: 'MANUAL',
      sourceId: null,
      description: dto.description ?? 'Manual journal entry',
      entryDate: dto.entryDate ? new Date(dto.entryDate) : new Date(),
      status: 'DRAFT',
      lines: dto.lines.map((l) => ({
        accountCode: byId.get(l.accountId)!,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
      userId,
    });
    if (!entry) {
      throw new ConflictException('A manual journal entry could not be created');
    }

    return this.prisma.client.journalEntry.findFirst({
      where: { id: entry.id, organizationId },
      include: {
        lines: { include: { account: { select: { code: true, name: true, type: true } } } },
      },
    });
  }

  async approveEntry(organizationId: string, entryId: string, userId: string) {
    const entry = await this.prisma.client.journalEntry.findFirst({
      where: { id: entryId, organizationId },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'DRAFT') {
      throw new ConflictException(`Only draft journal entries can be approved (status is ${entry.status})`);
    }
    return this.prisma.client.journalEntry.update({
      where: { id: entryId },
      data: {
        status: 'POSTED',
        approvedBy: userId,
        approvedAt: new Date(),
        updatedBy: userId,
      },
      include: {
        lines: { include: { account: { select: { code: true, name: true, type: true } } } },
      },
    });
  }

  /**
   * Reverse a POSTED entry: a new POSTED entry books the exact mirror and the
   * original flips to REVERSED. Auto entries (sourceType != MANUAL) can be
   * reversed to correct an immutably-posted document.
   */
  async reverseEntry(
    organizationId: string,
    entryId: string,
    reason: string | undefined,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const original = await tx.journalEntry.findFirst({
        where: { id: entryId, organizationId, status: 'POSTED', reversalOfId: null },
        include: {
          lines: { include: { account: { select: { code: true } } } },
        },
      });
      if (!original) {
        const existing = await tx.journalEntry.findFirst({
          where: { id: entryId, organizationId },
          select: { id: true, status: true },
        });
        if (!existing) throw new NotFoundException('Journal entry not found');
        throw new ConflictException(
          `Only posted journal entries that are not already reversed can be reversed (status is ${existing.status})`,
        );
      }

      const reversal = await this.ledger.post({
        tx,
        organizationId,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        reversalOfId: original.id,
        description: reason ?? `Reversal of ${original.entryNumber}`,
        lines: original.lines.map((l) => ({
          accountCode: l.account.code,
          debit: Number(l.credit),
          credit: Number(l.debit),
          memo: `Reverses ${original.entryNumber}`,
        })),
        userId,
      });

      if (!reversal) {
        throw new ConflictException('This entry has already been reversed');
      }

      await tx.journalEntry.update({
        where: { id: entryId },
        data: { status: 'REVERSED', updatedBy: userId ?? null },
      });

      return reversal;
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Reports                                                                 */
  /* ----------------------------------------------------------------------- */

  private async accountBalances(
    organizationId: string,
    from?: string,
    to?: string,
    onlyAccountId?: string,
  ): Promise<Map<string, GroupedBalance>> {
    const { start, end } = this.dateRange(from, to);
    const groups = await this.prisma.client.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        organizationId,
        ...(onlyAccountId ? { accountId: onlyAccountId } : {}),
        entry: {
          status: 'POSTED',
          entryDate: { gte: start, lte: end },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const map = new Map<string, GroupedBalance>();
    for (const g of groups) {
      const debit = Number(g._sum.debit ?? 0);
      const credit = Number(g._sum.credit ?? 0);
      map.set(g.accountId, { debit, credit, net: round2(debit - credit) });
    }
    return map;
  }

  async trialBalance(organizationId: string, from?: string, to?: string) {
    const { start, end } = this.dateRange(from, to);
    const balances = await this.accountBalances(organizationId, from, to);
    const accounts = await this.prisma.client.account.findMany({
      where: { organizationId, active: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    });

    const rows = accounts.map((a) => {
      const { debit, credit } = balances.get(a.id) ?? { debit: 0, credit: 0 };
      const side = this.balanceSide(a.type);
      const net = side === 'debit' ? round2(debit - credit) : round2(credit - debit);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: round2(debit),
        credit: round2(credit),
        side,
        balance: net,
      };
    });

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      accounts: rows,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
    };
  }

  async profitLoss(organizationId: string, from?: string, to?: string) {
    const { start, end } = this.dateRange(from, to);
    const balances = await this.accountBalances(organizationId, from, to);
    const accounts = await this.prisma.client.account.findMany({
      where: {
        organizationId,
        active: true,
        type: { in: [AccountType.INCOME, AccountType.EXPENSE] },
      },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    });

    let grossIncome = 0;
    let grossExpenses = 0;
    const income = [];
    const expenses = [];

    for (const a of accounts) {
      const { debit, credit } = balances.get(a.id) ?? { debit: 0, credit: 0 };
      if (a.type === AccountType.INCOME) {
        const net = round2(credit - debit);
        grossIncome = round2(grossIncome + net);
        income.push({ accountId: a.id, code: a.code, name: a.name, credit: round2(credit), debit: round2(debit), balance: net });
      } else {
        const net = round2(debit - credit);
        grossExpenses = round2(grossExpenses + net);
        expenses.push({ accountId: a.id, code: a.code, name: a.name, debit: round2(debit), credit: round2(credit), balance: net });
      }
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      income,
      totalIncome: grossIncome,
      expenses,
      totalExpenses: grossExpenses,
      netIncome: round2(grossIncome - grossExpenses),
    };
  }

  async balanceSheet(organizationId: string, asOf?: string) {
    const { end } = this.dateRange(undefined, asOf);
    const balances = await this.accountBalances(organizationId, undefined, asOf);
    const accounts = await this.prisma.client.account.findMany({
      where: {
        organizationId,
        active: true,
        type: {
          in: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY],
        },
      },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    });

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const a of accounts) {
      const { debit, credit } = balances.get(a.id) ?? { debit: 0, credit: 0 };
      if (a.type === AccountType.ASSET) {
        const net = round2(debit - credit);
        totalAssets = round2(totalAssets + net);
        assets.push({ accountId: a.id, code: a.code, name: a.name, balance: net });
      } else if (a.type === AccountType.LIABILITY) {
        const net = round2(credit - debit);
        totalLiabilities = round2(totalLiabilities + net);
        liabilities.push({ accountId: a.id, code: a.code, name: a.name, balance: net });
      } else {
        const net = round2(credit - debit);
        totalEquity = round2(totalEquity + net);
        equity.push({ accountId: a.id, code: a.code, name: a.name, balance: net });
      }
    }

    const pl = await this.profitLoss(organizationId, undefined, asOf);
    const netIncome = pl.netIncome;

    return {
      asOf: end.toISOString(),
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equity,
      totalEquity,
      netIncome,
      totalEquityIncludingNetIncome: round2(totalEquity + netIncome),
      totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity + netIncome),
    };
  }

  async generalLedger(
    organizationId: string,
    opts: {
      accountId?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {},
  ) {
    const { start, end } = this.dateRange(opts.from, opts.to);
    const rows = await this.prisma.client.journalEntryLine.findMany({
      where: {
        organizationId,
        ...(opts.accountId ? { accountId: opts.accountId } : {}),
        entry: {
          status: 'POSTED',
          entryDate: { gte: start, lte: end },
        },
      },
      include: {
        entry: {
          select: {
            entryNumber: true,
            entryDate: true,
            sourceType: true,
            sourceId: true,
            description: true,
          },
        },
        account: { select: { id: true, code: true, name: true, type: true } },
      },
      orderBy: [{ entry: { entryDate: 'asc' as const } }, { id: 'asc' }],
      take: Math.min(opts.limit ?? 200, 500),
    });

    const running = new Map<string, number>();
    const entries: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const side = this.balanceSide(row.account.type);
      const movement =
        side === 'debit'
          ? Number(row.debit) - Number(row.credit)
          : Number(row.credit) - Number(row.debit);
      const prior = running.get(row.accountId) ?? 0;
      const runningBalance = round2(prior + movement);
      running.set(row.accountId, runningBalance);
      entries.push({
        entryId: row.entryId,
        entryNumber: row.entry.entryNumber,
        entryDate: row.entry.entryDate,
        sourceType: row.entry.sourceType,
        sourceId: row.entry.sourceId,
        entryDescription: row.entry.description,
        account: row.account,
        debit: Number(row.debit),
        credit: Number(row.credit),
        memo: row.memo,
        runningBalance,
      });
    }
    return { from: start.toISOString(), to: end.toISOString(), entries };
  }
}