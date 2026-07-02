import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global error envelope. Every unhandled error — HttpException, Mongoose
 * validation/cast/duplicate-key, or an unexpected throw — is normalised to a
 * single shape so clients get consistent error handling:
 *
 *   { status: 0, statusCode, error, message, path, timestamp }
 *
 * `status: 0` mirrors the app's existing success convention ({ status: 1, ... }).
 * Success responses are intentionally left untouched to preserve the frontend
 * contract; this filter only shapes failures.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Something went wrong';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, any>;
        // ValidationPipe puts field errors in `message` (array); keep them.
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
      }
    } else if (this.isMongooseValidation(exception)) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'ValidationError';
      message = Object.values((exception as any).errors ?? {}).map(
        (e: any) => e.message,
      );
    } else if ((exception as any)?.name === 'CastError') {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'CastError';
      message = `Invalid value for "${(exception as any).path}"`;
    } else if ((exception as any)?.code === 11000) {
      statusCode = HttpStatus.CONFLICT;
      error = 'DuplicateKey';
      const field = Object.keys((exception as any).keyValue ?? {})[0] ?? 'field';
      message = `Duplicate value for "${field}"`;
    }

    // Log server-side faults (5xx) with the stack; client errors stay quiet.
    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${statusCode}`,
        (exception as any)?.stack ?? String(exception),
      );
    }

    res.status(statusCode).json({
      status: 0,
      statusCode,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private isMongooseValidation(e: unknown): boolean {
    return (e as any)?.name === 'ValidationError' && !!(e as any)?.errors;
  }
}
