import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Role, UserStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { getScope } from '../context/request-context.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

const API_KEY_PREFIX = 'erp_';

function extractApiKey(authorization?: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  const token = match?.[1]?.trim() ?? '';
  return token.startsWith(API_KEY_PREFIX) ? token : null;
}

/**
 * Global auth guard. Routes marked with `@Public()` skip authentication.
 *
 * Two credential types are accepted:
 *  - a valid bearer JWT (passport strategy) — an interactive user session;
 *  - a tenant API key (`erp_…`) — machine-to-machine, treated as READ_ONLY
 *    until scope-based authorization is layered on.
 *
 * Every authenticated request re-checks the bound user's DB status so a
 * suspended or deleted account is rejected immediately, even if its access
 * token has not yet expired.
 *
 * On success the actor/tenant is published to the AsyncLocalStorage request
 * scope so tenant isolation and audit columns apply transparently.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const apiKey = extractApiKey(req.headers.authorization);
    if (apiKey) {
      const credentials = await this.apiKeys.validate(apiKey);
      if (!credentials) {
        throw new UnauthorizedException('Invalid or expired API key');
      }
      const scope = getScope();
      if (scope) scope.organizationId = credentials.organizationId;
      req.user = {
        sub: `apikey:${credentials.id}`,
        email: `${credentials.id}@api.local`,
        role: Role.READ_ONLY,
        orgId: credentials.organizationId,
        scopes: credentials.scopes,
      };
      return true;
    }

    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    // Post-JWT check: the bound user must still exist, be ACTIVE, and not be
    // soft-deleted. This makes suspensions take effect immediately.
    const user = req.user;
    if (user?.sub && !user.sub.startsWith('apikey:')) {
      const dbUser = await this.prisma.client.user.findFirst({
        where: { id: user.sub, deletedAt: null },
        select: { status: true },
      });
      if (!dbUser || dbUser.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Account is disabled or not active');
      }
    }
    return true;
  }

  override handleRequest<TUser = any>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const scope = getScope();
    if (scope) {
      scope.userId = (user as { sub: string }).sub;
      scope.organizationId = (user as { orgId: string }).orgId;
    }
    return user as TUser;
  }
}