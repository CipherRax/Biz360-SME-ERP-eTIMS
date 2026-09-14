import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';

const KEY_PREFIX = 'erp_';

export interface ApiKeyCredentials {
  id: string;
  organizationId: string;
  scopes: string[];
}

export interface CreatedApiKey {
  id: string;
  name: string;
  scopes: string[];
  key: string;
  createdAt: Date;
  expiresAt: Date | null;
}

const MASKED_FIELDS = {
  id: true,
  name: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private static hash(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async create(
    organizationId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    const rawKey = ApiKeysService.generate(KEY_PREFIX);
    const keyHash = ApiKeysService.hash(rawKey);
    const existing = await this.prisma.client.apiKey.findUnique({
      where: { keyHash },
    });
    if (existing) {
      throw new ConflictException('Key collision, please retry');
    }

    const row = await this.prisma.client.apiKey.create({
      data: {
        organizationId,
        name: dto.name,
        keyHash,
        scopes: dto.scopes ?? [],
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
          : null,
      },
    });

    return {
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      key: rawKey,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  list(organizationId: string) {
    return this.prisma.client.apiKey.findMany({
      where: { organizationId },
      select: MASKED_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, keyId: string): Promise<void> {
    const target = await this.prisma.client.apiKey.findFirst({
      where: { id: keyId, organizationId, revokedAt: null },
      select: { id: true, expiresAt: true },
    });
    if (!target) throw new NotFoundException('API key not found');
    await this.prisma.client.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /** Authenticates a presented key; returning null means the key is invalid. */
  async validate(rawKey: string): Promise<ApiKeyCredentials | null> {
    const keyHash = ApiKeysService.hash(rawKey);
    const row = await this.prisma.client.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
      select: { id: true, organizationId: true, scopes: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    void this.prisma.client.apiKey
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
    return {
      id: row.id,
      organizationId: row.organizationId,
      scopes: row.scopes,
    };
  }

  private static generate(prefix: string): string {
    return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
  }
}