/**
 * Seed logically-connected demo data for every admin list/dashboard endpoint.
 * Runs once, after 01-init.js, on first DB init (empty volume). Re-run with
 * `docker compose down -v && docker compose up -d --build`.
 *
 * Collections mirror the Mongoose schemas (legacy collection names):
 *   master data -> countries, cities, currencies, services, property_types,
 *     property_ratings, privacy_policies, terms_conditions, room_types,
 *     room_names, bed_types, bed_numbers, guest_numbers, faq, offers,
 *     promocodes, termsandconditions
 *   core        -> roles, administrators, properties, rooms, users
 *   transactional -> userbookings, completed_bookings, invoices, userratings
 *   config      -> app_version
 */

// The init context connects to MONGO_INITDB_DATABASE (=stayhopper), so the
// global `db` already points at the app database.
const now = new Date();
const oid = () => new ObjectId();
// bcrypt hash of "admin123" (shared demo password for seeded users).
const PW = '$2b$10$KD2a6fU/bl22kwx7pv08f.Wyd9D0B4qzY0.vKl7DkyuXl50EBHQTi';
const stamp = (o) => Object.assign({ createdAt: now, updatedAt: now }, o);

// ---------------------------------------------------------------------------
// IDs (declared up-front so documents can reference each other)
// ---------------------------------------------------------------------------
const id = {
  // countries
  uae: oid(), india: oid(), ksa: oid(),
  // currencies
  aed: oid(), usd: oid(), inr: oid(), sar: oid(),
  // cities
  dubai: oid(), abudhabi: oid(), sharjah: oid(), mumbai: oid(),
  // property types
  ptHotel: oid(), ptApartment: oid(), ptResort: oid(), ptGuest: oid(),
  // property ratings
  pr3: oid(), pr4: oid(), pr5: oid(),
  // room types
  rtStandard: oid(), rtDeluxe: oid(), rtSuite: oid(),
  // room names
  rnSingle: oid(), rnDouble: oid(), rnTwin: oid(),
  // bed types
  btSingle: oid(), btDouble: oid(), btKing: oid(), btQueen: oid(),
  // bed numbers
  bn1: oid(), bn2: oid(), bn3: oid(),
  // guest numbers
  gn2: oid(), gn3: oid(), gn4: oid(),
  // services
  svWifi: oid(), svParking: oid(), svPool: oid(), svGym: oid(), svBreakfast: oid(), svAc: oid(), svSpa: oid(),
  // policies / terms
  polCancel: oid(), polPet: oid(), polSmoking: oid(),
  tcCheckin: oid(), tcId: oid(),
  // roles
  roleHotelAdmin: oid(), roleReceptionist: oid(),
  // administrators (hotel-admin companies)
  admAcme: oid(), admOasis: oid(),
  // properties
  propGrand: oid(), propOasis: oid(), propCity: oid(),
  // rooms
  roomG1: oid(), roomG2: oid(), roomO1: oid(), roomO2: oid(), roomC1: oid(),
  // users
  userAli: oid(), userSara: oid(), userJohn: oid(), userMaria: oid(),
  // bookings
  ubA: oid(), ubB: oid(), ubC: oid(), cbA: oid(), cbB: oid(),
};

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------
db.countries.insertMany([
  stamp({ _id: id.uae, country: 'United Arab Emirates', isd_code: '+971', timezone: 'Asia/Dubai', image: '' }),
  stamp({ _id: id.india, country: 'India', isd_code: '+91', timezone: 'Asia/Kolkata', image: '' }),
  stamp({ _id: id.ksa, country: 'Saudi Arabia', isd_code: '+966', timezone: 'Asia/Riyadh', image: '' }),
]);

db.currencies.insertMany([
  stamp({ _id: id.aed, name: 'UAE Dirham', code: 'AED', image: '' }),
  stamp({ _id: id.usd, name: 'US Dollar', code: 'USD', image: '' }),
  stamp({ _id: id.inr, name: 'Indian Rupee', code: 'INR', image: '' }),
  stamp({ _id: id.sar, name: 'Saudi Riyal', code: 'SAR', image: '' }),
]);

