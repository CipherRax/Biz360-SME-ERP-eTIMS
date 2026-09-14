import { Injectable, Logger } from '@nestjs/common';
import {
  OutboxDispatchContext,
  OutboxDispatcher,
} from '../outbox/outbox.dispatcher.js';

/**
 * Placeholder "mailer". SMTP is not wired up in Phase 1, so outbox events for
 * email receive a structured log line instead — the pipeline itself is real
 * and the dispatch cryogenic call can be swapped for nodemailer/Resend later.
 */
@Injectable()
export class NotificationHandlerRegistrar {
  private readonly logger = new Logger(NotificationHandlerRegistrar.name);

  constructor(private readonly dispatcher: OutboxDispatcher) {}

  onModuleInit(): void {
    this.dispatcher.register('EMAIL_VERIFICATION', {
      handle: (payload, context) => this.mail('email-verification', payload, context),
    });
    this.dispatcher.register('PASSWORD_RESET', {
      handle: (payload, context) => this.mail('password-reset', payload, context),
    });
  }

  private async mail(
    kind: string,
    payload: unknown,
    context: OutboxDispatchContext,
  ): Promise<void> {
    this.logger.log(
      `[mail:${kind}] -> org ${context.organizationId} / ${context.aggregateId}: ${JSON.stringify(payload)}`,
    );
  }
}