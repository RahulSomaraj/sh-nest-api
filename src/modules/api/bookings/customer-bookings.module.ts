import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../../../common/mail/mail.module';
import { ApiServicesModule } from '../services/api-services.module';
import { UserAuthModule } from '../auth/user-auth.module';
import {
  CustomerBookingsController,
  CustomerBookingsV3Controller,
  CustomerPaymentController,
} from './customer-bookings.controller';
import { CustomerBookingsService } from './customer-bookings.service';
import { InvoiceSchema } from '../../invoices/schemas/invoice.schema';

/**
 * MIGRATION.md 2e — booking creation, the payment gateway return URLs and the two
 * `/api/v3` booking routes.
 *
 * `invoices` is needed because the hotel invoice payment flow shares the same gateway
 * return URL as guest bookings.
 */
@Module({
  imports: [
    ApiServicesModule,
    UserAuthModule,
    MailModule,
    MongooseModule.forFeature([{ name: 'invoices', schema: InvoiceSchema }]),
  ],
  controllers: [
    CustomerBookingsController,
    CustomerPaymentController,
    CustomerBookingsV3Controller,
  ],
  providers: [CustomerBookingsService],
  exports: [CustomerBookingsService],
})
export class CustomerBookingsModule {}