db.cities.insertMany([
  stamp({ _id: id.dubai, name: 'Dubai', country: id.uae, featured: true, image: '' }),
  stamp({ _id: id.abudhabi, name: 'Abu Dhabi', country: id.uae, featured: true, image: '' }),
  stamp({ _id: id.sharjah, name: 'Sharjah', country: id.uae, featured: false, image: '' }),
  stamp({ _id: id.mumbai, name: 'Mumbai', country: id.india, featured: false, image: '' }),
]);

db.property_types.insertMany([
  stamp({ _id: id.ptHotel, name: 'Hotel', image: '' }),
  stamp({ _id: id.ptApartment, name: 'Hotel Apartment', image: '' }),
  stamp({ _id: id.ptResort, name: 'Resort', image: '' }),
  stamp({ _id: id.ptGuest, name: 'Guest House', image: '' }),
]);

db.property_ratings.insertMany([
  stamp({ _id: id.pr3, name: '3 Star', value: 3 }),
  stamp({ _id: id.pr4, name: '4 Star', value: 4 }),
  stamp({ _id: id.pr5, name: '5 Star', value: 5 }),
]);

db.room_types.insertMany([
  stamp({ _id: id.rtStandard, name: 'Standard', image: '' }),
  stamp({ _id: id.rtDeluxe, name: 'Deluxe', image: '' }),
  stamp({ _id: id.rtSuite, name: 'Suite', image: '' }),
]);

db.room_names.insertMany([
  stamp({ _id: id.rnSingle, name: 'Single Room', image: '' }),
  stamp({ _id: id.rnDouble, name: 'Double Room', image: '' }),
  stamp({ _id: id.rnTwin, name: 'Twin Room', image: '' }),
]);

db.bed_types.insertMany([
  stamp({ _id: id.btSingle, name: 'Single', image: '' }),
  stamp({ _id: id.btDouble, name: 'Double', image: '' }),
  stamp({ _id: id.btKing, name: 'King', image: '' }),
  stamp({ _id: id.btQueen, name: 'Queen', image: '' }),
]);

db.bed_numbers.insertMany([
  stamp({ _id: id.bn1, name: '1 Bed', value: 1, image: '' }),
  stamp({ _id: id.bn2, name: '2 Beds', value: 2, image: '' }),
  stamp({ _id: id.bn3, name: '3 Beds', value: 3, image: '' }),
]);

db.guest_numbers.insertMany([
  stamp({ _id: id.gn2, name: '2 Guests', value: 2, childrenValue: 1, image: '' }),
  stamp({ _id: id.gn3, name: '3 Guests', value: 3, childrenValue: 1, image: '' }),
  stamp({ _id: id.gn4, name: '4 Guests', value: 4, childrenValue: 2, image: '' }),
]);

db.services.insertMany([
  stamp({ _id: id.svWifi, name: 'Free WiFi', image: '' }),
  stamp({ _id: id.svParking, name: 'Parking', image: '' }),
  stamp({ _id: id.svPool, name: 'Swimming Pool', image: '' }),
  stamp({ _id: id.svGym, name: 'Gym', image: '' }),
  stamp({ _id: id.svBreakfast, name: 'Breakfast', image: '' }),
  stamp({ _id: id.svAc, name: 'Air Conditioning', image: '' }),
  stamp({ _id: id.svSpa, name: 'Spa', image: '' }),
]);

// policies -> collection privacy_policies (schema: name, image)
db.privacy_policies.insertMany([
  stamp({ _id: id.polCancel, name: 'Free cancellation up to 24h before check-in', image: '' }),
  stamp({ _id: id.polPet, name: 'Pets are not allowed', image: '' }),
  stamp({ _id: id.polSmoking, name: 'No smoking in rooms', image: '' }),
]);

// terms -> collection terms_conditions (schema: value, image)
db.terms_conditions.insertMany([
  stamp({ _id: id.tcCheckin, value: 'Check-in from 14:00, check-out by 12:00', image: '' }),
  stamp({ _id: id.tcId, value: 'A valid government-issued ID is required at check-in', image: '' }),
]);

