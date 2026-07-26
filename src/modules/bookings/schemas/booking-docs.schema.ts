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
// audit DB: hot query paths — bookings list, dashboard counts, payment lookups,
// and the property/admin/room delete-guards all filter on these fields.
UserBookingFullSchema.index({ property: 1 });
UserBookingFullSchema.index({ user: 1 });
UserBookingFullSchema.index({ property: 1, date_checkin: 1 }); // delete-guard active-booking check
UserBookingFullSchema.index({ 'room.room': 1 }); // room delete-guard
UserBookingFullSchema.index({ checkin_date: 1 }); // bookings list date filter

export const CompletedBookingFullSchema = new Schema(
  {},
  { collection: 'completed_bookings', timestamps: true, strict: false, strictPopulate: false },
);
// audit DB: completed bookings are filtered by user (users list/detail) and by the
// embedded property id (bookings list + dashboard) — both were unindexed.
CompletedBookingFullSchema.index({ user: 1 });
CompletedBookingFullSchema.index({ 'propertyInfo.id': 1 });
