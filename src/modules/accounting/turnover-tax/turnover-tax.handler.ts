import { Inject, Injectable, Logger } from '@nestjs/common';
import { TotFilingPeriodStatus } from '../../../generated/prisma/client.js';
import { OutboxDispatchContext, OutboxDispatcher } from '../../../events/outbox/outbox.dispatcher.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { MobileMoneyProvider } from '../../payments/mobile-money/mobile-money.provider.js';

type TotPayload = {
  periodId?: string;
  amount?: number;
  phoneNumber?: string | null;
  accountReference?: string;
};

/**
 * Executes the queued mobile-money STK push for a ToT filing period and, on
 * success, marks the period PAID with the provider confirmation code.
 */
@Injectable()
export class TotPaymentHandlerRegistrar {
  private readonly logger = new Logger(TotPaymentHandlerRegistrar.name);

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly prisma: PrismaService,
    @Inject('MobileMoneyProvider')
    private readonly mobileMoney: MobileMoneyProvider,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register('TOT_PAYMENT_STK_PUSH', {
      handle: (payload, context) => this.handle(payload as TotPayload, context),
    });
  }

  private async handle(
    payload: TotPayload,
    context: OutboxDispatchContext,
  ): Promise<void> {
    if (!payload.periodId) return;
    this.logger.log(
      `[tot-pay] period ${payload.periodId} amount ${payload.amount} for org ${context.organizationId}`,
    );

    const period = await this.prisma.client.totFilingPeriod.findFirst({
      where: {
        id: payload.periodId,
        organizationId: context.organizationId,
        paymentStatus: { not: TotFilingPeriodStatus.PAID },
      },
    });
    if (!period) {
      this.logger.warn(`[tot-pay] period ${payload.periodId} not payable`);
      return;
    }

    const push = await this.mobileMoney.initiatePayment({
      organizationId: context.organizationId,
      provider: 'MPESA',
      amount: payload.amount ?? Number(period.totDue),
      phoneNumber: payload.phoneNumber ?? undefined,
      accountReference: payload.accountReference ?? `TOT-${period.periodStart.toISOString().slice(0, 7)}`,
      transactionDesc: 'Turnover Tax (ToT) payment',
    });

    if (push.status === 'SUCCESS') {
      await this.prisma.client.totFilingPeriod.update({
        where: { id: period.id },
        data: {
          paymentStatus: TotFilingPeriodStatus.PAID,
          paidAt: new Date(),
          paymentReference: push.providerTransactionId,
        },
      });
      this.logger.log(
        `[tot-pay] period ${payload.periodId} paid via ${push.providerTransactionId} (mock provider)`,
      );
    } else {
      this.logger.error(
        `[tot-pay] period ${payload.periodId} STK push failed: ${push.detail}`,
      );
      throw new Error(push.detail ?? 'Mobile money payment failed');
    }
  }
}