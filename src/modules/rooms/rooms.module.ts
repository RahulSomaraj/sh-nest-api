import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';

/**
 * Every model this module touches — `rooms` (authoritative), the slot/booking/booking-log
 * collections used by the availability endpoints, and the populate refs (properties,
 * room_types, room_names, bed_types, guest_numbers, services, currencies, ...) — is
 * registered once in ReferenceModelsModule, so the admin and customer surfaces share
 * them instead of registering competing models on the same connection.
 */
@Module({
  imports: [ReferenceModelsModule, MailModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
