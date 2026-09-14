import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    {
      provide: RedisHealthIndicator,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new RedisHealthIndicator(config.getOrThrow<string>('redis.url')),
    },
  ],
})
export class HealthModule {}