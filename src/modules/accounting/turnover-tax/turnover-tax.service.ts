import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceType,
  OutboxEventType,
  Prisma,
  TaxRegime,
  TotFilingPeriodStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { OutboxService } from '../../../events/outbox/outbox.service.js';
import { ListTotPeriodsDto, PayTotPeriodDto, UpdateTaxProfileDto } from './dto/tax-profile.dto.js';

/** Confirmed sales are those that are live (exclude DRAFT/VOID). */
const CONFIRMED_STATUSES = [
  InvoiceStatus.CONFIRMED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
];

function monthRange(
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getFullYear(), end.getMonth() - 11, 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

const TAX_PROFILE_REQUIRED = 'Tax profile not initialized';

@Injectable()
export class TurnoverTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  private getTaxProfile(organizationId: string) {
    return this.prisma.client.organizationTaxProfile.findFirst({
      where: { organizationId },
    });
  }

  /** Lazy-initialize the tenant tax profile (regime defaults to VAT_STANDARD). */
  async profile(organizationId: string) {
    let profile = await this.getTaxProfile(organizationId);
    if (!profile) {
      profile = await this.prisma.client.organizationTaxProfile.create({
        data: { organizationId },
      });
    }
    return profile;
  }

  async updateProfile(organizationId: string, dto: UpdateTaxProfileDto) {
    await this.profile(organizationId);
    return this.prisma.client.organizationTaxProfile.update({
      where: { organizationId },
      data: {
        taxRegime: dto.taxRegime,
        ...(dto.totRatePercent !== undefined
          ? { totRatePercent: new Prisma.Decimal(dto.totRatePercent) }
          : {}),
      },
    });
  }

  private async computeTurnover(
    organizationId: string,
    start: Date,
    end: Date,
  ): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.saleInvoice.aggregate({
      where: {
        organizationId,
        type: InvoiceType.INVOICE,
        status: { in: CONFIRMED_STATUSES },
        invoiceDate: { gte: start, lte: end },
      },
      _sum: { total: true },
    });
    return agg._sum.total ?? new Prisma.Decimal(0);
  }

  /**
   * List filing periods, computing turnover + ToT due for any period that has
   * not yet been persisted. Periods default to calendar months.
   */
  async listPeriods(organizationId: string, dto: ListTotPeriodsDto) {
    const profile = await this.profile(organizationId);
    const { start, end } = monthRange(dto.from, dto.to);

    const persisted = await this.prisma.client.totFilingPeriod.findMany({
      where: {
        organizationId,
        periodStart: { gte: start },
        periodEnd: { lte: end },
      },
      orderBy: { periodStart: 'asc' },
    });

    const rate = profile.totRatePercent;

    // Materialize any month between start..end that has no persisted period yet.
    const computed: Array<{
      periodStart: Date;
      periodEnd: Date;
      grossTurnover: Prisma.Decimal;
      totDue: Prisma.Decimal;
      paymentStatus: TotFilingPeriodStatus;
    }> = [];
    const known = new Set(persisted.map((p) => p.periodStart.toISOString().slice(0, 7)));
    const cursor = new Date(start);
    while (cursor <= end) {
      const monthKey = cursor.toISOString().slice(0, 7);
      if (!known.has(monthKey)) {
        const s = new Date(cursor);
        const e = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        e.setHours(23, 59, 59, 999);
        const grossTurnover = await this.computeTurnover(organizationId, s, e);
        const totDue = grossTurnover.mul(rate).div(100);
        if (grossTurnover.gt(0)) {
          computed.push({ periodStart: s, periodEnd: e, grossTurnover, totDue, paymentStatus: TotFilingPeriodStatus.PENDING });
        }
        known.add(monthKey);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    if (computed.length) {
      await this.prisma.client.totFilingPeriod.createMany({
        data: computed.map((c) => ({
          organizationId,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
          grossTurnover: c.grossTurnover,
          totDue: c.totDue,
          paymentStatus: c.paymentStatus,
        })),
      });
    }

    return this.prisma.client.totFilingPeriod.findMany({
      where: {
        organizationId,
        periodStart: { gte: start },
        periodEnd: { lte: end },
      },
      orderBy: { periodStart: 'desc' },
    });
  }

  async getPeriod(organizationId: string, periodId: string) {
    const period = await this.prisma.client.totFilingPeriod.findFirst({
      where: { organizationId, id: periodId },
    });
    if (!period) throw new NotFoundException('ToT filing period not found');
    return period;
  }

  /**
   * Enqueue a mobile-money STK push for the period amount. The outbox handler
   * performs the actual (provider-abstracted) payment and marks the period paid.
   */
  async payPeriod(organizationId: string, periodId: string, dto: PayTotPeriodDto) {
    const profile = await this.profile(organizationId);
    if (profile.taxRegime !== TaxRegime.TURNOVER_TAX) {
      throw new BadRequestException('Turnover Tax is not active for this organization');
    }

    const period = await this.getPeriod(organizationId, periodId);
    if (period.paymentStatus === TotFilingPeriodStatus.PAID) {
      throw new BadRequestException('This ToT filing period is already paid');
    }

    const amount = Number(period.totDue);
    if (amount <= 0) {
      throw new BadRequestException('Nothing is due for this period');
    }

    const reference = period.paymentReference;
    await this.prisma.client.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, {
        type: OutboxEventType.TOT_PAYMENT_STK_PUSH,
        aggregateType: 'TotFilingPeriod',
        aggregateId: period.id,
        organizationId,
        payload: {
          periodId: period.id,
          amount,
          phoneNumber: dto.phoneNumber ?? null,
          accountReference: `TOT-${period.periodStart.toISOString().slice(0, 7)}`,
        },
      });
      if (!reference) {
        await tx.totFilingPeriod.update({
          where: { id: period.id },
          data: { paymentReference: `STK-${Date.now().toString().slice(-8)}` },
        });
      }
    });

    return this.getPeriod(organizationId, periodId);
  }

  async receipt(organizationId: string, periodId: string) {
    return this.getPeriod(organizationId, periodId);
  }
}