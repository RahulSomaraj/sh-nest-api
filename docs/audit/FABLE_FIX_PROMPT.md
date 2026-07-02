# Fable Fix Prompt — remediate the NestJS migration audit findings

Give this to a **Claude Fable 5** coding agent working in the `sh-api-nest` repo. It turns the findings in `docs/audit/API_MIGRATION_AUDIT.md` into concrete, verifiable fixes. Fix in the order below (severity-ranked). Do **one issue (or one tight group) per commit/PR**, build after each, and stop for sign-off on the two items marked ⚠️ PRODUCT.

---

## Master prompt (paste this)

```
You are fixing the StayHopper NestJS API (sh-api-nest) using the audit at
docs/audit/API_MIGRATION_AUDIT.md as the spec. The Express v2 app
(sh-api/stayhopper/admin/controllers/v2/*) is the behavioural reference; keep response
envelopes and status codes identical unless the audit says to change them.

Rules:
- Work one finding at a time in the order in "Fix backlog" below. After each, run
  `npm run build` (and `npm test` if present) and confirm no type/route errors.
- Preserve the existing response shape ({list,itemCount,pageCount,pages,active_page},
  {status,message,...}, etc.). Do not rename routes.
- Prefer minimal, surgical diffs. Add a short code comment referencing the finding id
  (e.g. // audit A1: strip password before signing).
- For anything labelled ⚠️ PRODUCT, do NOT change behaviour — instead open a TODO/PR
  description question and leave the current behaviour, unless I approve.
- When you add a DTO/whitelist, keep every field the frontend legitimately sends
  (cross-check the v2 controller's body usage) so you don't strip valid updates.
- After all fixes, update docs/audit/API_MIGRATION_AUDIT.md: change the fixed findings'
  tags from ❌/⚠️ to ✅ (fixed) with a one-line note, and tick a "Fix status" column.

Start with finding #1 and report the diff + build result before moving on.
```

---

## Fix backlog (severity-ordered)

### 1. [BLOCKER] Auth-login security — `modules/auth`
Files: `auth.service.ts`, `strategies/local.strategy.ts`, `modules/administrators/schemas/administrator.schema.ts`, `config/configuration.ts`, `strategies/jwt.strategy.ts`.
- **Inactive admins can log in.** In `AuthService.validateAdministrator` (and `autoLogin`), after the bcrypt check, reject when `administrator.status === false` (return null / `Invalid Login credentials`). Match legacy "Inactive User" behaviour.
- **Password hash leaks into JWT + responses.** Add a schema `toJSON`/`toObject` transform on `Administrator` that deletes `password` (and ideally `activationCode`, `autoLoginCode`). Then in `signToken`, sign a minimal claim set (`{_id, email, role}`) rather than the whole doc, and ensure `buildLoginResponse`/`autoLogin`/`create` never return `password`.
- **Weak JWT secret.** In `config/configuration.ts`, throw on boot if `process.env.API_SECRET` is unset (no `'secret'` fallback). Consider adding a token `expiresIn` (coordinate with the frontend before enabling expiry — mark ⚠️ PRODUCT if unsure).
- Acceptance: a disabled admin gets 401; a decoded login JWT and the login/create JSON contain no `password`; app fails fast without `API_SECRET`.

### 2. [BLOCKER] Payment confirmation/cancellation emails — `modules/payments`
Files: `modules/payments/payments.module.ts` (capture/return), `common/mail/mail.service.ts`.
- Replace the `// TODO capturedPaymentEmail/capturedHotelEmail` and `// TODO cancelledPaymentEmail/cancelledHotelEmail` stubs with real sends. Port the templates from `sh-api/stayhopper/controllers/api/v2/email.js` + `emailHotel.js` into `MailService` methods (mirror the A7 `sendTemplated` pattern) and call them after the container `/capture` and `/return` calls.
- Preserve recipients/bcc from the **active** legacy lines. Where legacy recipients were commented out (test state), mark ⚠️ PRODUCT and ask which address to use.
- Acceptance: capture and return each send the guest + hotel email; no regression to the money-movement flow.

