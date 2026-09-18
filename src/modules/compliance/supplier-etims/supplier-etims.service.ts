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
  CreateSupplierEtimsInvoiceDto,
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
    const open = await this.prisma.client.purchaseInvoice.findMany({
      where: {
        organizationId,
        expenseComplianceFlags: {
          some: { flagType: ExpenseComplianceFlagType.NO_ETIMS_MATCH, resolvedAt: null },
        },
      },
      orderBy: { invoiceDate: 'asc' },
      select: { total: true, invoiceDate: true },
    });

    const total = open.reduce((acc, row) => acc.add(row.total), new Prisma.Decimal(0));
    const oldest = open[0] ?? null;
    return {
      unmatchedCount: open.length,
      totalExposure: total.toFixed(2),
      oldestUnmatchedAt: oldest?.invoiceDate ?? null,
      agesInDays: oldest ? Math.floor((Date.now() - oldest.invoiceDate.getTime()) / 86_400_000) : 0,
    };
  }
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