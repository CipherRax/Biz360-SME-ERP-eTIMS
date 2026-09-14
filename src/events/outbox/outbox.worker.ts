import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';

type EventRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
};

/**
 * Polls `OutboxEvent` rows and dispatches them to registered handlers with
 * at-least-once semantics:
 *
 *  - rows are claimed atomically (PENDING → PROCESSING) so concurrent workers
 *    (multiple API instances) never process the same row twice;
 *  - on success the row is finalized (DONE + processedAt);
 *  - on failure attempts are incremented and the row is re-scheduled with
 *    exponential backoff, then marked FAILED at max attempts.
 *
 * The worker runs outside the request scope — it is deliberately cross-tenant.
 */
@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private stopped = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.getOrThrow<boolean>('outbox.enabled')) {
      this.logger.warn('Outbox worker disabled via OUTBOX_WORKER_ENABLED=false');
      return;
    }
    this.stopped = false;
    const interval = this.config.getOrThrow<number>('outbox.pollIntervalMs');
    // Fire once immediately, then poll on the configured interval.
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
    this.logger.log(`Outbox worker started (poll ${interval}ms)`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    if (this.stopped) return 0;
    try {
      const rows = await this.claimDueEvents();
      for (const row of rows) {
        await this.processRow(row);
      }
      return rows.length;
    } catch (error) {
      this.logger.error(`Outbox poll failed: ${(error as Error).message}`);
      return 0;
    }
  }

  private async claimDueEvents(): Promise<EventRow[]> {
    const due = (await this.prisma.client.outboxEvent.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      take: this.config.getOrThrow<number>('outbox.batchSize'),
      orderBy: { nextAttemptAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        organizationId: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    })) as unknown as EventRow[];

    if (due.length === 0) return [];

    // Atomic claim — only the worker that flips rows to PROCESSING proceeds.
    const claimed = await this.prisma.client.outboxEvent.updateMany({
      where: { id: { in: due.map((row) => row.id) }, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) return [];
    return due;
  }

  private async processRow(row: EventRow): Promise<void> {
    try {
      await this.dispatcher.dispatch(
        row.eventType as never,
        row.payload,
        {
          eventId: row.id,
          organizationId: row.organizationId,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
        },
      );
      await this.prisma.client.outboxEvent.update({
        where: { id: row.id },
        data: { status: 'DONE', processedAt: new Date(), lastError: null },
      });
      this.logger.debug(`Dispatched ${row.eventType} (${row.id})`);
    } catch (error) {
      const attempts = row.attempts + 1;
      const failed = attempts >= row.maxAttempts;
      await this.prisma.client.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts,
          status: failed ? 'FAILED' : 'PENDING',
          lastError: (error as Error).message,
          ...(failed ? {} : { nextAttemptAt: this.backoff(attempts) }),
        },
      });
      this.logger.warn(
        `${row.eventType} (${row.id}) ${failed ? 'failed permanently' : 'retry scheduled'} — ${(error as Error).message}`,
      );
    }
  }

  private backoff(attempt: number): Date {
    const base = this.config.getOrThrow<number>('outbox.pollIntervalMs');
    const waitMs = Math.min(base * 2 ** (attempt - 1), 5 * 60 * 1000);
    return new Date(Date.now() + waitMs);
  }
}