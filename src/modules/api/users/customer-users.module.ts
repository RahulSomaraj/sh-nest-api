import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../../../common/mail/mail.module';
import { MailchimpModule } from '../../../common/mailchimp/mailchimp.module';
import { ReferenceModelsModule } from '../../../common/reference/reference.module';
import { UserAuthModule } from '../auth/user-auth.module';
import { CustomerUsersService } from './customer-users.service';
import {
  CustomerUsersController,
  GuestUserController,
} from './customer-users.controller';
import {
  UserRating,
  UserRatingSchema,
} from '../../user-ratings/schemas/user-rating.schema';

/**
 * MIGRATION.md 2b — customer accounts (`/api/users`) and the two `/api/v3` guest-user
 * routes. Booking collections come from ReferenceModelsModule so the "my bookings"
 * read shares the models the admin surface writes.
 */
@Module({
  imports: [
    MailModule,
    MailchimpModule,
    ReferenceModelsModule,
    // Provides the `User` model plus the jwt-user / local-user-login strategies.
    UserAuthModule,
    MongooseModule.forFeature([
      { name: UserRating.name, schema: UserRatingSchema },
    ]),
  ],
  controllers: [CustomerUsersController, GuestUserController],
  providers: [CustomerUsersService],
  exports: [CustomerUsersService],
})
export class CustomerUsersModule {}
