# sh-api-nest — Architecture & Code Review

**Reviewer:** Senior Software Architect
**Date:** 2026-07-26
**Branch:** `uat` @ `7712f05`
**Scope:** Full `src/` tree (100 TS files, ~9.5k LOC), build/test config, deployment assets
**Prior art:** `docs/audit/PRODUCTION_READINESS_AUDIT.md` (2026-07-04) — re-verified against current HEAD, not taken on trust

---

## 0. What I actually ran

Findings below are grounded in checks executed against this working tree, not inferred:

| Check | Command | Result |
|---|---|---|
| Type safety | `npx tsc --noEmit` | ✅ exit 0 (but see [M-6] — `strict` is off) |
| Unit tests | `npx jest` | ✅ 12 suites / 73 tests passing, ~51s |
| Lint | `npm run lint` | ❌ **eslint is not installed** — the script cannot run |
| E2E | `npm run test:e2e` (per CLAUDE.md) | ❌ **script does not exist; no `test/` directory** |
| CI | `.github/`, `.gitlab-ci.yml` | ❌ absent |
| Secret hygiene | `git ls-files \| grep .env` | ✅ only `.env.example` tracked |

---

## 1. Executive summary

This is a **well-engineered migration**, materially stronger than the July 4 snapshot. The prior audit's five critical findings are genuinely closed — I verified each in source, not by reading the changelog. The team has added real infrastructure: a NoSQL sanitizer at the Express query-parser layer, HMAC webhook verification, Mongo transactions with topology fallback, atomic idempotent payment claims, health probes, graceful shutdown, index definitions on the hot collections, and N+1 elimination in the three worst list paths.

What remains is a different class of problem. The July audit was about *injection and money*. What's left is about **the authorization model**, which is inherited from legacy and has two structural fail-open properties, plus a **delivery-pipeline gap** (no lint, no CI, no e2e) that leaves all of this ungated.

### Verdict

> **Architecturally sound; not yet safe to expose without three authorization fixes and a CI gate.**
>
> The remaining critical risks are not exotic — they are reachable by any authenticated administrator with an ordinary role. Nothing here requires a rewrite; the fixes are days, not weeks.

### Scorecard

| # | Dimension | Score | Δ vs Jul 4 | Note |
|---|---|:---:|:---:|---|
| 1 | Architecture & module design | **7**/10 | ▲ +1 | Clean layering; 6 modules still bundle controller+service+schema in one file |
| 2 | Security — injection & transport | **8**/10 | ▲ +5 | Sanitizer, regex escaping, HMAC, CORS lockout, throttling all landed |
| 3 | Security — authorization | **4**/10 | ▬ | Two fail-open rules + a privilege-escalation path. **Weakest area.** |
| 4 | Database & data model | **7**/10 | ▲ +3 | Indexes + transactions landed; pool/timeouts still unset |
| 5 | Performance | **7**/10 | ▲ +3 | N+1s and in-memory sorts fixed; blocking bcrypt + unbounded `orderBy` remain |
| 6 | Resilience & error handling | **7**/10 | ▲ +3 | Timeouts, rollback, shutdown hooks; sentinel-return pattern persists |
| 7 | Observability | **5**/10 | ▲ +2 | Health probes landed; no correlation IDs, no metrics |
| 8 | Maintainability | **5**/10 | ▲ +1 | `strict` off, `Model<any>` pervasive, `buildPages` duplicated 8× |
| 9 | API design & contracts | **6**/10 | ▲ +1 | Swagger present; envelope duality and GET-with-side-effects remain |
| 10 | Testing & delivery | **4**/10 | ▬ −1 | 73 green unit tests — but **no lint, no CI, no e2e, no contract suite** |

**Weighted: 6.0 / 10** — up from 4.3. Trajectory is good; the gap is now concentrated rather than diffuse.

### Top 5 risks, today

1. **[S-1] Vertical privilege escalation.** Any admin holding `LIST_ADMINISTRATORS` can `PUT` their own record with a Super Admin `role` id. Role ids are readable from `GET /lookups/roles` behind a bare JWT guard. One request → full system compromise.
2. **[S-2] Cross-admin password reset with no permission check.** `POST /administrators/send-welcome-email/:id` is JWT-only and overwrites the target's password. Any authenticated user can lock out any administrator, including Super Admin.
3. **[S-3] Authorization fails *open*.** Both the shared owner-scope helper and the bookings/invoices services treat "caller has neither the OWN nor the ALL permission" as *unrestricted*, not *denied*. A role with zero booking permissions sees every tenant's bookings.
4. **[S-5] Payment webhook guard fails open by design.** `PAYMENT_WEBHOOK_SECRET` defaults to `''`; when unset the guard logs a warning and **allows the request**. Unless prod has the secret set today, capture/return are still unauthenticated money endpoints.
5. **[D-1] No CI, no lint, no e2e.** Every fix above ships unverified. `npm run lint` is broken and `npm run test:e2e` — the command CLAUDE.md names as the verification step — does not exist.

---

## 2. Architecture assessment

### 2.1 Topology

```
main.ts ──► AppModule
              ├─ ConfigModule (global, fail-fast on missing API_SECRET)
              ├─ ThrottlerModule (300/min global) ──► APP_GUARD
              ├─ DatabaseModule (Mongoose, shared legacy MongoDB)
              ├─ 16 feature modules  (auth, administrators, properties, rooms,
              │                       bookings, invoices, payments, dashboard, …)
              ├─ CrudModule ──► 17 reference resources on one generic base
              ├─ ApiUsageModule (global interceptor + audit endpoints)
              └─ HealthModule (mounted at root, outside the prefix)

Cross-cutting: src/common/{auth, cache, crud, db, filters, mail,
                           middleware, reference, security, util}
```

