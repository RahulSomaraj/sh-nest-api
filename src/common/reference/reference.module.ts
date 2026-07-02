import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Schema } from 'mongoose';
import { PropertySchema } from '../../modules/properties/schemas/property.schema';
import { RoomSchema } from '../../modules/rooms/schemas/room.schema';
import { crudSchemaModels } from './crud.schemas';
import {
  UserBookingFullSchema,
  CompletedBookingFullSchema,
} from '../../modules/bookings/schemas/booking-docs.schema';

/**
 * Single source of truth for shared Mongoose models resolved via `populate()` across
 * modules. Authoritative schemas (properties, rooms, and all standard-CRUD resources)
 * are registered once here so every module — and cross-module populate — reuses the same
 * model on the connection (no duplicate registration). Only collections not yet given a
 * real schema remain loose (strict:false) pass-throughs.
 *
 * Model name === the ref string used in schemas, so `ref:` values resolve correctly.
 */
const loose = (collection: string) =>
  new Schema({}, { strict: false, collection, timestamps: true });

const models = [
  { name: 'properties', schema: PropertySchema },
  { name: 'rooms', schema: RoomSchema },
  // Standard-CRUD resources (authoritative) — countries, cities, currencies, services,
  // propertytypes, propertyratings, policies, terms, room_types, room_names, bed_types,
  // bed_numbers, guest_numbers, faq, offers, promocodes, termsandconditions.
  ...crudSchemaModels,
  // Booking collections (authoritative; permissive) — shared by users, rooms, bookings.
  { name: 'userbookings', schema: UserBookingFullSchema },
  { name: 'completed_bookings', schema: CompletedBookingFullSchema },
  // Still-loose collections (not yet migrated to their own module).
  { name: 'hoteladmins', schema: loose('hotel_admins') },
  { name: 'users', schema: loose('users') },
];

@Module({
  imports: [MongooseModule.forFeature(models)],
  exports: [MongooseModule],
})
export class ReferenceModelsModule {}
