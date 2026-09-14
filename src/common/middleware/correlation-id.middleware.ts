import { NextFunction, Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { RequestScope, requestScope } from '../context/request-context.js';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Express handler that:
 *  - assigns a correlation id (incoming header or fresh UUID) to the request,
 *  - writes it back on the response,
 *  - runs downstream handlers inside an AsyncLocalStorage scope so services
 *    and the Prisma tenant extension can read it per-request.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[CORRELATION_HEADER];
  const correlationId =
    typeof incoming === 'string' && incoming.length > 0
      ? incoming
      : crypto.randomUUID();

  // pino-http falls back to `req.id` when no custom genReqId is set.
  (req as Request & { id: string }).id = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);

  const scope: RequestScope = { correlationId };
  requestScope.run(scope, next);
}