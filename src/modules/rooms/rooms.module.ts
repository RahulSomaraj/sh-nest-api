import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import {
  SlotSchema,
  BookingSchema,
  BookingLogSchema,
} from './schemas/availability.schema';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';

/**
 * `rooms` is registered here as the authoritative model (also overrides the loose one
 * from ReferenceModelsModule via connection reuse). slots/bookings/bookinglogs are
 * needed for the availability endpoints; when the bookings module is ported it should
 * take ownership of bookings/bookinglogs.
 * ReferenceModelsModule supplies the populate refs (properties, room_types, room_names,
 * bed_types, guest_numbers, services, currencies, ...).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'slots', schema: SlotSchema },
      { name: 'bookings', schema: BookingSchema },
      { name: 'bookinglogs', schema: BookingLogSchema },
    ]),
    // `rooms` (authoritative) + populate refs come from here.
    ReferenceModelsModule,
    MailModule,
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
