import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getScope } from '../context/request-context.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type Claim =
  | { kind: 'created'; id: string }
  | { kind: 'replay'; responseBody: unknown; responseCode?: number | null }
  | { kind: 'other' };

type AuthedRequest = Request & {
  user?: { orgId?: string; sub?: string };
};

/**
 * Idempotency-Key support for financial mutations.
 *
 * When a request carries an `Idempotency-Key` header the exact request is
 * claimed up-front (unique per tenant+key). A repeat of the SAME key+body
 * replays the stored response instead of re-executing the side effect, while
 * a key reuse with a DIFFERENT body is rejected. The claim row is created
 * before the handler runs, so concurrent duplicates cannot double-book; it is
 * removed again if the handler fails, so a failed attempt can be retried.
 *
 * Registered as the OUTERMOST global interceptor so the stored payload is the
 * final transform-enveloped body exactly as a replayed client would see it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs =
      parseInt(config.get<string>('app.idempotencyTtlHours') ?? '24', 10) *
      60 *
      60 *
      1000;
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    const key = String(req.headers['idempotency-key'] ?? '').trim();
    const organizationId = req.user?.orgId ?? getScope()?.organizationId;
    if (!key || !organizationId || !WRITE_METHODS.has(req.method)) {
      return next.handle();
    }

    const method = req.method;
    const path = (req.route?.path ?? req.path ?? '/') as string;
    const bodyJson = JSON.stringify((req as { body?: unknown }).body ?? {});
    const requestHash = createHash('sha256')
      .update(`${method} ${path} ${bodyJson}`)
      .digest('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    const claim = await this.claim({
      organizationId,
      key,
      method,
      path,
      requestHash,
      expiresAt,
    });
    if (claim.kind === 'replay') {
      if (claim.responseCode) res.statusCode = claim.responseCode;
      return of(claim.responseBody);
    }
    if (claim.kind === 'other') {
      return next.handle();
    }

    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        await this.complete(claim.id, data, res.statusCode);
        return data;
      }),
      catchError(async (err: unknown) => {
        await this.abort(claim.id);
        throw err;
      }),
    );
  }

  private async claim(params: {
    organizationId: string;
    key: string;
    method: string;
    path: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<Claim> {
    const { organizationId, key, requestHash, expiresAt } = params;
    try {
      const row = await this.prisma.client.idempotencyKey.create({
        data: {
          organizationId,
          key,
          method: params.method,
          path: params.path,
          requestHash,
          expiresAt,
        },
        select: { id: true },
      });
      return { kind: 'created', id: row.id };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.client.idempotencyKey.findFirst({
          where: { organizationId, key, expiresAt: { gte: new Date() } },
        });
        if (!existing) return { kind: 'other' };
        if (existing.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency-Key was already used for a different request',
          );
        }
        if (existing.responseBody) {
          return {
            kind: 'replay',
            responseBody: existing.responseBody as unknown,
            responseCode: existing.responseCode,
          };
        }
        return { kind: 'created', id: existing.id };
      }
      return { kind: 'other' };
    }
  }

  private async complete(id: string, data: unknown, statusCode: number): Promise<void> {
    await this.prisma.client.idempotencyKey.update({
      where: { id },
      data: {
        responseCode: statusCode,
        responseBody: data as Prisma.InputJsonValue,
      },
    });
  }

  private async abort(id: string): Promise<void> {
    await this.prisma.client.idempotencyKey
      .delete({ where: { id } })
      .catch(() => undefined);
  }
}