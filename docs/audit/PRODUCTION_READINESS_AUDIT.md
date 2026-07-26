# StayHopper `sh-api-nest` — Production-Readiness Audit

**Auditor:** Principal Backend Engineer review
**Date:** 2026-07-04
**Scope:** Full codebase under `src/` (NestJS 10, TypeScript, **MongoDB + Mongoose 8**, deployed on Linux VM behind PM2)

> ⚠️ **Stack correction.** The audit brief specified PostgreSQL + TypeORM/Prisma + Redis + PgBouncer + BullMQ. **None of that is in this repo.** The persistence layer is **MongoDB via `@nestjs/mongoose` 8**, there is **no Redis / cache-manager**, **no BullMQ**, and **no PgBouncer**. Findings below are written against the code that actually exists. Where the brief asked about a technology that isn't present (e.g. "raw SQL injection", "PgBouncer pool alignment") I map it to the real equivalent (NoSQL operator injection, Mongoose connection pool).
>
> **Context:** this is a partially-hardened rewrite of a legacy Express app. Many findings from a prior pass are already fixed and marked `// audit A#` in the source. The issues below are what remains.

---

## 1. Executive Summary

### Health score per section (/10)

| # | Section | Score | One-line justification |
|---|---------|:-----:|------------------------|
| 1 | Architecture & Module Design | 6 | Clean module split, but `Model<any>` everywhere, controllers embedded in module files, magic role IDs. |
| 2 | Security (OWASP) | **3** | Unauthenticated money endpoints, NoSQL operator injection, 4-digit brute-forceable codes, no auth-endpoint throttling. |
| 3 | Database & ORM | **4** | No transactions on money/cascade writes, missing indexes on the hottest collection (`userbookings`), N+1 in list endpoints. |
| 4 | Performance | 4 | No caching, no HTTP timeouts on payment providers, blocking bcrypt, in-memory sort-then-slice. |
| 5 | Memory & Heap | 5 | No graceful shutdown, unbounded in-memory sorts, no upload size limits. Singletons are stateless (good). |
| 6 | Error Handling & Resilience | 4 | Swallowed errors in money flow, sentinel-object returns, business errors surfaced as 500. |
| 7 | Logging & Observability | 3 | No health checks, no correlation IDs, no metrics, unstructured logs. |
| 8 | Complexity & Maintainability | 4 | `strict` off, `any` pervasive, duplicated `buildPages` in 8 files, 100-line nested methods. |
| 9 | API Design & Contracts | 5 | GET with side effects, inconsistent verbs/status codes, Swagger security contract wrong. |
| 10 | Testing & CI | 5 | Good service-spec breadth, but no e2e, no CI config found, external providers not verified mocked. |

**Overall: 4.3 / 10 — NOT production-ready.** Several issues can lose money or leak data today.

### Top 5 risks that could cause an outage or breach this month

1. **`GET /admin/v2/capture/:bookingId` and `/return/:bookingId` have NO authentication guard** and move money (mark paid, issue VCC, trigger refund). Anyone who can guess/enumerate a booking `_id` can capture payments or force refunds. `payments.module.ts` (CaptureController/ReturnController). **CRITICAL.**
2. **NoSQL operator injection** via `@Query() any` → `where.user = query.user` etc. `?user[$ne]=` bypasses owner-scoping filters and exfiltrates other tenants' bookings/invoices. Multiple list endpoints. **CRITICAL.**
3. **No database transactions** around payment capture (`updateOne(paid) → container POST → VCC`) and around multi-collection cascade deletes (admins/properties). Partial failure = money marked paid with no VCC, or orphaned/half-deleted data. **CRITICAL.**
4. **4-digit `autoLoginCode` / `activationCode` (1000–9999) brute-forceable** with no per-endpoint throttle or lockout → account takeover via `POST /auth/auto-login` and `/onboarding/verify`. **HIGH.**
5. **Missing indexes on `userbookings` / `completed_bookings`** (the hottest collection, queried on every booking list, dashboard, delete-guard, and payment) → full collection scans that will melt the DB as data grows. **HIGH.**

---

## 2. Critical Findings (money loss / data leak / process crash)

