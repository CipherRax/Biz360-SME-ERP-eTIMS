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
      await this.reapStaleProcessing();
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

  /**
   * Reclaims rows stuck in PROCESSING. A row can be left in PROCESSING if the
   * worker that claimed it is killed or crashes mid-dispatch; without a reaper
   * such rows would never be retried. Rows whose `updatedAt` (set when they
   * were claimed) is older than the stale threshold and whose attempts remain
   * below maxAttempts are reset to PENDING so the next poll reclaims them;
   * exhausted rows are moved to FAILED.
   */
  private async reapStaleProcessing(): Promise<void> {
    const staleBefore = new Date(
      Date.now() - this.config.getOrThrow<number>('outbox.staleProcessingMs'),
    );
    const stale = (await this.prisma.client.outboxEvent.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      select: { id: true, attempts: true, maxAttempts: true },
      take: this.config.getOrThrow<number>('outbox.batchSize'),
    })) as unknown as { id: string; attempts: number; maxAttempts: number }[];

    if (stale.length === 0) return;

    const failed = stale.filter((row) => row.attempts >= row.maxAttempts);
    const reclaim = stale.filter((row) => row.attempts < row.maxAttempts);

    if (reclaim.length > 0) {
      await this.prisma.client.outboxEvent.updateMany({
        where: { id: { in: reclaim.map((row) => row.id) }, status: 'PROCESSING' },
        data: { status: 'PENDING', nextAttemptAt: new Date() },
      });
    }
    if (failed.length > 0) {
      await this.prisma.client.outboxEvent.updateMany({
        where: { id: { in: failed.map((row) => row.id) }, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          lastError: 'Stale PROCESSING row reclaimed after exceeding maxAttempts',
        },
      });
    }
    this.logger.warn(
      `Stale reaper: reclaimed ${reclaim.length}, failed ${failed.length} PROCESSING row(s)`,
    );
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

    // Return only the rows THIS worker actually claimed. With concurrent
    // workers, an in-flight competitor may have claimed a subset of `due`
    // between our read and our updateMany; re-reading the now-PROCESSING rows
    // (scoped to our candidate set) keeps processing exactly-once-per-claim.
    const claimedRows = new Set(
      (
        await this.prisma.client.outboxEvent.findMany({
          where: { id: { in: due.map((row) => row.id) }, status: 'PROCESSING' },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    return due.filter((row) => claimedRows.has(row.id));
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