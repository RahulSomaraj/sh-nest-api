# StayHopper API Migration Audit — Legacy → v2 → NestJS

**Method:** Static code audit (no live server). Legacy code is the behavioural reference; the NestJS port (`sh-api-nest`) is the migration target being verified, with Express v2 as its declared source of truth.
**Started:** 2026-07-02 | **Canonical location:** `sh-api-nest/docs/audit/` (copy in `sh-api/audit/`).

**Three layers:**

| Layer | Path | Role |
|---|---|---|
| Legacy v1 | `sh-api/stayhopper/admin/controllers/*.js` (routes disabled) | Original behaviour spec |
| Express v2 | `sh-api/stayhopper/admin/controllers/v2/*.js` (mounted `/admin/v2/*`) | Interim; NestJS source of truth |
| NestJS | `sh-api-nest/src/modules/<module>/*` | Migration target under verification |

**Stacks:** Express 4.16.4 / Mongoose 5.2.8 / Node 8 (legacy+v2) → NestJS + Mongoose 8 (target).

> **Note on A1–A3:** the first pass compared **legacy v1 → Express v2** and logged v2's bugs. Those findings are the checklist the NestJS port must satisfy. A **NestJS verification column** is being layered in per module (does Nest fix or reproduce each v2 issue). Per `sh-api-nest/MIGRATION.md`, Nest uses real `JwtAuthGuard`/`PermissionsGuard` (guards throw → the v2 "missing `return` after 401" class of bug should not exist in Nest — to be confirmed during each module's Nest verification).

**Status legend:** ⬜ pending · 🔄 in progress · ✅ MATCH · ⚠️ CHANGED · ❌ REGRESSION · 🚫 MISSING · ➕ NEW

---

## TODO — Audit Checklist

### A. Admin module (legacy `admin/controllers/*` → v2 `admin/controllers/v2/*` → NestJS `src/modules/*`)

| # | Module | Legacy controller(s) | v2 controller | NestJS module | Status |
|---|---|---|---|---|---|
| A1 | auth | login.js, resetpassword.js | v2/auth.js | modules/auth | ❌ Nest REPRODUCES 2 security BLOCKERs (inactive-admin login, password-hash leak) + weak secret default; migrate-* correctly dropped |
| A2 | administrators | hoteladmins.js | v2/administrators.js | modules/administrators | ⚠️ Nest FIXED broken authz (real guards); DELETE safety/cascade still dropped; onboarding brute-force + role/status mass-assign remain |
| A3 | users | users.js | v2/users.js | modules/users | ⚠️ Nest FIXED authz + password mass-assign (DTO whitelist); unbounded bookings payload reproduced (now on GET & PUT) |
| A4 | user-ratings | userreviews.js | v2/user-ratings.js | modules/user-ratings | ✅ Nest BEST version — fixes v2 heap regression + rating recompute; minor boolean-cast note |
| A5 | properties | properties.js, photos.js, nearby.js | v2/properties.js | modules/properties | ✅ Nest faithful (11/11) + photo-resize improved; ⚠️ v2 IDOR on by-id ops (no owner scope) reproduced |
| A6 | rooms | rooms.js, availability.js, pricing.js | v2/rooms.js | modules/rooms | ✅ Nest faithful (13/13) + fixes StrictPopulate, ObjectId-compare & photo resize; ⚠️ no owner scope (v2 parity) |
| A7 | bookings | bookings.js, checkinout.js, completedbookings.js, cancelbookings.js | v2/bookings.js | modules/bookings | ⚠️ Nest faithful (8/8) + fixes heap & PII-crash; email-recipient divergence + no owner scope need product sign-off |
| A8 | payments | payments.js | v2/invoices.js, v2/capturePayment.js, v2/returnPayment.js | modules/invoices, modules/payments | ⚠️ Nest faithful (8/8) + fixes 4 latent v2 bugs (incl. invoice data-leak); ❗ capture/return confirmation emails DEFERRED |
| A9 | dashboard | dashboard.js | v2/dashboard.js | modules/dashboard | ✅ Nest faithful (5/5), clean; scoping preserved |
| A10 | promo-codes | promocode.js | v2/promo-codes.js | modules/crud (promo-codes) | ✅ CRUD-base (see batch) |
| A11 | policies | policy.js, policies.js | v2/policies.js | modules/crud (policies) | ✅ CRUD-base (see batch) |
| A12 | terms | terms.js | v2/terms.js | modules/crud (terms) | ✅ CRUD-base (see batch) |
| A13 | terms-and-conditions | terms_conditions.js | v2/terms-and-conditions.js | modules/crud | ✅ CRUD-base (see batch) |
| A14 | faq | faq.js | v2/faq.js | modules/crud (faq) | ✅ CRUD-base (see batch) |
| A15 | countries | countries.js | v2/countries.js | modules/crud (countries) | ✅ CRUD-base (see batch) |
| A16 | cities | cities.js | v2/cities.js | modules/crud (cities) | ⚠️ CRUD-base — drops `countries` from list envelope (see batch) |
| A17 | currencies | currencies.js | v2/currencies.js | modules/crud (currencies) | ✅ CRUD-base (see batch) |
| A18 | property-types | propertytypes.js | v2/property-types.js | modules/crud | ✅ CRUD-base (see batch) |
| A19 | property-ratings | propertyratings.js | v2/property-ratings.js | modules/crud | ✅ CRUD-base (see batch) |
| A20 | room-names | roomnames.js | v2/room-names.js | modules/crud | ✅ CRUD-base (see batch) |
| A21 | room-types | roomtypes.js | v2/room-types.js | modules/crud | ✅ CRUD-base (see batch) |
| A22 | bed-types | bedtypes.js | v2/bed-types.js | modules/crud | ✅ CRUD-base (see batch) |
| A23 | bed-numbers | no_beds.js | v2/bed-numbers.js | modules/crud | ✅ CRUD-base (see batch) |
| A24 | guest-numbers | no_guests.js | v2/guest-numbers.js | modules/crud | ✅ CRUD-base (see batch) |
| A25 | services | services.js | v2/services.js | modules/crud (services) | ✅ CRUD-base (see batch) |
| A26 | lookups / generalsettings | generalsettings.js | v2/lookups.js | modules/lookups | ✅ Nest faithful (roles lookup) |
| A27 | taxes | taxes.js | *(none — dropped at v2)* | *(not in Nest)* | 🚫 DROPPED at v2 — verify with product |
| A28 | notifications | notifications.js | *(none — dropped at v2)* | *(not in Nest)* | 🚫 DROPPED at v2 — verify with product |
| A29 | offers | *(none — new)* | v2/offers.js | modules/crud (offers) | ✅ ➕ CRUD-base (see batch) |
| A30 | commissions | *(none — new)* | v2/commissions.js | modules/commissions | ✅ ➕ Nest faithful (stub, incl. 400 quirk) |
| A31 | suggested-rates | pricing.js (partial?) | v2/suggested-rates.js | modules/suggested-rates | ✅ Nest faithful + StrictPopulate/email improvements |
| A32 | app-version | *(none — new)* | v2/app-version.js | modules/app-version | ✅ ➕ Nest faithful + auth hardening |

### B. Guest API module (legacy `controllers/api/*` → `controllers/api/v2|v3/*`) — NestJS coverage TBD

| # | Module | Legacy controller | Migrated controller | Status |
|---|---|---|---|---|
| B1 | users | api/users.js | api/v2/users.js | ⬜ |
| B2 | properties | api/properties.js | api/v2/properties.js | ⬜ |
| B3 | bookings | api/booking.js | api/v2/bookings.js | ⬜ |
| B4 | payment | api/payment.js | api/v2/payment.js | ⬜ |
| B5 | main (search/home) | api/general.js (partial?) | api/v2/main.js | ⬜ |
| B6 | ratings | api/rating.js | *(disabled, no v2 — verify)* | ⬜ |
| B7 | favourites | api/favourites.js | *(disabled, no v2 — verify)* | ⬜ |
| B8 | v3 booking filters | — | api/v3/showbookingsfilter.js | ⬜ ➕ |
| B9 | v3 guest user | — | api/v3/guestUser.js | ⬜ ➕ |
| B10 | v3 resend confirmation | — | api/v3/resendConfirmationMail.js | ⬜ ➕ |

### C. Reused v1 guest APIs (active, audit for correctness only)