### C-1 — Payment capture & return endpoints are unauthenticated (money movement)
**File:** `src/modules/payments/payments.module.ts:328-351`
**Severity: Critical**

```ts
@Controller('capture')
export class CaptureController {
  @Get(':bookingId')                          // ← no @UseGuards, GET, side effects
  capture(@Param('bookingId') bookingId, @Query('invoice_id') invoiceId, ...) {
    return this.service.capture(bookingId, invoiceId, transactionId);
  }
}
@Controller('return')
export class ReturnController {
  @Get(':bookingId')                          // ← no auth
  return(@Param('bookingId') bookingId, ...) { return this.service.return(bookingId, invoiceId); }
}
```
`capture()` sets `paid:1, hotel_approved:1`, calls the payment container `/capture/` and `/vcc/`; `return()` sets `paid:0, hotel_cancelled:1` and calls `/return/` (refund). The only guard against replay is the `hotel_approved` / `hotel_cancelled` flag check. **Why it matters:** these are gateway *return URLs* invoked by the browser/PSP, so they can't use a JWT — but they carry **zero signature verification**. Any actor hitting `/admin/v2/capture/<id>` marks a booking paid and issues a virtual card; `/return/<id>` forces a refund/cancel.

**Fix:** verify a provider HMAC signature + timestamp, make them `POST`, and add idempotency:
```ts
@Post(':bookingId')
async capture(@Param('bookingId') id, @Headers('x-telr-signature') sig,
              @Headers('x-telr-timestamp') ts, @Body() raw: Buffer) {
  this.gatewaySig.assertValid(raw, sig, ts);        // HMAC-SHA256(secret, ts + body); reject if |now-ts|>5m
  return this.service.capture(id, ...);             // idempotency key stored per bookingId+charge_uid
}
```
Guard the state transition with a conditional update so replays are no-ops:
```ts
const r = await this.userBookingModel.updateOne(
  { _id: bookingId, hotel_approved: { $ne: 1 } },
  { $set: { paid: 1, hotel_approved: 1 } });
if (r.modifiedCount === 0) return { status: 0, alreadyProcessed: true };
```

### C-2 — NoSQL operator injection through untyped query params
**Files:** `bookings.service.ts:94` (`where.user = query.user`, `where.property = query.property`), `invoices.service.ts:49`, `rooms.service.ts:111-112`, `base-crud.service.ts:41`, all `list()` handlers taking `@Query() query: any`.
**Severity: Critical**

Express parses `qs` extended syntax, so `?user[$ne]=` or `?property[$in][]=...` arrives as a **nested object**, and it is assigned verbatim into the Mongo filter:
```ts
if (query.user) where.user = query.user;          // query.user can be { $ne: null }
if (query.property) where.property = query.property;
```
An own-scoped hotel admin can send `GET /admin/v2/bookings?status=active&property[$nin][]=000000000000000000000000` and the `$and` owner filter is still ANDed, but a request like `?user[$gt]=` returns cross-tenant rows wherever the scoping branch is not taken (e.g. invoices `single`, or endpoints where the caller has neither OWN nor ALL and is "unrestricted"). **Why it matters:** authorization bypass + data exfiltration, and `$where`/`$regex` payloads enable ReDoS/JS execution.

**Fix:** never assign raw query values into filters. Coerce to string/ObjectId and reject objects:
```ts
const asId = (v: unknown) => { if (typeof v !== 'string' || !Types.ObjectId.isValid(v))
  throw new BadRequestException('invalid id'); return new Types.ObjectId(v); };
if (query.user) where.user = asId(query.user);
```
Also add a global sanitizer (strip keys starting with `$`/`.`) via `express-mongo-sanitize` in `main.ts`:
```ts
import mongoSanitize from 'express-mongo-sanitize';
app.use(mongoSanitize());
```

### C-3 — Unsanitized user regex → ReDoS + injection
**Files:** `users.service.ts:46-47`, `administrators.service.ts:71-74`, `properties.service.ts:83`.
**Severity: High → Critical (DoS)**

