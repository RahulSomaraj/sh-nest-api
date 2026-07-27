import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { HyperGuestSyncService } from '../api/hyperguest/hyperguest-sync.service';

/**
 * 6-hourly HyperGuest static sync (HYPERGUEST_PLAN.md slab B).
 * Same double-gate as every job here: ENABLE_CRON must be true on this PM2
 * instance AND HG_ENABLED must be true — otherwise the tick is a no-op, so
 * with the flag off this integration causes zero outbound traffic.
 */
@Injectable()
export class HyperGuestSyncJob {
  private readonly logger = new Logger(HyperGuestSyncJob.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sync: HyperGuestSyncService,
  ) {}

  private get enabled(): boolean {
    return (
      !!this.config.get<boolean>('enableCron') &&
      !!this.config.get<boolean>('hyperguest.enabled')
    );
  }

  @Cron('0 */6 * * *', { name: 'hyperguest-sync' })
  async run(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.sync.syncHotels('cron');
    } catch (err) {
      // syncHotels already records per-run errors; this catches boot-order surprises.
      this.logger.error(`hyperguest-sync tick failed: ${(err as Error).message}`);
    }
  }
}
