/**
 * DEPRECATED — the userbookings / completed_bookings models are now authoritative in
 * `common/reference/reference.module.ts` (schemas in `modules/bookings/schemas/booking-docs.schema.ts`).
 * Inject them with @InjectModel('userbookings') / @InjectModel('completed_bookings').
 * This file is intentionally left empty to avoid duplicate model registration.
 */
export {};
