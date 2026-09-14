import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { getScope } from '../context/request-context.js';

/**
 * Global auth guard. Routes marked with `@Public()` skip authentication.
 * All other requests must carry a valid bearer access token; on success the
 * actor is published to the AsyncLocalStorage request scope so tenant
 * isolation and audit columns apply transparently.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser = any>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw err instanceof Error
        ? new UnauthorizedException('Invalid or expired token')
        : new UnauthorizedException('Invalid or expired token');
    }
    const scope = getScope();
    if (scope) {
      scope.userId = (user as { sub: string }).sub;
      scope.organizationId = (user as { orgId: string }).orgId;
    }
    return user as TUser;
  }
}