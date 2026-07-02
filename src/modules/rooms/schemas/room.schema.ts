import { Schema, SchemaTypes } from 'mongoose';

/**
 * Full port of stayhopper/db/models/rooms.js (collection: "rooms").
 * Ref names match the Nest-side registered models so populate() resolves.
 */
const oid = (ref: string) => ({ type: SchemaTypes.ObjectId, ref });

const HoursSchema = new Schema(
  Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`h${i}`, Number])),
  { _id: false },
);

const RateBandSchema = {
  fullDay: { type: Number },
  standardDay: { type: Number },
  hours: HoursSchema,
};

const SuggestedRatesSchema = new Schema({
  name: String,
  weekday: RateBandSchema,
  weekend: RateBandSchema,
  dateFrom: Date,
  dateTo: Date,
  recurring: Boolean,
  minimumBookingRate: { type: Number },
  suggestedNewRatePercentage: { type: Number },
  isDefault: { type: Boolean, default: false },
  isAccepted: { type: Boolean, default: false },
  rateType: { type: String, enum: ['hourly', 'monthly'] },
});

const RatesSchema = new Schema({
  name: String,
  weekday: RateBandSchema,
  weekend: RateBandSchema,
  dateFrom: Date,
  dateTo: Date,
  recurring: Boolean,
  minimumBookingRate: { type: Number },
  suggested_rates: [SuggestedRatesSchema],
  isExistPriceSuggestion: { type: Boolean, default: false },
  isDefault: { type: Boolean, default: false },
  rateType: { type: String, enum: ['hourly', 'monthly'] },
});

const PricingSchema = new Schema(
  { h3: Number, h6: Number, h12: Number, h24: Number },
  { _id: false },
);

export const RoomSchema = new Schema(
  {
    property_id: { ...oid('properties'), required: true },
    room_type: { ...oid('room_types'), required: true },
    number_rooms: { type: Number, required: true },
    room_name: oid('room_names'),
    bed_type: { ...oid('bed_types'), required: true },
    custom_name: String,
    number_guests: Number,
    number_of_guests: oid('guest_numbers'),
    number_beds: Number,
    extrabed_option: Boolean,
    extrabed_number: Number,
    amount_extrabed: Number,
    room_size: String,
    extraslot_cleaning: Number,
    hours_cleaning: { type: Number, default: 0 },
    price: PricingSchema,
    rates: [RatesSchema],
    services: [oid('services')],
    images: [String],
    featured: [String],
    isExistPriceSuggestion: { type: Boolean, default: false },
    suggestedRatePercentage: { type: Number },
  },
  { collection: 'rooms', timestamps: true },
);

RoomSchema.index({ property_id: 1 });
