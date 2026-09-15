import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Role, UserStatus, OutboxEventType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { TokensService, TokenPair, DevicesShape } from './tokens.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { DeviceContext } from './dto/device-context.js';
import { OutboxService } from '../../events/outbox/outbox.service.js';
import { slugify } from '../../common/helpers/slugify.js';
import { seedChartOfAccounts } from '../accounting/chart-of-accounts.js';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_TOKEN_LENGTH = 32;
const RESET_TOKEN_LENGTH = 32;

export interface RegisterResult {
  userId: string;
  organizationId: string;
  requiresEmailVerification: boolean;
  tokens?: TokenPair;
  /** Development-only convenience: raw verification token (never in prod). */
  devVerificationToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
  ) {}

  async register(
    dto: RegisterDto,
    device: DeviceContext,
  ): Promise<RegisterResult> {
    const email = dto.email.toLowerCase().trim();
    const verificationRequired = this.config.getOrThrow<boolean>(
      'auth.emailVerificationRequired',
    );

    const existing = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.password.hash(dto.password);
    const organizationName = dto.organizationName ?? 'My Organization';
    const slug = `${slugify(organizationName)}-${crypto.randomBytes(3).toString('hex')}`;

    let devVerificationToken: string | undefined;

    const result = await this.prisma.client.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: organizationName, slug },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email,
          name: dto.name,
          passwordHash,
          role: Role.ADMIN,
          status: verificationRequired
            ? UserStatus.PENDING
            : UserStatus.ACTIVE,
          emailVerifiedAt: verificationRequired ? null : new Date(),
          preferences: { language: 'en', timezone: 'Africa/Nairobi' },
        },
      });

      if (verificationRequired) {
        const rawToken = crypto
          .randomBytes(VERIFICATION_TOKEN_LENGTH)
          .toString('base64url');
        const record = await tx.emailVerificationToken.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            tokenHash: this.tokens.hashToken(rawToken),
            expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
          },
          select: { id: true },
        });
        await this.outbox.enqueue(tx, {
          type: OutboxEventType.EMAIL_VERIFICATION,
          aggregateType: 'User',
          aggregateId: user.id,
          organizationId: organization.id,
          payload: {
            verificationTokenId: record.id,
            email: user.email,
            name: user.name,
          },
        });
        if (this.config.get('app.nodeEnv') !== 'production') {
          devVerificationToken = rawToken;
        }
      }

      await seedChartOfAccounts(tx, organization.id, user.id);

      // Per-tenant defaults; editable later via the org settings endpoint.
      await tx.organizationSetting.create({
        data: {
          organizationId: organization.id,
          taxRate: process.env.DEFAULT_TAX_RATE ?? '16.00',
          currency: 'KES',
          invoiceNumberFormat: 'INV-YYYY-######',
          defaultPaymentTermsDays: 30,
        },
      });

      return { organizationId: organization.id, userId: user.id };
    });

    let tokens: TokenPair | undefined;
    if (!verificationRequired) {
      tokens = await this.issueSessionPair(result.userId, device);
    }

    return {
      userId: result.userId,
      organizationId: result.organizationId,
      requiresEmailVerification: verificationRequired,
      tokens,
      devVerificationToken,
    };
  }

  async login(dto: LoginDto, device: DeviceContext): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.password.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }
    if (
      user.status === UserStatus.PENDING &&
      this.config.getOrThrow<boolean>('auth.emailVerificationRequired')
    ) {
      throw new ForbiddenException('Email not verified');
    }

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });

    return this.issueSessionPair(user.id, device);
  }

  async refresh(rawToken: string, device: DeviceContext) {
    return this.tokens.rotate(rawToken, device);
  }

  async logout(rawToken: string): Promise<void> {
    await this.tokens.revoke(rawToken);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const hash = this.tokens.hashToken(rawToken);
    const record = await this.prisma.client.emailVerificationToken.findFirst({
      where: { tokenHash: hash, usedAt: null },
      include: { user: true },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification link');
    }
    if (record.user.deletedAt) {
      throw new UnauthorizedException('Account no longer exists');
    }

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: record.userId },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      }),
      this.prisma.client.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async requestPasswordReset(emailRaw: string): Promise<void> {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    // Uniform response regardless of whether the account exists (no user enum).
    if (!user || user.deletedAt) return;

    const rawToken = crypto.randomBytes(RESET_TOKEN_LENGTH).toString('base64url');
    await this.prisma.client.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          tokenHash: this.tokens.hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      await this.outbox.enqueue(tx, {
        type: OutboxEventType.PASSWORD_RESET,
        aggregateType: 'User',
        aggregateId: user.id,
        organizationId: user.organizationId,
        payload: {
          resetTokenId: record.id,
          email: user.email,
        },
      });
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const hash = this.tokens.hashToken(rawToken);
    const record = await this.prisma.client.passwordResetToken.findFirst({
      where: { tokenHash: hash, usedAt: null },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await this.password.hash(newPassword);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async me(userId: string, organizationId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        preferences: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async sessions(
    userId: string,
    organizationId: string,
  ): Promise<DevicesShape[]> {
    return this.tokens.listActiveSessions(userId, organizationId);
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    await this.tokens.revokeSession(sessionId, organizationId);
  }

  async revokeAllSessions(userId: string, organizationId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId, organizationId);
  }

  private async issueSessionPair(
    userId: string,
    device: DeviceContext,
  ): Promise<TokenPair> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, organizationId: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const { token, rowId } = await this.tokens.issueRefreshToken(
      userId,
      user.organizationId,
      device,
    );
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.organizationId,
      tokenVersion: this.tokens.accessClientVersion(),
    });
    return {
      accessToken,
      refreshToken: token,
      refreshTokenId: rowId,
      expiresIn: this.tokens.refreshTtlSeconds(),
    };
  }
}