db.faq.insertMany([
  stamp({ title: 'How do I book a room?', description: 'Select a property, choose your dates and room, then confirm payment.' }),
  stamp({ title: 'Can I cancel my booking?', description: 'Yes, subject to the property cancellation policy shown at booking time.' }),
  stamp({ title: 'How are hourly bookings priced?', description: 'Hourly rates are set per room for 3, 6, 12 and 24-hour slots.' }),
]);

db.offers.insertMany([
  stamp({ title: 'Summer Escape', subtitle: 'Up to 30% off beach resorts', image: '', link: '/offers/summer', enabled: true }),
  stamp({ title: 'Business Stays', subtitle: 'Free breakfast on weekday bookings', image: '', link: '/offers/business', enabled: true }),
  stamp({ title: 'Weekend Getaway', subtitle: 'Stay 2 nights, pay for 1', image: '', link: '/offers/weekend', enabled: false }),
]);

db.promocodes.insertMany([
  stamp({ code: 'WELCOME10', discount: 10 }),
  stamp({ code: 'SUMMER25', discount: 25 }),
  stamp({ code: 'STAYHOPPER15', discount: 15 }),
]);

db.termsandconditions.insertMany([
  stamp({ description: 'By using StayHopper you agree to our booking, payment and cancellation terms. All bookings are subject to property availability and confirmation.' }),
]);

// ---------------------------------------------------------------------------
// Roles (Super Admin with ["*"] already created in 01-init.js)
// ---------------------------------------------------------------------------
db.roles.insertMany([
  stamp({
    _id: id.roleHotelAdmin,
    name: 'Hotel Admin',
    permissions: [
      'SHOW_DASHBOARD', 'SHOW_OWN_DASHBOARD', 'SHOW_SETTINGS',
      'LIST_PROPERTIES', 'LIST_OWN_PROPERTIES',
      'LIST_ROOMS', 'LIST_BOOKINGS', 'LIST_OWN_BOOKINGS',
      'LIST_INVOICES', 'LIST_OWN_INVOICES', 'LIST_USER_RATINGS',
    ],
  }),
  stamp({
    _id: id.roleReceptionist,
    name: 'Receptionist',
    permissions: [
      'SHOW_DASHBOARD', 'SHOW_OWN_DASHBOARD',
      'LIST_PROPERTIES', 'LIST_OWN_PROPERTIES',
      'LIST_ROOMS', 'LIST_BOOKINGS', 'LIST_OWN_BOOKINGS',
    ],
  }),
]);

// ---------------------------------------------------------------------------
// Administrators (hotel-admin companies; super admin already seeded)
// ---------------------------------------------------------------------------
db.administrators.insertMany([
  stamp({
    _id: id.admAcme, name: 'Acme Hospitality', email: 'acme@stayhopper.com', password: PW,
    status: true, role: id.roleHotelAdmin, contact_person: 'Omar Farooq', legal_name: 'Acme Hospitality LLC',
    country: id.uae, city: id.dubai, mobile: '+971500000001', properties: [id.propGrand, id.propCity],
  }),
  stamp({
    _id: id.admOasis, name: 'Oasis Resorts', email: 'oasis@stayhopper.com', password: PW,
    status: true, role: id.roleHotelAdmin, contact_person: 'Layla Hassan', legal_name: 'Oasis Resorts FZE',
    country: id.uae, city: id.abudhabi, mobile: '+971500000002', properties: [id.propOasis],
  }),
]);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------
const charges = [
  { name: 'VAT', id: 'vat', chargeType: 'percentage', value: 5 },
  { name: 'Municipality Fee', id: 'muncipality_fee', chargeType: 'percentage', value: 7 },
  { name: 'Tourism Fee', id: 'tourism_fee', chargeType: 'fixed', value: 15 },
];

