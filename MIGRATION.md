# Migration tracker — Express (`sh-api/stayhopper`) → NestJS (`sh-api-nest`)

Porting the `admin/v2` surface one module at a time. Source of truth per module:
`sh-api/stayhopper/admin/controllers/v2/<module>.js` + the Mongoose model(s) in
`sh-api/stayhopper/db/models/*.js`. Contract cross-reference: `sh-api/ENDPOINTS.md`.

## Status

| # | Module | Legacy controller (v2) | Status |
|---|--------|------------------------|--------|
| 1 | auth | `auth.js` | ✅ Done |
| 2 | administrators | `administrators.js` | ✅ Done |
| 3 | commissions | `commissions.js` | ✅ Done (stub, mirrors legacy) |
| 4 | users | `users.js` | ✅ Done |
| 5 | user-ratings | `user-ratings.js` | ✅ Done |
| 6 | properties | `properties.js` | ✅ Done |
| 7 | rooms | `rooms.js` | ✅ Done |
| 8 | suggested-rates | `suggested-rates.js` | ✅ Done |
| 9 | bookings | `bookings.js` | ✅ Done |
| 10 | invoices | `invoices.js` | ✅ Done |
| 11 | capture / return (payments) | `capturePayment.js`, `returnPayment.js` | ✅ Done (emails deferred) |
| 12 | dashboard | `dashboard.js` | ✅ Done |
| 13 | lookups | `lookups.js` | ✅ Done |
| 14 | offers | `offers.js` | ✅ Done (CRUD base) |
| 15 | countries | `countries.js` | ✅ Done (CRUD base) |
| 16 | cities | `cities.js` | ✅ Done (CRUD base) |
| 17 | currencies | `currencies.js` | ✅ Done (CRUD base) |
| 18 | faq | `faq.js` | ✅ Done (CRUD base) |
| 19 | promo-codes | `promo-codes.js` | ✅ Done (CRUD base) |
| 20 | terms-and-conditions | `terms-and-conditions.js` | ✅ Done (CRUD base) |
| 21 | property-types | `property-types.js` | ✅ Done (CRUD base) |
| 22 | property-ratings | `property-ratings.js` | ✅ Done (CRUD base) |
| 23 | policies | `policies.js` | ✅ Done (CRUD base) |
| 24 | terms | `terms.js` | ✅ Done (CRUD base) |
| 25 | app-version | `app-version.js` | ✅ Done |
| 26 | room-names | `room-names.js` | ✅ Done (CRUD base) |
| 27 | room-types | `room-types.js` | ✅ Done (CRUD base) |
| 28 | bed-numbers | `bed-numbers.js` | ✅ Done (CRUD base) |
| 29 | bed-types | `bed-types.js` | ✅ Done (CRUD base) |
| 30 | services | `services.js` | ✅ Done (CRUD base) |
| 31 | guest-numbers | `guest-numbers.js` | ✅ Done (CRUD base) |

### users notes
- Live routes only: `GET /users`, `GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`.
  Legacy `POST /users` (create) is commented out in the source, so it is **not** ported.
- `list()` uses the same aggregation as legacy: `$lookup` into `userbookings` +
  `completed_bookings`, projecting a combined `bookings` count; keyword filter on
  name/email; returns `{ list, countries, itemCount, pageCount, pages, active_page }`.
- `getById()`/`modify()` re-attach `getExtraUserInformation` (summed `total_amt` +
  counts across both booking collections). As in legacy, on `modify` the extra
  `bookings` field is dropped during serialization of the strict Mongoose doc — parity kept.
- Booking collections are registered as loose (`strict:false`) pass-through models
  (`userbookings`, `completed_bookings`) until the bookings module is ported.

### user-ratings notes
- Routes: `GET /user-ratings`, `PUT /user-ratings/:id/approval/:status`. Permission: LIST_USER_RATINGS.
- **Heap fix**: legacy loaded the whole `userratings` collection into memory and
  `Array.splice()`'d to paginate. Ported version paginates in the DB (`skip/limit/lean`).
  The `orderBy=property` case (sort by a populated field) uses an aggregation `$lookup`
  so only one page is materialised. Added `{ property, approved }` index.
- `properties` list in the response is gated by LIST_ALL_PROPERTIES (as legacy) and `.lean()`.
- Approval recomputes `property.user_rating` (rounded 1 dp avg of approved ratings) via
  `updateOne` instead of load-mutate-save.

### properties notes
- Routes: `GET /`, `GET /has-agreement-signed` (declared before `:id`), `GET /:id`,
  `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/nearby`, `DELETE /:id/nearby/:nearbyId`,
  `POST /:id/photos`, `POST /:id/photos/feature`, `POST /:id/photos/remove`. Permission: LIST_PROPERTIES.
