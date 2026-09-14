import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { getScope } from '../context/request-context.js';
import { fail } from '../helpers/response-envelope.js';

export interface ErrorDetail {
  message: string;
  path?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const correlationId = getScope()?.correlationId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: ErrorDetail[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const raw = body as Record<string, unknown>;
        const m = raw.message as string | ErrorDetail[] | undefined;
        if (Array.isArray(m)) {
          errors = m.map((item) =>
            typeof item === 'string'
              ? { message: item }
              : { message: item.message ?? 'Invalid value', path: item.path },
          );
          message = 'Validation failed';
        } else {
          message = (m as string) ?? exception.message;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        { err: exception, correlationId },
        `Unhandled exception: ${exception.message}`,
      );
    } else {
      this.logger.error(
        { err: exception, correlationId },
        'Unhandled non-Error exception',
      );
    }

    response.status(status).json(fail(message, errors));
  }
}