```ts
where.$or = [{ name: new RegExp(keyword, 'i') }, { email: new RegExp(keyword, 'i') }];
```
`keyword` is raw user input. A payload like `?q=(a+)+$` is a catastrophic-backtracking regex that pins a CPU core and blocks the event loop for the whole process. **Fix:** escape the input and anchor it:
```ts
const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
where.$or = [{ name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }];
```
Better: a text index + `$text` search.

### C-4 — No transactions on payment capture and cascade deletes
**Files:** `payments.service.ts:269-325`, `properties.service.ts:336-362`, `administrators.service.ts:215-248`, `rooms.service.ts:176-196`.
**Severity: Critical**

Capture performs `updateOne({paid,hotel_approved}) → containerPost('/capture/') → containerPost('/vcc/')` with no atomicity. `containerPost` swallows failures and returns `null` (line 253-256), so a failed `/capture/` **still leaves the booking marked paid** and proceeds to VCC; a failed VCC returns `{status:0}` but the paid flag is already committed. Cascade deletes fire 4–5 sequential `deleteMany`/`updateMany` with no transaction:
```ts
await this.userModel.updateMany(...);              // properties.remove
await this.availabilityBookingModel.deleteMany({ property: id });
await this.bookingLogModel.deleteMany({ property: id });
await this.roomModel.deleteMany({ property_id: id });
return this.propertyModel.deleteOne({ _id: id });  // if any step throws → orphans
```
**Why it matters:** money marked collected without a card issued; half-deleted graphs that corrupt later reads. **Fix:** the Mongo config already supports `replicaSet`, so use sessions:
```ts
const session = await this.connection.startSession();
try {
  await session.withTransaction(async () => {
    await this.userBookingModel.updateOne({_id:id,hotel_approved:{$ne:1}},{$set:{paid:1,hotel_approved:1}},{session});
    await this.availabilityBookingModel.deleteMany({property:id},{session});
    /* ... */
  });
} finally { await session.endSession(); }
```
For payments, do external calls **outside** the transaction and record a durable state machine (`captured_pending` → `vcc_issued`) so a retry/reconciliation job can finish or reverse.

### C-5 — Payment provider `fetch` calls have no timeout
**Files:** `payments.service.ts:247-252` (`containerPost`), `invoices.service.ts:201-206` (Telr).
**Severity: Critical (availability)**

```ts
const resp = await fetch(`${base}${pathname}`, { method:'POST', headers:{...}, body:... });
```
Node's `fetch` has **no default timeout**. If the payment container or `secure.telr.com` hangs, the request hangs indefinitely, holding a Mongoose connection and an event-loop slot; enough hung calls exhaust the pool and the whole API stalls. **Fix:** `AbortSignal.timeout` + retry/circuit-breaker:
```ts
const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
```
Wrap payment/Telr in a circuit breaker (e.g. `opossum`) and classify retryable (network/5xx) vs fatal (4xx).

---

## 3. Full Findings Table

### Security

