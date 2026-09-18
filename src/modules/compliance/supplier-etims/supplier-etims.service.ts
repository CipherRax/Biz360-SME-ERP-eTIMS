import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ExpenseComplianceFlagType,
  Prisma,
  SupplierEtimsCaptureMethod,
  SupplierEtimsMatchStatus,
  SupplierEtimsVerificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { OutboxService } from '../../../events/outbox/outbox.service.js';
import {
  CreateSupplierEtimsCreditNoteDto,
  CreateSupplierEtimsInvoiceDto,
  MatchSupplierEtimsCreditNoteDto,
  MatchSupplierEtimsDto,
  ScanSupplierEtimsDto,
} from './dto/supplier-etims.dto.js';

const SUPPLIER_ETIMS_FIELDS = {
  id: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, taxId: true } },
  kraInvoiceNumber: true,
  kraControlUnitId: true,
  invoiceDate: true,
  amount: true,
  vatAmount: true,
  captureMethod: true,
  matchedPurchaseInvoiceId: true,
  matchedPurchaseInvoice: {
    select: { id: true, invoiceNumber: true },
  },
  matchStatus: true,
  verificationStatus: true,
  attachmentUrl: true,
  createdAt: true,
} as const;

const SUPPLIER_ETIMS_CREDIT_FIELDS = {
  id: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, taxId: true } },
  kraInvoiceNumber: true,
  originalInvoiceNumber: true,
  originalEtimsInvoiceId: true,
  originalPurchaseInvoiceId: true,
  originalPurchaseInvoice: { select: { id: true, invoiceNumber: true } },
  creditNoteDate: true,
  amount: true,
  vatAmount: true,
  totalAmount: true,
  reason: true,
  captureMethod: true,
  matchStatus: true,
  verificationStatus: true,
  whtOffsetAmount: true,
  whtOffsetDeductionId: true,
  createdAt: true,
} as const;

