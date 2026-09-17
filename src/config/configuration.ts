import { registerAs } from '@nestjs/config';

/** Typed view over validated process.env, produced by the ConfigModule. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  idempotencyTtlHours: number;
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
    idempotencyTtlHours: parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? '24', 10),
  };
});

export const authConfig = registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  emailVerificationRequired:
    (process.env.EMAIL_VERIFICATION_REQUIRED ?? 'true') === 'true',
  loginLockoutThreshold: parseInt(
    process.env.AUTH_LOGIN_LOCKOUT_THRESHOLD ?? '10',
    10,
  ),
  loginLockoutMs: parseInt(
    process.env.AUTH_LOGIN_LOCKOUT_MS ?? (15 * 60 * 1000).toString(),
    10,
  ),
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
  staleProcessingMs: parseInt(process.env.OUTBOX_STALE_PROCESSING_MS ?? '60000', 10),
}));

export const etimsConfig = registerAs('etims', () => ({
  /** 'mock' synthesizes KRA responses without network I/O (default & dev/test). */
  mode: process.env.ETIMS_MODE ?? 'mock',
  baseUrl: process.env.ETIMS_BASE_URL ?? 'https://preprod-tims.kra.go.ke',
  clientId: process.env.ETIMS_CLIENT_ID ?? '',
  clientSecret: process.env.ETIMS_CLIENT_SECRET ?? '',
  taxpayerPin: process.env.ETIMS_TAXPAYER_PIN ?? '',
  deviceSerial: process.env.ETIMS_DEVICE_SERIAL ?? '',
  timeoutMs: parseInt(process.env.ETIMS_TIMEOUT_MS ?? '10000', 10),
}));