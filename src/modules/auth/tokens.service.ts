import {
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AccessTokenClaims } from './strategies/jwt.strategy.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  expiresIn: number;
}

export interface DevicesShape {
  id: string;
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

const REFRESH_TOKEN_LENGTH = 48;

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>('auth.accessSecret');
  }

  signAccessToken(claims: AccessTokenClaims): string {
    const expiresIn = this.config.getOrThrow<string>('auth.accessTtl') as unknown as
      | JwtSignOptions['expiresIn']
      | undefined;
    return this.jwt.sign(
      {
        email: claims.email,
        role: claims.role,
        orgId: claims.orgId,
        tokenVersion: claims.tokenVersion,
      },
      {
        secret: this.accessSecret,
        expiresIn,
        subject: claims.sub,
        issuer: 'biz360-erp',
        audience: 'biz360-erp-api',
      },
    );
  }

  accessClientVersion(): string {
    return crypto.createHash('sha256').digest('hex').slice(0, 8);
  }

  refreshTtlSeconds(): number {
    return this.parseTtlToSeconds(
      this.config.getOrThrow<string>('auth.refreshTtl'),
    );
  }

  /** Random opaque refresh token; only its hash is stored at rest. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(REFRESH_TOKEN_LENGTH).toString('base64url');
    return { token, hash: this.hashToken(token) };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issues a refresh token bound to a session family. Rotating refresh
   * exchanges (`refresh()`) reuse the same family while revoking the old row.
   */
  async issueRefreshToken(
    userId: string,
    organizationId: string,
    device: { userAgent?: string; ipAddress?: string },
    familyId?: string,
  ): Promise<{ token: string; rowId: string; familyId: string }> {
    const { token, hash } = this.generateRefreshToken();
    const ttl = this.config.getOrThrow<string>('auth.refreshTtl');
    const expiresInSeconds = this.parseTtlToSeconds(ttl);
    const row = await this.prisma.client.refreshToken.create({
      data: {
        userId,
        organizationId,
        tokenHash: hash,
        familyId: familyId ?? crypto.randomUUID(),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        userAgent: device.userAgent,
        ipAddress: device.ipAddress,
      },
    });
    return { token, rowId: row.id, familyId: row.familyId };
  }

  /**
   * ROTATE: exchanges a valid refresh token for a fresh pair.
   * Reuse or expiry of an already-rotated token revokes the whole family.
   */
  async rotate(
    rawToken: string,
    device: { userAgent?: string; ipAddress?: string },
  ): Promise<TokenPair & { user: AuthenticatedUser }> {
    const hash = this.hashToken(rawToken);
    const existing = await this.prisma.client.refreshToken.findFirst({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!existing || existing.user.deletedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // Token was rotated once already — possible theft. Kill the family.
      await this.prisma.client.refreshToken.updateMany({
        where: { familyId: existing.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (existing.expiresAt < new Date()) {
      await this.prisma.client.refreshToken.updateMany({
        where: { familyId: existing.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    const next = await this.issueRefreshToken(
      existing.userId,
      existing.organizationId,
      device,
      existing.familyId,
    );

    await this.prisma.client.refreshToken.update({
      where: { id: existing.id },
      data: { replacedById: next.rowId, revokedAt: new Date() },
    });

    const user = existing.user;
    const accessToken = this.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.organizationId,
      tokenVersion: this.accessClientVersion(),
    });
    return {
      accessToken,
      refreshToken: next.token,
      refreshTokenId: next.rowId,
      expiresIn: this.refreshTtlSeconds(),
      user: {
        sub: user.id,
        email: user.email,
        role: user.role,
        orgId: user.organizationId,
      },
    };
  }

  async revoke(rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    await this.prisma.client.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSession(rowId: string, organizationId: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { id: rowId, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listActiveSessions(
    userId: string,
    organizationId: string,
  ): Promise<DevicesShape[]> {
    const rows = await this.prisma.client.refreshToken.findMany({
      where: { userId, organizationId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        familyId: true,
        createdAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  private parseTtlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 30 * 24 * 60 * 60;
    const value = Number(match[1]);
    const unit = match[2];
    const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
    return value * seconds;
  }

  revokeAllForUser(userId: string, organizationId: string): Promise<number> {
    return this.prisma.client.refreshToken
      .updateMany({
        where: { userId, organizationId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then((result) => result.count);
  }
}