import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdministratorsController } from './administrators.controller';
import { AdministratorsService } from './administrators.service';
import {
  Administrator,
  AdministratorSchema,
} from './schemas/administrator.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';
import {
  BookingSchema,
  BookingLogSchema,
} from '../rooms/schemas/availability.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Administrator.name, schema: AdministratorSchema },
      { name: Role.name, schema: RoleSchema },
      // audit A2: delete-cascade cleanup of availability bookings/bookinglogs
      // (connection-level model reuse — no double registration).
      { name: 'bookings', schema: BookingSchema },
      { name: 'bookinglogs', schema: BookingLogSchema },
    ]),
    ReferenceModelsModule,
    MailModule,
  ],
  controllers: [AdministratorsController],
  providers: [AdministratorsService],
  exports: [AdministratorsService],
})
export class AdministratorsModule {}
