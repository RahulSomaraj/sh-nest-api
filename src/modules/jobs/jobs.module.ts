import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { MailModule } from '../../common/mail/mail.module';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { JobsService } from './jobs.service';
import { InvoicesJobService } from './invoices-job.service';
import { PushService } from './push.service';
import { HyperGuestSyncJob } from './hyperguest-sync.job';
import { HyperGuestModule } from '../api/hyperguest/hyperguest.module';
import { InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { CronBlockSlotSchema } from './schemas/cron-block-slot.schema';
import { NotificationLogSchema } from './schemas/notification-log.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationSchema,
  NotificationChild,
  NotificationChildSchema,
} from '../api/website/schemas/notification.schema';

/**
 * MIGRATION.md phase 3 — background jobs.
 *
 * The schedule is always registered, but every job returns immediately unless
 * `ENABLE_CRON=true`, so only the single designated PM2 instance actually does work.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ReferenceModelsModule,
    MailModule,
    // HyperGuest static sync (phase 4) — no-op unless ENABLE_CRON + HG_ENABLED.
    HyperGuestModule,
    MongooseModule.forFeature([
      { name: 'cron_blockslots', schema: CronBlockSlotSchema },
      { name: 'notificationlogs', schema: NotificationLogSchema },
      { name: User.name, schema: UserSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationChild.name, schema: NotificationChildSchema },
      { name: 'invoices', schema: InvoiceSchema },
    ]),
  ],
  providers: [JobsService, InvoicesJobService, PushService, HyperGuestSyncJob],
  // InvoicesJobService is consumed by the admin `POST /admin/v2/invoices/generate` route.
  exports: [JobsService, InvoicesJobService, PushService],
})
export class JobsModule {}
