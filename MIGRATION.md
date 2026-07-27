# Migration tracker — Express (`sh-api/stayhopper`) → NestJS (`sh-api-nest`)

Rewrite of the legacy Express backend. Source of truth per module:
`sh-api/stayhopper/{admin/controllers/v2,controllers/api}/<module>.js` + the Mongoose
model(s) in `sh-api/stayhopper/db/models/*.js`. Contract cross-reference: `sh-api/ENDPOINTS.md`.
Last audited against source & code: **2026-07-26**.

---

## Status at a glance

| Phase | Scope | State |
|-------|-------|-------|
| **1** — `admin/v2` (sh-account) | 31 modules | ✅ **Done** |
| **2** — customer `api/*` (sh-website) | 52 endpoints + routing + auth | 🟡 **Code done, 0 verified.** 2a (3 rows) blocked |
| **3** — background jobs | 10 jobs | 🟡 **7 built** (C1–C4, C6, C7, C9); C5/C8 need a decision; C10 skip |
| **4** — HyperGuest | greenfield | ⬜ **Not started** (correctly — gated on phase 2 `verified`) |
| **5** — cutover & retirement | nginx flips, archive legacy | ⬜ **Not started** (gated on everything above) |
| **—** — surfaces outside the tracker | 4 routers | ⚠️ **3 need a decision** (`/print` is live) |

### The distinction that matters: `done` ≠ `verified`

The ladder is `pending → in-progress → done → verified`. **Every Phase-2/3 row is at `done`
— nothing is `verified`.** `verified` has a specific meaning here: a contract test written
against **legacy first**, then replayed against nest, byte-identical. That suite
(`test/contract/`) **does not exist yet**. So the code is written and wired, but not proven
equivalent — and no nginx flip (phase 5) can happen until it is.

---

## ⏳ What is pending (the whole list)

Ordered by what unblocks the most. Items 1–4 are the real remaining work.

1. **Contract test suite → `test/contract/`.** *Biggest item; unblocks everything.* Write
   supertest specs against the running legacy app (the oracle), capture exact status/body/
   headers, replay against nest. Flips 52 Phase-2 rows + the jobs from `done` → `verified`.
   Money paths (B2, B4, B5, capture/return) also need a recorded payment-container replay.
