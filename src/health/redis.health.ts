import { HealthIndicatorResult } from '@nestjs/terminus';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Probes the shared Redis instance. Kept independent of BullMQ (`ioredis`
 * directly) so health checks never depend on queue wiring.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
  }

  /** Wait until the client is ready before issuing commands (first ping on a fresh boot races connection setup). */
  private async ensureReady(): Promise<void> {
    if (this.client.status === 'ready') return;
    if (this.client.status === 'end' || this.client.status === 'close' || this.client.status === 'wait') {
      await this.client.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        this.client.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        this.client.off('ready', onReady);
        reject(error);
      };
      this.client.once('ready', onReady);
      this.client.once('error', onError);
    });
  }

  async ping(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.ensureReady();
      const pong = await this.client.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected reply: ${pong}`);
      }
      return {
        [key]: { status: 'up' },
      } as HealthIndicatorResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException({
        status: 503,
        error: 'Redis health check failed',
        details: { [key]: { status: 'down', message } },
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.disconnect();
  }
}