function property(_id, name, admin, type, rating, city, approved, published, source) {
  return stamp({
    _id, name, administrator: admin, allAdministrators: [admin], company: null,
    type, rating, currency: id.aed, description: `${name} — comfortable stays in the heart of the city.`,
    timeslots: [3, 6, 12, 24], rooms: [], policies: [id.polCancel, id.polSmoking], terms: [id.tcCheckin, id.tcId],
    services: [id.svWifi, id.svParking, id.svPool, id.svAc], images: [], featured: [],
    primaryReservationEmail: `${name.toLowerCase().replace(/[^a-z]/g, '')}@stayhopper.com`,
    secondaryReservationEmails: '',
    contactinfo: {
      contact_person: 'Front Desk', legal_name: `${name} LLC`, country: id.uae, city,
      address_1: '123 Sheikh Zayed Road', address_2: 'Downtown', location: 'Downtown', latlng: [25.2, 55.27],
      zip: '00000', email: `info.${name.toLowerCase().replace(/[^a-z]/g, '')}@stayhopper.com`,
      mobile: '+971540000000', land_phone: '+97140000000', alt_land_phone: [],
    },
    charges, weekends: ['fri', 'sat'], anyTimeCheckin: true,
    approved, published, source, status: true, user_rating: rating === id.pr5 ? 4.8 : 4.2,
    agreement: { contactName: 'Owner', contactEmail: 'owner@stayhopper.com', isAgreementSigned: true, signedDate: now, commissionHourly: 15, commissionMonthly: 12 },
    location: { address: 'Downtown', type: 'Point', coordinates: [55.27, 25.2] },
  });
}

db.properties.insertMany([
  property(id.propGrand, 'Grand Plaza Hotel', id.admAcme, id.ptHotel, id.pr5, id.dubai, true, true, 'Extranet'),
  property(id.propOasis, 'Oasis Beach Resort', id.admOasis, id.ptResort, id.pr5, id.abudhabi, true, true, 'Extranet'),
  property(id.propCity, 'City Center Apartments', id.admAcme, id.ptApartment, id.pr4, id.dubai, false, false, 'Website'),
]);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const pricing = { h3: 80, h6: 140, h12: 240, h24: 380 };
const rate = {
  name: 'Default', rateType: 'hourly', isDefault: true,
  weekday: { fullDay: 380, standardDay: 300, hours: { h3: 80, h6: 140, h12: 240, h24: 380 } },
  weekend: { fullDay: 450, standardDay: 360, hours: { h3: 100, h6: 170, h12: 280, h24: 450 } },
  recurring: true, minimumBookingRate: 80,
};

function room(_id, prop, roomType, roomName, bedType, guests, numberRooms) {
  return stamp({
    _id, property_id: prop, room_type: roomType, room_name: roomName, bed_type: bedType,
    number_of_guests: guests, number_rooms: numberRooms, number_guests: 2, number_beds: 1,
    custom_name: '', room_size: '32 sqm', extrabed_option: true, extrabed_number: 1, amount_extrabed: 50,
    hours_cleaning: 1, extraslot_cleaning: 0, price: pricing, rates: [rate],
    services: [id.svWifi, id.svAc, id.svBreakfast], images: [], featured: [],
  });
}

db.rooms.insertMany([
  room(id.roomG1, id.propGrand, id.rtDeluxe, id.rnDouble, id.btKing, id.gn2, 10),
  room(id.roomG2, id.propGrand, id.rtSuite, id.rnTwin, id.btQueen, id.gn4, 4),
  room(id.roomO1, id.propOasis, id.rtStandard, id.rnDouble, id.btDouble, id.gn2, 20),
  room(id.roomO2, id.propOasis, id.rtSuite, id.rnDouble, id.btKing, id.gn4, 6),
  room(id.roomC1, id.propCity, id.rtStandard, id.rnSingle, id.btSingle, id.gn2, 15),
]);

// Back-fill property.rooms arrays.
db.properties.updateOne({ _id: id.propGrand }, { $set: { rooms: [id.roomG1, id.roomG2] } });
db.properties.updateOne({ _id: id.propOasis }, { $set: { rooms: [id.roomO1, id.roomO2] } });
db.properties.updateOne({ _id: id.propCity }, { $set: { rooms: [id.roomC1] } });

