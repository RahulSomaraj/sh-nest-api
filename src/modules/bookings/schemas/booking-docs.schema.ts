import { Schema, SchemaTypes } from 'mongoose';

/**
 * userbookings (active) + completed_bookings schemas for the admin bookings module.
 * Both are permissive (strict:false) so the large, evolving booking documents round-trip
 * without field loss, and strictPopulate:false so legacy-tolerant populate never throws
 * under Mongoose 8. Active-booking populate paths (user / room.room / property) are
 * declared as refs; completed bookings use embedded propertyInfo/roomsInfo and are joined
 * manually in the service (no ref needed).
 */
const oid = (ref: string) => ({ type: SchemaTypes.ObjectId, ref });

export const UserBookingFullSchema = new Schema(
  {
    user: oid('users'),
    property: oid('properties'),
    room: [{ room: oid('rooms'), number: Number }],
  },
  { collection: 'userbookings', timestamps: true, strict: false, strictPopulate: false },
);

export const CompletedBookingFullSchema = new Schema(
  {},
  { collection: 'completed_bookings', timestamps: true, strict: false, strictPopulate: false },
);