- **Shared model**: the full `Property` schema (`modules/properties/schemas/property.schema.ts`)
  is now the authoritative `properties` model, registered once in `ReferenceModelsModule`
  and reused everywhere (administrators, user-ratings, properties). This also fixed the
  earlier loose-model ref-name mismatches (`property_types`/`hotel_admins`/`property_ratings`
  collections now resolve for sub-populate). Added loose refs: `services`, `policies`
  (privacy_policies), `terms` (terms_conditions).
- **Owner scoping**: LIST_OWN_PROPERTIES (without LIST_ALL_PROPERTIES) restricts the query to
  `administrator == me` OR `me ∈ allAdministrators`. MANAGE_AGREEMENT gates commission edits.
- **Heap/perf**: DB-level skip/limit/lean (legacy already did this); added indexes on the
  hot filter paths. `total_rooms` computed via a bounded room aggregation per row.
- **Uploads**: multer disk storage mirrors legacy dirs (`public/files/properties`,
  `public/img/nearby`, `public/files/original/properties`) with the same extension filters;
  dirs are auto-created. Photo create resizes the uploaded original to width 800 with
  `sharp` directly (legacy re-fetched via `api_url` then piped — simplified, same result).
- **Body format**: create/modify take the raw body (`@Body() any`) to preserve the large
  nested payload past the global whitelist pipe. JSON is expected when no files are attached;
  with multipart uploads, deeply-nested text fields depend on the client sending them nested.
- Added deps: `multer`, `sharp` (+ `@types/multer`). Run `npm install` before building.

### rooms notes
- Routes: CRUD (`/`, `/:id`), rates (`POST/PUT/DELETE /:id/rates[/:rateId]`), availability
  (`GET /:id/availability`, `POST /:id/availability/:action` where action = block|unblock),
  photos (`POST /:id/photos`, `/photos/feature`, `/photos/remove`). Permission: LIST_ROOMS.
- **StrictPopulate fix**: legacy populated a `property` path that isn't on the rooms schema.
  Mongoose 8 throws `StrictPopulateError` for that — the bogus path is dropped.
- **rates modify**: rate-suggestion request/rejection emails moved into `MailService`
  (`sendRateSuggestionRequest` / `sendRateSuggestionRejected`), faithfully reproducing the
  24-hour red-diff table templating. Persistence (rate subdoc update + room
  `isExistPriceSuggestion`/`suggestedRatePercentage`) mirrors legacy.
- **availability**: `getSlotRanges` timezone logic preserved (moment-timezone). Block/unblock
  keeps legacy batching — one `insertMany` and one `deleteMany` for booking-logs instead of
  per-slot writes (heap/round-trip friendly). Added `{room,date}` + booking-log indexes.
  `underscore` calls replaced with native array ops (one fewer dependency).
- **Shared models**: `rooms` is now authoritative in ReferenceModelsModule (like `properties`).
  `slots`/`bookings`/`bookinglogs` are owned by RoomsModule for now — hand off to the bookings
  module when it migrates. Added loose refs: room_types, room_names, bed_types, guest_numbers.
- Added deps: `moment`, `moment-timezone`. Photo resize uses `sharp` on the uploaded original.

### standard-CRUD modules (shared base)
- 17 resources share `common/crud/BaseCrudService` + `BaseCrudController`, wired in a single
  `CrudModule` (`modules/crud/*`). Each concrete service binds a model + options
  (moduleTitle, basePath, populations, filters); each controller just sets `@Controller`.
