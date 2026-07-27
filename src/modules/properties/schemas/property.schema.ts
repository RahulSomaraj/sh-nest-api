import { Schema, SchemaTypes } from 'mongoose';

/**
 * Full port of stayhopper/db/models/properties.js (collection: "properties").
 *
 * Ref names use the *Nest-side* model names registered in this app
 * (Administrator, Role, currencies, countries, cities, rooms, propertytypes,
 * propertyratings, hoteladmins, services, policies, terms) so populate() resolves
 * on the shared Mongoose connection. Collection names for the loose reference models
 * are pinned to the legacy collections in reference.module.ts.
 */
const oid = (ref: string) => ({ type: SchemaTypes.ObjectId, ref });

const TradeLicenceSchema = new Schema(
  {
    trade_licence_number: String,
    trade_licence_attachment: String,
    trade_licence_validity: String,
    passport_attachment: String,
  },
  { _id: false },
);

const PaymentSchema = new Schema(
  {
    name: String,
    country: oid('countries'),
    bank: String,
    branch: String,
    account_no: String,
    ifsc: String,
    currency: oid('currencies'),
    tax: String,
    excluding_vat: String,
    tourism_fee: String,
    muncipality_fee: String,
    service_charge: String,
  },
  { _id: false },
);

const AgreementSchema = new Schema(
  {
    contactName: String,
    contactDesignation: String,
    contactEmail: String,
    signedDate: Date,
    isAgreementSigned: Boolean,
    commissionHourly: Number,
    commissionMonthly: Number,
  },
  { _id: false },
);

const ContactInfoSchema = new Schema(
  {
    contact_person: { type: String, required: [true, 'Contact Person is required'] },
    legal_name: String,
    country: oid('countries'),
    city: oid('cities'),
    address_1: String,
    address_2: String,
    location: String,
    latlng: [Number],
    zip: String,
    email: { type: String, required: [true, 'Contact Email is required'] },
    mobile: String,
    land_phone: String,
    alt_land_phone: [String],
  },
  { _id: false },
);

const NearBySchema = new Schema({
  name: { type: String, required: [true, 'Nearby location is required'] },
  image: { type: String, default: null },
});

const ChargesSchema = new Schema(
  {
    name: String,
    id: String,
    chargeType: String,
    value: Number,
  },
  { _id: false },
);

export const PropertySchema = new Schema(
  {
    company: oid('hoteladmins'),
    administrator: { ...oid('Administrator'), required: [true, 'Administrator is required'] },
    allAdministrators: [oid('Administrator')],
    name: { type: String, required: [true, 'Property Name is required'] },
    type: oid('propertytypes'),
    rating: oid('propertyratings'),
    description: String,
    timeslots: [Number],
    trade_licence: TradeLicenceSchema,
    rooms: [oid('rooms')],
    policies: [oid('policies')],
    terms: [oid('terms')],
    images: [String],
    featured: [String],
    contactinfo: ContactInfoSchema,
    currency: { ...oid('currencies'), required: [true, 'Currency is required'] },
    primaryReservationEmail: { type: String, required: true },
    secondaryReservationEmails: { type: String, default: '' },
    weekends: {
      type: [String],
      enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    },
    anyTimeCheckin: { type: Boolean, default: true },
    approved: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    services: [oid('services')],
    payment: PaymentSchema,
    agreement: AgreementSchema,
    charges: [ChargesSchema],
    nearby: [NearBySchema],
    location: {
      address: { type: String, default: '' },
      type: { type: String, default: 'Point' },
      coordinates: [Number],
    },
    user_rating: Number,
    legal_name: String,
    status: { type: Boolean, default: true },
    // 'HyperGuest' = supplier-materialized property (phase 4, HYPERGUEST_PLAN.md D1).
    // Deliberately NOT matched by the dashboard's Extranet $or bucket.
    source: { type: String, enum: ['Website', 'Extranet', 'HyperGuest'], default: 'Extranet' },
    max_day_price_percentage_to_normal_price: Number,
  },
  { collection: 'properties', timestamps: true },
);

// Hot query paths for the admin listing (owner scoping + filters).
PropertySchema.index({ administrator: 1 });
PropertySchema.index({ allAdministrators: 1 });
PropertySchema.index({ 'contactinfo.country': 1 });
PropertySchema.index({ 'contactinfo.city': 1 });
PropertySchema.index({ approved: 1, published: 1 });
