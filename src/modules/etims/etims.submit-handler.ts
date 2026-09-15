import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  OutboxDispatchContext,
  OutboxDispatcher,
} from '../../events/outbox/outbox.dispatcher.js';
import { EtimsClient } from './etims.client.js';
import { EtimsService } from './etims.service.js';

interface SubmitPayload {
  invoiceId: string;
  invoiceNumber: string;
}

/**
 * Registers handlers for eTIMS invoice / credit-note submission. Runs inside
 * the outbox worker (outside the request scope, cross-tenant by design).
 *
 * Failure throws so the worker re-schedules the event with backoff and final
 * FAILED state after max attempts — the document simply remains unsent and is
 * surfaced by the compliance status endpoint.
 */
@Injectable()
export class EtimsHandlerRegistrar {
  private readonly logger = new Logger(EtimsHandlerRegistrar.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly client: EtimsClient,
    private readonly etims: EtimsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register('ETIMS_INVOICE_SUBMIT', {
      handle: (payload, context) => this.submit(payload, context, '0'),
    });
    this.dispatcher.register('ETIMS_CREDIT_NOTE_SUBMIT', {
      handle: (payload, context) => this.submit(payload, context, '2'),
    });
  }

  private async submit(
    payload: Prisma.JsonValue,
    context: OutboxDispatchContext,
    type: '0' | '2',
  ): Promise<void> {
    const p = payload as unknown as SubmitPayload;
    if (!p?.invoiceId) throw new Error('eTIMS submit payload missing invoiceId');

    const invoice = await this.prisma.client.saleInvoice.findFirst({
      where: { id: p.invoiceId, organizationId: context.organizationId },
      include: {
        party: { select: { name: true, taxId: true, addressLine1: true, city: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            itemId: true,
            description: true,
            quantity: true,
            unitPrice: true,
            taxRate: true,
            lineAmount: true,
            lineTotal: true,
            taxAmount: true,
            lineDiscount: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new Error(`eTIMS invoice ${p.invoiceId} not found for org ${context.organizationId}`);
    }

    const org = await this.prisma.client.organization.findFirst({
      where: { id: context.organizationId },
      select: { taxPin: true, name: true },
    });
    if (!org) throw new Error('Organization not found for eTIMS submission');

    // Fail before any network I/O when live mode is under-configured or the
    // taxpayer PIN is missing — the outbox marks it FAILED with this message.
    const configErrors = this.client.liveConfigErrors();
    const isMock = this.config.get<string>('etims.mode') === 'mock';
    if (!isMock && !org.taxPin) configErrors.push('organization.taxPin');
    if (configErrors.length > 0) {
      throw new Error(`eTIMS submission blocked: missing ${configErrors.join(', ')}`);
    }

    // A KRA credit note must reference the original invoice's control number.
    if (type === '2' && !invoice.etimsCtrlNo) {
      throw new Error(
        `Cannot submit credit note for ${invoice.invoiceNumber}: original control number missing (invoice never submitted)`,
      );
    }

    const deviceSerial = this.config.get<string>('etims.deviceSerial') ?? '';
    const payloadBody =
      type === '2'
        ? this.etims.buildCreditPayload(org, deviceSerial, invoice as never)
        : this.etims.buildSalePayload(org, deviceSerial, invoice as never);

    const receipt = await this.client.submitInvoice(payloadBody);

    await this.prisma.client.$transaction(async (tx) => {
      await this.etims.recordReceipt(tx, context.organizationId, invoice.id, receipt, type);
    });

    this.logger.log(
      `${type === '2' ? 'credit note' : 'invoice'} ${invoice.invoiceNumber} -> ${receipt.ctrlNo}`,
    );
  }
}