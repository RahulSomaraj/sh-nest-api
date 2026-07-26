import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiUsage, ApiUsageDocument } from './api-usage.schema';

interface BufferEntry {
  method: string;
  route: string;
  count: number;
  last: Date;
}

/**
 * Tracks API usage so unused endpoints can be found and removed.
 *
 * Design notes:
 *  - Hits are buffered in memory and flushed to Mongo every FLUSH_MS (and on shutdown),
 *    so we do NOT issue a DB write on every request (see audit finding on per-request writes).
 *  - On bootstrap, every route registered in the Express router is upserted at count:0
 *    ($setOnInsert), so endpoints that are never hit still show up as count:0 = unused.
 *  - Routes are keyed by pattern (…/:id), matching req.route.path at runtime, so counts
 *    aggregate per endpoint rather than per concrete URL.
 */
@Injectable()
export class ApiUsageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ApiUsageService.name);
  private readonly buffer = new Map<string, BufferEntry>();
  private flushTimer?: NodeJS.Timeout;
  private readonly FLUSH_MS = 10_000;

  constructor(
    @InjectModel(ApiUsage.name) private readonly model: Model<ApiUsageDocument>,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  /** Fire-and-forget: buffer a hit. Never throws into the request path. */
  record(method: string, route: string): void {
    if (!method || !route) return;
    const m = method.toUpperCase();
    const key = `${m} ${route}`;
    const existing = this.buffer.get(key);
    if (existing) {
      existing.count += 1;
      existing.last = new Date();
    } else {
      this.buffer.set(key, { method: m, route, count: 1, last: new Date() });
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedRoutes();
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.FLUSH_MS);
    // Don't keep the event loop alive just for the flush timer.
    this.flushTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }

  /** Public flush so the report endpoint can read fresh numbers on demand. */
  async flushNow(): Promise<void> {
    await this.flush();
  }

  /** Persist buffered counts with atomic $inc. Re-buffers on failure so counts aren't lost. */
  private async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const entries = [...this.buffer.values()];
    this.buffer.clear();

    await Promise.all(
      entries.map((e) =>
        this.model
          .updateOne(
            { method: e.method, route: e.route },
            { $inc: { count: e.count }, $set: { lastAccessed: e.last } },
            { upsert: true },
          )
          .exec()
          .catch((err) => {
            // Put the counts back so the next flush retries them.
            const key = `${e.method} ${e.route}`;
            const back = this.buffer.get(key);
            if (back) back.count += e.count;
            else this.buffer.set(key, e);
            this.logger.warn(`flush failed for ${key}: ${err?.message}`);
          }),
      ),
    );
  }

  /** Walk the Express router and upsert every route at count:0 (without resetting existing counts). */
  private async seedRoutes(): Promise<void> {
    try {
      const server: any = this.adapterHost.httpAdapter?.getInstance();
      // Express 4 exposes the router at app._router.
      const stack: any[] = server?._router?.stack ?? server?.router?.stack ?? [];
      const seen = new Set<string>();
      const routes: { method: string; route: string }[] = [];

      for (const layer of stack) {
        const r = layer?.route;
        if (!r) continue;
        const paths = Array.isArray(r.path) ? r.path : [r.path];
        const methods = r.methods || {};
        for (const path of paths) {
          if (typeof path !== 'string') continue;
          for (const m of Object.keys(methods)) {
            if (m === '_all' || !methods[m]) continue;
            const method = m.toUpperCase();
            const key = `${method} ${path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            routes.push({ method, route: path });
          }
        }
      }

      if (!routes.length) {
        this.logger.warn('api-usage: no routes discovered to seed');
        return;
      }

      await Promise.all(
        routes.map((r) =>
          this.model
            .updateOne(
              { method: r.method, route: r.route },
              { $setOnInsert: { count: 0 } },
              { upsert: true },
            )
            .exec()
            .catch(() => undefined),
        ),
      );
      this.logger.log(`api-usage: seeded/verified ${routes.length} routes`);
    } catch (e: any) {
      this.logger.warn(`api-usage: route seed skipped (${e?.message})`);
    }
  }

  /** Full report: totals + rows sorted least-used first (so removable endpoints surface). */
  async report(query: any = {}) {
    await this.flushNow();
    const order = query.order === 'desc' ? -1 : 1; // default: least used first
    const rows = await this.model
      .find({})
      .sort({ count: order, method: 1, route: 1 })
      .lean()
      .exec();

    const used = rows.filter((r: any) => r.count > 0);
    const unused = rows.filter((r: any) => r.count === 0);
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        routes: rows.length,
        used: used.length,
        unused: unused.length,
      },
      rows,
    };
  }

  /** Just the endpoints that have never been hit (candidates for removal). */
  async unused() {
    await this.flushNow();
    const rows = await this.model
      .find({ count: 0 })
      .sort({ method: 1, route: 1 })
      .select('method route')
      .lean()
      .exec();
    return { count: rows.length, routes: rows };
  }

  /** Reset all counters to 0 to start a fresh observation window. */
  async reset() {
    const res = await this.model
      .updateMany({}, { $set: { count: 0 }, $unset: { lastAccessed: '' } })
      .exec();
    this.buffer.clear();
    return { reset: true, modified: (res as any).modifiedCount ?? 0 };
  }
}
