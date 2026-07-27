/**
 * Full demo-data seeder: lookups, properties, rooms, users, administrators and
 * bookings — with real Unsplash images so the UI looks populated.
 *
 * Same pattern as seed-properties.ts: boots a headless Nest context so every
 * insert goes through the app's own Mongoose models (validation, hooks,
 * timestamps), reusing DatabaseModule's connection.
 *
 * Usage:
 *   npm run seed:all                 # seed everything (idempotent)
 *   npm run seed:all:clean           # remove exactly what this seeder created
 *   npm run seed:all -- --check-images   # HEAD-check every image URL, no writes
 *
 * Env: SEED_COUNT (properties, default 8), SEED_ALLOW_PROD.
 *
 * Idempotency / clean markers:
 *   properties + administrators → "[SEED] " name prefix
 *   users                       → @seed.stayhopper.local email domain
 *   rooms                       → property_id ∈ seeded properties
 *   bookings                    → book_id prefix "SH-SEED-"
 * Reference lookups are find-or-created and never cleaned (shared data).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';

const SEED_PREFIX = '[SEED] ';
const SEED_NAME_RE = /^\[SEED\] /;
const SEED_EMAIL_DOMAIN = 'seed.stayhopper.local';
const SEED_BOOK_RE = /^SH-SEED-/;

// ---------------------------------------------------------------------------
// Images — free Unsplash CDN URLs (hotlinking permitted, no API key needed)
// and randomuser.me portraits for avatars.
// ---------------------------------------------------------------------------
const img = (id: string, w = 1080): string =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

/** Hotel exteriors / pools / lobbies. */
const PROPERTY_IMAGES = [
  img('1566073771259-6a8506099945'), // resort pool
  img('1542314831-068cd1dbfeeb'), // hotel building
  img('1520250497591-112f2f40a3f4'), // beach resort
  img('1551882547-ff40c63fe5fa'), // hotel exterior
  img('1564501049412-61c2a3083791'), // hotel facade
  img('1571896349842-33c89424de2d'), // pool loungers
  img('1445019980597-93fa8acb246c'), // hotel terrace
  img('1584132967334-10e028bd69f7'), // resort walkway
];

/** Rooms / interiors. */
const ROOM_IMAGES = [
  img('1582719508461-905c673771fd'), // deluxe room
  img('1590490360182-c33d57733427'), // bed close-up
  img('1611892440504-42a792e24d32'), // modern room
  img('1618773928121-c32242e63f39'), // king bed
  img('1631049307264-da0ec9d70304'), // twin room
  img('1578683010236-d716f9a3f461'), // dark suite
  img('1560448204-e02f11c3d0e2'), // apartment
  img('1522708323590-d24dbb6b0267'), // living area
];

const CITY_IMAGES: Record<string, string> = {
  Dubai: img('1512453979798-5ea266f8880c', 800),
  'Abu Dhabi': img('1512632578888-169bbbc64f33', 800),
};

const AVATARS = [
  'https://randomuser.me/api/portraits/men/32.jpg',
  'https://randomuser.me/api/portraits/women/44.jpg',
  'https://randomuser.me/api/portraits/men/75.jpg',
  'https://randomuser.me/api/portraits/women/68.jpg',
  'https://randomuser.me/api/portraits/men/11.jpg',
];

const pick = <T>(arr: T[], i: number, n: number): T[] =>
  Array.from({ length: n }, (_, k) => arr[(i + k) % arr.length]);

// ---------------------------------------------------------------------------
// Name pools
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
];

const USER_POOL = [
  { name: 'Ali', last: 'Khan', gender: 'male', mobile: '+971551111101' },
  { name: 'Sara', last: 'Ahmed', gender: 'female', mobile: '+971551111102' },
  { name: 'John', last: 'Smith', gender: 'male', mobile: '+14155550101' },
  { name: 'Maria', last: 'Garcia', gender: 'female', mobile: '+971551111104' },
  { name: 'Omar', last: 'Hassan', gender: 'male', mobile: '+971551111105' },
];

const propertyName = (i: number): string => {
  const base = NAME_POOL[i % NAME_POOL.length];
  const cycle = Math.floor(i / NAME_POOL.length);
  return `${SEED_PREFIX}${base}${cycle ? ` ${cycle + 1}` : ''}`;
};

