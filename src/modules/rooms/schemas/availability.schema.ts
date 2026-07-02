import { Schema, SchemaTypes } from 'mongoose';

/**
 * Slots / bookings / booking-logs models needed by the rooms availability endpoints.
 * Ported from db/models/slots.js, bookings.js, bookinglogs.js. When the bookings module
 * is migrated it should take ownership of `bookings`/`bookinglogs` (move here → shared).
 */
const oid = (ref: string) => ({ type: SchemaTypes.ObjectId, ref });

export const SlotSchema = new Schema(
  { label: String, no: String },
  { collection: 'slots', timestamps: true },
);

const BookingSlotSchema = new Schema(
  {
    slot: { ...oid('slots'), required: [true, 'Slot is required'] },
    number: { type: Number, required: [true, 'Slot Number is required'] },
    status: { type: String, enum: ['BLOCKED', 'BOOKED', 'RESERVED'], default: 'BLOCKED' },
    userbooking: oid('userbookings'),
  },
  { _id: true },
);

export const BookingSchema = new Schema(
  {
    property: { ...oid('properties'), required: [true, 'Property is required'] },
    room: { ...oid('rooms'), required: [true, 'Room is required'] },
    date: { type: String, required: [true, 'Date is required'] },
    slots: [BookingSlotSchema],
  },
  { collection: 'bookings', timestamps: true },
);
BookingSchema.index({ room: 1, date: 1 });

export const BookingLogSchema = new Schema(
  {
    property: { ...oid('properties'), required: [true, 'Property is required'] },
    date: { type: String, required: [true, 'Date is required'] },
    timestamp: { type: Date, required: [true, 'Timestamp is required'] },
    room: { ...oid('rooms'), required: [true, 'Room is required'] },
    number: { type: Number, required: [true, 'Room Number is required'] },
    slot: { ...oid('slots'), required: [true, 'Slot is required'] },
    slotStartTime: { type: Date },
    userbooking: { ...oid('userbookings'), default: null },
  },
  { collection: 'bookinglogs', timestamps: true },
);
BookingLogSchema.index({ room: 1, date: 1, slot: 1, number: 1 });
