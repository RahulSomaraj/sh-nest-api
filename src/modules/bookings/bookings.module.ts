import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';
import { BookingSchema, BookingLogSchema } from '../rooms/schemas/availability.schema';

/**
 * userbookings / completed_bookings / properties come from ReferenceModelsModule.
 * bookings / bookinglogs (for slot + log cleanup on delete/no-show) are re-registered
 * here; @nestjs/mongoose reuses the existing connection models.
 */
@Module({
  imports: [
    ReferenceModelsModule,
    MailModule,
    MongooseModule.forFeature([
      { name: 'bookings', schema: BookingSchema },
      { name: 'bookinglogs', schema: BookingLogSchema },
    ]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
