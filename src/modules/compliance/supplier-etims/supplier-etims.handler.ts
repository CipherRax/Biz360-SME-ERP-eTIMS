import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  SupplierEtimsCaptureMethod,
  SupplierEtimsMatchStatus,
  SupplierEtimsUploadItemStatus,
  SupplierEtimsUploadStatus,
  SupplierEtimsVerificationStatus,
} from '../../../generated/prisma/client.js';
import { OutboxDispatchContext, OutboxDispatcher } from '../../../events/outbox/outbox.dispatcher.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

type Payload = {
  invoiceId?: string | null;
  creditNoteId?: string | null;
  uploadId?: string | null;
  jobId?: string | null;
  fileKey?: string | null;
  kraQrCodeData?: string | null;
};

/**
 * Handlers for supplier-eTIMS async jobs. Both are provider-abstracted:
 *
 * - OCR extraction runs only when an OCR provider is configured
 *   (OCR_PROVIDER_URL). Without one the job completes as DONE with no parsed
 *   fields rather than failing — manual entry remains the supported capture
 *   path.
 * - KRA QR verification is a provider-abstracted call too; without a pool
 *   it degrades to a self-consistency check of the captured QR payload.
 */
@Injectable()
export class SupplierEtimsHandlerRegistrar {
  private readonly logger = new Logger(SupplierEtimsHandlerRegistrar.name);

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly prisma: PrismaService,
    @Inject('OcrProvider') private readonly ocrProvider: { extractInvoiceData: (fileKey: string, qrData?: string | null) => Promise<{ success: boolean; fields?: Record<string, string | undefined>; error?: string }> },
    @Inject('KraVerificationProvider') private readonly kraVerificationProvider: { verifyInvoice: (qrData: string, opts?: { tin?: string; amount?: string }) => Promise<{ verified: boolean; reason?: string }> },
  ) {}

  onModuleInit(): void {
    this.dispatcher.register('ETIMS_SUPPLIER_OCR', {
      handle: (payload, context) => this.ocr(payload as Payload, context),
    });
    this.dispatcher.register('ETIMS_SUPPLIER_VERIFY', {
      handle: (payload, context) => this.verify(payload as Payload, context),
    });
    this.dispatcher.register('ETIMS_SUPPLIER_CREDIT_VERIFY', {
      handle: (payload, context) => this.verifyCredit(payload as Payload, context),
    });
    this.dispatcher.register('ETIMS_BULK_IMPORT', {
      handle: (payload, context) => this.bulkImport(payload as Payload, context),
    });
  }

  private async ocr(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    this.logger.log(
      `[ocr] job ${payload.jobId ?? context.aggregateId} for org ${context.organizationId}`,
    );
    if (!payload.invoiceId) return;

    const invoice = await this.prisma.client.supplierEtimsInvoice.findUnique({
      where: { id: payload.invoiceId },
      select: { id: true, kraQrCodeData: true, captureMethod: true },
    });
    if (!invoice) {
      this.logger.warn(`[ocr] invoice ${payload.invoiceId} not found`);
      return;
    }

    const result = await this.ocrProvider.extractInvoiceData(
      payload.fileKey ?? '',
      invoice.kraQrCodeData,
    );

    if (result.success && result.fields) {
      await this.prisma.client.supplierEtimsInvoice.update({
        where: { id: payload.invoiceId },
        data: {
          kraInvoiceNumber: result.fields.kraInvoiceNumber ?? undefined,
          invoiceDate: result.fields.invoiceDate ? new Date(result.fields.invoiceDate) : undefined,
          amount: result.fields.amount ? new Prisma.Decimal(result.fields.amount) : undefined,
          vatAmount: result.fields.vatAmount ? new Prisma.Decimal(result.fields.vatAmount) : undefined,
          kraQrCodeData: result.fields.kraQrCodeData ?? undefined,
        },
      });
      this.logger.log(
        `[ocr] org ${context.organizationId} invoice ${payload.invoiceId} extracted ${Object.keys(result.fields).length} fields`,
      );
    } else {
      this.logger.warn(
        `[ocr] org ${context.organizationId} invoice ${payload.invoiceId} extraction failed: ${result.error}`,
      );
    }
  }

  private async verify(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    if (!payload.invoiceId) return;

    const invoice = await this.prisma.client.supplierEtimsInvoice.findUnique({
      where: { id: payload.invoiceId },
      select: { kraQrCodeData: true, amount: true, supplier: { select: { taxId: true } } },
    });
    if (!invoice) return;

    const qr = payload.kraQrCodeData ?? invoice.kraQrCodeData;
    if (!qr) {
      await this.prisma.client.supplierEtimsInvoice.update({
        where: { id: payload.invoiceId },
        data: { verificationStatus: SupplierEtimsVerificationStatus.VERIFICATION_FAILED },
      });
      return;
    }

    const result = await this.kraVerificationProvider.verifyInvoice(qr, {
      tin: invoice.supplier?.taxId ?? undefined,
      amount: invoice.amount?.toString() ?? undefined,
    });

    await this.prisma.client.supplierEtimsInvoice.update({
      where: { id: payload.invoiceId },
      data: {
        verificationStatus: result.verified
          ? SupplierEtimsVerificationStatus.VERIFIED_VIA_KRA_QR
          : SupplierEtimsVerificationStatus.VERIFICATION_FAILED,
        kraQrCodeData: qr,
      },
    });
    this.logger.log(
      `[verify] org ${context.organizationId} invoice ${payload.invoiceId} -> ${
        result.verified ? 'VERIFIED_VIA_KRA_QR' : 'VERIFICATION_FAILED'
      } (${result.reason})`,
    );
  }

  private async verifyCredit(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    if (!payload.creditNoteId) return;

    const creditNote = await this.prisma.client.supplierEtimsCreditNote.findUnique({
      where: { id: payload.creditNoteId },
      select: { kraQrCodeData: true, totalAmount: true, supplier: { select: { taxId: true } } },
    });
    if (!creditNote) return;

    const qr = payload.kraQrCodeData ?? creditNote.kraQrCodeData;
    if (!qr) {
      await this.prisma.client.supplierEtimsCreditNote.update({
        where: { id: payload.creditNoteId },
        data: { verificationStatus: SupplierEtimsVerificationStatus.VERIFICATION_FAILED },
      });
      return;
    }

    const result = await this.kraVerificationProvider.verifyInvoice(qr, {
      tin: creditNote.supplier?.taxId ?? undefined,
      amount: creditNote.totalAmount?.toString() ?? undefined,
    });

    await this.prisma.client.supplierEtimsCreditNote.update({
      where: { id: payload.creditNoteId },
      data: {
        verificationStatus: result.verified
          ? SupplierEtimsVerificationStatus.VERIFIED_VIA_KRA_QR
          : SupplierEtimsVerificationStatus.VERIFICATION_FAILED,
        kraQrCodeData: qr,
      },
    });
    this.logger.log(
      `[verify-credit] org ${context.organizationId} credit note ${payload.creditNoteId} -> ${
        result.verified ? 'VERIFIED_VIA_KRA_QR' : 'VERIFICATION_FAILED'
      } (${result.reason})`,
    );
  }

  private async bulkImport(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    if (!payload.uploadId) return;
    this.logger.log(`[bulk-import] processing upload ${payload.uploadId}`);

    const upload = await this.prisma.client.supplierEtimsUpload.findFirst({
      where: { id: payload.uploadId, organizationId: context.organizationId },
      select: { id: true, status: true },
    });
    if (!upload || upload.status === SupplierEtimsUploadStatus.COMPLETED) return;

    await this.prisma.client.supplierEtimsUpload.update({
      where: { id: payload.uploadId },
      data: { status: SupplierEtimsUploadStatus.PROCESSING },
    });

    const items = await this.prisma.client.supplierEtimsUploadItem.findMany({
      where: { uploadId: payload.uploadId, status: SupplierEtimsUploadItemStatus.QUEUED },
      orderBy: { rowIndex: 'asc' },
      take: 500,
    });

    let processed = 0;
    let errored = 0;

    for (const item of items) {
      try {
        if (!item.kraInvoiceNumber) throw new Error('Missing KRA invoice number');
        if (!item.supplierTin) throw new Error('Missing supplier TIN');

        const dup = await this.prisma.client.supplierEtimsInvoice.findFirst({
          where: { organizationId: context.organizationId, kraInvoiceNumber: item.kraInvoiceNumber, deletedAt: null },
          select: { id: true },
        });
        if (dup) {
          await this.prisma.client.supplierEtimsUploadItem.update({
            where: { id: item.id },
            data: { status: SupplierEtimsUploadItemStatus.DUPLICATE, error: `Duplicate: invoice ${item.kraInvoiceNumber} already exists`, processedAt: new Date() },
          });
          processed++;
          continue;
        }

        const supplier = await this.prisma.client.party.findFirst({
          where: { organizationId: context.organizationId, taxId: item.supplierTin, type: { not: 'CUSTOMER' as any } },
          select: { id: true },
        });
        if (!supplier) throw new Error(`No supplier party with TIN ${item.supplierTin}`);

        const invoice = await this.prisma.client.supplierEtimsInvoice.create({
          data: {
            organizationId: context.organizationId,
            supplierId: supplier.id,
            kraInvoiceNumber: item.kraInvoiceNumber,
            invoiceDate: item.invoiceDate ?? new Date(),
            amount: item.amount ?? new Prisma.Decimal(0),
            vatAmount: item.vatAmount ?? new Prisma.Decimal(0),
            captureMethod: SupplierEtimsCaptureMethod.BULK_IMPORT,
            matchStatus: SupplierEtimsMatchStatus.UNMATCHED,
            verificationStatus: SupplierEtimsVerificationStatus.UNVERIFIED,
          },
          select: { id: true },
        });

        await this.prisma.client.supplierEtimsUploadItem.update({
          where: { id: item.id },
          data: { status: SupplierEtimsUploadItemStatus.PROCESSED, createdSupplierEtimsInvoiceId: invoice.id, processedAt: new Date() },
        });
        processed++;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(`[bulk-import] item ${item.rowIndex} failed: ${message}`);
        await this.prisma.client.supplierEtimsUploadItem.update({
          where: { id: item.id },
          data: { status: SupplierEtimsUploadItemStatus.ERROR, error: message, processedAt: new Date() },
        });
        errored++;
      }
    }

    await this.prisma.client.supplierEtimsUpload.update({
      where: { id: payload.uploadId },
      data: {
        processedItems: { increment: processed },
        status: SupplierEtimsUploadStatus.COMPLETED,
        errorSummary: errored > 0 ? `${errored} item(s) failed processing` : null,
      },
    });

    this.logger.log(`[bulk-import] upload ${payload.uploadId}: ${processed} processed, ${errored} errors`);
  }
}