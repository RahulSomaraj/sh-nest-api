import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Module,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Connection } from 'mongoose';

/**
 * Liveness/readiness health checks for PM2 and load balancers.
 *
 *   GET /health/live   — liveness: the process is up and the event loop responds.
 *                        Always 200 (cheap; never touches the DB). Use for PM2 restarts.
 *   GET /health/ready  — readiness: pings MongoDB. 200 when the DB is reachable,
 *                        503 otherwise. Use for LB "should this instance get traffic?".
 *   GET /health        — alias of /ready.
 *
 * Mounted at the ROOT (excluded from the global /admin/v2 prefix in main.ts) so probes
 * hit stable paths. Throttling is skipped so frequent probes don't consume the rate limit.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  ready() {
    return this.check();
  }

  @Get()
  health() {
    return this.check();
  }

  private async check() {
    const started = Date.now();
    let mongo: 'up' | 'down' = 'down';
    let error: string | undefined;
    try {
      // readyState 1 === connected. `ping` needs no special privileges.
      if (this.connection.readyState === 1 && this.connection.db) {
        await this.connection.db.command({ ping: 1 });
        mongo = 'up';
      }
    } catch (e: any) {
      error = e?.message ?? String(e);
    }

    const body = {
      status: mongo === 'up' ? 'ok' : 'error',
      info: { mongo: { status: mongo, ...(error ? { error } : {}) } },
      responseTimeMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };

    if (mongo !== 'up') {
      // 503 so load balancers pull this instance out of rotation.
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
