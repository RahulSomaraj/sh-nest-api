/**
 * Idempotent, env-driven seeder for the `properties` collection (+ the reference
 * lookups it depends on). Inserts through the app's own Mongoose models — it boots a
 * headless Nest application context (NestFactory.createApplicationContext) so it reuses
 * DatabaseModule's connection and every schema registered in ReferenceModelsModule.
 * Nothing goes through the HTTP API, and all schema validation / hooks / timestamps run.
 *
 * Usage:
 *   npm run seed:properties          # ensure lookups, insert SEED_COUNT (default 10) properties
 *   npm run seed:properties:clean    # remove exactly the rows this seeder created
 *
 * Config (env, resolved from .env via ConfigModule):
 *   SEED_COUNT      number of properties to seed (default 10)
 *   SEED_ALLOW_PROD set to "true" to bypass the production guard (not recommended)
 *
 * Seeded rows are tagged with a "[SEED] " name prefix + source 'Extranet' so re-running
 * never duplicates and the clean step removes exactly what was created. Reference lookups
 * (countries/cities/currencies/property-types/ratings/...) are find-or-created: an
 * existing matching row is reused, otherwise a minimal standard row is inserted. The clean
 * step deliberately leaves lookups in place — they are shared reference data that real
 * rows may also point at.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';

const SEED_PREFIX = '[SEED] ';
const SEED_NAME_RE = /^\[SEED\] /;

// ---------------------------------------------------------------------------
// Realistic property name pool (all get the [SEED] prefix at insert time).
// ---------------------------------------------------------------------------
const NAME_POOL = [
  'Grand Marina Hotel',
  'Palm Oasis Resort',
  'Downtown City Suites',
  'Al Barsha Boutique Hotel',
  'Jumeirah Beach Residences',
  'Silver Sands Apartments',
  'Desert Pearl Hotel',
  'Corniche Bay Resort',
  'Business Bay Towers',
  'Golden Dune Guest House',
  'Marina Skyline Hotel',
  'Emerald Coast Resort',
  'Metro Central Apartments',
  'Rose Garden Hotel',
  'Harbour View Suites',
];

const propertyName = (i: number): string => {
  const base = NAME_POOL[i % NAME_POOL.length];
  const cycle = Math.floor(i / NAME_POOL.length);
  return `${SEED_PREFIX}${base}${cycle ? ` ${cycle + 1}` : ''}`;
};

const slug = (name: string): string =>
  name.replace(SEED_NAME_RE, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// Production guard: refuse to run against anything that looks like prod.
// ---------------------------------------------------------------------------
function assertNotProduction(mongoUrl: string): void {
  if (process.env.SEED_ALLOW_PROD === 'true') {
    console.warn('⚠  SEED_ALLOW_PROD=true — production guard bypassed.');
    return;
  }
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const dbName = (() => {
    try {
      return decodeURIComponent(new URL(mongoUrl).pathname.replace(/^\//, ''));
    } catch {
      return '';
    }
  })();
  const looksProd =
    env === 'production' ||
    env === 'prod' ||
    /prod/i.test(dbName) ||
    /prod/i.test(mongoUrl);
  if (looksProd) {
    throw new Error(
      `Refusing to seed: environment looks like production (NODE_ENV="${process.env.NODE_ENV}", db="${dbName}"). ` +
        `Set SEED_ALLOW_PROD=true to override.`,
    );
  }
  console.log(`✔ Production guard passed (NODE_ENV="${env}", db="${dbName}").`);
}

/** Find one doc matching `filter`, otherwise create it with `create`. */
async function findOrCreate(
  model: Model<any>,
  filter: Record<string, any>,
  create: Record<string, any>,
  label: string,
): Promise<Types.ObjectId> {
  const existing = await model.findOne(filter).exec();
  if (existing) {
    console.log(`  · reused ${label}: ${existing._id}`);
    return existing._id;
  }
  const doc = await model.create({ ...filter, ...create });
  console.log(`  + created ${label}: ${doc._id}`);
  return doc._id;
}

