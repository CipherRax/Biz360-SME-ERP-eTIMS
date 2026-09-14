import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY } from '../decorators/audit.decorator.js';
import { getScope } from '../context/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Records an AuditLog row after a decorated write route succeeds.
 * Attach `@Audit('EntityType')` to the handler; entity id is resolved from
 * the route param or the handler's own response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entityType = this.reflector.get<string>(AUDIT_KEY, context.getHandler());
    if (!entityType) return next.handle();

    return next.handle().pipe(
      tap({
        next: (data: unknown) => this.record(context, entityType, data),
        error: () => {
          /* failed writes are not silently audited in this version */
        },
      }),
    );
  }

  private async record(
    context: ExecutionContext,
    entityType: string,
    data: unknown,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Request>();
    const scope = getScope();
    if (!scope?.organizationId) return;

    const entityId =
      (req.params?.id as string | undefined) ??
      (data as { id?: unknown } | null)?.id;

    await this.prisma.client.auditLog.create({
      data: {
        actorId: scope.userId ?? null,
        action: `${req.method} ${req.route?.path ?? req.path}`,
        entityType,
        entityId: entityId !== undefined ? String(entityId) : null,
        after:
          data !== null && data !== undefined
            ? (data as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        metadata: { query: req.query } as Prisma.InputJsonValue,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: scope.correlationId,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  }
}