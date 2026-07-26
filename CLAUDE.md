# CLAUDE.md — sh-api-nest

## Stack
NestJS 10, Mongoose (shared MongoDB with legacy — same collections), deployed Azure VM + PM2.
Outbound HTTP: native `fetch` (Node 18+). **No axios.** Config via `src/config/configuration.ts` + `ConfigService`.

## What this repo is
NestJS rewrite of the legacy Express backend `sh-api/stayhopper`. Two API surfaces:
- `admin/v2` (extranet, consumer sh-account) — DONE, 31 modules (see MIGRATION.md phase 1).
- `api/*` (customer, consumer sh-website) — routes ported, awaiting contract verification
  (MIGRATION.md phase 2). Modules live under `src/modules/api/`; the legacy
  `services/*.js` pricing layer is ported verbatim into `src/modules/api/services/`.
- Background jobs — ported (`src/modules/jobs/`, MIGRATION.md phase 3); C5/C8 await a
  product decision, C10 is out of scope.
Legacy source of truth lives OUTSIDE this repo at `sh-api/stayhopper` (read-only reference).

## Conventions
- One feature = one module folder under `src/modules/`: `dto/`, `schemas/`, `<name>.service.ts`, `.controller.ts`, `.module.ts`.
- Customer-surface modules live under `src/modules/api/` and mount under the `api` prefix via `RouterModule`; admin modules keep `admin/v2`.
- Controllers contain NO business logic — delegate to service.
- Input via DTO + class-validator; global ValidationPipe is `whitelist:true, transform:true, forbidNonWhitelisted:false` (legacy accepts loose payloads — never turn on forbid).
- Schemas mirror legacy `db/models/*` exactly: same collection names, same field names, keep `select:false` flags. Never rename fields.
- Auth: admin routes → `JwtAuthGuard`; customer routes → `UserAuthGuard` (separate `jwt-user` strategy, HS256 `API_SECRET`, payload `{_id}`). Never mix them. `@CurrentUser()` for the authed principal.
- Errors: throw `HttpException` subclasses only; global filter formats the envelope.
- Preserve legacy response envelopes byte-identically: `{ status, message, data }`, pagination shape `{ list, itemCount, pageCount, pages, active_page }`, populate output.
- No `any`. No `require()`. Constructor injection only.
- Emails via `MailService`; templates ported from legacy `public/*.html`.

## Migration rules
- Response shapes stay byte-identical to legacy Express until cutover — same status codes, error bodies, field names. Exceptions ONLY as listed in MIGRATION.md §2g (security bugs we deliberately fix).
- Never change query/business logic and routing in the same PR.
- Legacy `services/*.js` (search, properties, propertyDetail, checkin, date-time) are ported VERBATIM as injectable services — no refactors of the math in phase 2.
- Update the MIGRATION.md status column (`pending → in-progress → done → verified`) after each row; `verified` requires the contract suite green against both backends.
- Contract tests live in `test/contract/`; written against legacy FIRST, then run against nest.
- DB schema untouched — shared live MongoDB. No index changes without a migration note.
- Cron jobs run only when `ENABLE_CRON=true` (single PM2 instance).
- `API_SECRET` is required at boot — no fallback secrets, ever.

## Verify
`npm run build && npx jest --testMatch="**/*.spec.ts"`
(the `jest.testMatch` in package.json doesn't resolve inside a git worktree — the `.claude`
path segment is read as a regex escape — so pass `--testMatch` explicitly there.)
`src/app.wiring.spec.ts` is the fast check that the DI graph and both route prefixes
still resolve; it needs no database.
