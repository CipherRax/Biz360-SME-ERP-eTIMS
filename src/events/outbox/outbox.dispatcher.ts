import { Injectable, Logger } from '@nestjs/common';
import { OutboxEventType, Prisma } from '../../generated/prisma/client.js';

/** Context passed to a handler alongside the event payload. */
export interface OutboxDispatchContext {
  eventId: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
}

/** Handles a single outbox event of a registered type. */
export interface OutboxHandler {
  handle(payload: Prisma.JsonValue, context: OutboxDispatchContext): Promise<void>;
}

/**
 * Routes outbox events to handlers by type. External side-effects (email,
 * eTIMS submission, webhooks) are always registered here so they can run
 * outside the request that enqueued them.
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly handlers = new Map<OutboxEventType, OutboxHandler>();

  register(type: OutboxEventType, handler: OutboxHandler): void {
    this.handlers.set(type, handler);
  }

  hasHandler(type: OutboxEventType): boolean {
    return this.handlers.has(type);
  }

  /** Missing handlers fail loudly so the gap is noticed. */
  async dispatch(
    type: OutboxEventType,
    payload: Prisma.JsonValue,
    context: OutboxDispatchContext,
  ): Promise<void> {
    const handler = this.handlers.get(type);
    if (!handler) {
      this.logger.warn(`No handler registered for outbox event type: ${type}`);
      throw new Error(`No handler registered for outbox event type: ${type}`);
    }
    await handler.handle(payload, context);
  }
}