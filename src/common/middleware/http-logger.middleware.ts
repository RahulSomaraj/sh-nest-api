import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Logs one line per request when the response finishes:
 *   GET /admin/v2/bookings 200 14ms - 172.18.0.1 user=6a46...
 *
 * Runs as middleware but logs on the response 'finish' event, so by then the
 * status code is known and req.user (set by the auth guard) is populated for
 * authenticated routes. Bodies are intentionally NOT logged to avoid leaking
 * passwords / tokens / PII.
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    const { method, originalUrl } = req;
    const ip = req.ip || req.socket?.remoteAddress || '-';

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const { statusCode } = res;
      const len = res.getHeader('content-length');
      const userId = (req as any).user?._id
        ? ` user=${(req as any).user._id}`
        : '';
      const msg = `${method} ${originalUrl} ${statusCode} ${ms.toFixed(1)}ms${len ? ` ${len}b` : ''} - ${ip}${userId}`;

      // Route severity by status so real failures stand out in the logs.
      if (statusCode >= 500) this.logger.error(msg);
      else if (statusCode >= 400) this.logger.warn(msg);
      else this.logger.log(msg);
    });

    next();
  }
}
