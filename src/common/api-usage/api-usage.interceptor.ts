import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiUsageService } from './api-usage.service';

/**
 * Global interceptor: records one hit per request, keyed by HTTP method + the matched
 * route *pattern* (req.route.path, e.g. "/admin/v2/bookings/:id").
 *
 * Uses finalize() so the hit is counted regardless of success/error (a 4xx/5xx still means
 * the endpoint is in use). Only counts requests that matched a route — unmatched 404s have
 * no req.route and are ignored. Recording is buffered in-memory, so this adds ~no latency.
 */
@Injectable()
export class ApiUsageInterceptor implements NestInterceptor {
  constructor(private readonly service: ApiUsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req: any = context.switchToHttp().getRequest();
    return next.handle().pipe(
      finalize(() => {
        const raw = req?.route?.path;
        const route = Array.isArray(raw) ? raw[0] : raw;
        // Don't count health-probe traffic — LB/PM2 probes would swamp the usage audit.
        if (route && !route.startsWith('/health')) {
          this.service.record(req.method, route);
        }
      }),
    );
  }
}
