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
import {
  SlotSchema,
  BookingSchema,
  BookingLogSchema,
} from '../../modules/rooms/schemas/availability.schema';
import {
  UserRating,
  UserRatingSchema,
} from '../../modules/user-ratings/schemas/user-rating.schema';

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
  // Slot/booking-log state. Owned here rather than by RoomsModule because the customer
  // search + booking flow reads and writes the same collections.
  { name: 'slots', schema: SlotSchema },
  { name: 'bookings', schema: BookingSchema },
  { name: 'bookinglogs', schema: BookingLogSchema },
  // Ratings, read by the search pricing path and written by the customer surface.
  { name: UserRating.name, schema: UserRatingSchema },
  // Still-loose collections (not yet migrated to their own module).
  { name: 'hoteladmins', schema: loose('hotel_admins') },
  { name: 'users', schema: loose('users') },
];

@Module({
  imports: [MongooseModule.forFeature(models)],
  exports: [MongooseModule],
})
export class ReferenceModelsModule {}
