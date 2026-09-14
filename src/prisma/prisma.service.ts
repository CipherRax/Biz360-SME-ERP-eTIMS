import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { createExtendedPrismaClient } from './prisma-extensions.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(databaseUrl: string) {
    this.client = createExtendedPrismaClient(databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('PostgreSQL connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}