const slug = (name: string): string =>
  name.replace(SEED_NAME_RE, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// Production guard (same as seed-properties.ts)
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
    env === 'production' || env === 'prod' || /prod/i.test(dbName) || /prod/i.test(mongoUrl);
  if (looksProd) {
    throw new Error(
      `Refusing to seed: environment looks like production (NODE_ENV="${process.env.NODE_ENV}", db="${dbName}"). ` +
        `Set SEED_ALLOW_PROD=true to override.`,
    );
  }
  console.log(`✔ Production guard passed (NODE_ENV="${env}", db="${dbName}").`);
}

// ---------------------------------------------------------------------------
// Image URL checker (runs on this machine — no DB writes)
// ---------------------------------------------------------------------------
async function checkImages(): Promise<void> {
  const urls = [
    ...PROPERTY_IMAGES,
    ...ROOM_IMAGES,
    ...Object.values(CITY_IMAGES),
    ...AVATARS,
  ];
  console.log(`Checking ${urls.length} image URLs…`);
  let bad = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) {
        bad++;
        console.error(`  ✖ ${res.status} ${url}`);
      } else {
        console.log(`  ✔ ${res.status} ${url.slice(0, 80)}…`);
      }
    } catch (e) {
      bad++;
      console.error(`  ✖ FETCH FAILED ${url} (${(e as Error).message})`);
    }
  }
  if (bad) throw new Error(`${bad} image URL(s) unreachable — replace before seeding.`);
  console.log('\n✔ All image URLs resolve.');
}

/** Find one doc matching `filter`, otherwise create it. Backfills `image` if empty. */
async function findOrCreate(
  model: Model<any>,
  filter: Record<string, any>,
  create: Record<string, any>,
  label: string,
): Promise<Types.ObjectId> {
  const existing = await model.findOne(filter).exec();
  if (existing) {
    if (create.image && !existing.image) {
      await model.updateOne({ _id: existing._id }, { $set: { image: create.image } }).exec();
      console.log(`  · reused ${label} (image backfilled)`);
    } else {
      console.log(`  · reused ${label}: ${existing._id}`);
    }
    return existing._id;
  }
  const doc = await model.create({ ...filter, ...create });
  console.log(`  + created ${label}: ${doc._id}`);
  return doc._id;
}

// Rate band helper: hours map h0..h23 priced off a base 3-hour rate.
const hoursMap = (h3: number): Record<string, number> =>
  Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [`h${i}`, Math.round(h3 * ((i + 1) / 3) * 0.9)]),
  );

