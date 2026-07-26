import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../../../common/mail/mail.module';
import { MailchimpModule } from '../../../common/mailchimp/mailchimp.module';
import { ReferenceModelsModule } from '../../../common/reference/reference.module';
import { UserAuthModule } from '../auth/user-auth.module';
import { WebsiteService } from './website.service';
import {
  ContactUsController,
  CustomerFaqController,
  CustomerNotificationsController,
  CustomerTermsAndConditionsController,
  CustomerUserRatingsController,
  WebsiteController,
} from './website.controller';
import { ContactUs, ContactUsSchema } from './schemas/contact-us.schema';
import {
  Notification,
  NotificationSchema,
  NotificationChild,
  NotificationChildSchema,
} from './schemas/notification.schema';
import {
  UserRating,
  UserRatingSchema,
} from '../../user-ratings/schemas/user-rating.schema';

/**
 * MIGRATION.md 2f — the small `/api` surfaces: website forms, contact-us, the
 * customer-facing FAQ/terms reads, rating submission and notifications.
 *
 * `cities`, `faq` and `termsandconditions` come from ReferenceModelsModule so this
 * module reads the same authoritative models the admin CRUD surface writes.
 */
@Module({
  imports: [
    MailModule,
    MailchimpModule,
    ReferenceModelsModule,
    UserAuthModule,
    MongooseModule.forFeature([
      { name: ContactUs.name, schema: ContactUsSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationChild.name, schema: NotificationChildSchema },
      { name: UserRating.name, schema: UserRatingSchema },
    ]),
  ],
  controllers: [
    WebsiteController,
    ContactUsController,
    CustomerTermsAndConditionsController,
    CustomerFaqController,
    CustomerUserRatingsController,
    CustomerNotificationsController,
  ],
  providers: [WebsiteService],
})
export class WebsiteModule {}