| Sec | File:Line | Sev | Issue | Fix |
|-----|-----------|-----|-------|-----|
| 2 | payments.module.ts:328-351 | Crit | Unauthenticated GET capture/return move money (C-1) | HMAC-verify, POST, idempotent update |
| 2 | bookings.service.ts:94; invoices.service.ts:49; rooms.service.ts:111 | Crit | NoSQL operator injection via `@Query() any` (C-2) | `express-mongo-sanitize` + coerce to ObjectId |
| 2 | users.service.ts:46; administrators.service.ts:71; properties.service.ts:83 | High | ReDoS via `new RegExp(userInput)` (C-3) | Escape input / `$text` index |
| 2 | administrators.service.ts:309,318,385; auth `auto-login` | High | 4-digit `activationCode`/`autoLoginCode` (`Math.random()*9000+1000`) brute-forceable | 256-bit `crypto.randomBytes`, single-use, TTL, throttle |
| 2 | app.module.ts:32; auth.controller.ts | High | Global throttler 300/min but **no stricter throttle** on `login`/`auto-login`/`reset-password`/`onboarding` | `@Throttle({ default:{limit:5, ttl:60000}})` + login lockout |
| 2 | main.ts:28-33 | High | CORS reflects **any** origin (`origin: true`) with `credentials:true` when `CORS_ORIGINS` unset | Require explicit allowlist in prod; never reflect-all with credentials |
| 2 | auth.service.ts:44-54; jwt.strategy.ts:23 | High | Tokens signed before expiry-rollout have no `exp` → never expire; no refresh rotation, no revocation on password change/reset | Enforce `expiresIn`, add `tokenVersion` claim bumped on password change |
| 2 | auth.service.ts:105 | Med | Reset-password reveals "Email id is not registered" → user enumeration; no throttle | Generic response + throttle |
| 2 | properties.controller.ts:74; base-crud.controller.ts:60; app-version:70; invoices:71 | High | `@Body() any` + `ValidationPipe({forbidNonWhitelisted:false})` → mass assignment; `app_version`/loose CRUD schemas are `strict:false` so arbitrary fields persist | Typed DTOs per resource; `forbidNonWhitelisted:true`; field allowlist |
| 2 | main.ts:38-45 | Med | `whitelist:true` but `transform`'s `@Query() any` bypasses validation entirely on list endpoints | Introduce `ListQueryDto` with validated `page/limit/order/orderBy` |
| 2 | properties/upload.config.ts:21-29 | Med | File filter checks **extension only**, not MIME/magic bytes; no size limit | Validate content type + `limits:{fileSize}` |
| 2 | main.ts:20 | Low | Helmet CSP disabled globally | Set CSP at edge or scope `false` to `/docs` only |
| 2 | dashboard.module.ts / payments.module.ts | Low | Controllers, services, schemas co-located in one `*.module.ts` file — harder to review guard coverage | Split into `*.controller.ts` / `*.service.ts` |

**Route guard coverage (every route, confirm public is intentional):**

| Route | Guard | Intentional public? |
|-------|-------|--------------------|
| `GET /auth/ping` | none | ✅ health ping |
| `POST /auth/login` | LocalAuthGuard | ✅ |
| `POST /auth/auto-login` | **none** | ⚠️ public but weak code (see above) |
| `POST /auth/reset-password` | none | ✅ but enumerable + unthrottled |
| `POST /auth/logout`, `authorized` | logout none / authorized Jwt | ✅ |
| `POST /administrators/onboarding`, `/onboarding/verify` | **none** | ⚠️ intentional (website), weak 4-digit code |
| `GET /admin/v2/capture/:id`, `/return/:id` | **none** | ❌ **should be signature-verified** (C-1) |
| `commissions GET/PUT` | Jwt only (no permission) | ⚠️ stubbed values |
| all other modules | Jwt + Permissions | ✅ |

### Database & ORM

| Sec | File:Line | Sev | Issue | Fix |
|-----|-----------|-----|-------|-----|
| 3 | booking-docs.schema.ts:13-25 | High | `userbookings` & `completed_bookings` have **zero indexes**; queried by `user`, `property`, `date_checkin`, `room.room`, `date` in bookings/dashboard/payments/delete-guards | Add `{property:1}`, `{user:1}`, `{property:1,date_checkin:1}`, `{'room.room':1}`, `{date:1,room:1}` |
| 3 | (no schema) bookinglogs, slots, userratings loose models | High | Availability writes/deletes `bookinglogs` by `{room,slot,date,number}`; `userratings` queried by `property,approved` — no indexes | Define real schemas w/ compound indexes |
| 3 | properties.service.ts:186 | High | N+1: `list.map(getExtraResourceInformation)` runs one `roomModel.aggregate` **per property** per page | Single `$group` aggregation over `{property_id:{$in:pageIds}}` |
| 3 | administrators.service.ts:100-114 | Med | N+1: per-admin property query when `getProperties=1` | One `$in` query keyed by admin ids, group in memory |
| 3 | payments.service.ts:59-64 | Med | N+1: `roomModel.findOne().populate()` per room inside email token builder | `find({_id:{$in:roomIds}}).populate` once |
| 3 | bookings.service.ts:133-148; invoices.service.ts:66-73; user-ratings handled | High | "Sort by property name" path loads **entire filtered collection** into memory, populates, then `.slice()` | Aggregation `$lookup+$sort+$skip+$limit` (already done in user-ratings — replicate) |
| 3 | payments.service.ts:277-303 | Crit | Capture writes without transaction (C-4) | `withTransaction` |
| 3 | rooms.service.ts:368-464 | High | `changeAvailability` read-modify-write on `booking.slots` array, no optimistic lock → concurrent block/unblock race = double-book/lost update | `optimisticConcurrency:true` (version key) or atomic `$push`/`$pull` with array filters |
| 3 | properties.service.ts:315-333; rooms.modify; base-crud.modify | Med | `findOne()` then `Object.keys(data).forEach(k => resource[k]=...)` then `save()` — read-modify-write race; last write wins | `findOneAndUpdate({_id},{ $set })` atomic |
| 3 | database.module.ts:14-23 | Med | No `maxPoolSize`/`serverSelectionTimeoutMS`/`socketTimeoutMS`; no `autoIndex:false` for prod | Set pool + timeouts; `autoIndex` off in prod, build indexes via migration |
| 3 | (whole repo) | Med | No migration framework; index creation relies on Mongoose `autoIndex` — schema/DB drift risk, and index builds block on boot | Adopt `migrate-mongo`; build indexes offline |
| 3 | invoices.service.ts:84; bookings.service.ts:157 | Med | `propertyModel.find({})` (all properties, full docs) loaded on every list call for the dropdown | `.select('_id name')` (partly done) + cache |

