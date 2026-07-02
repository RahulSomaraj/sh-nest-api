import { Schema, SchemaTypes } from 'mongoose';

/**
 * Authoritative schemas for the standard-CRUD resources. Model name (key) matches the
 * populate ref string used elsewhere (e.g. properties.type -> 'propertytypes'); the
 * `collection` is pinned to the legacy collection name. Registered once in
 * ReferenceModelsModule so both the CRUD modules and cross-module populate share them.
 */
const ts = { timestamps: true } as const;

export const countriesSchema = new Schema(
  { country: String, isd_code: String, image: String, timezone: { type: String, default: 'Asia/Dubai' } },
  { collection: 'countries', ...ts },
);

export const citiesSchema = new Schema(
  {
    name: String,
    image: String,
    country: { type: SchemaTypes.ObjectId, ref: 'countries' },
    featured: { type: Boolean, default: false },
  },
  { collection: 'cities', ...ts },
);

export const currenciesSchema = new Schema(
  { name: String, code: String, image: String },
  { collection: 'currencies', ...ts },
);

export const servicesSchema = new Schema(
  { name: String, image: String },
  { collection: 'services', ...ts },
);

export const propertyTypesSchema = new Schema(
  { name: String, image: String },
  { collection: 'property_types', ...ts },
);

export const propertyRatingsSchema = new Schema(
  { name: String, value: Number },
  { collection: 'property_ratings', ...ts },
);

export const policiesSchema = new Schema(
  { name: String, image: String },
  { collection: 'privacy_policies', ...ts },
);

export const termsSchema = new Schema(
  { value: String, image: String },
  { collection: 'terms_conditions', ...ts },
);

export const roomTypesSchema = new Schema(
  { name: String, image: String },
  { collection: 'room_types', ...ts },
);

export const roomNamesSchema = new Schema(
  { name: String, image: String },
  { collection: 'room_names', ...ts },
);

export const bedTypesSchema = new Schema(
  { name: String, image: String },
  { collection: 'bed_types', ...ts },
);

export const bedNumbersSchema = new Schema(
  { name: String, value: Number, image: String },
  { collection: 'bed_numbers', ...ts },
);

export const guestNumbersSchema = new Schema(
  { name: String, value: Number, childrenValue: Number, image: String },
  { collection: 'guest_numbers', ...ts },
);

export const faqSchema = new Schema(
  { title: String, description: String },
  { collection: 'faq', ...ts },
);

export const offersSchema = new Schema(
  { title: String, subtitle: String, image: String, link: String, enabled: { type: Boolean, default: false } },
  { collection: 'offers', ...ts },
);

export const promoCodesSchema = new Schema(
  { code: String, discount: Number },
  { collection: 'promocodes', ...ts },
);

export const termsAndConditionsSchema = new Schema(
  { description: String },
  { collection: 'termsandconditions', ...ts },
);

/** name -> schema, for MongooseModule.forFeature registration. */
export const crudSchemaModels = [
  { name: 'countries', schema: countriesSchema },
  { name: 'cities', schema: citiesSchema },
  { name: 'currencies', schema: currenciesSchema },
  { name: 'services', schema: servicesSchema },
  { name: 'propertytypes', schema: propertyTypesSchema },
  { name: 'propertyratings', schema: propertyRatingsSchema },
  { name: 'policies', schema: policiesSchema },
  { name: 'terms', schema: termsSchema },
  { name: 'room_types', schema: roomTypesSchema },
  { name: 'room_names', schema: roomNamesSchema },
  { name: 'bed_types', schema: bedTypesSchema },
  { name: 'bed_numbers', schema: bedNumbersSchema },
  { name: 'guest_numbers', schema: guestNumbersSchema },
  { name: 'faq', schema: faqSchema },
  { name: 'offers', schema: offersSchema },
  { name: 'promocodes', schema: promoCodesSchema },
  { name: 'termsandconditions', schema: termsAndConditionsSchema },
];