async function run(clean: boolean): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const get = <T = any>(token: string) =>
      app.get<Model<T>>(getModelToken(token), { strict: false });

    const propertyModel = get('properties');
    const roomModel = get('rooms');
    const userModel = get('users');
    const adminModel = get('Administrator');
    const activeBookingModel = get('userbookings');
    const completedBookingModel = get('completed_bookings');

    const conn = (propertyModel as any).db;
    assertNotProduction(conn?.client?.s?.url || process.env.MONGO_URL || '');

    // -- Clean ---------------------------------------------------------------
    if (clean) {
      const props = await propertyModel.find({ name: SEED_NAME_RE }, { _id: 1 }).lean().exec();
      const propIds = props.map((p: any) => p._id);
      const rooms = await roomModel.deleteMany({ property_id: { $in: propIds } }).exec();
      const active = await activeBookingModel.deleteMany({ book_id: SEED_BOOK_RE }).exec();
      const completed = await completedBookingModel.deleteMany({ book_id: SEED_BOOK_RE }).exec();
      const users = await userModel
        .deleteMany({ email: new RegExp(`@${SEED_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`) })
        .exec();
      const admins = await adminModel.deleteMany({ name: SEED_NAME_RE }).exec();
      const propsRes = await propertyModel.deleteMany({ name: SEED_NAME_RE }).exec();
      console.log(
        `\n🧹 Cleaned: ${propsRes.deletedCount} properties, ${rooms.deletedCount} rooms, ` +
          `${users.deletedCount} users, ${admins.deletedCount} administrators, ` +
          `${active.deletedCount} active + ${completed.deletedCount} completed bookings.`,
      );
      console.log('ℹ  Reference lookups left intact — shared reference data.');
      return;
    }

    const seedCount = Math.max(1, parseInt(process.env.SEED_COUNT || '', 10) || 8);
    console.log(`\nSeeding ${seedCount} properties + rooms, users, bookings…\n`);

    // -- 1. Reference lookups (with images) ----------------------------------
    console.log('Ensuring reference lookups:');
    const countryModel = get('countries');
    const cityModel = get('cities');
    const currencyModel = get('currencies');
    const typeModel = get('propertytypes');
    const ratingModel = get('propertyratings');
    const policyModel = get('policies');
    const termModel = get('terms');
    const serviceModel = get('services');
    const roomTypeModel = get('room_types');
    const roomNameModel = get('room_names');
    const bedTypeModel = get('bed_types');
    const guestNumberModel = get('guest_numbers');

    const uaeId = await findOrCreate(
      countryModel,
      { country: 'United Arab Emirates' },
      { isd_code: '+971', timezone: 'Asia/Dubai', image: CITY_IMAGES['Dubai'] },
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
      { country: uaeId, featured: true, image: CITY_IMAGES['Dubai'] },
      'city Dubai',
    );
    const abuDhabiId = await findOrCreate(
      cityModel,
      { name: 'Abu Dhabi' },
      { country: uaeId, featured: true, image: CITY_IMAGES['Abu Dhabi'] },
      'city Abu Dhabi',
    );
    const cityIds = [dubaiId, abuDhabiId];

    const typeIds = [
      await findOrCreate(typeModel, { name: 'Hotel' }, { image: PROPERTY_IMAGES[3] }, 'type Hotel'),
      await findOrCreate(
        typeModel,
        { name: 'Hotel Apartment' },
        { image: ROOM_IMAGES[6] },
        'type Hotel Apartment',
      ),
    ];
    const ratingIds = [
      await findOrCreate(ratingModel, { value: 3 }, { name: '3 Star' }, 'rating 3★'),
      await findOrCreate(ratingModel, { value: 4 }, { name: '4 Star' }, 'rating 4★'),
      await findOrCreate(ratingModel, { value: 5 }, { name: '5 Star' }, 'rating 5★'),
    ];
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
      await findOrCreate(serviceModel, { name: 'Swimming Pool' }, { image: '' }, 'service Pool'),
      await findOrCreate(serviceModel, { name: 'Gym' }, { image: '' }, 'service Gym'),
    ];
    const roomTypeIds = [
      await findOrCreate(roomTypeModel, { name: 'Standard' }, { image: ROOM_IMAGES[0] }, 'room type Standard'),
      await findOrCreate(roomTypeModel, { name: 'Deluxe' }, { image: ROOM_IMAGES[2] }, 'room type Deluxe'),
      await findOrCreate(roomTypeModel, { name: 'Suite' }, { image: ROOM_IMAGES[5] }, 'room type Suite'),
    ];
    const roomNameIds = [
      await findOrCreate(roomNameModel, { name: 'Single Room' }, { image: '' }, 'room name Single'),
      await findOrCreate(roomNameModel, { name: 'Double Room' }, { image: '' }, 'room name Double'),
      await findOrCreate(roomNameModel, { name: 'Executive Suite' }, { image: '' }, 'room name Suite'),
    ];
    const bedTypeIds = [
      await findOrCreate(bedTypeModel, { name: 'Single' }, { image: '' }, 'bed Single'),
      await findOrCreate(bedTypeModel, { name: 'Double' }, { image: '' }, 'bed Double'),
      await findOrCreate(bedTypeModel, { name: 'King' }, { image: '' }, 'bed King'),
    ];
    const guestNumberIds = [
      await findOrCreate(guestNumberModel, { value: 1 }, { name: '1 Guest', childrenValue: 0, image: '' }, 'guests 1'),
      await findOrCreate(guestNumberModel, { value: 2 }, { name: '2 Guests', childrenValue: 1, image: '' }, 'guests 2'),
      await findOrCreate(guestNumberModel, { value: 4 }, { name: '4 Guests', childrenValue: 2, image: '' }, 'guests 4'),
    ];

    // -- 2. Administrator (property owner) -----------------------------------
    let adminId: Types.ObjectId | undefined = (
      await adminModel.findOne({ name: SEED_NAME_RE }).exec()
    )?._id;
    if (!adminId) {
      const adm = await adminModel.create({
        name: `${SEED_PREFIX}Seed Administrator`,
        email: `seed.admin@${SEED_EMAIL_DOMAIN}`,
        password: bcrypt.hashSync('admin123', 10),
        status: true,
        contact_person: 'Seed Owner',
        legal_name: 'Seed Hospitality LLC',
        country: uaeId,
        city: dubaiId,
        mobile: '+971500000000',
      });
      adminId = adm._id;
      console.log(`  + created administrator (owner): ${adminId} (admin123)`);
    } else {
      console.log(`  · reused administrator (owner): ${adminId}`);
    }

    // -- 3. Users (avatars from randomuser.me) --------------------------------
    console.log('\nInserting users:');
    const userPassword = bcrypt.hashSync('user123', 10);
    const userIds: Types.ObjectId[] = [];
    for (let i = 0; i < USER_POOL.length; i++) {
      const u = USER_POOL[i];
      const email = `${u.name.toLowerCase()}.${u.last.toLowerCase()}@${SEED_EMAIL_DOMAIN}`;
      const existing = await userModel.findOne({ email }).exec();
      if (existing) {
        userIds.push(existing._id);
        console.log(`  · skipped (exists): ${email}`);
        continue;
      }
      const doc = await userModel.create({
        name: u.name,
        last_name: u.last,
        email,
        mobile: u.mobile,
        gender: u.gender,
        country: 'United Arab Emirates',
        city: i % 2 ? 'Abu Dhabi' : 'Dubai',
        country_id: uaeId,
        city_id: cityIds[i % 2],
        image: AVATARS[i % AVATARS.length],
        isGuestUser: 0,
        password: userPassword,
        status: 1,
        deleted: false,
        favourites: [],
      });
      userIds.push(doc._id);
      console.log(`  + created user: ${email} (user123)`);
    }

    // -- 4. Properties + rooms (with Unsplash images) --------------------------
    console.log('\nInserting properties + rooms:');
    const propertyIds: Types.ObjectId[] = [];
    const roomIdsByProperty: Types.ObjectId[][] = [];

    for (let i = 0; i < seedCount; i++) {
      const name = propertyName(i);
      const existing = await propertyModel.findOne({ name }).exec();
      if (existing) {
        propertyIds.push(existing._id);
        roomIdsByProperty.push((existing.rooms || []) as Types.ObjectId[]);
        console.log(`  · skipped (exists): ${name}`);
        continue;
      }

      const s = slug(name);
      const cityId = cityIds[i % cityIds.length];
      const lng = 55.27 + (i % 5) * 0.01;
      const lat = 25.2 + (i % 5) * 0.01;
      const images = pick(PROPERTY_IMAGES, i, 4);

      const prop = await propertyModel.create({
        name,
        legal_name: `${name.replace(SEED_NAME_RE, '')} LLC`,
        description: `${name.replace(SEED_NAME_RE, '')} — comfortable, well-located stays with modern amenities.`,
        administrator: adminId,
        allAdministrators: [adminId],
        company: null,
        type: typeIds[i % typeIds.length],
        rating: ratingIds[i % ratingIds.length],
        currency: aedId,
        timeslots: [3, 6, 12, 24],
        contactinfo: {
          contact_person: 'Front Desk',
          legal_name: `${name.replace(SEED_NAME_RE, '')} LLC`,
          country: uaeId,
          city: cityId,
          address_1: `${100 + i} Sheikh Zayed Road`,
          address_2: 'Downtown',
          location: 'Downtown',
          latlng: [lat, lng],
          zip: '00000',
          email: `info.${s}@${SEED_EMAIL_DOMAIN}`,
          mobile: '+9715400000' + String(i).padStart(2, '0'),
          land_phone: '+97140000000',
          alt_land_phone: [],
        },
        trade_licence: {
          trade_licence_number: `TL-SEED-${1000 + i}`,
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
          contactEmail: `owner.${s}@${SEED_EMAIL_DOMAIN}`,
          isAgreementSigned: true,
          commissionHourly: 15,
          commissionMonthly: 12,
        },
        primaryReservationEmail: `reservations.${s}@${SEED_EMAIL_DOMAIN}`,
        secondaryReservationEmails: '',
        weekends: ['fri', 'sat'],
        anyTimeCheckin: true,
        policies: policyIds,
        terms: termIds,
        services: serviceIds,
        rooms: [],
        nearby: [
          { name: 'Dubai Mall', image: PROPERTY_IMAGES[(i + 1) % PROPERTY_IMAGES.length] },
          { name: 'Metro Station', image: null },
        ],
        charges: [
          { name: 'VAT', id: 'vat', chargeType: 'percentage', value: 5 },
          { name: 'Tourism Fee', id: 'tourism_fee', chargeType: 'fixed', value: 15 },
        ],
        images,
        featured: [images[0]],
        published: true,
        approved: true,
        status: true,
        source: 'Extranet',
        user_rating: 4 + ((i % 10) / 10),
        location: { address: 'Downtown', type: 'Point', coordinates: [lng, lat] },
        max_day_price_percentage_to_normal_price: 150,
      });
      propertyIds.push(prop._id);
      console.log(`  + created property: ${name}`);

      // Two rooms per property.
      const roomIds: Types.ObjectId[] = [];
      for (let r = 0; r < 2; r++) {
        const baseH3 = 120 + i * 20 + r * 60;
        const roomImages = pick(ROOM_IMAGES, i * 2 + r, 3);
        const room = await roomModel.create({
          property_id: prop._id,
          room_type: roomTypeIds[(i + r) % roomTypeIds.length],
          room_name: roomNameIds[(i + r) % roomNameIds.length],
          bed_type: bedTypeIds[(i + r) % bedTypeIds.length],
          number_of_guests: guestNumberIds[(i + r) % guestNumberIds.length],
          custom_name: r === 0 ? 'Deluxe Double' : 'Executive Suite',
          number_rooms: 10 - r * 4,
          number_guests: 2 + r * 2,
          number_beds: 1 + r,
          extrabed_option: r === 1,
          extrabed_number: r,
          amount_extrabed: r ? 50 : 0,
          room_size: r ? '45 sqm' : '28 sqm',
          extraslot_cleaning: 1,
          hours_cleaning: 1,
          price: { h3: baseH3, h6: baseH3 * 1.6, h12: baseH3 * 2.4, h24: baseH3 * 3.2 },
          rates: [
            {
              name: 'Standard Rate',
              isDefault: true,
              rateType: 'hourly',
              recurring: true,
              minimumBookingRate: baseH3,
              weekday: { fullDay: baseH3 * 3.2, standardDay: baseH3 * 2.4, hours: hoursMap(baseH3) },
              weekend: {
                fullDay: baseH3 * 3.6,
                standardDay: baseH3 * 2.8,
                hours: hoursMap(Math.round(baseH3 * 1.15)),
              },
            },
          ],
          services: serviceIds.slice(0, 2 + r),
          images: roomImages,
          featured: [roomImages[0]],
        });
        roomIds.push(room._id);
      }
      await propertyModel.updateOne({ _id: prop._id }, { $set: { rooms: roomIds } }).exec();
      roomIdsByProperty.push(roomIds);
      console.log(`    + ${roomIds.length} rooms (images + rates)`);
    }

    // -- 5. Bookings -----------------------------------------------------------
    console.log('\nInserting bookings:');
    const bookingCount = Math.min(5, propertyIds.length);
    for (let i = 0; i < bookingCount; i++) {
      const bookId = `SH-SEED-${1001 + i}`;
      if (await activeBookingModel.exists({ book_id: bookId })) {
        console.log(`  · skipped (exists): ${bookId}`);
        continue;
      }
      const user = USER_POOL[i % USER_POOL.length];
      const roomId = roomIdsByProperty[i]?.[0];
      if (!roomId) continue;
      const hotelAmt = 250 + i * 40;
      const paid = i % 3 === 0 ? 0 : 1;
      const checkin = new Date();
      checkin.setDate(checkin.getDate() + 2 + i);
      checkin.setHours(14, 0, 0, 0);
      const checkout = new Date(checkin.getTime() + 6 * 3600 * 1000);
      const dateStr = (d: Date) => d.toISOString().slice(0, 10);

      await activeBookingModel.create({
        book_id: bookId,
        user: userIds[i % userIds.length],
        property: propertyIds[i],
        room: [{ room: roomId, number: 1 }],
        bookingType: 'hourly',
        status: 'active',
        platform: 'app',
        checkin_date: dateStr(checkin),
        checkin_time: '14:00',
        checkout_date: dateStr(checkout),
        checkout_time: '20:00',
        date_checkin: checkin,
        date_checkout: checkout,
        date_booked: new Date(),
        stayDuration: '6 hours',
        selected_hours: 6,
        no_of_adults: 2,
        no_of_children: 0,
        tax: Math.round(hotelAmt * 0.05),
        bookingFee: 30,
        discount: 0,
        hotelAmt,
        total_amt: Math.round(hotelAmt * 1.3),
        paymentAmt: Math.round(hotelAmt * 0.3),
        currencyCode: 'AED',
        paid,
        hotel_approved: paid,
        abandoned: 0,
        cancel_request: 0,
        charge_uid: paid ? `ch_${bookId}` : undefined,
        guestinfo: {
          title: user.gender === 'male' ? 'Mr' : 'Ms',
          first_name: user.name,
          last_name: user.last,
          nationality: 'United Arab Emirates',
          city: 'Dubai',
          email: `${user.name.toLowerCase()}.${user.last.toLowerCase()}@${SEED_EMAIL_DOMAIN}`,
          mobile: user.mobile,
        },
      });
      console.log(`  + active booking ${bookId} (paid=${paid})`);
    }

    for (let i = 0; i < Math.min(3, propertyIds.length); i++) {
      const bookId = `SH-SEED-${901 + i}`;
      if (await completedBookingModel.exists({ book_id: bookId })) {
        console.log(`  · skipped (exists): ${bookId}`);
        continue;
      }
      const user = USER_POOL[(i + 2) % USER_POOL.length];
      const hotelAmt = 220 + i * 50;
      await completedBookingModel.create({
        book_id: bookId,
        user: userIds[(i + 2) % userIds.length],
        bookingType: 'hourly',
        status: 'completed',
        propertyInfo: { id: propertyIds[i], name: propertyName(i).replace(SEED_NAME_RE, '') },
        roomsInfo: [{ name: 'Deluxe Double', number: 1 }],
        checkin_date: '2026-06-20',
        checkin_time: '13:00',
        checkout_date: '2026-06-20',
        checkout_time: '19:00',
        stayDuration: '6 hours',
        no_of_adults: 2,
        no_of_children: 0,
        bookingFee: 30,
        discount: 0,
        hotelAmt,
        total_amt: Math.round(hotelAmt * 1.3),
        paymentAmt: Math.round(hotelAmt * 0.3),
        currencyCode: 'AED',
        paid: 1,
        guestinfo: {
          first_name: user.name,
          last_name: user.last,
          email: `${user.name.toLowerCase()}.${user.last.toLowerCase()}@${SEED_EMAIL_DOMAIN}`,
          mobile: user.mobile,
        },
      });
      console.log(`  + completed booking ${bookId}`);
    }

    // -- 6. Verify ---------------------------------------------------------------
    const totals = {
      properties: await propertyModel.countDocuments({ name: SEED_NAME_RE }),
      withImages: await propertyModel.countDocuments({ name: SEED_NAME_RE, 'images.0': { $exists: true } }),
      rooms: await roomModel.countDocuments({ property_id: { $in: propertyIds } }),
      users: await userModel.countDocuments({ email: new RegExp(`@${SEED_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`) }),
      active: await activeBookingModel.countDocuments({ book_id: SEED_BOOK_RE }),
      completed: await completedBookingModel.countDocuments({ book_id: SEED_BOOK_RE }),
    };
    console.log('\n─── Summary ───────────────────────────────────');
    console.log(`properties: ${totals.properties} (${totals.withImages} with images)`);
    console.log(`rooms: ${totals.rooms}   users: ${totals.users}`);
    console.log(`bookings: ${totals.active} active + ${totals.completed} completed`);
    console.log('\nLogins: seed.admin@seed.stayhopper.local / admin123 (extranet)');
    console.log('        <firstname>.<lastname>@seed.stayhopper.local / user123 (customer)');
    console.log('\n✔ Done. Re-run is safe. Clean with: npm run seed:all:clean');
  } finally {
    await app.close();
  }
}

const argv = process.argv.slice(2);
const main = argv.includes('--check-images') ? checkImages() : run(argv.includes('--clean'));
main
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✖ Seeder failed:', err?.message || err);
    console.error(err?.stack);
    process.exit(1);
  });