**This is the right shape.** The separation of `common/` (mechanism) from `modules/` (policy) holds. `ReferenceModelsModule` centralising the 17 shared Mongoose model registrations avoids the classic Nest duplicate-model-registration trap. `BaseCrudService`/`BaseCrudController` collapsing 17 near-identical legacy controllers into ~230 LOC is exactly the right call for a migration — it turns 17 opportunities for divergence into one.

### 2.2 Layering discipline — good, with a documented exception

Controllers correctly delegate; I found no business logic in a controller. Guards are declarative. DTO validation is applied where DTOs exist.

The exception: **six modules bundle controller, service, and schema into a single `*.module.ts`**:

| File | LOC | Contains |
|---|---:|---|
| [payments.module.ts](src/modules/payments/payments.module.ts) | 430 | service + 2 controllers + module |
| [dashboard.module.ts](src/modules/dashboard/dashboard.module.ts) | 169 | schema + service + controller + module |
| [suggested-rates.module.ts](src/modules/suggested-rates/suggested-rates.module.ts) | 156 | all four |
| [invoices.module.ts](src/modules/invoices/invoices.module.ts) | 100 | controller + module |
| [app-version.module.ts](src/modules/app-version/app-version.module.ts) | 85 | all four |
| [lookups.module.ts](src/modules/lookups/lookups.module.ts) | 56 | all four |

This directly contradicts the project's own convention in CLAUDE.md ("One feature = one module folder … `<name>.service.ts`, `.controller.ts`, `.module.ts`"). The practical cost is real and I hit it during this review: **guard coverage is hard to audit when route decorators are buried 390 lines into a module file.** Two of my three top findings live in files that follow the convention; the third-highest ([S-7], app-version mass assignment) lives in one that doesn't — and it went unnoticed in the July pass.

### 2.3 The authorization model — the structural weak point

This is where I'd focus architectural attention. Three separate issues compound:

