import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import {
  Administrator,
  AdministratorSchema,
} from '../administrators/schemas/administrator.schema';
import { Role, RoleSchema } from '../administrators/schemas/role.schema';
import {
  BookingSchema,
  BookingLogSchema,
} from '../rooms/schemas/availability.schema';

/**
 * The authoritative `properties` (+ rooms/countries/currencies/... loose) models come
 * from ReferenceModelsModule. Administrator/Role are re-registered here for the
 * company-filter + owner-scoping queries; @nestjs/mongoose reuses the existing model
 * on the shared connection, so this does not double-register.
 */
@Module({
  imports: [
    ReferenceModelsModule,
    MongooseModule.forFeature([
      { name: Administrator.name, schema: AdministratorSchema },
      { name: Role.name, schema: RoleSchema },
      // audit A5: delete-cascade cleanup of availability bookings/bookinglogs.
      { name: 'bookings', schema: BookingSchema },
      { name: 'bookinglogs', schema: BookingLogSchema },
    ]),
  ],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