// ---------------------------------------------------------------------------
// Users (guest accounts)
// ---------------------------------------------------------------------------
db.users.insertMany([
  stamp({ _id: id.userAli, name: 'Ali', last_name: 'Khan', email: 'ali.khan@example.com', mobile: '+971551111111', gender: 'male', country: 'United Arab Emirates', city: 'Dubai', country_id: id.uae, city_id: id.dubai, isGuestUser: 0, password: PW, status: 1, deleted: false, favourites: [id.propGrand] }),
  stamp({ _id: id.userSara, name: 'Sara', last_name: 'Ahmed', email: 'sara.ahmed@example.com', mobile: '+971552222222', gender: 'female', country: 'United Arab Emirates', city: 'Abu Dhabi', country_id: id.uae, city_id: id.abudhabi, isGuestUser: 0, password: PW, status: 1, deleted: false, favourites: [] }),
  stamp({ _id: id.userJohn, name: 'John', last_name: 'Smith', email: 'john.smith@example.com', mobile: '+14155550000', gender: 'male', country: 'India', city: 'Mumbai', country_id: id.india, city_id: id.mumbai, isGuestUser: 0, password: PW, status: 1, deleted: false, favourites: [] }),
  stamp({ _id: id.userMaria, name: 'Maria', last_name: 'Garcia', email: 'maria.garcia@example.com', mobile: '+971553333333', gender: 'female', country: 'United Arab Emirates', city: 'Dubai', country_id: id.uae, city_id: id.dubai, isGuestUser: 1, password: PW, status: 1, deleted: false, favourites: [] }),
]);

// ---------------------------------------------------------------------------
// Active bookings (userbookings) — populate paths: user, room.room, property
// ---------------------------------------------------------------------------
function activeBooking(_id, bookId, user, prop, roomId, guest, hotelAmt, paid) {
  return stamp({
    _id, book_id: bookId, user, property: prop, room: [{ room: roomId, number: 1 }],
    bookingType: 'hourly', status: 'active',
    checkin_date: '2026-07-10', checkin_time: '14:00', checkout_date: '2026-07-10', checkout_time: '20:00',
    stayDuration: '6 hours', no_of_adults: 2, no_of_children: 0,
    total_amt: Math.round(hotelAmt * 1.3), hotelAmt, paymentAmt: Math.round(hotelAmt * 0.3),
    bookingFee: 30, discount: 0, currencyCode: 'AED', paid, hotel_approved: paid ? 1 : 0,
    charge_uid: 'ch_' + bookId,
    guestinfo: { first_name: guest.f, last_name: guest.l, email: guest.e, mobile: guest.m },
  });
}

db.userbookings.insertMany([
  activeBooking(id.ubA, 'SH1001', id.userAli, id.propGrand, id.roomG1, { f: 'Ali', l: 'Khan', e: 'ali.khan@example.com', m: '+971551111111' }, 300, 1),
  activeBooking(id.ubB, 'SH1002', id.userSara, id.propOasis, id.roomO1, { f: 'Sara', l: 'Ahmed', e: 'sara.ahmed@example.com', m: '+971552222222' }, 250, 0),
  activeBooking(id.ubC, 'SH1003', id.userJohn, id.propGrand, id.roomG2, { f: 'John', l: 'Smith', e: 'john.smith@example.com', m: '+14155550000' }, 420, 1),
]);

// ---------------------------------------------------------------------------
// Completed bookings — embedded propertyInfo/roomsInfo (joined manually in service)
// ---------------------------------------------------------------------------
function completedBooking(_id, bookId, prop, propName, hotelAmt, guest) {
  return stamp({
    _id, book_id: bookId, bookingType: 'hourly',
    propertyInfo: { id: prop, name: propName },
    roomsInfo: [{ name: 'Deluxe Double', number: 1 }],
    checkin_date: '2026-06-20', checkin_time: '13:00', checkout_date: '2026-06-20', checkout_time: '19:00',
    stayDuration: '6 hours', total_amt: Math.round(hotelAmt * 1.3), hotelAmt, paymentAmt: Math.round(hotelAmt * 0.3),
    bookingFee: 30, discount: 0, currencyCode: 'AED', paid: 1, status: 'completed',
    guestinfo: { first_name: guest.f, last_name: guest.l, email: guest.e, mobile: guest.m },
  });
}

