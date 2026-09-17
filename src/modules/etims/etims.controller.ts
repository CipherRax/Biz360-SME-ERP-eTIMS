import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OutboxService } from '../../events/outbox/outbox.service.js';
import { EtimsClient } from './etims.client.js';

@ApiTags('etims')
@ApiBearerAuth()
@Controller('etims')
export class EtimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly etimsClient: EtimsClient,
  ) {}

  /** Compliance status: operating mode + how many taxable docs are unsent. */
  @Get('status')
  async status(@CurrentUser() user?: AuthenticatedUser) {
    if (!user) throw new BadRequestException('Not authenticated');
    const [org, unsubmitted] = await Promise.all([
      this.prisma.client.organization.findFirst({
        where: { id: user.orgId },
        select: { taxPin: true },
      }),
      this.prisma.client.saleInvoice.count({
        where: {
          organizationId: user.orgId,
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          etimsSubmittedAt: null,
        },
      }),
    ]);

    const mode = this.config.get<string>('etims.mode');
    const taxpayerPinConfigured = Boolean(
      this.config.get<string>('etims.taxpayerPin') || org?.taxPin,
    );
    const configErrors = this.etimsClient.liveConfigErrors();
    if (!org?.taxPin) configErrors.push('organization.taxPin');
    return {
      mode,
      taxpayerPinConfigured,
      deviceSerialConfigured: Boolean(this.config.get<string>('etims.deviceSerial')),
      orgTaxPinPresent: Boolean(org?.taxPin),
      liveReady:
        mode === 'live' && configErrors.length === 0,
      unsubmittedInvoices: unsubmitted,
    };
  }

  /** (Re-)queue a sale invoice for submission to KRA. Idempotent. */
  @Post('sales/:id/trigger')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('SaleInvoice')
  async triggerSubmit(
    @CurrentUser() user?: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id?: string,
  ) {
    if (!user || !id) throw new BadRequestException('Not authenticated');
    try {
      const invoice = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.saleInvoice.findFirst({
          where: { id, organizationId: user.orgId },
          select: { id: true, invoiceNumber: true, status: true, etimsSubmittedAt: true },
        });
        if (!row) throw new BadRequestException('Invoice not found');
        if (row.status === 'VOID') {
          throw new BadRequestException('A voided invoice must be handled as a credit note');
        }
        if (row.etimsSubmittedAt === null) {
          await this.outbox.enqueue(tx, {
            type: 'ETIMS_INVOICE_SUBMIT',
            aggregateType: 'SaleInvoice',
            aggregateId: row.id,
            organizationId: user.orgId,
            payload: { invoiceId: row.id, invoiceNumber: row.invoiceNumber },
          });
        }
        return row;
      });

      const alreadySubmitted = invoice.etimsSubmittedAt !== null;
      return {
        enqueued: !alreadySubmitted,
        invoiceNumber: invoice.invoiceNumber,
        alreadySubmitted,
      };
    } catch (error) {
      // A concurrent trigger already enqueued an in-flight submission for this
      // invoice (outbox_events_inflight_aggregate_unique). Treat it as queued
      // rather than failing the request or double-submitting to KRA.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { enqueued: false, invoiceNumber: undefined, alreadySubmitted: false, alreadyQueued: true };
      }
      throw error;
    }
  }
}