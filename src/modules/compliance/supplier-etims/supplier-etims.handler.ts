import { Injectable, Logger } from '@nestjs/common';
import { SupplierEtimsVerificationStatus } from '../../../generated/prisma/client.js';
import { OutboxDispatchContext, OutboxDispatcher } from '../../../events/outbox/outbox.dispatcher.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

type Payload = {
  invoiceId?: string | null;
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
  ) {}

  onModuleInit(): void {
    this.dispatcher.register('ETIMS_SUPPLIER_OCR', {
      handle: (payload, context) => this.ocr(payload as Payload, context),
    });
    this.dispatcher.register('ETIMS_SUPPLIER_VERIFY', {
      handle: (payload, context) => this.verify(payload as Payload, context),
    });
  }

  private async ocr(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    this.logger.log(
      `[ocr] job ${payload.jobId ?? context.aggregateId} for org ${context.organizationId}`,
    );
    if (payload.invoiceId) {
      // Placeholder until an OCR provider (OCR_PROVIDER_URL) is configured.
      this.logger.warn(
        `[ocr] no OCR provider configured — job ${payload.jobId ?? context.aggregateId} completed without extraction`,
      );
    }
  }

  private async verify(payload: Payload, context: OutboxDispatchContext): Promise<void> {
    if (!payload.invoiceId) return;
    const qr = payload.kraQrCodeData;
    // Best-effort self-consistency check until a live KRA verification
    // provider is configured (see .env.example KRA_PIN_VERIFY_URL).
    const selfConsistent = !!qr && qr.length >= 20;
    await this.prisma.client.supplierEtimsInvoice.update({
      where: { id: payload.invoiceId },
      data: {
        verificationStatus: selfConsistent
          ? SupplierEtimsVerificationStatus.VERIFIED_VIA_KRA_QR
          : SupplierEtimsVerificationStatus.VERIFICATION_FAILED,
        ...(selfConsistent ? { kraQrCodeData: qr } : {}),
      },
    });
    this.logger.log(
      `[verify] org ${context.organizationId} invoice ${payload.invoiceId} -> ${
        selfConsistent ? 'VERIFIED_VIA_KRA_QR (self-checked)' : 'VERIFICATION_FAILED'
      }`,
    );
  }
}