db.completed_bookings.insertMany([
  completedBooking(id.cbA, 'SH0901', id.propGrand, 'Grand Plaza Hotel', 300, { f: 'Maria', l: 'Garcia', e: 'maria.garcia@example.com', m: '+971553333333' }),
  completedBooking(id.cbB, 'SH0902', id.propOasis, 'Oasis Beach Resort', 260, { f: 'Ali', l: 'Khan', e: 'ali.khan@example.com', m: '+971551111111' }),
]);

// ---------------------------------------------------------------------------
// Invoices (dashboard counts status:'pending')
// ---------------------------------------------------------------------------
db.invoices.insertMany([
  stamp({ invoiceNo: 'INV-2026-001', invoiceForDate: '2026-06-01', invoiceForMonthString: 'June 2026', issueDate: now, status: 'pending', property: id.propGrand, currency: id.aed, completedBookings: [id.cbA], userBookings: [id.ubA], totalBookingsCount: 2, amount: 780, amountToProperty: 660, amountFromProperty: 120, commissionHourly: 15, commissionMonthly: 12 }),
  stamp({ invoiceNo: 'INV-2026-002', invoiceForDate: '2026-06-01', invoiceForMonthString: 'June 2026', issueDate: now, status: 'pending', property: id.propOasis, currency: id.aed, completedBookings: [id.cbB], userBookings: [id.ubB], totalBookingsCount: 2, amount: 620, amountToProperty: 520, amountFromProperty: 100, commissionHourly: 15, commissionMonthly: 12 }),
  stamp({ invoiceNo: 'INV-2026-003', invoiceForDate: '2026-05-01', invoiceForMonthString: 'May 2026', issueDate: now, status: 'paid', datepayed: now, property: id.propGrand, currency: id.aed, totalBookingsCount: 5, amount: 1950, amountToProperty: 1650, amountFromProperty: 300, commissionHourly: 15, commissionMonthly: 12 }),
]);

// ---------------------------------------------------------------------------
// User ratings (dashboard counts approved / unapproved)
// ---------------------------------------------------------------------------
db.userratings.insertMany([
  stamp({ user: id.userAli, ub_id: id.cbA, booking_id: 'SH0901', property: id.propGrand, comment: 'Great location and very clean rooms.', value: 5, date: now, approved: true }),
  stamp({ user: id.userSara, ub_id: id.cbB, booking_id: 'SH0902', property: id.propOasis, comment: 'Beautiful beach view, friendly staff.', value: 4, date: now, approved: true }),
  stamp({ user: id.userJohn, ub_id: id.ubC, booking_id: 'SH1003', property: id.propGrand, comment: 'Good value but check-in was slow.', value: 3, date: now, approved: false }),
  stamp({ user: id.userMaria, ub_id: id.cbA, booking_id: 'SH0901', property: id.propGrand, comment: 'Loved the pool and breakfast.', value: 5, date: now, approved: false }),
]);

// ---------------------------------------------------------------------------
// App version (android + ios rows the GET expects)
// ---------------------------------------------------------------------------
db.app_version.insertMany([
  stamp({ appType: 'android', buildVersion: '1.0.0', appVersion: '1.0.0', forceUpdate: false }),
  stamp({ appType: 'ios', buildVersion: '1.0.0', appVersion: '1.0.0', forceUpdate: false }),
]);

print('[mongo-init] 02-seed: master data + ' +
  db.properties.countDocuments() + ' properties, ' +
  db.rooms.countDocuments() + ' rooms, ' +
  db.users.countDocuments() + ' users, ' +
  (db.userbookings.countDocuments() + db.completed_bookings.countDocuments()) + ' bookings, ' +
  db.invoices.countDocuments() + ' invoices, ' +
  db.userratings.countDocuments() + ' ratings seeded.');
