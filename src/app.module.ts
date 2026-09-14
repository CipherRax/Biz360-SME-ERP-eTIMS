import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { getScope } from './common/context/request-context.js';
import { envValidationSchema } from './config/env.validation.js';
import {
  appConfig,
  authConfig,
  redisConfig,
  throttlerConfig,
  outboxConfig,
} from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CommonModule } from './common/common.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { HealthModule } from './health/health.module.js';
import { EventsModule } from './events/events.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      validationSchema: envValidationSchema,
      load: [appConfig, authConfig, redisConfig, throttlerConfig, outboxConfig],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        genReqId: (req) =>
          (req as { id?: string }).id ??
          (req as { headers?: Record<string, unknown> }).headers?.['x-correlation-id'] ??
          'req-unknown',
        customProps: () => ({
          correlationId: getScope()?.correlationId,
        }),
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[redacted]',
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
      },
    ]),
    PrismaModule,
    EventsModule,
    AuthModule,
    UsersModule,
    ApiKeysModule,
    HealthModule,
    CommonModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}