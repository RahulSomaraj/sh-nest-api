import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModelsModule } from '../../../common/reference/reference.module';
import { HgHotelSchema, HgSyncRunSchema } from './schemas/hg-hotel.schema';
import { HyperGuestClientService } from './hyperguest-client.service';
import { HyperGuestSyncService } from './hyperguest-sync.service';

/**
 * HyperGuest supplier integration (phase 4, HYPERGUEST_PLAN.md).
 * Providers only — no controller, so this module carries no routes of its own:
 * the admin sync trigger lives in HyperGuestAdminModule (admin/v2 surface) and
 * the 6-hourly sync cron in JobsModule. Everything is inert unless HG_ENABLED.
 */
@Module({
  imports: [
    // properties + currencies (+ the rest of the shared models).
    ReferenceModelsModule,
    MongooseModule.forFeature([
      { name: 'hg_hotels', schema: HgHotelSchema },
      { name: 'hg_sync_runs', schema: HgSyncRunSchema },
    ]),
  ],
  providers: [HyperGuestClientService, HyperGuestSyncService],
  exports: [HyperGuestClientService, HyperGuestSyncService],
})
export class HyperGuestModule {}