| # | Module | Controller | Status |
|---|---|---|---|
| C1 | terms-and-conditions | api/termsAndConditions.js | ⬜ |
| C2 | faq | api/faq.js | ⬜ |
| C3 | notifications | api/notifications.js | ⬜ |
| C4 | userratings | api/userratings.js | ⬜ |
| C5 | website | api/website.js | ⬜ |
| C6 | contactus | api/contactus.js | ⬜ |

---

## Per-Module Audit Reports

### A1 — auth

**Audited:** 2026-07-02 | **Verdict (legacy→v2):** ⚠️ CHANGED — all legacy functions migrated, but with 1 functional regression and 2 security findings
**Accuracy:** 2/4 legacy endpoints fully equivalent (50%); 4/4 functionally present
**Files:** legacy `admin/controllers/login.js`, `admin/controllers/resetpassword.js` (session, model `db/models/admins`) → v2 `admin/controllers/v2/auth.js` (JWT + passport, model `db/models/administrators`) → NestJS `src/modules/auth/*`
**NestJS verification (2026-07-02):** ❌ The two security BLOCKERs are **reproduced**, plus a weak-secret default. Files: `modules/auth/{auth.controller,auth.service}.ts`, `strategies/{local,jwt}.strategy.ts`, `config/configuration.ts`, `modules/administrators/schemas/administrator.schema.ts`.

- ❌ **[BLOCKER — reproduced] Inactive-admin can still log in.** `AuthService.validateAdministrator` (auth.service.ts L25–36) does `findOne({email})` + `bcrypt.compare` only — no `status` check. `autoLogin` (L61–83) also omits it. Deactivated administrators authenticate successfully. **Fix:** reject `status === false` in both.
- ❌ **[BLOCKER — reproduced] Password hash leaked in JWT + login response.** `validateAdministrator` selects `+password`; `signToken` signs `administrator.toJSON()` and `buildLoginResponse` returns `user: administrator`. `administrator.schema.ts` defines no `toJSON` transform, so the bcrypt hash rides in the (client-decodable) JWT payload and the response body. Same in `autoLogin`. **Fix:** add a schema `toJSON` transform deleting `password` (and ideally sign a minimal claim set, not the whole doc).
- ❌ **[BLOCKER — reproduced] Weak JWT secret default.** `config/configuration.ts` L4: `apiSecret: process.env.API_SECRET || 'secret'`; `jwt.strategy.ts` uses it with `ignoreExpiration: true`. Missing env → forgeable, non-expiring tokens. **Fix:** fail fast if `API_SECRET` unset; add expiry.
- ⚠️ **[WARN — reproduced] Login by phone dropped** — `validateAdministrator` matches `email` only (legacy accepted phone OR email).
- ⚠️ **[WARN — reproduced] Login-failure contract** — `LocalStrategy.validate` throws `UnauthorizedException` → `401`, not the legacy `200 {status:0,...}`.
- ✅ **[FIXED] change-password privilege** — controller passes `req.user._id` (from JWT) to the service; a caller can only change their own password. `/migrate-*` routes correctly **omitted** (documented in the controller).
- ✅ **[FIXED] change-password / reset-password hashing** — explicit `bcrypt.hashSync(…,10)`.
- ℹ️ **[INFO]** `/reset-password` still reveals whether an email is registered (enumeration) — matches legacy.

**Nest verdict:** partial — functional parity good, but the security posture of the v2 login path was carried over intact. These three are the top fixes for the auth module.

| Endpoint (v2 `/admin/v2/auth`) | Legacy equivalent | Auth | Logic | Response | Status |
|---|---|---|---|---|---|
| POST /login | POST /admin/login/check | session → JWT | ⚠️ | ⚠️ | CHANGED |
| POST /reset-password | POST /admin/login/resetpassword | public (both) | ✅ | ✅ | MATCH |
| POST /change-password | POST /admin/resetpassword | JWT (was: id in body!) | ✅ | ✅ | MATCH (improved) |
| POST /logout | GET /admin/logout | — | ⚠️ no-op (JWT stateless) | ✅ | CHANGED |
| GET /ping, POST /auto-login, POST /authorized | — | mixed | — | — | NEW |
| POST /migrate-* (7) | — | JWT (any admin) | ❌ | — | NEW (one-off; not ported to Nest — correct) |

**Findings:**