**(a) Permissions are resource-scoped, not verb-scoped.** `LIST_ADMINISTRATORS` gates GET *and* POST *and* PUT *and* DELETE ([administrators.controller.ts:31-78](src/modules/administrators/administrators.controller.ts#L31-L78)). Same for `LIST_ROOMS`, `LIST_PROPERTIES`, `LIST_USERS`, `LIST_INVOICES`. There is no way to grant read-only access to any resource. The name says "LIST"; the grant means "own". This is inherited from legacy and is the root cause of [S-1].

**(b) Scoping fails open.** [owner-scope.ts:45](src/common/auth/owner-scope.ts#L45):

```ts
if (hasAll || !hasOwn) return null;   // null === unrestricted
```

Read that again: a caller who has *neither* `LIST_OWN_BOOKINGS` nor `LIST_ALL_BOOKINGS` is treated identically to a Super Admin. The same rule is re-implemented in [bookings.service.ts:73](src/modules/bookings/bookings.service.ts#L73) and [invoices.service.ts:40](src/modules/invoices/invoices.service.ts#L40). It is *documented* as deliberate v2 parity, and I accept that as a migration decision — but it must be tracked as a known fail-open, with an explicit post-cutover date to invert it. A fail-open default that nobody has scheduled to close tends to become permanent.

**(c) Guard placement is inconsistent.** `PermissionsGuard` is applied per-class in most modules, but [bookings.controller.ts:28](src/modules/bookings/bookings.controller.ts#L28) applies only `JwtAuthGuard` at class level and adds `@RequirePermissions` to exactly one route (`GET :id/:status`). So `GET /bookings`, `PUT /bookings/:id`, `POST /bookings/cancel`, `DELETE /bookings/:id` require **no booking permission at all** — combined with (b), a role with zero booking permissions gets unrestricted cross-tenant list access and can cancel/delete bookings anywhere.

**Recommendation:** introduce an `@AllowUnscoped()` opt-in decorator and invert the default in `ownedPropertyIds` to deny. Migrate role-by-role behind a feature flag rather than in one cutover.

### 2.4 Cross-cutting mechanisms — strong

Genuinely good work here, worth preserving:

- **[mongo-sanitize.ts](src/common/security/mongo-sanitize.ts)** — correctly identifies that Express 4's `req.query` is a *re-parsing getter*, so mutation in middleware doesn't stick, and replaces the query parser instead. That is a subtle bug most implementations get wrong.
- **[transaction.util.ts](src/common/db/transaction.util.ts)** — transaction wrapper with topology detection and graceful non-atomic fallback for standalone dev instances. Pragmatic and correctly scoped.
- **[api-usage.service.ts](src/common/api-usage/api-usage.service.ts)** — buffered `$inc` with re-buffer-on-failure and route seeding at bootstrap. Adds ~zero request latency and is cluster-safe. Good design for a migration: it tells you which endpoints nobody actually calls before you invest in porting them.
- **[payments capture/return](src/modules/payments/payments.module.ts#L286-L387)** — conditional-update claim → gateway call → compensating rollback on failure, with a `vcc_pending` flag for reconciliation. This is the correct pattern for a non-transactional external boundary.

---

## 3. Delta vs the 2026-07-04 audit — verified closed

I re-checked each prior finding in source rather than trusting the annotations.

| Prior ID | Issue | Status | Evidence |
|---|---|:---:|---|
| C-1 | Unauthenticated capture/return | ⚠️ **Partial** | `PaymentWebhookGuard` added — but fails open when the secret is unset. See [S-5]. |
| C-2 | NoSQL operator injection | ✅ **Closed** | Query-parser sanitizer + `scalarOrThrow` at each filter site |
| C-3 | ReDoS via `new RegExp(userInput)` | ✅ **Closed** | `escapeRegex` in users/administrators/properties |
| C-4 | No transactions | ✅ **Closed** | `runInTransaction` in properties/rooms/administrators cascade deletes; atomic claim in capture |
| C-5 | `fetch` with no timeout | ✅ **Closed** | `AbortSignal.timeout(8000)` on payment container + Telr |
| — | 4-digit brute-forceable codes | ✅ **Closed** | `secureNumericCode(6)` / `secureToken(24)` + 24h TTL + single-use |
| — | No auth-endpoint throttling | ✅ **Closed** | login 5/min, auto-login 10/min, reset 3/min, onboarding 5/min |
| — | CORS reflects any origin | ✅ **Closed** | Boot fails in production without `CORS_ORIGINS` |
| — | Missing indexes on `userbookings` | ✅ **Closed** | 5 indexes + 2 on `completed_bookings`, plus `scripts/sync-indexes.ts` |
| — | N+1 in property/admin/payment lists | ✅ **Closed** | Single `$in` aggregation in each |
| — | In-memory sort-then-slice | ✅ **Closed** | `$lookup`+`$sort`+`$skip`+`$limit` in bookings and invoices |
| — | No graceful shutdown | ✅ **Closed** | `enableShutdownHooks()` + PM2 `wait_ready` + `kill_timeout` |
| — | No health checks | ✅ **Closed** | `/health/live` + `/health/ready` with Mongo ping → 503 |
| — | No compression | ✅ **Closed** | `compression()` in `main.ts` |
| — | `bcrypt.hashSync` blocking | ❌ **Open** | 5 call sites remain. See [P-1]. |
| — | `strict` off, `any` pervasive | ❌ **Open** | See [M-6], [M-7] |
| — | No e2e / no CI | ❌ **Open** | See [D-1], [D-2] |

**14 of 17 closed or partially closed.** That is a strong remediation pass.

---

## 4. Open findings

### Severity ledger

| ID | Sev | Area | One-liner |
|---|:---:|---|---|
| [S-1] | **Critical** | AuthZ | Admin can self-elevate to Super Admin via `PUT /administrators/:id` |
| [S-2] | **High** | AuthZ | Any authenticated user can reset any administrator's password |
| [S-3] | **High** | AuthZ | Missing permissions ⇒ *unrestricted*, not denied (fail-open) |
| [S-4] | **High** | Data leak | Customer bcrypt hashes returned by 3 admin endpoints |
| [S-5] | **High** | Payments | Webhook guard allows all requests when secret unset |
| [S-6] | Medium | Uploads | No size limit, extension-only filter, SVG accepted, originals leak to disk |
| [S-7] | Medium | Mass assign | `app-version` accepts arbitrary fields into a `strict:false` schema |
| [S-8] | Medium | Session | Password change/reset does not revoke existing JWTs |
| [S-9] | Medium | DoS | `orderBy` unvalidated → arbitrary-field sort on unindexed columns |
| [S-10] | Low | Privacy | Reset-password reveals whether an email is registered |
| [P-1] | Medium | Perf | `bcrypt.hashSync` blocks the event loop (5 sites) |
| [P-2] | Medium | DB | No pool size / connect / socket timeouts configured |
| [P-3] | Medium | Correctness | Read-modify-write `save()` pattern → lost updates (4 sites) |
| [P-4] | Medium | Correctness | `changeAvailability` slot-id comparison looks wrong; concurrent races |
| [P-5] | Low | Perf | Full `properties` collection fetched per invoice-list request |
| [P-6] | Low | Cache | `invalidate()` exists but is never called — stale reference data |
| [M-1..8] | Low–Med | Maintainability | See §4.11 |
| [D-1..4] | **High** | Delivery | No CI, no lint, no e2e, no contract suite |

---

### S-1 — Vertical privilege escalation via administrator update — **Critical**

**Files:** [administrators.controller.ts:62-71](src/modules/administrators/administrators.controller.ts#L62-L71), [create-administrator.dto.ts:22-28](src/modules/administrators/dto/create-administrator.dto.ts#L22-L28), [administrators.service.ts:202-211](src/modules/administrators/administrators.service.ts#L202-L211), [lookups.module.ts:54-55](src/modules/lookups/lookups.module.ts#L54-L55)

The update route is gated on a *read*-named permission:

```ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_ADMINISTRATORS')
@Put(':id')
async modify(@Param('id') id: string, @Body() dto: UpdateAdministratorDto) { … }
```

`UpdateAdministratorDto = PartialType(CreateAdministratorDto)`, and `CreateAdministratorDto` exposes:

```ts
@IsOptional() @IsBoolean()  status?: boolean;
@IsOptional() @IsMongoId()  role?: string;      // ← the whole ballgame
```

The service applies it verbatim: `findOneAndUpdate({_id: id}, {$set: resourceData})`. There is no check that `id !== req.user._id`, and no check that the caller may grant the target role.

**Exploit, complete:**
```
GET  /admin/v2/lookups/roles                    → JWT-only; returns every role _id
PUT  /admin/v2/administrators/<my-own-id>
     { "role": "<super-admin-role-id>" }        → 200
GET  /admin/v2/auth/authorized                  → next request loads role fresh from DB
```
`JwtStrategy.validate` re-populates `role` from the database on every request ([jwt.strategy.ts:33-36](src/modules/auth/strategies/jwt.strategy.ts#L33-L36)), so the escalation takes effect immediately — no re-login needed.

**Fix (layered, all three):**
1. Split the permission: introduce `MANAGE_ADMINISTRATORS` for POST/PUT/DELETE; leave `LIST_ADMINISTRATORS` on the reads.
2. Strip `role` and `status` from the update DTO unless the caller holds a dedicated `ASSIGN_ROLES` permission (mirroring the existing `MANAGE_AGREEMENT` pattern in [properties.service.ts:306](src/modules/properties/properties.service.ts#L306)).
3. Reject self-modification of `role`/`status` outright — `if (String(id) === String(user._id)) delete dto.role`.
4. Gate `GET /lookups/roles` behind `LIST_ADMINISTRATORS`.

---

### S-2 — Unauthorized administrator password reset — **High**

**Files:** [administrators.controller.ts:89-103](src/modules/administrators/administrators.controller.ts#L89-L103), [administrators.service.ts:283-301](src/modules/administrators/administrators.service.ts#L283-L301)

```ts
@UseGuards(JwtAuthGuard)          // ← no PermissionsGuard, no @RequirePermissions
@Post('send-welcome-email/:id')
async sendWelcomeEmail(@Param('id') id: string) { … }
```

The handler generates a new password, **overwrites the target's hash**, and emails the plaintext to the target. Any authenticated principal — a receptionist, a hotel admin, a compromised low-privilege account — can invoke this against *any* administrator id, including Super Admin.

Direct impact: **denial of service by credential invalidation.** Loop over `GET /administrators` ids and every administrator in the system is locked out simultaneously; recovery requires inbox access for each. The new password goes to the victim's mailbox, so it is not by itself account takeover — but chained with [S-1] it is, and it is a clean lockout primitive on its own.

**Fix:** add `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('MANAGE_ADMINISTRATORS')`, and throttle it (`@Throttle({ default: { limit: 5, ttl: 60_000 } })`).

---

### S-3 — Authorization fails open on missing permissions — **High**

**Files:** [owner-scope.ts:41-45](src/common/auth/owner-scope.ts#L41-L45), [bookings.service.ts:73](src/modules/bookings/bookings.service.ts#L73), [invoices.service.ts:40](src/modules/invoices/invoices.service.ts#L40), [bookings.controller.ts:28-39](src/modules/bookings/bookings.controller.ts#L28-L39)

Three fail-open behaviours stack:

1. `ownedPropertyIds` returns `null` (= unrestricted) when the caller holds neither OWN nor ALL.
2. `BookingsService.prepareWhere` only adds the scoping `$and` inside `if (hasOwn && !hasAll)`; otherwise `where` stays `{}`.
3. `BookingsController` requires no booking permission on list/update/cancel/delete.

**Net effect:** a role configured with, say, only `SHOW_DASHBOARD` can call `GET /admin/v2/bookings` and receive **every booking in the system across all tenants** — guest names, emails, mobiles (masked, but present), amounts — and can `DELETE /admin/v2/bookings/:id` on any of them. `InvoicesService` has the identical hole for financial data.

I accept the "v2 parity" rationale as a migration constraint. It must nonetheless be **tracked as a scheduled fail-open**, not left as a comment.

**Fix:** invert the default in `ownedPropertyIds` to deny; add an explicit `@AllowUnscoped()` decorator for the handful of routes that genuinely need it. Apply `PermissionsGuard` at the `BookingsController` class level. Audit the live `roles` collection first — this changes behaviour for any role that currently relies on the fail-open path.

---

### S-4 — Customer password hashes exposed via admin API — **High**

**Files:** [user.schema.ts:14-31](src/modules/users/schemas/user.schema.ts#L14-L31), [users.service.ts:180-203](src/modules/users/users.service.ts#L180-L203), [dashboard.module.ts:104-108](src/modules/dashboard/dashboard.module.ts#L104-L108)

The users schema deliberately omits `select:false` on `password` (documented as legacy parity — administrators have it, users don't). Three endpoints then return whole documents:

| Endpoint | Code | Leaks |
|---|---|---|
| `GET /admin/v2/users/:id` | `findOne({_id}).lean()` | full doc incl. `password` |
| `PUT /admin/v2/users/:id` | `findOneAndUpdate(…, {new:true})` | full doc incl. `password` |
| `GET /admin/v2/dashboard/users` | `find().sort().limit(5).lean()` | 5 full docs incl. `password` |

`GET /users` is safe — its `$project` stage excludes `password` ([users.service.ts:82-100](src/modules/users/users.service.ts#L82-L100)), and `create()` deletes it. The gap is exactly the paths that skip projection.

These are **customer** credentials, shared with the live legacy authentication surface. Every administrator, and anyone who compromises an admin session, gets an offline-crackable corpus of end-user hashes. Bcrypt cost 10 buys time, not immunity.

**Fix:** `.select('-password')` on all three (cheapest, zero-risk), or add `select:false` to the schema prop and audit the legacy customer-login path for a `.select('+password')` before flipping it. Recommend the first now, the second before phase 2 ships the customer auth surface.

---

### S-5 — Payment webhook guard fails open — **High**

**Files:** [payment-webhook.guard.ts:37-43](src/modules/payments/payment-webhook.guard.ts#L37-L43), [configuration.ts:39](src/config/configuration.ts#L39)

```ts
if (!secret) {
  this.logger.warn(`… ${req.method} ${req.url} is UNVERIFIED. …`);
  return true;                                  // ← allows the request
}
```

`paymentWebhookSecret` defaults to `''`, and `PAYMENT_WEBHOOK_SECRET` is absent from `.env.example`. The rollout-safety rationale is sound in principle, but the consequence is precise: **if the secret is not set in the production environment right now, `GET /admin/v2/capture/:bookingId` and `/return/:bookingId` remain exactly as unauthenticated as they were on July 4** — the July audit's #1 critical finding. The mitigation is real but conditional, and the condition is invisible from the code.

The 10/min throttle and the idempotent conditional update do limit blast radius: a replay is a no-op, and a first-time hit on a guessed `_id` is rate-limited. But booking ids are ObjectIds with a timestamp prefix — not meaningfully unguessable at scale.

**Fix (today):**
1. Confirm `PAYMENT_WEBHOOK_SECRET` is set in the production environment. If it is not, this is a live Critical, not a High.
2. Make it **mandatory in production** — mirror the `API_SECRET` fail-fast in [configuration.ts:3-5](src/config/configuration.ts#L3-L5):
   ```ts
   if (process.env.NODE_ENV === 'production' && !process.env.PAYMENT_WEBHOOK_SECRET) {
     throw new Error('PAYMENT_WEBHOOK_SECRET is required in production');
   }
   ```
3. Add it to `.env.example` so it is not silently omitted on the next deploy.

---

### S-6 — Upload handling — **Medium**

**Files:** [properties/upload.config.ts](src/modules/properties/upload.config.ts), [rooms/upload.config.ts](src/modules/rooms/upload.config.ts), [crud-upload.config.ts](src/common/crud/crud-upload.config.ts)

Four distinct problems in one place:

1. **No `limits.fileSize`.** multer's `diskStorage` will accept a file of any size. A handful of concurrent multi-GB uploads fills the VM disk and takes Mongo down with it.
2. **Extension-only filtering.** `extensionFilter` checks `extname(originalname)` — never the declared MIME type, never magic bytes. A polyglot or a renamed payload passes.
3. **`.svg` is on the allowlist.** SVG is an active-content format. Combined with `crossOriginResourcePolicy: 'cross-origin'` and `contentSecurityPolicy: false` in [main.ts:52-58](src/main.ts#L52-L58), an SVG served from the API origin is stored XSS against anything sharing that origin.
4. **Originals are never cleaned up.** [properties.service.ts:411-419](src/modules/properties/properties.service.ts#L411-L419) writes the sharp output to `public/files/properties/` but leaves the multer original in `public/files/original/properties/` forever. Unbounded disk growth proportional to upload volume.

**Fix:** add `limits: { fileSize: 10 * 1024 * 1024, files: 10 }`; validate `file.mimetype` against the extension; drop `.svg` (or sanitize it server-side and serve with `Content-Disposition: attachment`); `fsp.unlink` the original after a successful resize.

---

### S-7 — Mass assignment on `app-version` — **Medium**

**File:** [app-version.module.ts:46-76](src/modules/app-version/app-version.module.ts#L46-L76)

```ts
@UseGuards(JwtAuthGuard)                 // no permission required
@Put()
async modify(@Body() body: any) { … }    // no DTO

// service: schema is strict:false
Object.keys(resourceData).forEach((key) => { resource[key] = resourceData[key]; });
```

`@Body() any` bypasses the global `ValidationPipe` whitelist entirely (whitelisting is DTO-metadata-driven — with no DTO there is nothing to whitelist against), and the schema is `strict:false`, so **arbitrary attacker-chosen fields persist to the `app_version` collection**. Any authenticated user can do it. This document drives force-update behaviour in the mobile clients.

Same `@Body() any` pattern, lower impact, at [base-crud.controller.ts:60,68](src/common/crud/base-crud.controller.ts#L60), [rooms.controller.ts:53,59](src/modules/rooms/rooms.controller.ts#L53), [properties.controller.ts:74,83](src/modules/properties/properties.controller.ts#L74), [invoices.module.ts:71,78](src/modules/invoices/invoices.module.ts#L71). Invoices and rooms mitigate in the service (`pickWritable`, `preCreateOrUpdate`); properties partially; app-version and base-crud not at all.

**Fix:** `AppVersionDto { appType, buildVersion, appVersion, forceUpdate }` + `@RequirePermissions('SHOW_SETTINGS')`. Then work through the remaining `@Body() any` sites, preferring service-side allowlists (the `pickWritable` pattern in [invoices.service.ts:133-163](src/modules/invoices/invoices.service.ts#L133-L163) is the right model) where a full DTO would break legacy payload tolerance.

---

### S-8 — No session revocation — **Medium**

**Files:** [auth.service.ts:107-161](src/modules/auth/auth.service.ts#L107-L161), [jwt.strategy.ts:20-27](src/modules/auth/strategies/jwt.strategy.ts#L20-L27)

Neither `resetPassword` nor `changePassword` invalidates outstanding tokens. A stolen JWT survives the victim's password change for the full 7-day lifetime — which is precisely the window during which the victim believes they have remediated. `POST /auth/logout` returns `{}` and does nothing server-side.

Compounding: `ignoreExpiration: false` is correctly set, but tokens minted before the expiry rollout carry **no `exp` claim at all**, and `passport-jwt` treats a missing `exp` as non-expiring. Those tokens are valid forever.

**Fix:** add a `tokenVersion` integer to the administrator schema, include it in the JWT payload, bump it on password change/reset, and compare in `JwtStrategy.validate`. That also gives you a working `logout`. Separately, decide a hard cutoff date after which tokens lacking `exp` are rejected.

---

### S-9 — Unvalidated `orderBy` → arbitrary-field sort — **Medium**

**Files:** [base-crud.service.ts:59-62](src/common/crud/base-crud.service.ts#L59), [bookings.service.ts:129-132](src/modules/bookings/bookings.service.ts#L129), [rooms.service.ts:132-135](src/modules/rooms/rooms.service.ts#L132), [properties.service.ts:162-165](src/modules/properties/properties.service.ts#L162), [administrators.service.ts:91-94](src/modules/administrators/administrators.service.ts#L91), [users.service.ts:58-61](src/modules/users/users.service.ts#L58), [invoices.service.ts:90-93](src/modules/invoices/invoices.service.ts#L90)

```ts
sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
```

`orderBy` is never validated against a field allowlist. Sorting a large collection on an unindexed field forces an in-memory sort; past 32 MB MongoDB aborts the operation, and before that it burns CPU and RAM. `?orderBy=guestinfo.email` on `userbookings` is a one-request lever, repeatable, available to any authenticated caller. In `users.service` it lands inside an aggregation `$sort` after two `$lookup` stages — the worst case.

The mongo-sanitizer does not help here: it strips `$`-prefixed *keys*, and `orderBy` arrives as a *value*.

**Fix:** a shared `ListQueryDto` with `@IsIn([...])` on `orderBy` per resource. This also fixes the `@Query() any` validation bypass noted in the July audit, and gives you validated `page`/`limit` in one place.

---

### S-10 — User enumeration on password reset — **Low**

**File:** [auth.service.ts:115-117](src/modules/auth/auth.service.ts#L115-L117)

`{ status: 0, message: 'Email id is not registered with us!' }` confirms whether an address is a registered administrator. Throttled to 3/min, so it is slow enumeration rather than fast — but the admin population is small and high-value. Return the same success envelope either way.

---

### 4.11 Performance, correctness, maintainability

**[P-1] Blocking bcrypt — Medium.** `bcrypt.hashSync(x, 10)` at [auth.service.ts:120](src/modules/auth/auth.service.ts#L120), [auth.service.ts:153](src/modules/auth/auth.service.ts#L153), [administrators.service.ts:193](src/modules/administrators/administrators.service.ts#L193), [administrators.service.ts:293](src/modules/administrators/administrators.service.ts#L293), [administrators.service.ts:363](src/modules/administrators/administrators.service.ts#L363), [users.service.ts:219](src/modules/users/users.service.ts#L219). Each call blocks the single event loop for ~60-100 ms — every concurrent request stalls, including health probes. Mechanical fix: `await bcrypt.hash(...)`. All six sites are already in `async` functions.

**[P-2] Mongoose connection unbounded — Medium.** [database.module.ts:24-31](src/database/database.module.ts#L24-L31) sets `uri`, auth, `replicaSet`, `autoIndex` — and nothing else. No `maxPoolSize` (defaults to 100 per process; × PM2 cluster workers can exhaust server connections), no `serverSelectionTimeoutMS`, no `socketTimeoutMS`. During a Mongo blip, requests queue indefinitely instead of failing fast, and `/health/ready` may not flip in time for the LB to drain the instance. Add `maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000`.

**[P-3] Read-modify-write lost updates — Medium.** `findOne()` → mutate keys → `save()` at [base-crud.service.ts:107-117](src/common/crud/base-crud.service.ts#L107), [rooms.service.ts:169-180](src/modules/rooms/rooms.service.ts#L169), [properties.service.ts:333-346](src/modules/properties/properties.service.ts#L333), [app-version.module.ts:46-56](src/modules/app-version/app-version.module.ts#L46), [invoices.service.ts:172-180](src/modules/invoices/invoices.service.ts#L172). Two concurrent edits: last write wins silently and the first admin's changes vanish with no error. `administrators.modify` and `users.modify` already use atomic `findOneAndUpdate($set)` — apply that pattern uniformly, or enable `optimisticConcurrency` on the schemas.

**[P-4] `changeAvailability` — Medium, needs verification.** [rooms.service.ts:381-488](src/modules/rooms/rooms.service.ts#L381-L488). Two concerns:
- *Likely logic bug:* line 429-431 builds `unavailable` from `.map((s: any) => s._id)` — subdocument ids — then filters `slotIds` against it: `slotIds.filter(sid => unavailable.indexOf(sid) === -1)`. Those two id spaces never intersect, so the filter is a no-op and `available` is always the full `slotIds`. That means re-blocking an already-blocked slot **pushes a duplicate entry** rather than skipping it. Worth diffing against the legacy source before changing — if legacy has the same bug, preserve it and file it, per the migration rules.
- *Race:* `Promise.all` over `dates`, each doing `findOne` → mutate `booking.slots` → `save()`, with no session and no version check. Two concurrent block/unblock calls on the same room+date lose one.

**[P-5] Full-collection dropdown fetch — Low.** [invoices.service.ts:98](src/modules/invoices/invoices.service.ts#L98) — `propertyModel.find({}).sort({name:1}).lean()` with **no `.select()`**, on every invoice list request, for a UI dropdown that needs `{_id, name}`. Bookings does this correctly at [bookings.service.ts:180](src/modules/bookings/bookings.service.ts#L180). Add `.select('_id name')` and wrap in `cached()`.

**[P-6] Cache invalidation is dead code — Low.** `invalidate()` is exported from [ttl-cache.ts:46](src/common/cache/ttl-cache.ts#L46) and **called from nowhere**. `cached()` is used at exactly two sites, both `ref:countries`. So editing a country via the CRUD endpoint leaves a stale list served for up to 5 minutes with no way to flush. Either call `invalidate('ref:countries')` from the countries CRUD write path, or drop the function and document the staleness window.

**[M-1] Hardcoded role ObjectIds — Medium.** [bookings.service.ts:85-86](src/modules/bookings/bookings.service.ts#L85-L86):
```ts
String(user.role?._id) === '5efc8ef65694cbf9675b28a3' ||
String(user.role?._id) === '5f1a9e9a016a9ccac0177d39'
```
These gate whether a hotel admin sees unpaid bookings. They are environment-specific database ids embedded in application logic — they will silently not match in staging or any re-seeded environment, and the failure mode is *showing more data than intended*, not an error. Replace with a permission-set lookup, as `properties.service` already does at [properties.service.ts:168-176](src/modules/properties/properties.service.ts#L168-L176).

**[M-2] `buildPages` duplicated 8×.** Byte-identical in `base-crud`, `administrators`, `bookings`, `invoices`, `properties`, `rooms`, `user-ratings`, `users` services. Extract to `common/util/pagination.util.ts`.

**[M-3] Sentinel-return pattern.** Services return `{notFound:true}` / `{error:true}` / `{badRequest:true}` and rely on every controller remembering to check. Where a controller forgets, the sentinel serialises straight to the client as a 200. Several are mapped to HTTP 500 where 400/404/409 is correct ([bookings.controller.ts:62,76,91,100](src/modules/bookings/bookings.controller.ts#L62)) — "Could not cancel booking" is a client error reported as a server fault, which pollutes error dashboards and misleads on-call.

**[M-4] `console.log` in a catch block.** [user-ratings.service.ts:149](src/modules/user-ratings/user-ratings.service.ts#L149) — bypasses the Nest logger, so it will not carry context or route by severity. Use `Logger.error`.

**[M-5] Commissions is a stub.** [commissions.controller.ts:15](src/modules/commissions/commissions.controller.ts#L15) returns hardcoded `2.6666666`. Faithful to legacy. Flag for product before cutover — someone may be reading that number.

**[M-6] `strict` is off.** [tsconfig.json:15-17](tsconfig.json#L15-L17) — `strictNullChecks:false`, `noImplicitAny:false`, `strictBindCallApply:false`. `tsc --noEmit` passing therefore means considerably less than it appears to. The `?.` operators scattered through the services are hand-compensating for a compiler check that is switched off.

**[M-7] `Model<any>` throughout.** Nearly every injected model is `Model<any>`, and `@Body() any` / `req: any` / `resource: any` are pervasive. Given the shared-schema migration constraint this is defensible *for the loose legacy collections* — but `properties`, `rooms`, `invoices`, `users`, `administrators` all have real typed schemas that are not being used at the injection site.

**[M-8] Colocated module files.** See §2.2.

---

### 4.12 Delivery pipeline — **High, and the reason everything above is fragile**

**[D-1] `npm run lint` cannot run.** `package.json` declares `"lint": "eslint ..."` but **eslint is not in `devDependencies` and is not installed**; there is no `.eslintrc*` or `eslint.config.*`. The script fails immediately. Nobody has linted this codebase.

**[D-2] No CI.** No `.github/workflows`, no `.gitlab-ci.yml`. Nothing gates a merge. Every security fix in §3 landed on trust.

**[D-3] No e2e or contract tests.** No `test/` directory. CLAUDE.md names `npm run build && npm run test:e2e` as *the* verification command — **that script does not exist**. CLAUDE.md also mandates `test/contract/`, written against legacy first; none exists. The 73 unit tests are good (`owner-scope.spec`, `payments.service.spec` are both well-targeted) but they are all service-level with mocked models. **Zero tests exercise a guard.** Every finding in §4 — S-1 through S-3 especially — is a guard/decorator-level defect that no service unit test can catch.

**[D-4] `MIGRATION.md` `verified` status is unattainable.** The migration rules state `verified` requires "the contract suite green against both backends". With no contract suite, all 31 phase-1 modules are capped at `done`. The status column currently reads ✅ Done for all 31, which is honest — but it means **no module has been proven byte-identical to legacy**, and byte-identical response parity is the central premise of this migration.

**Dockerfile:** runs as root (no `USER node`), no `HEALTHCHECK` despite `/health/live` existing. Minor, but free to fix.

---

## 5. Phase 2 readiness — customer `api/*` surface

MIGRATION.md tracks ~15 customer routes (U1–U15) plus the search/property-detail services, all `pending`. `src/modules/api/` does not exist yet. Observations for when it starts:

- **The `UserAuthGuard` / `jwt-user` strategy does not exist yet.** CLAUDE.md specifies a separate HS256 strategy with an `{_id}` payload, mounted via `RouterModule` under the `api` prefix. Building it is the first task, and the "never mix them" rule needs a test, not just a convention — a contract test asserting an admin token is rejected by a customer route and vice versa.
- **[S-4] becomes materially worse.** The customer surface will authenticate against the same `users` collection whose `password` field has no `select:false`. Fix S-4 *before* U3 (`POST /api/users/login`) lands, or the leak surface doubles.
- **U15 has a known legacy bug** already documented in MIGRATION.md (missing `return` after a 400; reuses an existing non-guest account by email → issues a token for an arbitrary account). That is an authentication bypass in legacy. The tracker correctly says port the *intended* behaviour. Make sure that decision survives review — it is the one place where "byte-identical parity" must lose.
- **The verbatim-port rule for `services/*.js`** (search, propertyDetail, checkin, date-time) is right. Do not let the pricing math get "cleaned up" during the port.

**Recommendation: do not start phase 2 until [D-1]/[D-2] are done.** Phase 1 is ~9.5k LOC verified by 73 mocked unit tests and a manual audit. Phase 2 roughly doubles the surface, adds a second auth scheme, and carries the pricing engine. Adding that on top of an ungated pipeline compounds risk faster than it adds value.

---

## 6. Roadmap

### Sprint 0 — this week (blocking; ~3 days)

| # | Task | Ref | Effort |
|---|---|---|:---:|
| 1 | Verify `PAYMENT_WEBHOOK_SECRET` is set in prod **today**; add prod fail-fast + `.env.example` entry | S-5 | XS |
| 2 | `MANAGE_ADMINISTRATORS` permission on administrator write routes; block self `role`/`status` edit; gate `/lookups/roles` | S-1 | S |
| 3 | Permission guard + throttle on `send-welcome-email/:id` | S-2 | XS |
| 4 | `.select('-password')` on the three user endpoints | S-4 | XS |
| 5 | Install eslint + config; `npm run lint` must pass | D-1 | S |
| 6 | CI: `npm ci && npm run lint && npx tsc --noEmit && npm test` on every PR | D-2 | S |

*Do 1–4 before 5–6 if you must choose; but land 6 the same week or the rest will drift.*

### Sprint 1 — next two weeks

| # | Task | Ref |
|---|---|---|
| 7 | e2e harness (supertest + mongodb-memory-server); **first tests are guard-coverage tests** for S-1/S-2/S-3 | D-3 |
| 8 | `ListQueryDto` with `@IsIn` on `orderBy`, validated `page`/`limit`; roll across all list endpoints | S-9 |
| 9 | Upload hardening: size limits, MIME validation, drop SVG, unlink originals | S-6 |
| 10 | `AppVersionDto` + permission; sweep remaining `@Body() any` | S-7 |
| 11 | `bcrypt.hashSync` → `await bcrypt.hash` (6 sites) | P-1 |
| 12 | Mongoose pool + timeout options | P-2 |

### Sprint 2 — weeks 3–4

| # | Task | Ref |
|---|---|---|
| 13 | Invert owner-scope default to deny + `@AllowUnscoped()`; audit live `roles` first; feature-flag the rollout | S-3 |
| 14 | `tokenVersion` claim; bump on password change/reset; make `logout` real; set a cutoff for `exp`-less tokens | S-8 |
| 15 | Atomic `findOneAndUpdate` for the 5 read-modify-write sites | P-3 |
| 16 | Diff `changeAvailability` against legacy; fix or document the slot-id comparison; add optimistic concurrency | P-4 |
| 17 | Replace hardcoded role ids with permission lookups | M-1 |
| 18 | Contract test harness (`test/contract/`) — unblocks `verified` in MIGRATION.md | D-4 |

### Sprint 3 — hardening, then phase 2

| # | Task | Ref |
|---|---|---|
| 19 | `strict: true` incrementally, gated by CI; start with `strictNullChecks` | M-6 |
| 20 | Split the 6 colocated module files; extract `buildPages` | M-8, M-2 |
| 21 | Convert sentinel returns to thrown exceptions; correct 4xx vs 5xx | M-3 |
| 22 | `x-request-id` correlation + structured logging (`nestjs-pino`); `prom-client` `/metrics` | Obs |
| 23 | Dockerfile `USER node` + `HEALTHCHECK` | Ops |
| 24 | **Then** begin phase 2 `api/*` — starting with `UserAuthGuard` and its isolation test | §5 |

---

## 7. Closing note

The engineering instincts on display here are good. The query-parser sanitizer, the transaction fallback, the compensating rollback in `capture()`, and the API-usage tracker are all the work of someone thinking past the immediate ticket. The July audit was taken seriously and largely executed.

The gap is not skill — it is **verification**. A codebase this security-sensitive, mid-migration, sharing a live database with a system still in production, currently has no lint, no CI, and no test that can observe a guard. The three critical authorization findings in this report all live in decorators, and every one of them would be caught by a fifteen-line supertest assertion. Sprint 0 item 6 is worth more than any single fix in this document, because it is what stops the next one from happening.

---

*Prepared 2026-07-26 against `uat` @ `7712f05`. All findings traced to file:line in the working tree; `tsc --noEmit` and the full jest suite were executed as part of this review.*
