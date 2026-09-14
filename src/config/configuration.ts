import { registerAs } from '@nestjs/config';

/** Typed view over validated process.env, produced by the ConfigModule. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
}

export const appConfig = registerAs('app', (): AppConfig => {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
});

export const authConfig = registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  emailVerificationRequired:
    (process.env.EMAIL_VERIFICATION_REQUIRED ?? 'true') === 'true',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}));

export const throttlerConfig = registerAs('throttler', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
}));

export const outboxConfig = registerAs('outbox', () => ({
  enabled: (process.env.OUTBOX_WORKER_ENABLED ?? 'true') === 'true',
  pollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? '5000', 10),
  batchSize: parseInt(process.env.OUTBOX_BATCH_SIZE ?? '10', 10),
}));