### 3. [BLOCKER] Destructive deletes without cascade — `modules/administrators`, `modules/rooms`, `modules/properties`
- **Administrators (A2):** in `AdministratorsService.remove`, re-add the legacy guard — refuse deletion when the admin's properties have active bookings (`date_checkin >= now`), and cascade: delete the admin's properties + their rooms, and `$pull` those properties from users' `favourites`. Re-expose the `check_active_bookings` capability if the frontend uses it.
- **Rooms (A6) / Properties (A5):** on delete, clean up dependent `bookings`/`slots`/`bookinglogs` (rooms) and rooms/availability (properties), or explicitly document why not. At minimum, don't leave orphaned child docs.
- Acceptance: deleting an entity with live bookings is blocked; no orphaned children remain after a permitted delete.

### 4. [HIGH] Owner-scoping IDOR on by-id routes — `modules/properties`, `modules/rooms`, `modules/bookings`
- Apply the same owner filter used in `list` to the **by-id** operations when the caller has `LIST_OWN_*` but not `LIST_ALL_*`:
  - Properties `single`/`modify`/`remove` + nearby/photos (A5).
  - Rooms — add owner scoping (currently none, even on list) (A6).
  - Bookings `cancel`/`remove`/`reject-cancellation`/`noshow`/`reject-noshow`/`approveNoShow` and `single` (A7).
- Implement as a shared helper: resolve the caller's property ids once, then require the target's `property`/`property_id`/`propertyInfo.id` (or `administrator`/`allAdministrators`) to be in that set, else 403.
- Acceptance: an own-scoped admin gets 403 when acting on another property's property/room/booking by id; full-access admins are unaffected.

### 5. [HIGH → ⚠️ PRODUCT] Booking email decisions — `modules/bookings`
- Rejection emails now send `to: primaryReservationEmail` (v2 had it commented). Confirm this is desired before shipping.
- `cancel`/`noShow`/`approveNoShow` still target hard-coded `support@stayhopper.com`; wire the real production recipients (`config.website_cancellation_email`, guest email) once confirmed.
- Do NOT change silently — surface both as questions.

### 6. [MEDIUM] Mass assignment — write endpoints
Files: `modules/administrators`, `modules/users`, `modules/properties`, `modules/rooms`, `modules/invoices`, CRUD base.
- Add `class-validator` DTOs (or an explicit field allowlist) to `create`/`modify` on the sensitive resources so callers cannot set `password`, `role`, `status`, `paid`, `amount`, `approved`, `published`, `user_rating`, `isExistPriceSuggestion`, etc. directly.
- Cross-check each v2 controller's body usage so no legitimate field is dropped (properties/rooms send large nested payloads — scope the whitelist carefully or gate only the sensitive keys).
- Acceptance: sending a disallowed field on PUT/POST is ignored/rejected; normal updates still work.

### 7. [LOW] Small parity/quality fixes
- **cities list (A16):** override `list` for cities to re-add `countries: (all countries sorted by name)` to the response envelope.
- **commissions PUT (A30):** change the `@HttpCode(400)` to `200` (coordinate with frontend — likely a v2 bug).
- **app-version (A32):** confirm whether any unauthenticated client (mobile app) reads this; if so, expose a public read instead of requiring `JwtAuthGuard`.
- **rooms rate-rejection email trigger (A6):** confirm the corrected `String(...)` comparison (fires only for a different user) matches product intent.
- **user-ratings / rooms boolean cast (A4/A6):** coerce `approved`/`:status` string params to real booleans (`x === 'true'`) and reject other values.
- **bookings `getById` unbounded arrays (A3/A7):** paginate or drop the inlined booking arrays; keep the counts.

### 8. [VERIFY] Dropped modules
- **taxes (A27) / notifications (A28):** no code change — confirm with product they're intentionally retired. If needed, spec + build fresh (no v2 to port).

---

## Definition of done
- `npm run build` passes; routes unchanged; response shapes preserved.
- Each fixed finding in `API_MIGRATION_AUDIT.md` is re-tagged ✅ with a one-line note.
- The two ⚠️ PRODUCT items (5, and the app-version/commissions bits in 7) are raised as questions, not silently changed.
- A short CHANGELOG / PR description lists every finding id addressed.
