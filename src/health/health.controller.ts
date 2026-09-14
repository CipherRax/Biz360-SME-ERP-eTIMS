import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisHealthIndicator } from './redis.health.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma.client),
      () => this.redis.ping('redis'),
    ]);
  }

  @Public()
  @Get('db')
  @HealthCheck()
  db() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma.client),
    ]);
  }

  @Public()
  @Get('redis')
  @HealthCheck()
  redisCheck() {
    return this.health.check([() => this.redis.ping('redis')]);
  }
}