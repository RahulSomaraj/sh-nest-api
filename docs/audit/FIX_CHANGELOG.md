# Audit fix pass — 2026-07-02

PR description / changelog for the fixes driven by `API_MIGRATION_AUDIT.md` ("Fix backlog", items 1–8). Every change carries an `// audit <id>` code comment. Routes and response envelopes are unchanged except where noted.

## 1. [BLOCKER] Auth-login security (A1)

- `modules/administrators/schemas/administrator.schema.ts` — `toJSON`/`toObject` transforms delete `password`, `activationCode`, `autoLoginCode` on every serialisation.
- `modules/auth/auth.service.ts` — `validateAdministrator` + `autoLogin` reject `status === false` (legacy "Inactive User" parity); `signToken` signs minimal `{_id, email, role}` claims instead of the whole doc.
- `config/configuration.ts` — boot fails if `API_SECRET` is unset (removed `'secret'` fallback). **Deploy note: `API_SECRET` must be set in every environment.**
- Token expiry deferred — `TODO(⚠️ PRODUCT)` in `signToken` (coordinate with frontend).
- ⚠️ FE note: if anything decodes the JWT client-side beyond `_id`/`email`/`role`, switch it to the `user` object in the login response (unchanged, populated role included).

## 2. [BLOCKER] Payment capture/return emails (A8)

- `common/mail/mail.service.ts` — new `sendCapturedPaymentEmail`, `sendCapturedHotelEmail`, `sendCancelledPaymentEmail`, `sendCancelledHotelEmail` (templates: `booking_confirmation.html`, `order_hotel_captured.html`, `booking_cancelled.html`, `order_cancelled_hotel.html`; recipients/bcc = v2 active lines).
- `modules/payments/payments.module.ts` — token builder ports the v2 route-body computations (dates, guests, room types, VATS incl. the v2 two-pass quirk, hotel price/commission); emails fire after the container calls, error-isolated from the money flow; capture also reads `?transactionId` (v2 TRANSACTION_REFERENCE).
- Deliberate deviations from broken v2 code (commented): return-flow VATS `ReferenceError` fixed; missing `commissionHourly` → 0 instead of `NaN`.
- ⚠️ PRODUCT TODOs (decisions 2026-07-02: keep for now): `b2cbookings@stayhopper.com` bcc stays disabled; hotel-cancellation email keeps v2's guest recipient (suspected v2 copy-paste bug).
- Templates resolve via `PUBLIC_DIR` (point at the legacy `sh-api/stayhopper/public`, as with the existing mail flows).

## 3. [BLOCKER] Destructive deletes (A2, A5, A6)

- `administrators.service.remove` — blocks with 400 `{status:0,message,count}` when owned properties have bookings with `date_checkin >= now`; cascades users' `favourites` pull, availability `bookings`/`bookinglogs`, rooms, properties. `POST /administrators/check_active_bookings` re-exposed (legacy `{status:1,count}`).
- `properties.service.remove` — same guard; cascades rooms + availability docs + favourites.
- `rooms.service.remove` — blocks (400, legacy message) while `userbookings` reference the room; deletes availability docs and `$pull`s from `property.rooms`.
- ⚠️ FE note: blocked deletes now return 400 (previously silently succeeded/orphaned).

## 4. [HIGH] Owner-scoping IDOR (A5, A6, A7)

- New `common/auth/owner-scope.ts` — resolves owned property ids once (`administrator == me` OR `me ∈ allAdministrators`), 403 on mismatch; scoping applies only to OWN-without-ALL callers (v2 list rule), full-access admins unaffected.
- Properties: `single/modify/remove` + nearby/photo mutations.
- Rooms: `list` (filtered) + `create` + every by-id op (scoped via `LIST_OWN/ALL_PROPERTIES` — rooms have no own pair).
- Bookings: `single` + `cancel/remove/reject-cancellation/noshow/reject-noshow/approveNoShow` (`property` / `propertyInfo.id`).

## 5. [HIGH → ⚠️ PRODUCT] Booking email decisions (A7)

- Product decisions 2026-07-02: rejection emails keep the real hotel recipient (sign-off recorded in code); `support@stayhopper.com` test recipients on cancel/noshow/approve-noshow stay, each tagged `TODO(⚠️ PRODUCT — audit A7)` — must be revisited before go-live.

## 6. [MEDIUM] Mass assignment

- Properties `preCreateOrUpdate`: `user_rating` always stripped; `approved`/`published` stripped unless caller has `LIST_ALL_PROPERTIES`.
- Rooms `preCreateOrUpdate`: room-level `isExistPriceSuggestion`/`suggestedRatePercentage` stripped (rate flows unaffected).
- Invoices: explicit 22-field allowlist on create/modify.
- Administrators/users: already DTO-whitelisted; `role`/`status` kept in the admin DTO by design (admin UI sends both) — granularity issue tracked in audit.

## 7. [LOW] Parity/quality fixes

- A16: `CitiesCrudService.list` override restores `countries` (sorted) to the envelope.
- A30: commissions `PUT` 400 → **200** (v2 bug; body unchanged — flag to FE).
- A32: verified the mobile app reads app versions via the guest API (`api/v2/main.js`) — admin route keeps `JwtAuthGuard`, no public read needed.
- A6: rate-rejection email trigger (fires only for a different user) — product signed off 2026-07-02.
- A4: `approved`/`:status` coerced to real booleans; invalid values → 400.
- A3: users `GET/PUT /:id` inlined booking arrays bounded to the latest 100 each (aggregate totals still full-history).

## 8. [VERIFY] Dropped modules

- A27 taxes & A28 notifications: **confirmed retired by product 2026-07-02.** No code change.

## Finding ids addressed

A1, A2, A3, A4, A5, A6, A7, A8, A16, A27, A28, A30, A32.

## Still open (non-blocking, tracked in audit)

- A2 onboarding brute-force (4-digit codes, no rate limiting).
- Read-permission-gated writes (`LIST_*` used for create/modify/remove) — permission-granularity work.
- A8 payment-container response validation (pre-existing in both stacks).
- A1 token expiry (⚠️ PRODUCT).
- A7 production email recipients (⚠️ PRODUCT TODOs).