- Routes per resource: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` — matching
  the frontend contract. Response envelopes match legacy.
- **Security**: `list` requires an authenticated admin (JwtAuthGuard); `single/create/
  modify/remove` require `SHOW_SETTINGS`. Guards are method-level (Nest doesn't reliably
  inherit class-level guard metadata onto subclasses).
- **Perf**: DB-side skip/limit/lean pagination (no full-collection loads).
- **Schemas**: all 17 authoritative schemas live in `ReferenceModelsModule`
  (`crud.schemas.ts`), so cross-module populate (e.g. properties.type → propertytypes,
  cities.country → countries) resolves to the same models. Model name === legacy ref;
  collection === legacy collection (e.g. `property_types`, `privacy_policies`).
- **Filters**: `cities` filters by `country`; others have no extra list filter.
- Optional `image` upload wired generically (folder derived from the route). Body is raw
  (`@Body() any`) to preserve arbitrary fields past the whitelist pipe.
- Path aliases handled: `property-policies` FE → `policies`, `property-terms` FE → `terms`.

### lookups / app-version / suggested-rates notes
- **lookups**: `GET /lookups/roles` — paginated roles, authenticated admins only.
- **app-version**: `GET /` (android + ios rows), `PUT /` (update by `appType`). The legacy
  model omitted the `appType` field it queries; schema keeps it (strict:false) so data loads
  and PUT persists. Hardened with JwtAuthGuard (legacy route had none; admin panel is authed).
- **suggested-rates**: `GET /` lists rooms with `isExistPriceSuggestion`; `PUT /:roomId/:rateId`
  applies the suggested band to the rate, clears the suggestion, bumps
  `property.max_day_price_percentage_to_normal_price`, and emails the owner
  (`MailService.sendRateSuggestionAccepted`). Permission: LIST_ADMINISTRATORS. Reuses the
  authoritative `rooms`/`properties` models; bogus `property` populate path dropped.

### bookings notes
- Routes: `GET /`, `GET /:id/:status`, `POST /cancel`, `POST /reject-cancellation/:id`,
  `DELETE /:id`, `POST /noshow`, `POST /reject-noshow/:id`, `DELETE /noshow/:id`
  (`/noshow/:id` declared before `/:id`). `single` requires LIST_BOOKINGS; list + workflow
  routes require an authenticated admin (legacy left list's permission check commented).
- Active bookings read `userbookings` (+populate user/room.room/property); completed read
  `completed_bookings` and join `propertyInfo.id` → properties **manually** (embedded doc,
  no ref) — avoids StrictPopulate + save-time field loss.
- **Owner scoping**: LIST_OWN_BOOKINGS restricts to the admin's properties; Hotel-Admin /
  Receptionist roles are further limited to `paid` bookings. **Guest PII masking** (email +
  mobile) applied for non-LIST_ALL admins. `hotelFinalAmount` computed from property charges
  (excluding tourism_fee), matching legacy.
- **Heap**: DB skip/limit for normal sorts; the sort-by-property-name case (populated/embedded)
  loads+sorts+slices as legacy did.
- **Model ownership**: `userbookings`/`completed_bookings` are now authoritative in
  ReferenceModelsModule (moved out of the users module's local registration) so users, rooms
  and bookings share them.
- **Emails**: all 6 cancel/no-show flows use `MailService.sendTemplated` (global token
  replacement). Flag changes use `updateOne` (no full-doc re-cast); slot/booking-log cleanup
  uses `$pull` + `deleteMany` as legacy. Recipient addresses follow the active legacy code.

### invoices / dashboard / payments notes
- **invoices**: full CRUD + `GET /:id/get-payment-link` (Telr hosted order via `fetch`).
  list open to authed admins; single/create/modify/remove/payment-link require LIST_INVOICES
  with LIST_ALL vs LIST_OWN scoping + per-record ownership check on single. Property-name sort
  handled in-memory (populated field), other sorts DB-side. Invoice schema authoritative.
- **dashboard**: `GET /properties|/bookings|/user-ratings|/users|/invoices` count aggregates.
  SHOW_DASHBOARD required; SHOW_FULL vs SHOW_OWN scoping; `/users` needs SHOW_FULL_DASHBOARD.
- **payments (capture/return)**: `/admin/v2/capture/:bookingId`, `/admin/v2/return/:bookingId`.
  Core money-movement + state transitions ported: booking guards (hotel_approved/
  hotel_cancelled/invoice), `paid`/`hotel_approved`/`hotel_cancelled` updates, external
  payment-container `/capture` `/return` `/vcc` calls (via `fetch`), VCC amount from property
  charges, invoice paid/rejected + extranet redirect. **Deferred**: the guest/hotel
  confirmation emails (captured/cancelled) live in a separate un-migrated subsystem
  (`controllers/api/v2/email.js`, `emailHotel.js`) — marked with TODOs. No auth guard (legacy
  parity; also gateway return URLs). Uses global `fetch` (Node 18+).

## Porting pattern (per module)
1. **Read** `admin/controllers/v2/<module>.js` and its `db/models/*` model(s).
2. **Schema**: create `src/modules/<module>/schemas/<entity>.schema.ts` mirroring the
   Mongoose model — keep collection names and any `select: false` flags identical.
3. **DTOs**: `dto/*.dto.ts` with `class-validator` decorators from the controller's
   validation / request body usage.
4. **Service**: move query/business logic; preserve response envelopes
   (`{ status, message, data }`, pagination shape, populate calls).
5. **Controller**: `@Controller('<route>')`; guard authenticated routes with
   `JwtAuthGuard` (the equivalent of `administratorAuthenticationRequired`).
6. **Module**: register schemas via `MongooseModule.forFeature`, add to `AppModule`.
7. **Verify**: `npm run build`, then hit the endpoint and diff the response against
   the legacy service for the same input.

## Notes / gotchas
- Legacy route prefix mismatches: `property-terms` FE → `terms`, `property-policies`
  FE → `policies`, `commissions` lives in the FE administrators module.
- Photo deletes use `POST .../photos/remove` (URL in body), not `DELETE`.
- `capture/:id` and `return/:id` are top-level, not under `bookings`.
- Pagination default convention across list endpoints:
  `page=1, limit=10, order=asc, orderBy=name` + per-resource filters.
- The legacy `v2/auth.js` `/migrate-*` routes were one-off data backfills and are
  intentionally **not** ported.
