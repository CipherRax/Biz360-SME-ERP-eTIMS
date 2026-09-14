import { Injectable } from '@nestjs/common';
import {
  OutboxEventStatus,
  OutboxEventType,
  Prisma,
} from '../../generated/prisma/client.js';

type TransactionClient = Prisma.TransactionClient;

export interface EnqueueInput {
  type: OutboxEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  organizationId: string;
  maxAttempts?: number;
}

/**
 * Writes an outbox row for a pending external side-effect. Always call this
 * inside the same DB transaction as the state change it describes — never
 * perform the side-effect inline.
 */
@Injectable()
export class OutboxService {
  async enqueue(
    client: TransactionClient,
    input: EnqueueInput,
  ): Promise<void> {
    await client.outboxEvent.create({
      data: {
        eventType: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        organizationId: input.organizationId,
        status: OutboxEventStatus.PENDING,
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
  }
}