### Performance & Memory

| Sec | File:Line | Sev | Issue | Fix |
|-----|-----------|-----|-------|-----|
| 4 | payments.service.ts:247; invoices.service.ts:201 | Crit | External `fetch` with no timeout/retry/breaker (C-5) | `AbortSignal.timeout` + circuit breaker |
| 4 | auth.service.ts:110,143; administrators.service.ts:166,261,329 | Med | `bcrypt.hashSync` (cost 10) **blocks the event loop** on register/reset/change/onboarding | `await bcrypt.hash(...)` (async); consider cost 12 |
| 4 | (whole repo) | Med | No caching layer at all — reference data (countries, currencies, roles, permissions) re-queried every request | Add `@nestjs/cache-manager`; TTL-cache lookups + role/permission resolution |
| 4 | main.ts | Med | No `compression()` middleware — large JSON list payloads sent uncompressed | `app.use(compression())` |
| 4 | bookings/*, cancel/remove/reject | Med | Email send `await`ed inline in request cycle (SendGrid round-trip on the critical path) | Queue emails (Bull/Redis) or fire-and-forget like capture does |
| 4 | bookings.service.ts:59,62 | Low | `JSON.parse(JSON.stringify(item))` deep clone per booking row | Structured clone once / avoid |
| 5 | main.ts:9-77 | High | **No graceful shutdown**: `app.enableShutdownHooks()` never called; no SIGTERM drain → PM2 restarts drop in-flight requests and don't close Mongo | `app.enableShutdownHooks()`; `OnApplicationShutdown` to close connections |
| 5 | main.ts | Med | No `process.on('unhandledRejection'/'uncaughtException')` → unhandled rejection can leave process in a corrupt-but-alive state | Log + exit(1) so PM2 restarts clean |
| 5 | *upload.config.ts | Med | multer `diskStorage` has no `limits.fileSize` → large uploads fill disk / buffer memory during `sharp` resize | Add size limits; stream to storage |
| 5 | bookings.service.ts:135 | High | Property-sort path materialises whole collection (heap OOM as bookings grow) | Aggregation pagination |
| 5 | all services | ✅ | Singleton `@Injectable()` services hold **no mutable request state** — no cross-request bleed (verified) | (good — keep it this way) |

### Error Handling, Logging, Observability

| Sec | File:Line | Sev | Issue | Fix |
|-----|-----------|-----|-------|-----|
| 6 | payments.service.ts:253-256 | High | `containerPost` swallows errors, returns `null`; capture continues after a failed `/capture/` call | Throw/branch on failure; don't commit `paid` unless gateway acked |
| 6 | user-ratings.service.ts:146-150 | Med | `catch { console.log(...) }` then continue; uses `console.log` not Logger | Use `Logger.error`; decide fail vs best-effort explicitly |
| 6 | Services return `{notFound}`/`{error}`/`{badRequest}` sentinels | Med | Controllers must remember to check; some map real failures to 500 (bookings.cancel error → 500) | Throw typed `NotFoundException`/`BadRequestException` from services |
| 6 | bookings.controller.ts:44; properties.controller.ts:123 | Med | Business "could not X" surfaced as HTTP 500 instead of 400/404/409 | Correct status codes |
| 6 | all-exceptions.filter.ts:72-79 | Low | No `correlationId` in error envelope; `status:0` custom shape | Add request id (from middleware) to envelope |
| 7 | (whole repo) | High | **No health checks** (`@nestjs/terminus` not installed) — PM2/LB can't detect DB down | Add `/health` liveness + readiness (Mongo ping) |
| 7 | http-logger.middleware.ts | Med | Unstructured text logs, no correlation id propagated into services; no request-id header | pino/nestjs-pino w/ `x-request-id` |
| 7 | (whole repo) | Med | No metrics (event-loop lag, heap, request duration histograms) | `prom-client` + `/metrics` |
| 7 | http-logger.middleware.ts:30-34 | ✅ | Bodies not logged; PII kept out (good) | keep |

### Complexity, API Design, Testing

| Sec | File:Line | Sev | Issue | Fix |
|-----|-----------|-----|-------|-----|
| 8 | tsconfig.json:15-17 | High | `strictNullChecks:false`, `noImplicitAny:false` → null-safety and type errors invisible; non-null DB fields untyped | Enable `strict`; fix incrementally |
| 8 | Every service | High | `Model<any>`, `@Body() any`, `req: any`, `resource: any` pervasive — no compile-time safety on DB shapes | Type models with schema interfaces |
| 8 | bookings.service.ts:83-85 | High | **Hardcoded role ObjectIds** `'5efc8ef65694cbf9675b28a3'`, `'5f1a9e9a016a9ccac0177d39'` for auth logic — breaks across environments | Role lookup by permission set or named constant seeded per env |
| 8 | `buildPages` duplicated in 8 files (users, admins, properties, rooms, bookings, invoices, user-ratings, base-crud, suggested-rates, lookups) | Med | Copy-paste pagination logic | Extract `PaginationHelper` util |
| 8 | rooms.service.ts:368-464 | Med | `changeAvailability` ~100 lines, 4-5 nesting levels, high cyclomatic complexity | Decompose into block/unblock strategies |
| 8 | payments.service.ts:85-241 | Med | `sendCaptureEmails`/`sendReturnEmails` huge with duplicated tax-breakdown loops | Extract `computeTaxBreakdown()` |
| 9 | properties.controller.ts:156; payments GET | Med | `POST /photos/remove` (should be DELETE); `GET capture/return` mutate state | Align verbs; POST for mutations |
| 9 | main.ts:65 | Med | Swagger sets `document.security=[{JWT:[]}]` globally, but login/onboarding/capture/return/ping are public → docs misrepresent contract | Mark public routes `@ApiExcludeEndpoint`/no-auth; per-op security |
| 9 | Envelope `{status:1}` success vs thrown `{status:0}` errors | Med | Two different success/error shapes; Flutter clients depend on both | Document + standardize response interceptor |
| 9 | commissions.controller.ts:15,24 | Low | Returns hardcoded `2.6666666`; stub | Implement or remove |
| 10 | test/ (absent) | High | No e2e tests (no supertest, no `*.e2e-spec.ts`), esp. for auth + money endpoints | Add e2e for login, capture/return, owner-scoping |
| 10 | No `.github/workflows`, `.gitlab-ci.yml` found | High | No CI gate for lint/typecheck/test before deploy | Add CI: `lint && tsc --noEmit && jest` |
| 10 | *.service.spec.ts (present) | ✅ | Good unit-spec breadth incl. `payments.service.spec`, `owner-scope.spec` | Verify external providers (SendGrid/Telr/fetch) are mocked, not live |

---

## 4. Performance Quick Wins (ranked by impact ÷ effort)

| Rank | Fix | Effort | Expected improvement |
|------|-----|--------|----------------------|
| 1 | Add indexes to `userbookings`/`completed_bookings` (`property`, `user`, `property+date_checkin`, `room.room`) | XS (1 migration) | Booking list / dashboard / delete-guard queries drop from O(collection) scans to index seeks — 10–1000× on large data |
| 2 | `AbortSignal.timeout(8000)` on all `fetch` (payments, Telr) | XS | Eliminates indefinite request hangs / pool exhaustion during PSP incidents |
| 3 | `express-mongo-sanitize` + `compression()` in `main.ts` | XS | Closes operator-injection class; ~60–80% smaller list payloads |
| 4 | Replace per-property `getExtraResourceInformation` N+1 with one `$in` aggregation | S | Property list p95 from ~(N×roundtrip) to ~2 queries |
| 5 | `bcrypt.hashSync` → async `bcrypt.hash` | XS | Unblocks event loop during register/reset bursts |
| 6 | Cache reference lookups (countries/currencies/roles) with TTL | S | Removes 2–4 redundant queries per list request |
| 7 | Replace in-memory "sort by property, then slice" with aggregation in bookings & invoices | M | Bounded memory + single-page fetch; removes OOM risk |
| 8 | `app.enableShutdownHooks()` + SIGTERM drain | S | Zero-dropped-request PM2 restarts/deploys |

---

## 5. 30-Day Remediation Plan (ordered, with dependencies)

**Week 1 — Stop the bleeding (money & data).**
1. **C-1**: HMAC-verify + convert capture/return to POST + idempotent conditional update. *(blocks nothing; do first)*
2. **C-4/C-5**: Add `AbortSignal.timeout` to all `fetch`; wrap capture state changes in a Mongo transaction + durable payment state machine. *(depends on replicaSet — already configured)*
3. **C-2/C-3**: Add `express-mongo-sanitize`, escape regex inputs, coerce id query params to `ObjectId`. *(global, low-risk)*

**Week 2 — Auth hardening & availability.**
4. Replace 4-digit `autoLoginCode`/`activationCode` with `crypto.randomBytes` single-use + TTL. *(depends on frontend/email links — coordinate at cutover)*
5. Add per-endpoint throttling on login/auto-login/reset/onboarding + login lockout. *(depends on #4 for the code endpoints)*
6. Lock CORS to explicit allowlist in prod; add `tokenVersion` JWT claim invalidated on password change. *(independent)*
7. Add indexes to `userbookings`/`completed_bookings`/`bookinglogs`/`userratings` via `migrate-mongo`; set `autoIndex:false`, pool + timeouts in `database.module.ts`. *(quick win #1; do early)*

**Week 3 — Resilience & correctness.**
8. Wrap cascade deletes (properties/admins/rooms) in transactions. *(depends on transaction plumbing from #2)*
9. Fix availability race with optimistic concurrency / atomic array updates. *(independent)*
10. Convert service sentinel returns to thrown Nest exceptions; correct 400/404/409 vs 500. *(touches controllers — do as one sweep)*
11. Add `@nestjs/terminus` health checks (Mongo ping); `enableShutdownHooks` + SIGTERM; `unhandledRejection`/`uncaughtException` handlers. *(independent)*

**Week 4 — Performance, types, CI.**
12. Kill N+1s (properties/admins/payments) and in-memory sorts (bookings/invoices). *(depends on #7 indexes for full benefit)*
13. Add caching for reference data; `compression()`; async bcrypt; queue emails. *(independent)*
14. Turn on `tsconfig strict`, replace worst `any` hotspots, extract `buildPages`/pagination + magic role IDs to config. *(large but incremental; gate with CI)*
15. Stand up CI (`lint && tsc --noEmit && jest`) + e2e tests for auth and capture/return; verify external providers are mocked. *(do last so the gate reflects the fixed state)*

**Cross-cutting dependency notes:** #2 unlocks #8; #7 amplifies #12; #4 must land with #5 and be coordinated with the Flutter/website clients (email-link format change) at a planned cutover; #14 should be merged behind CI (#15) to prevent regressions.