- ❌ **[BLOCKER] Inactive-admin check dropped.** Legacy `/login/check` rejected `status == 0` ("Inactive User"). v2 passport strategy `local-administrator-login` (`middleware/passport.js` L11–37) checks only email + password — deactivated admins can still log in. → **Verify Nest `local.strategy.ts` re-adds the status check.**
- ❌ **[BLOCKER] Password hash leaked in JWT + response.** Strategy selects `+password`; `/login` does `jwt.sign(req.user.toJSON())` and returns `user: req.user`; `administrators` schema has no `toJSON` transform stripping password. Same in `/auto-login`. → **Verify Nest strips password before signing/returning.**
- ❌ **[BLOCKER] `/migrate-*` (7) live in v2 production routes**, callable by any authed admin, with buggy catch blocks (undefined `newAdmin.name`) and un-awaited `map(async …)`. Correctly **not ported** to Nest per MIGRATION.md.
- ⚠️ **[WARN] Login failure contract changed** — `passport.authenticate` with no custom callback → `401` plain text instead of legacy `200 {status:0,...}`; in-handler `else` is dead code.
- ⚠️ **[WARN] Login by phone dropped** — legacy matched `{phone} OR {email}`; v2 is email-only.
- ⚠️ **[WARN] Weak JWT secret fallback** — `API_SECRET || "secret"`.
- ℹ️ **[INFO] change-password privilege bug fixed** — legacy took target `id` from body (any session could change any admin's password); v2 uses `req.user._id`.
- ℹ️ **[INFO] Password hashing** moved from model `pre('save')` hook to explicit `bcrypt.hashSync` in v2 handlers.
- ℹ️ **[INFO]** `/reset-password` reveals whether an email is registered (enumeration) — present in legacy too.

---

### A2 — administrators

**Audited:** 2026-07-02 | **Verdict (legacy→v2):** ❌ REGRESSION — core CRUD migrated well, but authorization is broken on all write endpoints and delete safety logic was dropped
**Accuracy:** 5/9 legacy operations fully equivalent (56%); 1 changed, 1 regressed, 2 missing/relocated
**Files:** legacy `admin/controllers/hoteladmins.js` (session, model `hoteladmins`) → v2 `admin/controllers/v2/administrators.js` (JWT + role permissions, model `administrators`) → NestJS `src/modules/administrators/*`
**NestJS verification (2026-07-02):** ⚠️ The broken-authz BLOCKER is **fixed**; the DELETE-safety BLOCKER and the onboarding/mass-assign warnings **remain**. Files: `modules/administrators/{administrators.controller,administrators.service}.ts`, `dto/{create,update}-administrator.dto.ts`, `common/auth/permissions.guard.ts`, `main.ts`.

- ✅ **[FIXED] Authorization now enforced.** Every write route carries `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('LIST_ADMINISTRATORS')`; `PermissionsGuard` **throws** `ForbiddenException` before the handler runs (permissions.guard.ts L27–29). The v2 "missing `return` after 401 → write still executes → `ERR_HTTP_HEADERS_SENT`" bug is gone.
- ❌ **[BLOCKER — reproduced] DELETE still has no safety logic.** `AdministratorsService.remove` (administrators.service.ts L180–182) is just `deleteOne({_id})`. No active-booking guard, no cascade of properties/rooms/favourites. `check_active_bookings` remains unported. Deleting an admin still orphans their properties.
- ⚠️ **[WARN — reproduced] Write ops gated by a read permission.** create/modify/remove all require `LIST_ADMINISTRATORS` — no granular manage permission.
- ⚠️ **[WARN — partially fixed] Mass assignment.** Global `ValidationPipe({whitelist:true})` (main.ts) + `UpdateAdministratorDto` (PartialType of `CreateAdministratorDto`) strip unknown fields, so `password` **cannot** be mass-assigned (not in the DTO) — good. **But** `status` and `role` **are** in the DTO, so any `LIST_ADMINISTRATORS` holder can set another admin's `role`/`status` via `PUT /:id` (privilege-escalation surface). Email uniqueness still not re-checked (`findOneAndUpdate` bypasses the unique validator → generic error on collision).
- ⚠️ **[WARN — reproduced] Public onboarding brute-force.** `/onboarding` + `/onboarding/verify` are unguarded (matches legacy); `activationCode`/`autoLoginCode` are still `Math.floor(random*9000)+1000` (4 digits), no rate limiting, and `messageCode:'emailExists'` enables enumeration. Combined with A1 `/auto-login`, the takeover path is intact.
- ℹ️ **[INFO] create response leaks the hashed password** — `create` returns the in-memory saved doc where `password` was set; with no schema `toJSON` transform the hash is in the body (same root cause as A1). list/getById use `.lean()` + `select('+email')` only, so they don't leak.
- ✅ **[INFO] Improvements preserved** — JSON responses, keyword/role search + sort, property back-refs, bcrypt on create, `MailService` templating.

**Nest verdict:** meaningful improvement over v2 (authz actually works), but the destructive DELETE and the onboarding brute-force path are the two things to fix next; then close the role/status mass-assign gap.

| Endpoint (v2 `/admin/v2/administrators`) | Legacy equivalent | Auth | Logic | Response | Status |
|---|---|---|---|---|---|
| GET / (list; q/role/sort) | GET /admin/hoteladmins | JWT+perm ⚠️ | ✅ | ✅ JSON | MATCH (improved) |
| GET /me | — | JWT | — | — | NEW |
| GET /:id (incl. properties) | GET /admin/hoteladmins/:id | JWT+perm ⚠️ | ✅ | ✅ | MATCH (improved) |
| POST / (create, generated pwd) | POST /admin/hoteladmins/admin/new | JWT+perm ❌ | ✅ | ✅ | MATCH* |
| PUT /:id | POST /admin/hoteladmins/update | JWT+perm ❌ | ⚠️ | ✅ | MATCH* |
| DELETE /:id | GET /admin/hoteladmins/delete/:id | JWT+perm ❌ | ❌ | ✅ | REGRESSION |
| POST /send-welcome-email/:id | GET /admin/hoteladmins/welcomemail/send | JWT | ✅ | ✅ | MATCH (improved) |
| — (use PUT with status) | POST /admin/hoteladmins/disable | — | ⚠️ | — | CHANGED |
| — | POST /admin/hoteladmins/check_active_bookings | — | — | — | MISSING |
| — (moved?) | POST /admin/hoteladmins/addproperty (multer: licence + passport) | — | — | — | RELOCATED — verify in A5 |
| POST /onboarding, /onboarding/verify | — | **public** ⚠️ | — | — | NEW |

**Findings:**

- ❌ **[BLOCKER] (v2) 401 responses don't stop execution.** In `list/getById/create/modify/remove`, permission check does `res.status(401).send(...)` **without `return`** → the create/update/delete runs anyway, then `ERR_HTTP_HEADERS_SENT`. → **Nest guards should fix this; confirm every write route carries `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@Permissions(...)`.**
- ❌ **[BLOCKER] (v2) DELETE lost all safety logic.** Legacy refused delete when properties had active bookings and cascaded cleanup (properties + rooms, pull from user favourites). v2 `deleteOne`s only the admin. `check_active_bookings` dropped. → **Verify Nest `remove()`.**
- ⚠️ **[WARN] Write ops gated by a read permission** (`LIST_ADMINISTRATORS`). No granular MANAGE/EDIT.
- ⚠️ **[WARN] Public onboarding uses 4-digit codes.** `/onboarding` (no auth) emails a 1000–9999 code; `/onboarding/verify` mints a 4-digit `autoLoginCode` that A1 `/auto-login` accepts for a full JWT. No rate limiting → brute-forceable takeover. `messageCode:"emailExists"` enables enumeration. → **Verify Nest onboarding.**
- ⚠️ **[WARN] PUT /:id** — `findOneAndUpdate` bypasses unique-validator (email dup → generic 500); `$set: req.body` unfiltered (mass assignment of password/role/status).
- ℹ️ **[INFO] Improvements:** list/get JSON (were EJS), keyword/role search, sorting, property back-refs; create bcrypt-hashes password; welcome email moved to `emails/welcome.html`.
- ℹ️ **[INFO] Intentional model change** `hoteladmins` → `administrators`; legacy `addproperty` responsibility relocated — confirm in A5.

---

### A3 — users

**Audited:** 2026-07-02 | **Verdict (legacy→v2):** ⚠️ CHANGED — list/get/delete migrated (and list improved), but authorization is broken on writes, the status toggle was dropped, and the detail endpoint returns unbounded booking data
**Accuracy:** 3/5 legacy endpoints functionally covered (60%); 2 changed, 1 missing, 1 disabled
**Files:** legacy `admin/controllers/users.js` (session, EJS) → v2 `admin/controllers/v2/users.js` (JWT + `LIST_USERS`, JSON) → NestJS `src/modules/users/*`
**NestJS verification (2026-07-02):** ⚠️ Authz and the plaintext-password risk are **fixed**; the unbounded-bookings payload is **reproduced** (and now also on PUT). Files: `modules/users/{users.controller,users.service}.ts`, `dto/update-user.dto.ts`, `main.ts`.

- ✅ **[FIXED] Authorization enforced.** `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('LIST_USERS')` are declared **class-level** on `UsersController` (applies to GET/PUT/DELETE); the guard throws before the handler. v2 missing-`return` bug gone.
- ✅ **[FIXED] Plaintext-password mass assignment.** `UpdateUserDto` does **not** include `password`, and the global `whitelist:true` pipe strips it — a `password` in the PUT body is dropped, so it can no longer be written unhashed. (`status`, `favourites`, `email` are intentionally whitelisted and editable; email uniqueness still not re-checked.)
- ❌ **[BLOCKER — reproduced, wider] Unbounded booking arrays.** `getExtraUserInformation` (users.service.ts L118–167) still does `userBookingModel.find({user})` **and** `completedBookingModel.find({user})` with no limit and inlines both arrays. It runs on **`GET /:id` and `PUT /:id`** now, so the heavy payload appears on edits too. **Fix:** return only the computed `amount`/`count`, or paginate the arrays.
- ⚠️ **[WARN — reproduced] No dedicated enable/disable.** Status is changed only via `PUT /:id` (`status:number` is in the DTO). Functional, but the legacy `POST /status/:id` toggle has no direct equivalent.
- ✅ **[INFO] List aggregation preserved** — single `$lookup` pipeline (no N+1); `POST` create correctly not ported (matches disabled v2 route); `DELETE` verb correct. No cascade cleanup of the user's bookings/favourites (pre-existing gap).

**Nest verdict:** the two security-relevant v2 issues (authz, unhashed password) are resolved; the one remaining real problem is the unbounded booking payload on `GET`/`PUT /:id`.

| Endpoint (v2 `/admin/v2/users`) | Legacy equivalent | Auth | Logic | Response | Status |
|---|---|---|---|---|---|
| GET / (q search, sort, booking counts) | GET /admin/users | JWT+perm ⚠️ | ✅ (improved) | ✅ JSON | MATCH (improved) |
| GET /:id (user + all bookings + totals) | GET /admin/users/view/:id | JWT+perm ⚠️ | ⚠️ | ✅ | CHANGED |
| (merged into GET /:id) | GET /admin/users/view/completed/:id | — | — | — | MERGED |
| PUT /:id (edit) | — (legacy had no edit) | JWT+perm ❌ | ⚠️ | ✅ | NEW |
| DELETE /:id | GET /admin/users/delete/:id | JWT+perm ❌ | ✅ | ✅ | MATCH (improved verb) |
| POST / (create) — **route commented out** | — | — | — | — | DISABLED |
| — | POST /admin/users/status/:id (enable/disable) | — | — | — | MISSING |

**Findings:**

- ❌ **[BLOCKER] (v2) Missing `return` on 401 checks** in all five handlers → PUT/DELETE run without permission, then `ERR_HTTP_HEADERS_SENT`. → **Nest guards should fix; confirm.**
- ❌ **[BLOCKER] (v2) Status enable/disable dropped.** Legacy `POST /status/:id` toggled "Enable"/"Disable"; v2 only via mass-assign `PUT /:id`. (Legacy toggle itself was buggy — sent no response.)
- ⚠️ **[WARN] `GET /:id` returns unbounded booking arrays.** `getExtraUserInformation` finds all UserBooking + CompletedBooking with no limit and inlines both. Legacy paginated. → **Verify Nest.**
- ⚠️ **[WARN] `PUT /:id` mass assignment + plaintext password risk** — `findOneAndUpdate($set:req.body)`; bypasses pre-save hook so `password` stored unhashed.
- ℹ️ **[INFO] List is a real improvement** — single `$lookup` pipeline vs legacy per-user N+1.
- ℹ️ **[INFO] Delete verb fixed** GET → DELETE. Neither version cascades booking/favourite cleanup.
- ℹ️ **[INFO] Country filter left commented out** in v2 `list` (dead code).
- ℹ️ **[INFO] Response EJS → JSON**; `completed_view` folded into `GET /:id`.

---

### A4 — user-ratings

**Audited:** 2026-07-02 | **Verdict:** ✅ Nest is the strongest of the three — it ports both live v2 endpoints faithfully **and** fixes a v2 performance regression the legacy code didn't have.
**Accuracy:** 2/2 live v2 endpoints ported (100%); list improved, approval improved.
**Files:** legacy `admin/controllers/userreviews.js` (session, EJS) → v2 `admin/controllers/v2/user-ratings.js` (JWT + `LIST_USER_RATINGS`, JSON) → NestJS `src/modules/user-ratings/*`

| Endpoint (v2/Nest `/admin/v2/user-ratings`) | Legacy equivalent | Auth | Logic | Response | Status |
|---|---|---|---|---|---|
| GET / (filter property/approved, sort incl. by property name) | GET /admin/userreviews | JWT+perm | ✅ (Nest fixes heap) | ✅ JSON | MATCH (improved) |
| PUT /:id/approval/:status (explicit approve/unapprove + recompute property rating) | POST /admin/userreviews/approved (toggle) | JWT+perm | ✅ (Nest uses updateOne) | ✅ | CHANGED (improved) |

**Legacy → v2 findings:**

- ❌ **[BLOCKER — v2 regression] `list` loads the entire collection then `Array.splice()`s for pagination.** v2 (`user-ratings.js` L126–141) drops the DB `skip/limit` and pulls every matching rating into memory to allow sorting by the populated `property.name`. Ironically **legacy paginated at the DB** (`.limit/.skip/.lean`), so v2 *introduced* a heap risk that grows with the ratings collection.
- ⚠️ **[WARN — v2] Missing `return` on 401** in both `list` and `approval` (same systemic bug as A2/A3).
- ⚠️ **[WARN — v2/legacy] `approved` filter passes a raw string.** `where.approved = req.query.approved` ("true"/"false") is compared against a Boolean field; also `if (approved !== '')` fires when the param is `undefined`, so `where.approved = undefined`. Boolean casting of `"false"` is unreliable.
- ⚠️ **[WARN] Contract change (intentional):** legacy `POST /approved {id}` **toggled** the flag; v2/Nest use `PUT /:id/approval/:status` with an explicit value. Cleaner and idempotent — but callers must send the target state, not just an id.

**NestJS verification (2026-07-02):** ✅ Best implementation of the three. Files: `modules/user-ratings/{user-ratings.controller,user-ratings.service}.ts`, `schemas/user-rating.schema.ts`.

- ✅ **[FIXED] Authorization** — class-level `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('LIST_USER_RATINGS')`; guard throws before the handler. v2 missing-`return` bug gone. `LIST_ALL_PROPERTIES` still gates the properties dropdown (computed in the controller and passed to the service).
- ✅ **[FIXED] Heap regression.** `list` paginates at the DB (`skip/limit/lean`); the one case the DB can't sort natively — `orderBy=property` (populated field) — is handled with an `$lookup` + `$sort` + `$skip/$limit` aggregation, so only **one page** is materialised. This is better than both v2 (load-all) and legacy.
- ✅ **[IMPROVED] Rating recompute** — `updatePropertyRating` uses `updateOne({$set:{user_rating}})` instead of legacy/v2 load-mutate-`save()`, and guards `count > 0`. Added `{property, approved}` index for the hot filter/aggregation path.
- ✅ **[FIXED] `approved` filter guard** — `if (query.approved !== undefined && query.approved !== '')` closes the v2 `undefined` case.
- ⚠️ **[WARN — reproduced] Boolean cast of string state.** Both the `approved` list filter and `approval(:status)` write pass the raw string (`"true"`/`"false"`) into a Boolean path (`$set:{approved: status}`). Mongoose's cast of the string `"false"` is version-dependent and can resolve truthy — validate/coerce to a real boolean (`status === 'true'`) and reject other values. Low severity but worth hardening.
- ℹ️ **[INFO]** No DTO needed (params only); response is JSON (was EJS). Endpoint set matches v2 exactly.

**Nest verdict:** ✅ ship-quality. The only nit is coercing the `approved`/`:status` string to a real boolean.

---

### A5 — properties (incl. photos + nearby)

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful, high-quality port — all 11 v2 endpoints present with matching logic; photo handling improved. One inherited authorization gap (IDOR on by-id operations) is reproduced.
**Accuracy:** 11/11 live v2 endpoints ported (100%).
**Files:** legacy `admin/controllers/{properties,photos,nearby}.js` → v2 `admin/controllers/v2/properties.js` → NestJS `src/modules/properties/{properties.controller,properties.service}.ts` + `upload.config.ts`.

| Endpoint (`/admin/v2/properties`) | Auth | Logic | Response | Status |
|---|---|---|---|---|
| GET / (owner scope + q/company/country/city/source/agreement/approved/published filters, sort, pagination, total_rooms) | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| GET /has-agreement-signed (declared before `:id`) | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| GET /:id (commission defaults injected) | LIST_PROPERTIES | ⚠️ no owner scope | ✅ | MATCH* |
| POST / (multipart: trade_licence + passport; preCreateOrUpdate normalisation; max_day default 25) | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| PUT /:id (load-mutate-save to persist nested subdocs) | LIST_PROPERTIES | ⚠️ no owner scope | ✅ | MATCH* |
| DELETE /:id | LIST_PROPERTIES | ⚠️ no owner scope, no cascade | ✅ | MATCH* |
| POST /:id/nearby (image upload) | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| DELETE /:id/nearby/:nearbyId | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| POST /:id/photos (upload + resize 800) | LIST_PROPERTIES | ✅ (improved) | ✅ | MATCH (improved) |
| POST /:id/photos/feature | LIST_PROPERTIES | ✅ | ✅ | MATCH |
| POST /:id/photos/remove (url in body, not DELETE) | LIST_PROPERTIES | ✅ | ✅ | MATCH |

**Findings:**

- ⚠️ **[WARN — v2 gap reproduced in Nest] IDOR on by-id operations.** Owner scoping (`LIST_OWN_PROPERTIES` without `LIST_ALL_PROPERTIES` → restrict to `administrator == me` OR `me ∈ allAdministrators`) is applied only in `list` and `hasAgreementSigned`. `single`, `modify`, `remove`, and all nearby/photo mutations query by `{_id}` alone. Since Hotel-Admin/Receptionist roles hold `LIST_PROPERTIES`, such a user can **read, edit, delete, and re-photo any property by id**, not just their own. Present in v2 (`single/modify/remove` use bare `where={_id}`) and **reproduced** in the Nest service. Fix: apply the same owner-scope `$or` to by-id reads/writes when the caller lacks `LIST_ALL_PROPERTIES`.
- ⚠️ **[WARN — v2 parity] Mass assignment on create/modify.** Both accept the raw body (`@Body() any`, deliberately bypassing the whitelist pipe to preserve the large nested payload). `approved`, `published`, `user_rating`, etc. can be set directly. `preCreateOrUpdate` does strip `agreement.commission*` when the caller lacks `MANAGE_AGREEMENT` (parity kept), but nothing else is gated. Consider a typed DTO or explicit field guard for the sensitive flags.
- ⚠️ **[WARN — v2 parity] DELETE has no cascade.** `remove` is a bare `deleteOne` — the property's rooms/availability/bookings are left orphaned. Matches v2 (not a Nest regression), but worth a cleanup pass.
- ✅ **[FIXED/IMPROVED] Photo resize.** v2 re-fetched the just-uploaded file over HTTP (`request(config.api_url + path).pipe(sharp().resize(800)…)`) — fragile and dependent on `api_url`. Nest resizes the uploaded original directly: `sharp(file.path).resize(800).toFile('public/files/properties/…')`. Same result, no network round-trip, original preserved in `public/files/original/properties` (dirs auto-created). Callback-style error handling replaced with async/await.
- ✅ **[FIXED] approved/published filter.** v2's `if (approved || approved === false)` never matched the string `"false"`; Nest explicitly handles `'true'`/`'false'`, so the publish/approval filters actually work.
- ✅ **[INFO] No missing-`return` bug here.** Unlike A2/A3, v2 properties used a boolean-guard pattern (`if (hasPermissions(req,res)) { … }`), so unauthorized calls didn't fall through. Nest uses real guards. Authz-crash class of bug not present in either.
- ✅ **[RESOLVES A2 open item] `addproperty` relocation confirmed.** The legacy `hoteladmins/addproperty` responsibility (property creation with `trade_licence_attachment` + `passport_attachment` uploads) is fully covered by `POST /properties` create here (`PROPERTY_DOC_FIELDS` + `preCreateOrUpdate`). No coverage gap.
- ✅ **[INFO] Faithful parity** on owner scoping in list, the hotel-admin/receptionist role lookup for the company filter, commission defaults on `single`, geo-`location` defaulting, `weekends` CSV parsing, and the nearby subdoc create/pull.

**Nest verdict:** ✅ strong, near-exact port; the photo path is better than v2. Priority fix is applying owner scoping to the by-id read/write routes (the IDOR is inherited from v2, not introduced here, but it's real).

---

### A6 — rooms (incl. rates + availability + photos)

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful, high-quality port of a complex module — all 13 v2 endpoints present; several latent v2 bugs fixed. Inherits v2's lack of owner scoping.
**Accuracy:** 13/13 live v2 endpoints ported (100%).
**Files:** legacy `admin/controllers/{rooms,availability,pricing}.js` → v2 `admin/controllers/v2/rooms.js` → NestJS `src/modules/rooms/{rooms.controller,rooms.service}.ts` + `common/mail/mail.service.ts`.

| Endpoint (`/admin/v2/rooms`) | Auth | Logic | Response | Status |
|---|---|---|---|---|
| GET / (filter propertyId, sort, paginate) | LIST_ROOMS | ✅ | ✅ | MATCH |
| GET /:id (deep property populate) | LIST_ROOMS | ✅ | ✅ | MATCH |
| POST / (create; extrabed normalisation) | LIST_ROOMS | ✅ | ✅ | MATCH |
| PUT /:id (load-mutate-save) | LIST_ROOMS | ✅ | ✅ | MATCH |
| DELETE /:id | LIST_ROOMS | ⚠️ no cascade | ✅ | MATCH* |
| POST /:id/rates | LIST_ROOMS | ✅ | ✅ | MATCH |
| PUT /:id/rates/:rateId (rate-suggestion request/reject emails) | LIST_ROOMS | ✅ (refactored + bugfix) | ✅ | MATCH (improved) |
| DELETE /:id/rates/:rateId | LIST_ROOMS | ✅ | ✅ | MATCH |
| GET /:id/availability (tz-aware slot ranges) | LIST_ROOMS | ✅ | ✅ | MATCH |
| POST /:id/availability/:action (block/unblock) | LIST_ROOMS | ✅ | ✅ | MATCH |
| POST /:id/photos (upload + resize 800) | LIST_ROOMS | ✅ (improved) | ✅ | MATCH (improved) |
| POST /:id/photos/feature | LIST_ROOMS | ✅ | ✅ | MATCH |
| POST /:id/photos/remove | LIST_ROOMS | ✅ | ✅ | MATCH |

**Findings:**

- ✅ **[FIXED] `StrictPopulateError`.** Legacy/v2 populated both `property_id` **and** a bogus `property` path that isn't on the rooms schema. Under Mongoose 8 that throws — Nest drops the invalid `property` path from `populations`/`singlePopulations`. Without this the whole rooms module would 500.
- ✅ **[FIXED] Latent ObjectId-comparison bug in `modifyRate`.** v2 gated the "rejected your suggestion" email on `resource.property_id.administrator._id !== req.user._id` — a reference comparison of two ObjectId instances, which is **always true**, so v2 effectively mailed the owner on every suggestion-clear regardless of who did it. Nest compares `String(...) !== String(userId)`, so the mail fires only when a *different* user rejects. ⚠️ **Behavioural divergence** (Nest is correct, but the notification pattern differs from production v2) — flag for product sign-off.
- ✅ **[IMPROVED] Rate-suggestion emails refactored.** v2 inlined `fs.readFileSync` + a ~200-line manual 24-hour red-diff table build for both the request and rejection templates. Nest moves this into `MailService.sendRateSuggestionRequest` / `sendRateSuggestionRejected`, reproducing the hourly weekday/weekend diff highlighting. Same output, far more maintainable. (Verify the template token set matches once, as it's now in one place.)
- ✅ **[IMPROVED] Photo resize** — same fix as A5: `sharp(file.path).resize(800)` directly instead of v2's `request(config.api_url + path).pipe(...)` HTTP refetch. Originals in `public/files/original/rooms`, resized in `public/files/rooms`.
- ✅ **[FAITHFUL] Availability engine.** `getSlotRanges` timezone handling (moment-timezone, UAE/India/Vietnam zone selection) is preserved; `changeAvailability` keeps the batched `insertMany`/`deleteMany` for booking-logs (one write per action, not per slot) and replaces the `underscore` filters with native array ops. Block/unblock branch logic matches v2 line-for-line.
- ⚠️ **[WARN — v2 parity] No owner scoping anywhere.** Rooms only checks `LIST_ROOMS`; neither `list` (filters by `propertyId` only) nor the by-id read/write routes restrict a Hotel-Admin to their own property's rooms. Same IDOR class as A5, but here **not even list is scoped**. Pre-existing in v2 — not a Nest regression, but the whole rooms surface is cross-tenant readable/writable by any `LIST_ROOMS` holder.
- ⚠️ **[WARN — v2 parity] Mass assignment on create/modify/rates.** Raw `@Body() any` (deliberate, to preserve nested rate payloads). `isExistPriceSuggestion`, `suggestedRatePercentage`, `rates`, `images` can all be set directly. No DTO/whitelist.
- ⚠️ **[WARN — v2 parity] DELETE has no cascade.** `remove` is a bare `deleteOne`; the room's `bookings`/`slots`/`bookinglogs` are left orphaned. (Per `MIGRATION.md`, `bookings`/`slots`/`bookinglogs` are owned by RoomsModule until the bookings module lands — revisit cascade then.)

**Nest verdict:** ✅ the best implementation of a hard module — it fixes two bugs that would break or misbehave under the new stack (StrictPopulate, ObjectId compare) and cleans up the email/photo paths. Open items are all v2-parity: owner scoping, mass assignment, delete cascade. Confirm the changed rate-rejection email trigger is acceptable to product.

---

### A7 — bookings (list/single + cancellation + no-show workflows)

**Audited:** 2026-07-02 | **Verdict:** ⚠️ Faithful, careful port of the highest-risk module — all 8 live v2 endpoints present, with real fixes (heap, PII-crash) — but two email-behaviour items and the owner-scoping gap need product/security sign-off before cutover.
**Accuracy:** 8/8 live v2 endpoints ported (100%); create/modify correctly omitted (commented out in v2).
**Files:** legacy `admin/controllers/{bookings,checkinout,completedbookings,cancelbookings}.js` → v2 `admin/controllers/v2/bookings.js` → NestJS `src/modules/bookings/{bookings.controller,bookings.service}.ts` + `common/mail/mail.service.ts`.

| Endpoint (`/admin/v2/bookings`) | Auth | Logic | Response | Status |
|---|---|---|---|---|
| GET / (active↔completed model switch, owner scope, PII mask, hotelFinalAmount) | JWT only | ✅ (heap fixed) | ✅ | MATCH (improved) |
| GET /:id/:status (single, PII mask, hotelFinalAmount) | JWT + LIST_BOOKINGS | ✅ | ✅ | MATCH |
| POST /cancel (cancel_request=1, mail) | JWT only | ✅ | ✅ | MATCH |
| POST /reject-cancellation/:id (cancel_approval=2, mail) | JWT only | ⚠️ mail recipient divergence | ✅ | CHANGED |
| DELETE /:id (pull slots, delete booklogs, cancel_approval=1, mail guest) | JWT only | ✅ | ✅ | MATCH |
| POST /noshow (noshow_request=1, mail) | JWT only | ✅ | ✅ | MATCH |
| POST /reject-noshow/:id (nowshow_approval=2, mail) | JWT only | ⚠️ mail recipient divergence | ✅ | CHANGED |
| DELETE /noshow/:id (declared before :id; pull slots, delete booklogs, nowshow_approval=1, mail) | JWT only | ✅ | ✅ | MATCH |

**Findings:**

- ✅ **[FIXED] Heap risk in `list`.** v2 always ran `find(where).sort().populate().lean()` with **no** `limit/skip`, loading the entire filtered booking set into memory before `Array.splice()`. Nest paginates at the DB (`skip/limit`) for normal sorts and only falls back to load-all for the `orderBy=property` case (populated/embedded name, not DB-sortable) — same optimisation as A4.
- ✅ **[FIXED] PII-mask crash.** v2 called `guestinfo.email.replace(...)` with no null check → a booking with no guest email would throw. Nest guards `if (guestinfo.email)` / `if (guestinfo.mobile)` before masking.
- ✅ **[FAITHFUL] Guest PII masking.** Email (`a***@…`) and mobile (last-4) masking applied when the caller lacks `LIST_ALL_BOOKINGS`, in both `list` and `single`. Preserved exactly.
- ✅ **[FAITHFUL] `hotelFinalAmount`.** Charges filtered to exclude `tourism_fee`, summed as a percentage of `hotelAmt`, with the same `hotelAmt<=0 → 0` guard. Active reads use `property.charges`; completed use `propertyInfo.id.charges`.
- ✅ **[IMPROVED] Persistence + cleanup.** Flag changes use `updateOne({$set})` instead of load-mutate-`save()` (no full-doc re-cast); slot cleanup uses `updateMany({}, {$pull:{slots:{userbooking:id}}})` and `bookinglogs.deleteMany({userbooking:id})` — matches v2 semantics on Mongoose 8. Completed bookings' `propertyInfo.id` is joined manually (embedded doc, not a ref) to avoid `StrictPopulateError`.
- ✅ **[IMPROVED] Emails via `MailService.sendTemplated`** (global token replacement) instead of six inline `fs.readFileSync` + `.replace()` blocks.
- ⚠️ **[WARN — behavioural divergence] Rejection emails now have a real `to:` recipient.** In v2 `rejectCancellation` and `noShowRejectCancel`, the `to:` line was **commented out** — only `bcc: [noreply@stayhopper.com]` was active, so the property owner was never actually emailed on rejection. Nest sends `to: primaryReservationEmail`. This is likely the *intended* behaviour, but it **differs from production v2** — confirm with product before cutover (owners will suddenly start receiving rejection emails).
- ⚠️ **[WARN — v2 parity, must finalise] Test recipients hard-coded.** `cancel`, `noShow`, and `approveNoShow` still send `to: 'support@stayhopper.com'` (the v2 "TESTING" recipient); the production targets (`config.website_cancellation_email`, guest email, etc.) were commented out in v2 and remain so. `remove` correctly mails the guest (that line was active in v2). The disabled real recipients must be wired up before go-live — this is faithful to v2 but v2 itself was in a test state.
- ⚠️ **[WARN — v2 parity] No owner scoping on workflow endpoints or `single`.** `cancel/remove/reject-cancellation/noshow/reject-noshow/approveNoShow` all operate by `{_id}` with no check that the booking belongs to the caller's property; `single`'s owner check was commented out in v2 and remains absent (masking still applies). A `LIST_OWN_BOOKINGS` admin can cancel/delete/no-show **any** booking by id (IDOR). Reproduced from v2. `list` is also gated by JWT only (not `LIST_BOOKINGS`) — v2 had that permission check commented out too.
- ℹ️ **[INFO] Import style.** `bookings.service.ts` uses `import moment from 'moment'` (default) whereas `rooms.service.ts` uses `import * as moment from 'moment-timezone'`. Fine only if `esModuleInterop`/`allowSyntheticDefaultImports` is on — worth a one-line tsconfig check (a build would catch it).

**Nest verdict:** ⚠️ solid, faithful migration of a delicate module — the heap and PII-crash fixes are genuine improvements and the money math + masking are preserved exactly. Before cutover, product/security must decide on: (1) the rejection-email recipient change, (2) finishing the disabled production email recipients, and (3) whether to add owner scoping to the by-id workflow operations. None are Nest-introduced logic errors, but this is the module where they matter most.

---

### A8 — payments (invoices + capture/return)

**Audited:** 2026-07-02 | **Verdict:** ⚠️ Faithful money-movement port that fixes four latent v2 bugs (including an invoice data-leak), but the guest/hotel payment confirmation & cancellation emails are **deferred** (not sent) pending migration of the email subsystem.
**Accuracy:** 8/8 live v2 endpoints ported (6 invoices + capture + return).
**Files:** v2 `admin/controllers/v2/{invoices,capturePayment,returnPayment}.js` → NestJS `src/modules/invoices/*` + `src/modules/payments/payments.module.ts`.

| Endpoint | Auth | Logic | Response | Status |
|---|---|---|---|---|
| GET /invoices | JWT only | ✅ (heap fixed) | ✅ | MATCH (improved) |
| GET /invoices/:id | JWT + LIST_INVOICES | ✅ (owner-scope fixed) | ✅ | MATCH (improved) |
| POST /invoices | JWT + LIST_INVOICES | ⚠️ mass assign | ✅ | MATCH |
| PUT /invoices/:id | JWT + LIST_INVOICES | ⚠️ mass assign | ✅ | MATCH |
| DELETE /invoices/:id | JWT + LIST_INVOICES | ✅ | ✅ | MATCH |
| GET /invoices/:id/get-payment-link (Telr hosted order) | JWT + LIST_INVOICES | ✅ (fetch vs curl) | ✅ | MATCH |
| GET /capture/:bookingId (paid + VCC) | none (gateway) | ⚠️ emails deferred | ✅ | CHANGED |
| GET /return/:bookingId (refund/cancel) | none (gateway) | ⚠️ emails deferred | ✅ | CHANGED |

**Findings:**

- ❗ **[BLOCKER — feature gap, documented] Payment confirmation/cancellation emails not sent.** v2 `capture` sent `capturedPaymentEmail` (guest) + `capturedHotelEmail` (hotel); `return` sent `cancelledPaymentEmail` + `cancelledHotelEmail`. In Nest these are `// TODO` stubs — the underlying subsystem (`controllers/api/v2/email.js`, `emailHotel.js`) isn't migrated yet. Money movement and booking-state transitions are faithful, but **guests/hotels currently receive no payment or cancellation email**. Must migrate that subsystem (or bridge to `MailService`) before cutover. Flagged in `MIGRATION.md`.
- ✅ **[FIXED — security] Invoice `single` owner-scope was a data leak in v2.** v2's forbidden-invoice check did `res.status(401).send(...)` **without `return`**, so execution continued and the invoice was **still sent** (plus an `ERR_HTTP_HEADERS_SENT`). Nest throws `ForbiddenException`, so an own-scoped admin genuinely cannot read another property's invoice. Real fix.
- ✅ **[FIXED] Heap in invoice `list`.** v2 loaded the entire filtered invoice set and `splice()`d; Nest paginates at the DB (load-all only for the `orderBy=property` case).
- ✅ **[FIXED] `returnPayment.js` missing `config` import.** v2 `returnPayment.js` referenced `config.extranet_url` / `config.payment_website_url` but never imported `config` — the `invoice_id` and catch paths would throw `ReferenceError`. Nest uses injected `ConfigService`. (capturePayment.js did import it.)
- ✅ **[FIXED] `handleHotelPayment` null-deref order.** v2 set `pay.status` then checked `if (!pay)` *after* using it; Nest checks existence first.
- ✅ **[FIXED] Undefined `platform` in catch blocks.** Both v2 capture/return `catch` referenced an undefined `platform` variable (`if (platform === 'web')`) → a second error inside the handler. Nest logs via `Logger` and returns a clean `{status:0}`/null.
- ✅ **[FAITHFUL] VCC amount + state transitions.** `capture` sets `paid=1, hotel_approved=1`, computes `vccAmount = hotelAmt + Σ(non-tourism charges on hotelAmt)`, calls the payment-container `/capture/` then `/vcc/`, stores `ub.vcc`. `return` sets `paid=0, hotel_cancelled=1` and calls `/return/`. Guards (`!ub || hotel_approved` etc., `invoice_id → handleHotelPayment`) preserved. State writes use `updateOne` instead of load-save. Uses global `fetch` (Node 18+) instead of `request`/`curl-request`.
- ✅ **[FAITHFUL] No auth on capture/return** — legacy parity (these are payment-gateway return URLs). Correct to keep unguarded.
- ⚠️ **[WARN — v2 parity] Writes gated by `LIST_INVOICES` (a read permission)** and invoice create/modify accept raw `@Body() any` (mass assignment — `status`, `amount`, `paid` settable directly). Same class as A2/A5/A6.
- ⚠️ **[WARN — v2 parity] Neither version validates the payment-container response.** Only network errors are caught; a container-reported capture failure still proceeds (booking marked paid). Pre-existing risk worth hardening in the money path.

**Nest verdict:** ⚠️ the money-movement logic is faithfully ported and actually **safer** than v2 (four real bugs fixed, including an invoice data-leak). The single hard blocker for cutover is wiring up the deferred capture/return confirmation & cancellation emails; secondary items are the mass-assignment/permission gaps and (in both versions) the lack of payment-container response validation.

---

### A9 — dashboard

**Audited:** 2026-07-02 | **Verdict:** ✅ Clean, faithful port — 5 count endpoints, scoping preserved, no issues found.
**Accuracy:** 5/5 live v2 endpoints ported (100%); the commented-out CRUD handlers are correctly not ported.
**Files:** v2 `admin/controllers/v2/dashboard.js` → NestJS `src/modules/dashboard/dashboard.module.ts` (self-contained service + controller).

| Endpoint (`/admin/v2/dashboard`) | Auth | Logic | Status |
|---|---|---|---|
| GET /properties (count, live, source Website/Extranet) | SHOW_DASHBOARD | ✅ | MATCH |
| GET /bookings (active + completed counts) | SHOW_DASHBOARD | ✅ | MATCH |
| GET /user-ratings (approved/unapproved counts) | SHOW_DASHBOARD | ✅ | MATCH |
| GET /users (count + latest 5) | SHOW_DASHBOARD + **SHOW_FULL_DASHBOARD** | ✅ | MATCH |
| GET /invoices (pending count) | SHOW_DASHBOARD | ✅ | MATCH |

**Findings:**

- ✅ **[FAITHFUL] Authorization + scoping.** Class-level `@RequirePermissions('SHOW_DASHBOARD')`; `getUsers` additionally requires `SHOW_FULL_DASHBOARD` (throws `ForbiddenException`, matching v2's 401). `SHOW_OWN_DASHBOARD` (without full) restricts properties/bookings/ratings/invoices counts to the admin's own properties via the same `administrator`/`allAdministrators` query — reproduced exactly.
- ✅ **[FAITHFUL] Count logic.** `properties` live = `approved && published`; `bookings` splits active (`userbookings`) vs completed (`completed_bookings`); `invoices` counts `status:'pending'`; `users` returns count + latest 5 by `{createdAt:-1,_id:-1}`. All identical to v2.
- ✅ **[INFO] Guard pattern fixes the latent class of bug** — where v2 relied on `if (hasPermissions(...))` wrappers, Nest uses real guards; no missing-`return` exposure here (v2 dashboard didn't have write ops anyway).
- ℹ️ **[INFO — v2 parity] Source counts aren't own-scoped.** `countSourceExtranet`/`countSourceWebsite` are computed globally for every caller (no owner filter) in both v2 and Nest. So an own-scoped hotel admin sees platform-wide Website/Extranet totals on those two figures. Pre-existing; flag only if the dashboard exposes them to non-full admins.

**Nest verdict:** ✅ ship-quality, no action needed beyond the (pre-existing) source-count scoping note.

---

### A10–A25 + A29 — Shared CRUD-base resources (batched)

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful. All 17 v2 "standard CRUD" controllers are byte-for-byte copies of one generic template; the Nest `BaseCrudService` + `BaseCrudController` reproduce it exactly, with DB-side pagination and matching auth. One shared divergence (cities list envelope) and the usual v2-parity mass-assignment note.
**Covered (17):** A10 promo-codes, A11 policies, A12 terms, A13 terms-and-conditions, A14 faq, A15 countries, A16 cities, A17 currencies, A18 property-types, A19 property-ratings, A20 room-names, A21 room-types, A22 bed-types, A23 bed-numbers, A24 guest-numbers, A25 services, A29 offers.
**Files:** v2 `admin/controllers/v2/*.js` (17 near-identical files) → NestJS `common/crud/{base-crud.service,base-crud.controller}.ts` + `modules/crud/{crud.services,crud.controllers}.ts` (+ schemas in `common/reference/crud.schemas.ts`).

**Method:** verified `BaseCrudService`/`BaseCrudController` once against the v2 template, then reviewed the per-resource wiring (model, `moduleTitle`, `basePath`, `populations`, `filters`) for all 17. Spot-checked v2 `countries.js`, `cities.js`, `promo-codes.js` to confirm the template is genuinely uniform (it is — only `ModuleModel`, title, and cities' `country` filter/populate differ).

| Resource | Route | Populations | List filter | Notes |
|---|---|---|---|---|
| countries | /countries | — | — | image upload |
| cities | /cities | country | country | ⚠️ drops `countries` from list envelope |
| currencies | /currencies | — | — | |
| services | /services | — | — | |
| property-types | /property-types | — | — | |
| property-ratings | /property-ratings | — | — | |
| policies | /policies | — | — | FE alias `property-policies`→policies |
| terms | /terms | — | — | FE alias `property-terms`→terms |
| room-types | /room-types | — | — | collection `room_types` |
| room-names | /room-names | — | — | collection `room_names` |
| bed-types | /bed-types | — | — | collection `bed_types` |
| bed-numbers | /bed-numbers | — | — | collection `bed_numbers` |
| guest-numbers | /guest-numbers | — | — | collection `guest_numbers` |
| faq | /faq | — | — | |
| offers | /offers | — | — | new in v2 |
| promo-codes | /promo-codes | — | — | collection `promocodes` |
| terms-and-conditions | /terms-and-conditions | — | — | collection `termsandconditions` |

**Findings:**

- ✅ **[FAITHFUL] Auth model matches exactly.** v2 template leaves `list` un-permission-gated (the `hasPermissions` wrapper is commented out → JWT only) and gates `single/create/modify/remove` on `SHOW_SETTINGS`. Nest `BaseCrudController` mirrors this precisely: `@Get()` → `JwtAuthGuard` only; the other four → `JwtAuthGuard + PermissionsGuard + @RequirePermissions('SHOW_SETTINGS')`. (Method-level guards used deliberately — Nest doesn't reliably inherit class-level guard metadata onto subclasses.)
- ✅ **[FAITHFUL] Pagination + envelope.** Unlike bookings/invoices/user-ratings, the v2 CRUD template already paginated at the DB (`skip/limit/lean`) — Nest keeps that (no heap issue to fix here). List envelope `{list,itemCount,pageCount,pages,active_page}`, `single` 404 message (`"<Title> does not exist"`), and create/modify populate-after-save all match.
- ✅ **[FAITHFUL] Image upload.** v2 accepted `.array("image")` and set `resourceData.image = req.files[0].path`. Nest wires `FilesInterceptor('image')` + `applyImage()` doing the same. Per-resource upload dirs differ in v2 (e.g. `public/img/countries`, `public/img/cities`) but the migration uses one shared `crudImageUpload` dir — cosmetic, image URL still stored on the record.
- ✅ **[FAITHFUL] cities filter.** `country` query filter + `country` populate preserved.
- ⚠️ **[WARN — divergence] `cities` list drops the `countries` array.** v2 `cities` list uniquely added `countries: Country.find().sort({country:1})` to its response envelope (for the FE country dropdown). `BaseCrudService.list` has no per-resource envelope extension, so the Nest `cities` response omits `countries`. If the sh-account cities screen reads `data.countries`, its dropdown will be empty. **Fix:** override `list` for cities (or add an `extraEnvelope` hook). This is the only behavioural gap in the batch.
- ⚠️ **[WARN — v2 parity] Mass assignment.** Bodies are raw `@Body() any` (whitelist bypassed by design). Any field is settable on these settings records. Low risk (settings data, `SHOW_SETTINGS`-gated), same pattern as elsewhere.
- ℹ️ **[INFO — verify] Collection-name mapping.** Correctness hinges on `ReferenceModelsModule` binding each model to the **legacy collection name** (e.g. `promocodes`, `termsandconditions`, `room_types`). Per `MIGRATION.md` this is intentional and consistent; worth one runtime smoke-test per collection that a legacy record loads.
- ℹ️ **[INFO] FE path aliases** `property-policies → policies` and `property-terms → terms` are handled at the routing/alias layer (noted in `MIGRATION.md`), not inside these controllers.

**Nest verdict:** ✅ the shared-CRUD layer is a clean, faithful consolidation of 17 duplicated v2 controllers into one tested base. Only real action: restore the `countries` array on the `cities` list response. Everything else is parity.

---

### A26 — lookups

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful. 1/1 live endpoint.
**Files:** v2 `admin/controllers/v2/lookups.js` → NestJS `modules/lookups/lookups.module.ts`.

- `GET /lookups/roles` — paginated roles list, authenticated admins only. Nest reproduces the query/sort/pagination and envelope exactly (`JwtAuthGuard`). Legacy `generalsettings.js` is unrelated and not part of the v2 lookups surface (only `/roles` is live). No issues.

### A27 — taxes  🚫 not migrated

**Verdict:** 🚫 **Dropped at the v2 stage** — legacy `admin/controllers/taxes.js` exists but is **not mounted** in `admin/routes/web.js` (v2), and there is no Nest module. So this was retired before the NestJS migration, not by it.
**Action:** confirm with product that admin tax management is intentionally gone (charges are now modelled per-property under `property.charges`, per A5/A7 — taxes/VAT/tourism-fee live there). If a standalone tax CRUD is still needed, it must be built fresh.

### A28 — notifications  🚫 not migrated

**Verdict:** 🚫 **Dropped at the v2 stage** — legacy `admin/controllers/notifications.js` is not mounted in v2 `web.js`, and there is no Nest module.
**Action:** confirm with product whether admin push/notification management is still required. If so, it needs to be re-specified and built (no v2 reference to port from). Note: guest-facing notifications (`controllers/api/notifications.js`, item C3) are separate and still active.

### A30 — commissions ➕

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful port of a **stub**. 2/2 endpoints.
**Files:** v2 `admin/controllers/v2/commissions.js` → NestJS `modules/commissions/commissions.controller.ts`.

- `GET /commissions` → `{ commission: 2.6666666 }` (hardcoded in both). `PUT /commissions` → **HTTP 400** `{ success: true }` — an odd status code that v2 returns; Nest preserves it via `@HttpCode(400)` for parity. Both guarded with `JwtAuthGuard`.
- ℹ️ **[INFO] It's a stub in v2 too** — there's no real commission persistence. The genuine commission logic lives in `property.agreement.commissionHourly/Monthly` (A5) and the `config.commission` defaults. If this endpoint is meant to do something, it's unimplemented in both stacks — not a migration gap. Consider fixing the `PUT` 400→200 while touching it.

### A31 — suggested-rates

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful + improved. 2/2 endpoints.
**Files:** v2 `admin/controllers/v2/suggested-rates.js` → NestJS `modules/suggested-rates/suggested-rates.module.ts`.

| Endpoint (`/admin/v2/suggested-rates`) | Auth | Logic | Status |
|---|---|---|---|
| GET / (rooms where `isExistPriceSuggestion:true`, paginated) | LIST_ADMINISTRATORS | ✅ | MATCH |
| PUT /:roomId/:rateId (accept suggestion) | LIST_ADMINISTRATORS | ✅ | MATCH (improved) |

- ✅ **[FAITHFUL] Accept flow.** Applies the selected rate's `suggested_rates[0]` band (weekday/weekend/minimumBookingRate) onto the rate, clears `isExistPriceSuggestion` + `suggested_rates`, sets `property.max_day_price_percentage_to_normal_price = suggestedRatePercentage`, and emails the owner. Matches v2.
- ✅ **[FIXED] StrictPopulate** — drops the bogus `property` populate path (same Mongoose-8 fix as A6).
- ✅ **[IMPROVED] Email** — v2's ~150-line inline `rate_suggestion_request_accepted.html` build moves to `MailService.sendRateSuggestionAccepted`. Also awaits the email before returning, vs v2 sending the HTTP response first then firing the mail.
- ✅ **[INFO] Guards** — `LIST_ADMINISTRATORS` (matching v2's permission), via real guards (v2 used the boolean-wrapper pattern, no missing-`return` here).

### A32 — app-version ➕

**Audited:** 2026-07-02 | **Verdict:** ✅ Faithful + hardened. 2/2 endpoints.
**Files:** v2 `admin/controllers/v2/app-version.js` → NestJS `modules/app-version/app-version.module.ts`.

- `GET /app-version` → `{success, data:{android, ios}}` (first row per `appType`); `PUT /app-version` → update the row matched by `appType` (strips `_id`). Logic matches v2.
- ✅ **[FIXED/hardened] Auth added.** The v2 `app-version` routes had **no auth guard at all**; Nest adds `JwtAuthGuard`. ⚠️ Behavioural change (previously public) — fine for an admin-panel endpoint, but confirm no unauthenticated client (e.g. the mobile app checking for updates) calls this admin route. If the mobile app reads it unauthenticated, keep a public read or expose it via the guest API.
- ✅ **[FIXED] Schema `appType`.** The legacy model omitted the `appType` field it queries on; Nest's schema declares it (`strict:false`) so existing docs load and `PUT` persists.
- ✅ **[INFO] `catch` bug not carried.** v2 `GET`'s catch referenced an undefined `e` (`catch(err){ ... e.message }`); Nest's error handling is clean.

---

## ✅ Admin pass complete (A1–A32)

All 32 admin modules audited. Headline: the NestJS port is **functionally faithful and frequently safer than v2** — it fixed ~10 latent v2 bugs (StrictPopulate, missing-`return` authz holes, an invoice data-leak, ObjectId comparison, undefined `platform`/`config`/`e`, PII-mask crash, and multiple heap/load-all regressions). The systemic gaps it **inherited** from v2 are what need decisions before cutover.

### Consolidated must-fix before cutover

1. **[BLOCKER] Auth-login security (A1).** Inactive-admin login still allowed; password hash leaked in JWT + login/create responses (no `toJSON` transform); `API_SECRET` defaults to `'secret'` with no token expiry.
2. **[BLOCKER] Payment emails deferred (A8).** Capture/return guest+hotel confirmation & cancellation emails are `// TODO` — migrate `email.js`/`emailHotel.js` (or bridge to `MailService`).
3. **[BLOCKER] Destructive deletes without cascade (A2, A6).** Deleting an administrator/room/property orphans child records; A2 also dropped the active-booking guard.
4. **[HIGH] Owner-scoping IDOR on by-id routes (A5, A6, A7).** `single`/`modify`/`remove` + booking workflows query by `_id` only — an own-scoped admin can act on other tenants' data.
5. **[HIGH] Booking email decisions (A7).** Rejection emails now actually send to owners (v2 had `to:` commented); cancel/no-show still use hard-coded `support@stayhopper.com` test recipients.
6. **[MEDIUM] Mass assignment.** Most write endpoints take raw `@Body() any` (approved/published/status/role/paid/amount settable). Add DTic whitelists on the sensitive ones.
7. **[LOW] `cities` list drops `countries` array (A16); commissions `PUT` returns 400; app-version now requires auth (A32); rooms rate-rejection email trigger changed (A6).**
8. **[VERIFY] Dropped modules — taxes (A27) & notifications (A28)** retired at the v2 stage; confirm intended.

### Still outstanding (not admin)
- **B1–B10** — guest/public API (`controllers/api/v2|v3/*`): users, properties, bookings, payment, main, ratings, favourites, v3 endpoints. **Not yet audited** — and note the deferred payment-email subsystem (A8) lives here.
- **C1–C6** — reused v1 guest APIs (terms, faq, notifications, userratings, website, contactus).

*(To continue: prompt "Audit B1" etc., or "audit the guest API".)*