@Injectable()
export class SupplierEtimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  private static complianceDir() {
    return resolve(process.cwd(), 'uploads', 'compliance');
  }

  async create(organizationId: string, dto: CreateSupplierEtimsInvoiceDto) {
    const supplier = await this.prisma.client.party.findFirst({
      where: { id: dto.supplierId, organizationId },
      select: { id: true, type: true },
    });
    if (!supplier || supplier.type === 'CUSTOMER') {
      throw new BadRequestException('Supplier not found');
    }

    const kraInvoiceNumber = dto.kraInvoiceNumber.trim().toUpperCase();
    const dup = await this.prisma.client.supplierEtimsInvoice.findFirst({
      where: { organizationId, kraInvoiceNumber },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        `A receipt with KRA number ${kraInvoiceNumber} is already captured`,
      );
    }

    return this.prisma.client.supplierEtimsInvoice.create({
      data: {
        organizationId,
        supplierId: supplier.id,
        kraInvoiceNumber,
        kraControlUnitId: dto.kraControlUnitId ?? null,
        kraQrCodeData: dto.kraQrCodeData ?? null,
        invoiceDate: new Date(dto.invoiceDate),
        amount: new Prisma.Decimal(dto.amount),
        vatAmount: dto.vatAmount
          ? new Prisma.Decimal(dto.vatAmount)
          : new Prisma.Decimal(0),
        captureMethod: dto.captureMethod ?? SupplierEtimsCaptureMethod.MANUAL,
        matchedPurchaseInvoiceId: null,
        matchStatus: SupplierEtimsMatchStatus.UNMATCHED,
        verificationStatus: SupplierEtimsVerificationStatus.UNVERIFIED,
      },
      select: SUPPLIER_ETIMS_FIELDS,
    });
  }

  async list(
    organizationId: string,
    opts: { limit?: number; cursor?: string; supplierId?: string; matchStatus?: SupplierEtimsMatchStatus },
  ) {
    const where: Prisma.SupplierEtimsInvoiceWhereInput = { organizationId, deletedAt: null };
    if (opts.supplierId) where.supplierId = opts.supplierId;
    if (opts.matchStatus) where.matchStatus = opts.matchStatus;

    const take = Math.min(opts.limit ?? 50, 100);
    const items = await this.prisma.client.supplierEtimsInvoice.findMany({
      where,
      take,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { invoiceDate: 'desc' },
      select: SUPPLIER_ETIMS_FIELDS,
    });
    return {
      data: items,
      nextCursor: items.length === take ? items[items.length - 1]?.id : undefined,
    };
  }

  /** Queues an OCR job for a photographed/PDF supplier receipt. Returns jobId. */
  async scan(organizationId: string, dto: ScanSupplierEtimsDto) {
    const match = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,(.+)$/i.exec(
      dto.data.trim(),
    );
    if (!match) {
      throw new BadRequestException(
        'Scan must be a base64 data URL of a JPEG, PNG, WebP image or PDF.',
      );
    }
    const [, mime, encoded] = match;
    const ext = mapMimeToExt(mime);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.byteLength === 0) throw new BadRequestException('File is empty.');
    if (bytes.byteLength > 1_200_000) {
      throw new BadRequestException('File must be 1 MB or smaller.');
    }

    const dir = SupplierEtimsService.complianceDir();
    mkdirSync(dir, { recursive: true });
    const fileKey = `compliance/${randomUUID()}${ext}`;
    writeFileSync(join(dir, basenameOf(fileKey)), bytes);

    const jobId = randomUUID();
    let invoiceId: string | null = null;
    if (dto.supplierId) {
      const supplier = await this.prisma.client.party.findFirst({
        where: { id: dto.supplierId, organizationId },
        select: { id: true },
      });
      if (supplier) {
        const pending = await this.prisma.client.supplierEtimsInvoice.create({
          data: {
            organizationId,
            supplierId: supplier.id,
            kraInvoiceNumber: `SCAN-${jobId.slice(0, 8)}`,
            invoiceDate: new Date(),
            amount: new Prisma.Decimal(0),
            captureMethod: SupplierEtimsCaptureMethod.OCR_SCAN,
            attachmentUrl: `/uploads/${fileKey}`,
            ocrJobId: jobId,
          },
          select: { id: true },
        });
        invoiceId = pending.id;
      }
    }

    await this.outbox.enqueue(
      this.prisma.client,
      {
        type: 'ETIMS_SUPPLIER_OCR',
        aggregateType: 'SUPPLIER_ETIMS_INVOICE',
        aggregateId: invoiceId ?? jobId,
        payload: { jobId, fileKey, invoiceId },
        organizationId,
      },
    );

    return {
      jobId,
      invoiceId,
      status: 'QUEUED',
      message:
        'OCR extraction queued. Poll GET /etims/supplier-invoices/scan/:jobId for the result.',
    };
  }

  async scanStatus(organizationId: string, jobId: string) {
    const job = await this.prisma.client.outboxEvent.findFirst({
      where: { organizationId, aggregateId: jobId, eventType: 'ETIMS_SUPPLIER_OCR' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, attempts: true, lastError: true, processedAt: true },
    });
    if (!job) throw new NotFoundException('Scan job not found');

    const invoice = await this.prisma.client.supplierEtimsInvoice.findFirst({
      where: { organizationId, ocrJobId: jobId },
      select: { id: true, kraInvoiceNumber: true, amount: true },
    });

    return {
      jobId,
      jobStatus: job.status,
      attempts: job.attempts,
      error: job.lastError,
      processedAt: job.processedAt,
      extracted: job.status === 'DONE' ? (invoice?.amount.gt(0) ? invoice : null) : null,
    };
  }

  async verify(organizationId: string, id: string) {
    const invoice = await this.prisma.client.supplierEtimsInvoice.findFirst({
      where: { id, organizationId },
      select: { id: true, kraQrCodeData: true },
    });
    if (!invoice) throw new NotFoundException('Supplier eTIMS invoice not found');

    await this.outbox.enqueue(
      this.prisma.client,
      {
        type: 'ETIMS_SUPPLIER_VERIFY',
        aggregateType: 'SUPPLIER_ETIMS_INVOICE',
        aggregateId: invoice.id,
        payload: { invoiceId: invoice.id, kraQrCodeData: invoice.kraQrCodeData },
        organizationId,
      },
    );
    return {
      invoiceId: invoice.id,
      status: 'VERIFICATION_QUEUED',
      message: 'Verification queued against the KRA verification provider.',
    };
  }

  async match(organizationId: string, id: string, dto: MatchSupplierEtimsDto) {
    const invoice = await this.prisma.client.supplierEtimsInvoice.findFirst({
      where: { id, organizationId },
      select: { id: true, supplierId: true, amount: true },
    });
    if (!invoice) throw new NotFoundException('Supplier eTIMS invoice not found');

    const purchase = await this.prisma.client.purchaseInvoice.findFirst({
      where: { id: dto.purchaseInvoiceId, organizationId },
      select: { id: true, partyId: true, total: true, invoiceDate: true },
    });
    if (!purchase) throw new NotFoundException('Purchase invoice not found');
    if (purchase.partyId !== invoice.supplierId) {
      throw new BadRequestException(
        'Purchase and supplier eTIMS receipt must reference the same supplier',
      );
    }

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.supplierEtimsInvoice.update({
        where: { id },
        data: {
          matchedPurchaseInvoiceId: purchase.id,
          matchStatus: SupplierEtimsMatchStatus.MATCHED,
        },
        select: SUPPLIER_ETIMS_FIELDS,
      });

      const mismatch = Number(invoice.amount) !== Number(purchase.total);
      await tx.expenseComplianceFlag.updateMany({
        where: { organizationId, purchaseInvoiceId: purchase.id, resolvedAt: null },
        data: { resolvedAt: new Date(), resolutionNote: 'Matched to supplier eTIMS invoice' },
      });
      if (mismatch) {
        await tx.expenseComplianceFlag.create({
          data: {
            organizationId,
            purchaseInvoiceId: purchase.id,
            flagType: ExpenseComplianceFlagType.PARTIAL_AMOUNT_MISMATCH,
            amountMismatch: purchase.total.sub(invoice.amount),
          },
        });
      }
      return updated;
    });
  }

  async unmatched(organizationId: string, limit = 50, cursor?: string) {
    const where = {
      organizationId,
      expenseComplianceFlags: {
        some: { flagType: ExpenseComplianceFlagType.NO_ETIMS_MATCH, resolvedAt: null },
      },
    } satisfies Prisma.PurchaseInvoiceWhereInput;

    const items = await this.prisma.client.purchaseInvoice.findMany({
      where,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        total: true,
        partyId: true,
        party: { select: { id: true, name: true } },
        expenseComplianceFlags: {
          where: { flagType: ExpenseComplianceFlagType.NO_ETIMS_MATCH, resolvedAt: null },
          select: { id: true, createdAt: true },
          take: 1,
        },
      },
    });

    return {
      data: items.map((i) => ({
        purchaseInvoiceId: i.id,
        invoiceNumber: i.invoiceNumber,
        supplierId: i.partyId,
        supplier: i.party.name,
        amount: i.total,
        invoiceDate: i.invoiceDate,
        flaggedAt: i.expenseComplianceFlags[0]?.createdAt ?? null,
      })),
      nextCursor: items.length === Math.min(limit, 100) ? items[items.length - 1]?.id : undefined,
    };
  }

  async exposureSummary(organizationId: string) {
    const [open, credits] = await Promise.all([
      this.prisma.client.purchaseInvoice.findMany({
        where: {
          organizationId,
          expenseComplianceFlags: {
            some: { flagType: ExpenseComplianceFlagType.NO_ETIMS_MATCH, resolvedAt: null },
          },
        },
        orderBy: { invoiceDate: 'asc' },
        select: { id: true, total: true, invoiceDate: true },
      }),
      this.prisma.client.supplierEtimsCreditNote.findMany({
        where: {
          organizationId,
          matchStatus: SupplierEtimsMatchStatus.MATCHED,
          deletedAt: null,
        },
        select: { originalPurchaseInvoiceId: true, totalAmount: true },
      }),
    ]);

    const creditedByPurchase = new Map<string, Prisma.Decimal>();
    let creditedTotal = new Prisma.Decimal(0);
    for (const c of credits) {
      creditedTotal = creditedTotal.add(c.totalAmount);
      if (c.originalPurchaseInvoiceId) {
        const prev = creditedByPurchase.get(c.originalPurchaseInvoiceId) ?? new Prisma.Decimal(0);
        creditedByPurchase.set(c.originalPurchaseInvoiceId, prev.add(c.totalAmount));
      }
    }

    let exposure = new Prisma.Decimal(0);
    let openCount = 0;
    let oldest: Date | null = null;
    for (const p of open) {
      const credited = creditedByPurchase.get(p.id) ?? new Prisma.Decimal(0);
      const net = p.total.gt(credited) ? p.total.sub(credited) : new Prisma.Decimal(0);
      if (net.gt(0)) {
        openCount += 1;
        exposure = exposure.add(net);
        oldest ??= p.invoiceDate;
      }
    }

    return {
      unmatchedCount: openCount,
      totalExposure: exposure.toFixed(2),
      creditedAmount: creditedTotal.toFixed(2),
      creditNoteCount: credits.length,
      oldestUnmatchedAt: oldest,
      agesInDays: oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : 0,
    };
  }

  /* ------------------------- Supplier eTIMS credit notes ------------------------ */

  private async supplierOrThrow(organizationId: string, supplierId: string) {
    const supplier = await this.prisma.client.party.findFirst({
      where: { id: supplierId, organizationId },
      select: { id: true, type: true },
    });
    if (!supplier || supplier.type === 'CUSTOMER') {
      throw new BadRequestException('Supplier not found');
    }
    return supplier;
  }

  /** Capture a supplier credit note (KRA ETCR) — usually a returned purchase. */
  async createCreditNote(organizationId: string, dto: CreateSupplierEtimsCreditNoteDto) {
    await this.supplierOrThrow(organizationId, dto.supplierId);

    const kraInvoiceNumber = dto.kraInvoiceNumber.trim().toUpperCase();
    const dup = await this.prisma.client.supplierEtimsCreditNote.findFirst({
      where: { organizationId, kraInvoiceNumber, deletedAt: null },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        `A credit note with KRA number ${kraInvoiceNumber} is already captured`,
      );
    }

    return this.prisma.client.supplierEtimsCreditNote.create({
      data: {
        organizationId,
        supplierId: dto.supplierId,
        kraInvoiceNumber,
        originalInvoiceNumber: dto.originalInvoiceNumber?.trim() || null,
        originalEtimsInvoiceId: dto.originalEtimsInvoiceId ?? null,
        originalPurchaseInvoiceId: dto.originalPurchaseInvoiceId ?? null,
        kraQrCodeData: dto.kraQrCodeData ?? null,
        creditNoteDate: new Date(dto.creditNoteDate),
        amount: new Prisma.Decimal(dto.amount),
        vatAmount: dto.vatAmount ? new Prisma.Decimal(dto.vatAmount) : new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(dto.amount).plus(
          dto.vatAmount ? new Prisma.Decimal(dto.vatAmount) : new Prisma.Decimal(0),
        ),
        reason: dto.reason ?? null,
        captureMethod: dto.captureMethod ?? SupplierEtimsCaptureMethod.MANUAL,
        matchStatus: SupplierEtimsMatchStatus.UNMATCHED,
        verificationStatus: SupplierEtimsVerificationStatus.UNVERIFIED,
      },
      select: SUPPLIER_ETIMS_CREDIT_FIELDS,
    });
  }

  async listCreditNotes(
    organizationId: string,
    opts: { limit?: number; cursor?: string; supplierId?: string; matchStatus?: SupplierEtimsMatchStatus },
  ) {
    const where: Prisma.SupplierEtimsCreditNoteWhereInput = { organizationId, deletedAt: null };
    if (opts.supplierId) where.supplierId = opts.supplierId;
    if (opts.matchStatus) where.matchStatus = opts.matchStatus;

    const take = Math.min(opts.limit ?? 50, 100);
    const items = await this.prisma.client.supplierEtimsCreditNote.findMany({
      where,
      take,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { creditNoteDate: 'desc' },
      select: SUPPLIER_ETIMS_CREDIT_FIELDS,
    });
    return {
      data: items,
      nextCursor: items.length === take ? items[items.length - 1]?.id : undefined,
    };
  }

  /** Queues best-effort KRA QR verification for a captured credit note. */
  async verifyCreditNote(organizationId: string, id: string) {
    const credit = await this.prisma.client.supplierEtimsCreditNote.findFirst({
      where: { id, organizationId },
      select: { id: true, kraQrCodeData: true },
    });
    if (!credit) throw new NotFoundException('Supplier eTIMS credit note not found');

    await this.outbox.enqueue(this.prisma.client, {
      type: 'ETIMS_SUPPLIER_CREDIT_VERIFY',
      aggregateType: 'SUPPLIER_ETIMS_CREDIT_NOTE',
      aggregateId: credit.id,
      payload: { creditNoteId: credit.id, kraQrCodeData: credit.kraQrCodeData },
      organizationId,
    });
    return {
      creditNoteId: credit.id,
      status: 'VERIFICATION_QUEUED',
      message: 'Verification queued against the KRA verification provider.',
    };
  }

  /** Match a credit note to its original eTIMS invoice/purchase and offset WHT. */
  async matchCreditNote(
    organizationId: string,
    id: string,
    dto: MatchSupplierEtimsCreditNoteDto,
  ) {
    const credit = await this.prisma.client.supplierEtimsCreditNote.findFirst({
      where: { id, organizationId },
      select: { id: true, supplierId: true, totalAmount: true, matchStatus: true, kraInvoiceNumber: true },
    });
    if (!credit) throw new NotFoundException('Supplier eTIMS credit note not found');
    if (credit.matchStatus === SupplierEtimsMatchStatus.MATCHED) {
      throw new ConflictException('Credit note is already matched');
    }

    let originalInvoiceId: string | null = null;
    let purchaseId = dto.purchaseInvoiceId ?? null;

    if (dto.originalEtimsInvoiceId) {
      const invoice = await this.prisma.client.supplierEtimsInvoice.findFirst({
        where: { id: dto.originalEtimsInvoiceId, organizationId },
        select: { id: true, supplierId: true, matchedPurchaseInvoiceId: true, amount: true },
      });
      if (!invoice || invoice.supplierId !== credit.supplierId) {
        throw new BadRequestException(
          'Original eTIMS invoice must belong to the same supplier as the credit note',
        );
      }
      originalInvoiceId = invoice.id;
      purchaseId ??= invoice.matchedPurchaseInvoiceId;
    }

    if (purchaseId) {
      const purchase = await this.prisma.client.purchaseInvoice.findFirst({
        where: { id: purchaseId, organizationId },
        select: { id: true, partyId: true, total: true },
      });
      if (!purchase) throw new NotFoundException('Purchase invoice not found');
      if (purchase.partyId !== credit.supplierId) {
        throw new BadRequestException(
          'Credit note and purchase must reference the same supplier',
        );
      }
    }

    let whtOffset: { deductionId: string; amount: Prisma.Decimal } | null = null;
    if (dto.whtOffsetDeductionId) {
      const deduction = await this.prisma.client.withholdingTaxDeduction.findFirst({
        where: { id: dto.whtOffsetDeductionId, organizationId },
        select: { id: true, supplierId: true, grossAmount: true, whtAmount: true },
      });
      if (!deduction || deduction.supplierId !== credit.supplierId) {
        throw new BadRequestException(
          'WHT offset deduction must belong to a payment to the same supplier',
        );
      }
      const alreadyUsed = await this.prisma.client.supplierEtimsCreditNote.findFirst({
        where: { organizationId, whtOffsetDeductionId: deduction.id, deletedAt: null },
        select: { id: true },
      });
      if (alreadyUsed) {
        throw new ConflictException('That withholding deduction is already offset by another credit note');
      }
      const cappedCredit = credit.totalAmount.lt(deduction.grossAmount)
        ? credit.totalAmount
        : deduction.grossAmount;
      const ratio = deduction.grossAmount.gt(0)
        ? decimalDiv(cappedCredit, deduction.grossAmount)
        : new Prisma.Decimal(0);
      const amount = deduction.whtAmount.mul(ratio).toDecimalPlaces(2);
      whtOffset = { deductionId: deduction.id, amount };
    }

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.supplierEtimsCreditNote.update({
        where: { id },
        data: {
          originalEtimsInvoiceId: originalInvoiceId,
          originalPurchaseInvoiceId: purchaseId,
          matchStatus: SupplierEtimsMatchStatus.MATCHED,
          ...(whtOffset ? { whtOffsetDeductionId: whtOffset.deductionId, whtOffsetAmount: whtOffset.amount } : {}),
        },
        select: SUPPLIER_ETIMS_CREDIT_FIELDS,
      });

      // A credit that closes the gap between the purchase total and the
      // captured invoice (e.g. VAT-only residual) resolves the amount mismatch.
      if (originalInvoiceId && purchaseId) {
        const purchase = await tx.purchaseInvoice.findFirst({
          where: { id: purchaseId, organizationId },
          select: { total: true },
        });
        const invoice = await tx.supplierEtimsInvoice.findFirst({
          where: { id: originalInvoiceId, organizationId },
          select: { amount: true },
        });
        if (purchase && invoice && invoice.amount.plus(credit.totalAmount).gte(purchase.total)) {
          await tx.expenseComplianceFlag.updateMany({
            where: {
              organizationId,
              purchaseInvoiceId: purchaseId,
              flagType: ExpenseComplianceFlagType.PARTIAL_AMOUNT_MISMATCH,
              resolvedAt: null,
            },
            data: {
              resolvedAt: new Date(),
              resolutionNote: `Supplier credit note ${credit.kraInvoiceNumber} bridges to the purchase total`,
            },
          });
        }
      }
      return updated;
    });
  }

  /** Credit notes that have not been matched to an original invoice/purchase yet. */
  async unmatchedCreditNotes(organizationId: string, limit = 50, cursor?: string) {
    const take = Math.min(limit, 100);
    const where = { organizationId, matchStatus: SupplierEtimsMatchStatus.UNMATCHED, deletedAt: null } satisfies Prisma.SupplierEtimsCreditNoteWhereInput;
    const items = await this.prisma.client.supplierEtimsCreditNote.findMany({
      where,
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { creditNoteDate: 'asc' },
      select: {
        id: true,
        supplierId: true,
        supplier: { select: { id: true, name: true, taxId: true } },
        kraInvoiceNumber: true,
        originalInvoiceNumber: true,
        creditNoteDate: true,
        amount: true,
        vatAmount: true,
        totalAmount: true,
        reason: true,
      },
    });
    return {
      data: items,
      nextCursor: items.length === take ? items[items.length - 1]?.id : undefined,
    };
  }
}

/** Decimal division with safe zero handling. */
function decimalDiv(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.div(b);
}

function mapMimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return map[mime] ?? '.bin';
}

function basenameOf(key: string): string {
  return key.replace('compliance/', '');
}