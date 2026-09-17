import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
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

    // Translate known Prisma errors into client-friendly HTTP exceptions before
    // the generic handling below. This keeps a wrong-ID request from surfacing
    // as a cryptic 500 with driver internals.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      exception = this.translatePrismaError(exception);
    }

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

  private translatePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): HttpException {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation.
        return new ConflictException('A record with this value already exists');
      case 'P2003':
        return new ConflictException(
          'Operation conflicts with related records (foreign key)',
        );
      case 'P2025':
        return new NotFoundException('Record not found');
      case 'P2023':
        return new NotFoundException('Record not found (inconsistent data)');
      default:
        // Codes like P2010 (raw query failed) or connection errors leak driver
        // details — keep them as a generic 500.
        this.logger.error(
          { code: error.code, meta: error.meta },
          `Prisma ${error.code}`,
        );
        return new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}