2. **Five product/engineering decisions:**
   - **C5** — release-stale-unpaid-slots cron is dead code in legacy (`return;` first line).
     Port it, or confirm it stays off?
   - **C6** — the one behavioural change in the whole migration. Legacy pushed "extend your
     stay?" to *every* guest (missing `await`); the port only offers when nothing conflicts.
     Confirm that's the intended behaviour.
   - **C8** — bulk BLOCK worker is commented in legacy. Does the extranet write
     `cron_blockslots` BLOCK rows that now have no processor?
   - **Invoice recipients** — legacy mailed invoices to a hardcoded personal gmail (real
     recipient commented out), i.e. properties aren't getting invoices today. Port sends to
     the configured mailbox + property contact. Confirm that's wanted.
   - **Monthly / standard-day search** — legacy's round-up divisor is `0` for a standard-day
     stay → `NaN` → room filtered out, so that search is effectively dead. Kept for parity.
     Is fixing it in scope? (It's a pricing change, not a refactor.)
3. **Three surface decisions** (see "Legacy surfaces OUTSIDE this tracker"):
   - **`/print/booking/:id`** — ⚠ **live and linked from confirmation emails nest already
     sends.** Port it or pin `/print` to legacy in nginx before archiving anything.
   - **ResortPass** (17 routes, own models) — port or confirm retired.
   - **v1 EJS admin panel** (~179 routes) — presumed dead; confirm nobody logs in.
4. **A1–A3 frontend tracing** — the 3 blocked admin/v2 gaps. Trace whether sh-account /
   sh-website still call them and what envelope they expect, before building (they're
   commented/absent in legacy, so this is new dev, not a port).
5. **Phase 5 cutover** — nginx `location` flips, one group at a time, a week of bake each.
   Gated on the contract suite. First action when phase 3 ships: disable legacy crons.
6. **Phase 4 HyperGuest** — greenfield; slots in after P2/B2 are `verified`.

Also outstanding (non-blocking): local `npm install` for the new deps (`@nestjs/schedule`,
`@nestjs/testing`, `luxon`); prune the other two Claude Code worktrees.

---

# Phase 1 — `admin/v2` (sh-account) ✅ Done

31 modules. Complete before the Phase-2 work started.

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
| 11 | capture / return (payments) | `capturePayment.js`, `returnPayment.js` | ✅ Done (emails ported 2026-07-02, audit A8) |
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
  `slots`/`bookings`/`bookinglogs` moved to ReferenceModelsModule too (phase 2) — the
  customer search and booking flow read and write the same collections, so no module owns
  them privately. Added loose refs: room_types, room_names, bed_types, guest_numbers.
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
  charges, invoice paid/rejected + extranet redirect. The guest/hotel confirmation &
  cancellation emails (from `controllers/api/v2/email.js`, `emailHotel.js.js`) are ported
  into `MailService` (audit A8, 2026-07-02) and fire after the container calls. No auth
  guard (legacy parity; also gateway return URLs). Uses global `fetch` (Node 18+).

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

---

# Phase 2 — Customer `api/*` surface (sh-website) 🟡 Code done, 0 verified

Source of truth: `sh-api/stayhopper/routes/api.js` (mounted at `/api`, `index.js:73`)
plus `controllers/api/*`, `controllers/api/v2/*`, `controllers/api/v3/*`.
Inventory audited from source 2026-07-26.

**Goal**: 1:1 response parity for every endpoint sh-website actually calls, so the
live frontend needs zero changes. Routes nothing consumes are marked `SKIP` and die
with the legacy app.

**Status roll-up**: routing + auth + all 52 rows (2b–2f) are `done` and compile clean
(`tsc` + `app.wiring.spec` 7/7). **None are `verified`** — no contract suite yet. Only
2a (A1–A3) is unbuilt, and deliberately so (blocked on FE tracing).

## Routing change — ✅ DONE

1. ✅ `setGlobalPrefix` removed from `main.ts`; `RouterModule.register` in `AppModule`
   mounts `{ path: 'admin/v2', children: adminModules }` and
   `{ path: 'api', children: customerModules }`. Config exposes `adminPrefix` /
   `customerPrefix` instead of `globalPrefix`.
2. ✅ `health` stays at the root (no prefix applies to it now).
3. ✅ Customer auth: `modules/api/auth/` — `UserJwtStrategy` (`jwt-user`, HS256
   `API_SECRET`, payload `{_id}`, populates `city_id`/`country_id`,
   `ignoreExpiration: true` per 2g#9), `UserLocalStrategy` (`local-user-login`,
   username field `email`), `UserAuthGuard` / `UserLocalAuthGuard`, and
   `@CurrentUser()` in `common/auth/current-user.decorator.ts`. Fully separate from the
   admin `jwt-administrator` strategy.
4. ✅ `CountrySelectionMiddleware` (`common/middleware/`) applied to `api/*`; same UAE /
   `Asia/Dubai` defaults, with the country row cached for the process lifetime instead
   of re-queried on every request.

### Shared model ownership (done as part of this phase)

`slots`, `bookings`, `bookinglogs` and `userratings` moved out of RoomsModule /
UserRatingsModule into `ReferenceModelsModule`, so the admin and customer surfaces share
one model per collection on the connection. RoomsModule now only imports it.

### New shared infrastructure

| Piece | Location | Replaces |
|-------|----------|----------|
| `MailchimpService` | `common/mailchimp/` | `mailchimp-api-v3` client (now `fetch`) |
| `downloadImage()` | `common/util/remote-image.util.ts` | `request(url).pipe(...)` in fb-login (2g#6) |
| `GeocoderService` | `modules/api/main/` | `node-geocoder` + committed key (2g#4) |
| `PushService` | `modules/jobs/` | `fcm-node` legacy HTTP API → FCM HTTP v1 |
| ported `services/*` | `modules/api/services/` | `stayhopper/services/*.js` |

## Phase-2 tracker

Status: `pending` → `in-progress` → `done` → `verified` (contract-tested against legacy).
`SKIP` = not consumed / dead — do not port.

### 2a. Admin/v2 gaps (sh-website calls these on the admin surface)

| # | Route | Legacy source | Consumer | Status |
|---|-------|---------------|----------|--------|
| A1 | `POST admin/v2/properties/register` | ⚠ no `/register` route exists in legacy `admin/controllers/v2/properties.js:862-876` either — the FE call may 404 today or land elsewhere. Trace the sh-website call before porting | pending-verify |
| A2 | `POST admin/v2/users` (create) | commented in legacy `users.js:18` | sh-account (verify FE still calls) | pending-verify |
| A3 | `PUT admin/v2/bookings/:id` (modify) | commented in legacy `bookings.js:23` | sh-account (verify FE still calls) | pending-verify |

⚠ **Still blocked, deliberately not built.** All three routes are commented out or absent
in legacy, so nothing to port: writing them would be new development, not migration, and
the response contract would be invented rather than matched. Each needs the sh-account /
sh-website call traced first (does the frontend still call it? what body and envelope does
it expect?). Those repos are outside this one.

### 2b. Users module (`/api/users`, `/api/v3` guest) → `modules/api/users`

| # | Route | Legacy | Auth | Notes | Status |
|---|-------|--------|------|-------|--------|
| U1 | `POST /api/users` | `v2/users.js:30` | none | SendGrid welcome + Mailchimp | done |
| U2 | `POST /api/users/checklogin` | `v2/users.js:123` | none | | done |
| U3 | `POST /api/users/login` | `v2/users.js:138` | local strategy | email+password | done |
| U4 | `POST /api/users/authorized` | `v2/users.js:177` | user JWT | | done |
| U5 | `GET /api/users/me` | `v2/users.js:186` | user JWT | | done |
| U6 | `GET /api/users/logout` | `v2/users.js:212` | user JWT | nulls device token | done |
| U7 | `POST /api/users/reset-password` | `v2/users.js:243` | none | SendGrid; ⚠ unauthenticated by design in legacy | done |
| U8 | `GET /api/users/bookings` | `v2/users.js:290` | user JWT | userbookings + completedbookings + ratings | done |
| U9 | `POST /api/users/editprofile` | `v2/users.js:368` | user JWT | multer → `public/files/userpics` | done |
| U10 | `DELETE /api/users/delete-account` | `v2/users.js:448` | user JWT | soft delete | done |
| U11 | `POST /api/users/change-password` | `v2/users.js:478` | user JWT | | done |
| U12 | `POST /api/users/fb-login` | `v2/users.js:516` | none | remote image fetch — replace `request().pipe` with fetch + content-type/size guard | done |
| U13 | `POST /api/users/notify_cred` | `v2/users.js:594` | none | device token update | done |
| U14 | `POST /api/users/favorites` | `v2/users.js:622` | user JWT | | done |
| U15 | `POST /api/v3/guestUser` | `v3/guestUser.js:11` | none | ⚠ legacy bug: missing `return` after 400; reuses existing NON-guest account by email (token for any account). Port the intended behavior: return on 400; if email belongs to non-guest account, reject | done |
| U16 | `POST /api/v3/checkIsGuestUser` | `v3/guestUser.js:71` | none | legacy double-send bug — port intended single response | done |

### 2c. Main module (`/api/main`) → `modules/api/main`

| # | Route | Legacy | Notes | Status |
|---|-------|--------|-------|--------|
| M1 | `POST /api/main/authorized` | `v2/main.js:23` | user JWT | done |
| M2 | `GET /api/main/app/version/:appType?` | `v2/main.js:28` | | done |
| M3 | `GET /api/main/redirect/:encodedParams` | `v2/main.js:75` | geocoder — move hardcoded Google key (`main.js:18`) to env; **rotate the key** | done |
| M4 | `POST /api/main/city` | `v2/main.js:137` | services/properties | done |
| M5 | `GET /api/main/home` | `v2/main.js:166` | offers + properties services | done |
| M6 | `POST /api/main/cities` | `v2/main.js:199` | | done |
| M7 | `GET /api/main/offers` | `v2/main.js:223` | | done |
| M8 | `GET /api/main/hotels-cheapest` | `v2/main.js:240` | | done |
| M9 | `GET /api/main/hotels-popular` | `v2/main.js:257` | | done |
| M10 | `POST /api/main/v2/cities` | `v2/main.js:298` | legacy module-level cache → use `@nestjs/cache-manager` w/ TTL | done |
| M11 | `GET /api/main/v2/offers` | `v2/main.js:325` | same | done |
| M12 | `GET /api/main/v2/hotels-cheapest` | `v2/main.js:343` | same | done |
| M13 | `GET /api/main/v2/hotels-popular` | `v2/main.js:362` | legacy caches an unresolved Promise (`main.js:366` bug) — port intended behavior | done |

### 2d. Properties module (`/api/properties`) → `modules/api/customer-properties`

The heavy one — drags in `services/search.js` (1.5k lines), `services/properties.js`
(2.1k), `services/propertyDetail.js` (1.3k), `services/checkin.js`, `services/date-time.js`.
Port the services **verbatim first** (as injectable services, same math), refactor never —
or at least not in this phase.

| # | Route | Legacy | Notes | Status |
|---|-------|--------|-------|--------|
| P1 | `POST /api/properties/authorized` | `v2/properties.js:14` | user JWT | done |
| P2 | `POST /api/properties/search` | `v2/properties.js:23` | services/search.js slot engine; uses `req.timezone` | done |
| P3 | `GET /api/properties/filters` | `v2/properties.js:87` | lookup collections | done |
| P4 | `POST /api/properties/:id` | `v2/properties.js:106` | propertyDetail + checkin services | done |

### 2e. Bookings + payment (`/api/bookings`, `/api/payment`) → `modules/api/customer-bookings`

| # | Route | Legacy | Notes | Status |
|---|-------|--------|-------|--------|
| B1 | `POST /api/bookings/checkpromo` | `v2/bookings.js:82` | user JWT | done |
| B2 | `POST /api/bookings` | `v2/bookings.js:134` | user JWT; payment-container `/paymentlink` call; slot allocation; drop the hardcoded debug emails to personal gmails (`bookings.js:46-80`) | done |
| B3 | `GET /api/bookings/:id` | `v2/bookings.js:1547` | ⚠ unauthenticated w/ guessable `SH-######` id returning guest PII — port for parity, flag for hardening in 2g | done |
| B4 | `GET /api/payment/success` | `v2/payment.js:36` | gateway return URL — unauthenticated, marks booking/invoice paid; hotel + guest emails | done |
| B5 | `GET /api/payment/failed` | `v2/payment.js:339` | releases slots, redirects | done |
| B6 | `POST /api/v3/myBookings` | `v3/showbookingsfilter.js:6` | completedbookings filter | done |
| B7 | `POST /api/v3/resendConfirmMail` | `v3/resendConfirmationMail.js:15` | SendGrid template | done |
| — | `POST /api/bookings/test` | `v2/bookings.js:118` | whadapp debug hook | SKIP |
| — | `POST /api/bookings/extendedbooking` | commented (`bookings.js:976-1546`) | old Telr flow | SKIP |

### 2f. Website / misc (`/api/website`, `/api/contactus`, basics) → `modules/api/website`

| # | Route | Legacy | Notes | Status |
|---|-------|--------|-------|--------|
| W1 | `POST /api/website/register` | `website.js:23` | SendGrid x2 | done |
| W2 | `POST /api/website/contact` | `website.js:229` | SendGrid x2 | done |
| W3 | `POST /api/website/subscribe` | `website.js:436` | Mailchimp | done |
| W4 | `GET /api/website/cities` | `website.js:483` | | done |
| W5 | `GET /api/website/slots` | `website.js:492` | hardcoded 48-slot array — constant | done |
| W6 | `POST /api/contactus` | `contactus.js:12` | new `contactus` schema | done |
| W7 | `GET /api/terms-and-conditions` | `termsAndConditions.js:8` | reuse existing nest schema | done |
| W8 | `GET /api/faq` | `faq.js:8` | reuse existing nest schema | done |
| W9 | `POST /api/userratings` | `userratings.js:9` | user JWT | done |
| W10 | `GET /api/notifications/new` | `notifications.js:13` | new `notification_childs` schema; ⚠ no auth in legacy | done |
| W11 | `POST /api/notifications/read` | `notifications.js:74` | | done |
| W12 | `GET /api/notifications/notification_count` | `notifications.js:83` | | done |
| — | `GET /api/notifications` (base) | `notifications.js:9` | hardcoded failure stub | SKIP |
| — | `GET /api/website/propertysearch` | `website.js:481` | empty handler (hangs) | SKIP |
| — | `POST /api/website/search` | `website.js:568` | v1 search — sh-website uses `/api/properties/search` | SKIP-verify |
| — | `POST /api/userratings/report` | `userratings.js:76` | no-op stub | SKIP-verify |
| — | v1 routers commented in `routes/api.js:5-25`, `v2/otp.js`, `backupPayment.js`, `properties2.js`, `test.js`, `testpayment.js` | | never mounted | SKIP |

### Phase-2 implementation notes

**Module layout** — everything customer-facing lives under `src/modules/api/`:

| Rows | Module | Files |
|------|--------|-------|
| U1–U16 | `api/users` | `customer-users.{service,controller,module}.ts`, `upload.config.ts` |
| M1–M13 | `api/main` | `main.{service,controller,module}.ts`, `geocoder.service.ts` |
| P1–P4 | `api/properties` | `customer-properties.{service,controller,module}.ts` |
| B1–B7 | `api/bookings` | `customer-bookings.{service,controller,module}.ts` |
| W1–W12 | `api/website` | `website.{service,controller,module}.ts`, `schemas/` |
| — | `api/services` | the ported `stayhopper/services/*.js` layer (below) |
| — | `api/auth` | `jwt-user` / `local-user-login` strategies + guards |

**Ported services** (`api/services/`, wired by `ApiServicesModule`):
`date-time.service.ts`, `checkin.service.ts`, `offers.service.ts`, `search.service.ts`,
`properties-data.service.ts` (= `services/properties.js`), `property-detail.service.ts`,
plus `pricing.types.ts` and `search-helpers.ts`. The pricing arithmetic is reproduced
statement for statement — including the clamping cascade, the commission/MamoPay/round-up
sequence in `search.js`, and `propertyDetail.js` recomputing taxes against the rounded
base. `moment-precise-range-plugin`, `lodash` and `haversine-distance` were reimplemented
locally (`search-helpers.ts`, `CheckinService.preciseDiff`) rather than added as deps;
each helper matches the exact semantics the callers rely on.

**Legacy quirks preserved deliberately** (all flagged in-code):
- `search.js` emits `total.amount` / hourly `payNow.amount` as `.toFixed(2)` **strings**;
  `propertyDetail.js` replaces `priceSummary.total` with a bare **number**. Both kept —
  sh-website consumes them in those shapes (`SearchPriceSummary` models this).
- `search.js` derives the round-up divisor from `datesAndHoursParams[0].hours.length / 2`,
  which is `0` for a standard-day stay → `NaN` base → the room is filtered out. Monthly /
  standard-day search is therefore effectively dead today. Flagged `TODO(⚠️ PRODUCT)`;
  changing it is a pricing change, not a refactor.
- `getPopularProperties` reads `config.pageSize.popularPropertiesPageSize`, which does not
  exist (the key is `popularProperties`), so the limit falls through to the default.
- `propertyDetail.js` writes into `basePropertyQuery.location.coordinates` without
  initialising `location`, so passing `location` to the detail route 500s. Dead in
  practice (sh-website only sends it to `/search`); the same failure is kept.
- `propertyDetail.js` keeps `property.charges` in the response (the delete is a no-op
  statement there), unlike the search path which strips it.
- Two no-progress recursions in the room-selection algorithm (`search.js`,
  `propertyDetail.js`) are bounded by a guard that only fires where legacy would have
  recursed forever; every terminating case is byte-identical.

**Deviations from legacy, beyond the 2g list:**
- `sendBookingInfoEmail` (legacy mailed a debug transcript of every booking to two
  personal gmail addresses) is **not** ported — the same information goes to the Nest
  logger instead (2g#3).
- `notifications/notification_count` counts with `countDocuments` instead of running the
  full aggregate and taking `.length`. Same number, one collection scan fewer.
- The 48 half-hour slot labels (W5) are a frozen module constant instead of a per-request
  array literal.

### New schemas needed (mirror legacy `db/models/*`, same collection names)

✅ All created: `contactus`, `notifications`, `notification_childs`
(`api/website/schemas/`), `cron_blockslots` and `notificationlogs`
(`modules/jobs/schemas/`). `slots` is an inline frozen constant for W5
(`common/util/timeslots.ts`) and the real `slots` collection for booking allocation.
`pricing`, `failedbookings` and `taxes` are dead on the api surface — not created.

`userbookings` / `completed_bookings` remain the permissive schemas in
`ReferenceModelsModule`; the customer surface writes them through the same models the
admin surface uses. Tightening them to strict schemas is deferred — doing it now would
risk silently dropping fields the legacy app still writes while both run.

## 2g. Parity exceptions (fix, don't copy)

Legacy bugs/hazards we deliberately do NOT reproduce (everything else is byte-identical):

1. `API_SECRET || 'secret'` fallback — nest must **fail to boot** without `API_SECRET`.
2. `guestUser` account takeover + double-send (U15/U16) — port intended behavior.
3. Hardcoded debug/personal-email recipients (bookings, invoices) — route to config'd
   addresses or drop.
4. Committed Google Maps key (M3) — env + rotate.
5. multer upload with no fileFilter/limits (U9) — restrict to images, size cap, keep
   response shape identical.
6. `fb-login` arbitrary-URL fetch (U12) — content-type/size guard.
7. Module-level caches (M10-13) — TTL cache.
8. Implicit globals shared across requests (`v2/payment.js` `ub`/`UB`/`msg`) — plain
   local variables; identical output.
9. JWT without expiry: keep no-expiry at first (parity — sh-website sessions must not
   break), revisit at cutover.

Post-cutover hardening backlog (breaks parity, needs FE coordination): auth on
`GET /api/bookings/:id`, `notifications/*` user scoping, signature check on
`payment/success|failed`.

---

# Phase 3 — Background jobs (`@nestjs/schedule`) 🟡 7 built, 2 to decide, 1 skip

`@nestjs/schedule` added; `modules/jobs/` holds `JobsModule`, `JobsService` (6 `@Cron`
methods: C1–C4, C6, C7), `InvoicesJobService` (C9 manual trigger) and `PushService`. **Run jobs in ONE instance only** —
every job early-returns unless `ENABLE_CRON=true`, so exactly one PM2 process should set
it (legacy runs them as an import side effect of the web process).

| # | Job | Legacy | Schedule | Port? | Status |
|---|-----|--------|----------|-------|--------|
| C1 | Purge old bookinglogs | `cron.js:26` | `*/30 * * * *` | yes | done |
| C2 | Checkout → completedbookings + review push | `cron.js:39` | `0 * * * *` | yes | done |
| C3 | 30-min-before-checkin reminder push | `cron.js:179` | `*/30 * * * *` | yes | done |
| C4 | Purge unpaid past-checkout bookings | `cron.js:326` | `0 0 * * *` | yes | done |
| C5 | Release stale unpaid slots | `cron.js:334` | dead (`return;` first line) | NO — confirm intent with team, else skip | decide |
| C6 | "Extend your stay" push | `cron.js:366` | `*/30 * * * *` | yes — fix missing `await` on availability check (`cron.js:511`) | done ⚠ see note |
| C7 | Bulk UNBLOCK slots worker | `cron.js:1102` | `* * * * *` | yes (extranet bulk-unblock depends on it) | done |
| C8 | Bulk BLOCK worker | commented `cron.js:922` | — | decide: extranet may create `cron_blockslots` BLOCK rows nobody processes | decide |
| C9 | Monthly invoice generation | `cron-invoices.js:775` | no-op in legacy (call commented) | port the **manual trigger** only: `POST admin/v2/invoices/generate` behind admin auth (legacy exposes unauthenticated `GET /generate-invoice`, `index.js:80`) | done |
| C10 | Unpaid reminders / property deactivation | commented | — | skip until product asks | SKIP |

### Phase-3 notes

- `PushService` (`modules/jobs/push.service.ts`) replaces `fcm-node`: FCM **HTTP v1**,
  service-account JSON (`FCM_SERVICE_ACCOUNT_PATH` / `_JSON`), OAuth2 token minted and
  cached in-process. Every send is a no-op unless `ENABLE_PUSH=true`, and per-device
  failures are logged rather than thrown, so a bad token can't abort a cron run.
  ⚠ C2/C3/C6 pushed via the **legacy FCM HTTP API, which Google decommissioned** — those
  notifications are almost certainly already failing silently in production. Confirm with
  the team whether the pushes still matter before treating them as parity-critical.
- `cron_blockslots` and `notificationlogs` schemas added (`modules/jobs/schemas/`), field
  types identical to legacy (block-slot room/property/slot ids are **strings**, not
  ObjectIds; the notification-log `ref: "userbooking"` never resolved, so it is a plain
  ObjectId here).
- C7 drains 5 rows per run, as legacy did, and sends the "inventory update is live"
  mail only for the row flagged `is_last`.
- **C2** archives sequentially rather than with legacy's `forEach(async …)`, which fired
  every iteration at once and swallowed rejections — one bad booking no longer takes the
  whole run down. The `completed_bookings` document shape is field-for-field identical,
  including the `room.custom_name ? roomDoc.custom_name : …` mismatch.
- **C3** collapses legacy's five chained `$project` stages into one and moves the
  `checkin_date` / `checkin_time` / `cancel_approval` matches ahead of the `$lookup`s, so
  the index is used instead of joining every paid booking first. Same rows, same output.
- **⚠ C6 is the one behavioural change in this migration.** Legacy called
  `check_extended_booking_availability` WITHOUT `await` (`cron.js:511`), so the caller
  always saw a truthy Promise and the "extend your stay?" push went to **every** guest
  regardless of availability. The helper's return value is also inverted relative to its
  name — it returns 1 when a CONFLICT exists, 0 when the room is free — so simply adding
  `await` would have flipped it to "only offer when the room is already taken". The port
  awaits it and reads it the sensible way: **offer the extension only when nothing
  conflicts**. Confirm with the team that guests should stop receiving offers for rooms
  that are already re-booked.
- **C9** is the manual trigger only, per the scope above: `POST /admin/v2/invoices/generate`
  behind `JwtAuthGuard` + `LIST_ALL_INVOICES` (legacy's `GET /generate-invoice` was mounted
  at the app root with **no authentication at all**). Query: `from`/`to` (`DD-MM-YYYY`,
  widened to whole months, never billing an in-progress month) or neither for last month,
  plus `disableEmailToProperty`. Invoice numbering (`SHINV-YYYY-MM-<hash><count>`) is
  reproduced exactly — the `string-hash` djb2-xor and `numberToFourDigits` helpers are
  ported inline so existing invoice numbers stay stable. The monthly *schedule* is
  deliberately NOT ported: legacy's `cron.schedule("0 0 1 * *")` has its
  `generateInvoices` call commented out, so adding one would start billing that isn't
  happening today.
  2g#3 applies here twice — legacy mailed the admin summary to a hardcoded
  `stayhopper@gmail.com` and, worse, sent each property's invoice to a hardcoded personal
  gmail with the real recipient commented out (so **properties are not receiving their
  invoices today**). Both now go to the configured invoice mailbox and the property's own
  contact email.
- **Not ported from `cron-invoices.js`**: `sendUnpaidInvoiceReminders` and the
  property-deactivation reminders (C10) — still `SKIP` until product asks.

### Wiring regression test

`src/app.wiring.spec.ts` builds the entire DI graph with the Mongoose connection stubbed
and asserts on the routes Express actually registers: both prefixes mount, `health` stays
at the root, specific routes are declared before their parameterised siblings
(`/api/properties/search` before `/api/properties/:id`), and no method+path pair is
registered twice. This catches the failure modes that compile cleanly and only surface at
boot. Requires no database.

---

# Phase 4 — HyperGuest (greenfield inside `api/*`) 🟡 Content live, not sellable

Not a migration — new `modules/api/hyperguest` per `hyperguest.types.ts` contracts.
Certification scope: property 19912, DEV token, `paymentDetails.details.charge:false`
(hard-coded in the client, not config-switchable), no LIVE bookings.

| Slab | Scope | State |
|------|-------|-------|
| A | config + types + fetch client (cert rails, retry/back-off) | done |
| B | hotels.json diff sync → materialized `properties` (source:'HyperGuest'), 6h cron, `POST /admin/v2/hyperguest/sync`, `npm run hg:sync` / `hg:status` | **done — hotels imported** |
| C | search + detail merge (behind HG_ENABLED) | **next** |
| D | booking branch (pre-book → create) + reconciliation cron | pending — after C |
| E | full verify + certification runbook | pending |

Everything is inert with `HG_ENABLED` unset (default): no routes change behaviour,
no outbound calls, no cron work. New collections: `hg_hotels`, `hg_sync_runs`
(additive; indexes {hotel_id unique}, {active}, {startedAt}).

**Imported hotels are deliberately not sellable yet.** Materialized properties carry
`rooms: []`, and the search pipeline drops zero-room properties — so HG hotels have
ids, content and routing in place but never surface to customers until slab C serves
virtual rooms from live HG search.

### Architecture decisions (settled)

| # | Decision | Why |
|---|----------|-----|
| D1 | HG hotels are **materialized as real `properties` docs** (`source:'HyperGuest'`); rooms stay **virtual** (live from HG search, never stored) | Detail routing, favourites, bookings and populate all key off `properties` — a real doc means zero special-casing. Rooms/prices change constantly and only HG knows availability, so storing them guarantees staleness. |
| D2 | HG participates only in **nightly-shaped stays** (full-day segments, or monthly ≤30 nights) | HG is a nights-based API; sub-day slot stays cannot be represented. |
| D3 | **Keep the MamoPay payment-link flow.** HG booking is created *after* payment succeeds, with `charge:false` | `charge:false` is mandatory pre-certification anyway; no change to the payment container; nothing exists on HG's side to unwind if payment fails. |
| D4 | Config is **env-only** (`HG_*` in `configuration.ts`) | Matches the repo pattern; admin-managed CRUD can come later if partners multiply. |
| D5 | Search merge hooks **inside `SearchService.getProperties`, between rating population and `sortAndPaginateProperties`** | The only seam where HG items flow through sort/count/totalPages exactly like native ones, so the response envelope stays byte-identical. |

### Scope + pacing (slab B operational notes)

`HG_CITIES` / `HG_CITY_IDS` (and `HG_COUNTRIES`) filter the feed **before** any
`property-static` fetch — the supplier exposes content one hotel per request, so
scope is the only real cost lever. `HG_STATIC_CONCURRENCY` (default 4) and
`HG_STATIC_RPS` (default 3) pace the import; the supplier throttles hard and
retrying harder does not help. Narrowing scope unpublishes out-of-scope hotels
(never deletes — bookings may reference them). `GET /admin/v2/hyperguest/feed-cities`
lists cities + `city_Id` + counts from one feed request.

### Open items (product decisions, not blockers)

- **Refund path when HG create fails after the customer already paid** (consequence of
  D3). Needs a decision before LIVE.
- Home-page lists (`MainService.hotelsCheapest` / `hotelsPopular`) are a *second*
  merge point, deliberately not covered by slab C.
- LIVE cutover: LIVE token, `HG_CERTIFICATION=false`, revisit the charging model.

`property-static.json`'s shape is **confirmed** against live payloads (2026-07-27,
333 UAE hotels) — see the key list on `HgPropertyStatic`. The two that bit us:
image URLs live under `images[].uri` (not `.url`), and descriptions under the
plural `descriptions[]` (`{language, type, description}`), with no singular
`description` key.

---

# Legacy surfaces OUTSIDE this tracker

Audited from `sh-api/stayhopper/index.js` 2026-07-26. Phases 1–3 cover `admin/v2`,
`api/*` and the cron jobs — but `index.js` mounts four more routers that no phase ever
inventoried. **`sh-api` cannot be archived (phase 5 step 5) until each has a decision.**

| Surface | Mounted at | Size | Status |
|---------|-----------|------|--------|
| Booking print view | `/print/booking/:id` (`routes/web.js:5` → `print.js`) | 1 route | ⚠ **LIVE — not ported** |
| ResortPass feature | `/admin/ResortPassesProperty`, `/admin/lookups`, `/admin/serviceOpeningHours`, `/admin/resortPass` (`index.js:76-79`) | 17 routes / 4 routers | ⚠ **not ported, never tracked** |
| v1 EJS admin panel | `/admin/*` (non-v2) + `routes/web.js` | ~179 routes, 59 `res.render`, 38 EJS templates | presumed dead — needs confirmation |
| Test router | `/test` (`routes/test.js`) | 7 lines | dead — do not port |

### `/print/booking/:id` — the one that will actually break

This is **not dead**, and it is reachable from code this migration already ported: the
`{{PRINT_URL}}` token in `booking_confirmation.html`, `order_hotel_booked.html` and
`resend-confirmation-mail.html` resolves to `<api_url>/print/booking/<id>`. Nest generates
those emails now, so every booking confirmation it sends contains a link that only works
while legacy is still serving. Either port the route (it reads `userbookings` + populates
property/room and renders a printable page — the same data the confirmation email already
assembles) or keep `/print` pointed at legacy in nginx indefinitely.

### ResortPass

A complete feature area — property resort passes, service opening hours, and its own
lookups — with its own models under `db/models/propertyResortPass/` and a
`resortPassProperty/website/` router that exists on disk but is **not mounted** anywhere.
Nothing in phases 1–5 references it. Needs a product call: port, or confirm the feature is
retired and drop it with legacy.

### v1 EJS admin panel

Server-rendered internal admin (session auth via `middleware/requiresLogin`, `express-session`
with a hardcoded secret), superseded by sh-account + `admin/v2`. Almost certainly dead — but
"almost certainly" is not a decision, and it is ~35 controllers of behaviour. Confirm nobody
still logs into it before archiving; if anything is still used, it needs its own phase.

---

# Phase 5 — Cutover & legacy retirement (proxy-level strangler) ⬜ Not started

Nginx (or the Azure LB) is the strangler seam — sh-website keeps one base URL:

1. **Now**: `/admin/v2/* → nest` (already live), `/api/* → legacy`, `/generate-invoice → legacy`.
2. Per module-group flip as rows go `verified`: move one `location` block at a time
   (`/api/users → nest`, then `/api/main`, `/api/properties`, `/api/bookings|payment`, misc).
   Order: 2f basics → 2b users → 2c main → 2d properties → 2e bookings/payment (money last).
3. Keep legacy warm but jobless: once nest jobs are on (`ENABLE_CRON=true`), **remove
   `require("./cron*")` from legacy `index.js`** — double-running C2/C4/C7 would
   double-push, double-delete and race slot state. This is the first thing to do when
   phase 3 ships.
4. Bake time per flip: 1 week of error-rate + response-diff monitoring, instant
   rollback = revert the nginx location.
5. Retire: when every row is `verified`, **every surface in "Legacy surfaces OUTSIDE this
   tracker" has a decision** (`/print` in particular is still live and linked from emails
   nest sends), and nginx has no legacy upstream for 2 weeks,
   archive `sh-api`, decommission its PM2 app, rotate `API_SECRET`/session secrets,
   and start the post-cutover hardening backlog (2g).

## Verification protocol (every row)

1. Contract tests (supertest) against **legacy** first — capture exact status, body,
   headers for happy + error paths. These are the oracle; commit under `test/contract/`.
2. Run the same suite against nest — byte-identical (field order excepted).
3. For money paths (B2, B4, B5, capture/return): also replay a recorded sandbox
   payment-container session.
4. Flip nginx for that path group only after green; mark `verified`.

## Migration order (dependency-sorted)

RouterModule refactor → user auth (guard/strategy/decorator) → W7/W8/W5 (trivial,
proves the pattern end-to-end incl. nginx flip) → 2b users → 2c main → services port
(verbatim: date-time → checkin → offers → properties → search → propertyDetail) →
2d properties → 2e bookings/payment → 2a admin gaps → phase 3 jobs → phase 4
HyperGuest → phase 5 retirement.