async function run(clean: boolean): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    // Resolve models straight off the shared connection (strict:false lets the
    // context resolver find providers registered in any feature module).
    const get = <T = any>(token: string) =>
      app.get<Model<T>>(getModelToken(token), { strict: false });

    const propertyModel = get('properties');
    const conn = (propertyModel as any).db;
    assertNotProduction(conn?.client?.s?.url || process.env.MONGO_URL || '');

    if (clean) {
      const propRes = await propertyModel.deleteMany({ name: SEED_NAME_RE }).exec();
      const adminModel = get('Administrator');
      const admRes = await adminModel.deleteMany({ name: SEED_NAME_RE }).exec();
      console.log(
        `\n🧹 Cleaned: ${propRes.deletedCount} seeded properties, ${admRes.deletedCount} seeded administrators removed.`,
      );
      console.log(
        'ℹ  Reference lookups (countries/cities/currencies/types/ratings/...) left intact — shared reference data.',
      );
      return;
    }

    const seedCount = Math.max(1, parseInt(process.env.SEED_COUNT || '', 10) || 10);
    console.log(`\nSeeding ${seedCount} properties…\n`);

    // -- 1. Ensure dependency lookups ---------------------------------------
    console.log('Ensuring reference lookups:');
    const countryModel = get('countries');
    const cityModel = get('cities');
    const currencyModel = get('currencies');
    const typeModel = get('propertytypes');
    const ratingModel = get('propertyratings');
    const policyModel = get('policies');
    const termModel = get('terms');
    const serviceModel = get('services');
    const adminModel = get('Administrator');

    const uaeId = await findOrCreate(
      countryModel,
      { country: 'United Arab Emirates' },
      { isd_code: '+971', timezone: 'Asia/Dubai', image: '' },
      'country UAE',
    );
    const aedId = await findOrCreate(
      currencyModel,
      { code: 'AED' },
      { name: 'UAE Dirham', image: '' },
      'currency AED',
    );
    const dubaiId = await findOrCreate(
      cityModel,
      { name: 'Dubai' },
      { country: uaeId, featured: true, image: '' },
      'city Dubai',
    );
    const typeIds = [
      await findOrCreate(typeModel, { name: 'Hotel' }, { image: '' }, 'type Hotel'),
      await findOrCreate(
        typeModel,
        { name: 'Hotel Apartment' },
        { image: '' },
        'type Hotel Apartment',
      ),
    ];
    const ratingIds = [
      await findOrCreate(ratingModel, { value: 3 }, { name: '3 Star' }, 'rating 3★'),
      await findOrCreate(ratingModel, { value: 5 }, { name: '5 Star' }, 'rating 5★'),
    ];
    // Optional lookups (arrays on the property) — a minimal set.
    const policyIds = [
      await findOrCreate(
        policyModel,
        { name: 'Free cancellation up to 24h before check-in' },
        { image: '' },
        'policy cancellation',
      ),
    ];
    const termIds = [
      await findOrCreate(
        termModel,
        { value: 'Check-in from 14:00, check-out by 12:00' },
        { image: '' },
        'term check-in',
      ),
    ];
    const serviceIds = [
      await findOrCreate(serviceModel, { name: 'Free WiFi' }, { image: '' }, 'service WiFi'),
      await findOrCreate(serviceModel, { name: 'Parking' }, { image: '' }, 'service Parking'),
    ];

    // A seeded administrator to own the properties (administrator is required).
    // Reuse an existing seeded admin if present so re-runs don't pile them up.
    let adminId: Types.ObjectId = (
      await adminModel.findOne({ name: SEED_NAME_RE }).exec()
    )?._id;
    if (!adminId) {
      const adm = await adminModel.create({
        name: `${SEED_PREFIX}Seed Administrator`,
        email: `seed.admin.${slug('owner')}@seed.stayhopper.local`,
        // bcrypt hash of "admin123" (same demo hash used by docker seed).
        password: '$2b$10$KD2a6fU/bl22kwx7pv08f.Wyd9D0B4qzY0.vKl7DkyuXl50EBHQTi',
        status: true,
        contact_person: 'Seed Owner',
        legal_name: 'Seed Hospitality LLC',
        country: uaeId,
        city: dubaiId,
        mobile: '+971500000000',
      });
      adminId = adm._id;
      console.log(`  + created administrator (owner): ${adminId}`);
    } else {
      console.log(`  · reused administrator (owner): ${adminId}`);
    }

    // -- 2. Insert N properties (idempotent by name) ------------------------
    console.log('\nInserting properties:');
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < seedCount; i++) {
      const name = propertyName(i);
      if (await propertyModel.exists({ name })) {
        skipped++;
        console.log(`  · skipped (exists): ${name}`);
        continue;
      }

      const s = slug(name);
      const type = typeIds[i % typeIds.length];
      const rating = ratingIds[i % ratingIds.length];
      // Spread coordinates a little around Dubai so they're not all identical.
      const lng = 55.27 + (i % 5) * 0.01;
      const lat = 25.2 + (i % 5) * 0.01;

      await propertyModel.create({
        name,
        legal_name: `${name.replace(SEED_NAME_RE, '')} LLC`,
        description: `${name.replace(SEED_NAME_RE, '')} — comfortable, well-located stays with modern amenities.`,
        administrator: adminId,
        allAdministrators: [adminId],
        company: null,
        type,
        rating,
        currency: aedId,
        timeslots: [3, 6, 12, 24],
        contactinfo: {
          contact_person: 'Front Desk',
          legal_name: `${name.replace(SEED_NAME_RE, '')} LLC`,
          country: uaeId, // required ref
          city: dubaiId,
          address_1: `${100 + i} Sheikh Zayed Road`,
          address_2: 'Downtown',
          location: 'Downtown',
          latlng: [lat, lng],
          zip: '00000',
          email: `info.${s}@seed.stayhopper.local`, // required
          mobile: '+9715400000' + String(i).padStart(2, '0'),
          land_phone: '+97140000000',
          alt_land_phone: [],
        },
        trade_licence: {
          trade_licence_number: `TL-SEED-${String(1000 + i)}`,
          trade_licence_attachment: '',
          trade_licence_validity: '2027-12-31',
          passport_attachment: '',
        },
        payment: {
          name: 'Seed Owner',
          country: uaeId,
          bank: 'Emirates NBD',
          branch: 'Downtown',
          account_no: `000${1000 + i}`,
          ifsc: '',
          currency: aedId,
          tax: '5',
        },
        agreement: {
          contactName: 'Seed Owner',
          contactEmail: `owner.${s}@seed.stayhopper.local`,
          isAgreementSigned: true,
          commissionHourly: 15,
          commissionMonthly: 12,
        },
        primaryReservationEmail: `reservations.${s}@seed.stayhopper.local`, // required
        secondaryReservationEmails: '',
        weekends: ['fri', 'sat'],
        anyTimeCheckin: true,
        policies: policyIds,
        terms: termIds,
        services: serviceIds,
        rooms: [],
        nearby: [],
        charges: [
          { name: 'VAT', id: 'vat', chargeType: 'percentage', value: 5 },
          { name: 'Tourism Fee', id: 'tourism_fee', chargeType: 'fixed', value: 15 },
        ],
        images: [],
        featured: [],
        published: true,
        approved: true,
        status: true,
        source: 'Extranet',
        user_rating: i % 2 === 0 ? 4.8 : 4.2,
        location: {
          address: 'Downtown',
          type: 'Point',
          coordinates: [lng, lat], // GeoJSON: [lng, lat]
        },
        max_day_price_percentage_to_normal_price: 150,
      });
      created++;
      console.log(`  + created: ${name}`);
    }

    // -- 3. Verify ----------------------------------------------------------
    const total = await propertyModel.countDocuments({ name: SEED_NAME_RE });
    const withType = await propertyModel.countDocuments({
      name: SEED_NAME_RE,
      type: { $ne: null },
    });
    const withCountry = await propertyModel.countDocuments({
      name: SEED_NAME_RE,
      'contactinfo.country': { $ne: null },
    });

    console.log('\n─── Summary ───────────────────────────────────');
    console.log(`created: ${created}   skipped (already existed): ${skipped}`);
    console.log(`total seeded properties in DB: ${total}`);
    console.log(`  with a valid type:               ${withType}/${total}`);
    console.log(`  with a valid contactinfo.country: ${withCountry}/${total}`);

    const sample = await propertyModel
      .find({ name: SEED_NAME_RE })
      .populate('type', 'name')
      .populate('contactinfo.country', 'country')
      .populate('currency', 'code')
      .limit(2)
      .lean()
      .exec();
    console.log('\nSample inserted docs:');
    for (const p of sample) {
      console.log(
        JSON.stringify(
          {
            _id: p._id,
            name: p.name,
            type: p.type,
            rating: p.rating,
            currency: p.currency,
            country: p.contactinfo?.country,
            city: p.contactinfo?.city,
            location: p.location,
            published: p.published,
            approved: p.approved,
            source: p.source,
          },
          null,
          2,
        ),
      );
    }
    console.log('\n✔ Done. Re-run is safe (idempotent). Clean with: npm run seed:properties:clean');
  } finally {
    await app.close();
  }
}

const isClean = process.argv.includes('--clean');
run(isClean)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✖ Seeder failed:', err?.message || err);
    console.error(err?.stack);
    process.exit(1);
  });
