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
import { Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OutboxService } from '../../events/outbox/outbox.service.js';

@ApiTags('etims')
@ApiBearerAuth()
@Controller('etims')
export class EtimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
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
    return {
      mode,
      taxpayerPinConfigured,
      liveReady:
        mode === 'live' &&
        Boolean(this.config.get<string>('etims.clientId')) &&
        Boolean(this.config.get<string>('etims.clientSecret')),
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
    const invoice = await this.prisma.client.saleInvoice.findFirst({
      where: { id, organizationId: user.orgId },
      select: { id: true, invoiceNumber: true, status: true, etimsSubmittedAt: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    if (invoice.status === 'VOID') {
      throw new BadRequestException('A voided invoice must be handled as a credit note');
    }

    const alreadySubmitted = invoice.etimsSubmittedAt !== null;
    if (!alreadySubmitted) {
      await this.outbox.enqueue(this.prisma.client, {
        type: 'ETIMS_INVOICE_SUBMIT',
        aggregateType: 'SaleInvoice',
        aggregateId: invoice.id,
        organizationId: user.orgId,
        payload: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      });
    }
    return {
      enqueued: !alreadySubmitted,
      invoiceNumber: invoice.invoiceNumber,
      alreadySubmitted,
    };
  }
}