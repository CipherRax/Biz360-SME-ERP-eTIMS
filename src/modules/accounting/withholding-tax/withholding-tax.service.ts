import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WithholdingTaxDeductionStatus, WithholdingTaxPaymentType, WithholdingTaxResidency } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  ComputeWithholdingTaxDto,
  CalculateWithholdingTaxDto,
  ListWithholdingTaxDeductionsDto,
  RecordWithholdingTaxDto,
  UpsertWithholdingTaxRateDto,
  WithholdingTaxCertificateDto,
} from './dto/withholding-tax.dto.js';

@Injectable()
export class WithholdingTaxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rate lookup: org-specific row wins, else the tenant-nullable system default. */
  async resolveRate(
    organizationId: string,
    paymentType: WithholdingTaxPaymentType,
    residency: WithholdingTaxResidency = WithholdingTaxResidency.RESIDENT,
    asOf = new Date(),
  ): Promise<{ ratePercent: Prisma.Decimal; source: 'system' | 'custom' }> {
    const custom = await this.prisma.client.withholdingTaxRate.findFirst({
      where: {
        organizationId,
        paymentType,
        residency,
        effectiveFrom: { lte: asOf },
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { ratePercent: true },
    });
    if (custom) return { ratePercent: custom.ratePercent, source: 'custom' };

    const systemRate = await this.prisma.client.withholdingTaxRate.findFirst({
      where: {
        organizationId: null,
        paymentType,
        residency,
        effectiveFrom: { lte: asOf },
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { ratePercent: true },
    });
    if (systemRate) return { ratePercent: systemRate.ratePercent, source: 'system' };

    throw new NotFoundException(
      `No withholding tax rate configured for ${paymentType} (${residency})`,
    );
  }

  private dateRange(dto?: { from?: string; to?: string }): { gte: Date; lte: Date } {
    const to = dto?.to ? new Date(dto.to) : new Date();
    to.setHours(23, 59, 59, 999);
    return { gte: dto?.from ? new Date(dto.from) : new Date(0), lte: to };
  }

  async listRates(organizationId: string) {
    const [custom, system] = await Promise.all([
      this.prisma.client.withholdingTaxRate.findMany({
        where: { organizationId },
        orderBy: [{ paymentType: 'asc' }, { effectiveFrom: 'desc' }],
      }),
      this.prisma.client.withholdingTaxRate.findMany({
        where: { organizationId: null },
        orderBy: [{ paymentType: 'asc' }, { effectiveFrom: 'desc' }],
      }),
    ]);
    return {
      systemDefaults: system,
      organizationOverrides: custom,
    };
  }

  async upsertRate(organizationId: string, dto: UpsertWithholdingTaxRateDto): Promise<unknown> {
    const ratePercent = new Prisma.Decimal(dto.ratePercent);
    if (dto.defaults) {
      // Organization override: version by effectiveFrom, auto-version on rate change.
      const existing = await this.prisma.client.withholdingTaxRate.findFirst({
        where: {
          organizationId,
          paymentType: dto.paymentType,
          residency: dto.residency,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : { lte: new Date() },
        },
        orderBy: { effectiveFrom: 'desc' },
        select: { id: true, ratePercent: true, effectiveFrom: true },
      });
      if (
        existing &&
        (!dto.effectiveFrom || new Date(existing.effectiveFrom).getTime() === new Date(dto.effectiveFrom).getTime())
      ) {
        return this.prisma.client.withholdingTaxRate.update({
          where: { id: existing.id },
          data: { ratePercent, effectiveTo: dto.effectiveTo ?? undefined },
        });
      }
    }
    return this.prisma.client.withholdingTaxRate.create({
      data: {
        organizationId,
        paymentType: dto.paymentType,
        residency: dto.residency,
        ratePercent,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
    });
  }

  /** Supplier payments that have not yet been WHT-deducted. */
  async eligiblePayments(organizationId: string, limit = 50): Promise<unknown[]> {
    const payments = await this.prisma.client.payment.findMany({
      where: {
        organizationId,
        party: { type: { not: 'CUSTOMER' } },
        withholdingDeductions: { none: {} },
      },
      take: Math.min(limit, 200),
      orderBy: { paidAt: 'desc' },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        reference: true,
        partyId: true,
        party: { select: { name: true, taxId: true } },
      },
    });
    return payments;
  }

  /** Preview WHT for a supplier payment using scenario rates (A2). */
  async compute(
    organizationId: string,
    dto: ComputeWithholdingTaxDto,
  ): Promise<{
    paymentId: string;
    grossAmount: string;
    ratePercent: string;
    whtAmount: string;
    netPayableAmount: string;
    rateSource: 'system' | 'custom';
  }> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: dto.paymentId, organizationId },
      select: { id: true, amount: true, partyId: true, party: { select: { type: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.party.type === 'CUSTOMER') {
      throw new BadRequestException('Withholding tax applies to supplier payments only');
    }

    const rate = await this.resolveRate(
      organizationId,
      WithholdingTaxPaymentType.PROFESSIONAL_FEES,
      undefined,
      new Date(),
    );
    const gross = payment.amount;
    const wht = gross.mul(rate.ratePercent).div(100).toDecimalPlaces(2);
    const net = gross.sub(wht);

    return {
      paymentId: payment.id,
      grossAmount: gross.toFixed(2),
      ratePercent: rate.ratePercent.toFixed(2),
      whtAmount: wht.toFixed(2),
      netPayableAmount: net.toFixed(2),
      rateSource: rate.source,
    };
  }

  /** Records the deduction for an approved supplier payment (idempotent). */
  async record(organizationId: string, dto: RecordWithholdingTaxDto): Promise<unknown> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: dto.paymentId, organizationId },
      select: { id: true, amount: true, partyId: true, party: { select: { type: true, name: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.party.type === 'CUSTOMER') {
      throw new BadRequestException('Withholding tax applies to supplier payments only');
    }

    const existing = await this.prisma.client.withholdingTaxDeduction.findFirst({
      where: { organizationId, supplierPaymentId: payment.id },
      select: { id: true },
    });
    if (existing) return existing;

    const rate = await this.resolveRate(
      organizationId,
      WithholdingTaxPaymentType.PROFESSIONAL_FEES,
      undefined,
      new Date(),
    );
    const gross = payment.amount;
    const wht = gross.mul(rate.ratePercent).div(100).toDecimalPlaces(2);
    const net = gross.sub(wht);

    return this.prisma.client.withholdingTaxDeduction.create({
      data: {
        organizationId,
        supplierId: payment.partyId,
        supplierPaymentId: payment.id,
        paymentType: WithholdingTaxPaymentType.PROFESSIONAL_FEES,
        grossAmount: gross,
        ratePercent: rate.ratePercent,
        whtAmount: wht,
        netPayableAmount: net,
        status: WithholdingTaxDeductionStatus.CALCULATED,
      },
    });
  }

  async list(organizationId: string, dto: ListWithholdingTaxDeductionsDto) {
    const where: Prisma.WithholdingTaxDeductionWhereInput = { organizationId };
    if (dto.paymentId) where.supplierPaymentId = dto.paymentId;
    if (dto.supplierId) where.supplierId = dto.supplierId;

    const [items, total] = await Promise.all([
      this.prisma.client.withholdingTaxDeduction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: dto.limit ?? 50,
        skip: dto.offset ?? 0,
        select: {
          id: true,
          supplierId: true,
          supplier: { select: { name: true, taxId: true } },
          supplierPaymentId: true,
          paymentType: true,
          grossAmount: true,
          ratePercent: true,
          whtAmount: true,
          netPayableAmount: true,
          status: true,
          kraWhtCertificateNumber: true,
          remittanceDate: true,
          createdAt: true,
        },
      }),
      this.prisma.client.withholdingTaxDeduction.count({ where }),
    ]);
    return { items, total };
  }

  /** Issues a WHT certificate (idempotent per deduction). */
  async certificate(organizationId: string, dto: WithholdingTaxCertificateDto) {
    const deduction = dto.deductionId
      ? await this.prisma.client.withholdingTaxDeduction.findFirst({
          where: { id: dto.deductionId, organizationId },
          select: { id: true, supplierId: true, grossAmount: true, ratePercent: true, whtAmount: true, kraWhtCertificateNumber: true },
        })
      : null;
    if (!deduction) throw new NotFoundException('Withholding tax deduction not found');

    if (!deduction.kraWhtCertificateNumber) {
      const year = new Date().getFullYear();
      const seq = await this.prisma.client.withholdingTaxDeduction.count({
        where: { organizationId, createdAt: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31T23:59:59`) } },
      });
      await this.prisma.client.withholdingTaxDeduction.update({
        where: { id: deduction.id },
        data: { kraWhtCertificateNumber: `WHT-${year}-${String(seq + 1).padStart(4, '0')}` },
      });
    }

    return this.prisma.client.withholdingTaxDeduction.findUnique({
      where: { id: deduction.id },
      select: {
        id: true,
        supplier: { select: { name: true, taxId: true } },
        grossAmount: true,
        ratePercent: true,
        whtAmount: true,
        netPayableAmount: true,
        kraWhtCertificateNumber: true,
        paymentType: true,
      },
    });
  }

  /** Monthly remittance summary KRA expects from the payer, net of supplier credit-note offsets. */
  async remittanceSummary(organizationId: string, dto: CalculateWithholdingTaxDto) {
    const range = this.dateRange(dto);
    const rows = await this.prisma.client.withholdingTaxDeduction.findMany({
      where: { organizationId, createdAt: range },
      select: {
        id: true,
        paymentType: true,
        grossAmount: true,
        whtAmount: true,
        status: true,
        remittanceDate: true,
      },
    });

    const byType = new Map<string, { gross: Prisma.Decimal; wht: Prisma.Decimal; count: number }>();
    for (const r of rows) {
      const key = r.paymentType;
      const agg = byType.get(key) ?? { gross: new Prisma.Decimal(0), wht: new Prisma.Decimal(0), count: 0 };
      agg.gross = agg.gross.add(r.grossAmount);
      agg.wht = agg.wht.add(r.whtAmount);
      agg.count += 1;
      byType.set(key, agg);
    }

    const gross = rows.reduce((a, r) => a.add(r.grossAmount), new Prisma.Decimal(0));
    const wht = rows.reduce((a, r) => a.add(r.whtAmount), new Prisma.Decimal(0));

    const deductionIds = rows.map((r) => r.id);
    const offsets = deductionIds.length
      ? await this.prisma.client.supplierEtimsCreditNote.findMany({
          where: {
            organizationId,
            matchStatus: 'MATCHED',
            whtOffsetDeductionId: { in: deductionIds },
            whtOffsetAmount: { not: null },
            deletedAt: null,
          },
          select: { whtOffsetAmount: true },
        })
      : [];
    const offset = offsets.reduce(
      (a, c) => a.add(c.whtOffsetAmount ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    return {
      range: { from: range.gte, to: range.lte },
      totals: {
        grossAmount: gross.toFixed(2),
        whtAmount: wht.toFixed(2),
        offsetAmount: offset.toFixed(2),
        remittableWhtAmount: wht.sub(offset).toFixed(2),
        count: rows.length,
        offsetCount: offsets.length,
      },
      byPaymentType: Array.from(byType.entries()).map(([key, v]) => ({
        paymentType: key,
        grossAmount: v.gross.toFixed(2),
        whtAmount: v.wht.toFixed(2),
        count: v.count,
      })),
      pendingRemittance: rows.filter((r) => r.status === WithholdingTaxDeductionStatus.CALCULATED),
    };
  }
}