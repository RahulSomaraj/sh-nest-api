# Module-wise API tests

Unit test suites verifying the audit-fix behaviour (`docs/audit/API_MIGRATION_AUDIT.md` /
`docs/audit/FIX_CHANGELOG.md`). Services are constructed directly with mocked Mongoose
models — **no database or network needed**; suites run fully offline.

## Setup (one-time)

```bash
npm install   # pulls jest, ts-jest, @types/jest (new devDependencies)
```

## Run everything — module-wise report

```bash
npm run test:report
```

`--verbose` prints one section per module spec with every test named after the behaviour
it verifies (each spec file = one module; describe blocks are titled `Module: <name> (<audit id>)`).

## HTML report with charts & analytics

```bash
npm run test:html
```

Runs the full suite and writes a self-contained dashboard to
**`reports/test-report.html`** (open in any browser — no server, no internet needed):

- summary cards (modules / tests / passed / failed / duration) + pass-rate donut
- per-module stacked pass/fail bar chart
- one section per module with the **example request payload** and the
  **success message/response contract** for its endpoints, followed by every test's
  status badge, duration and message (full failure output when red)

Raw machine-readable results land in `reports/jest-results.json` (both are gitignored).

## Run a single module

| Command | Module | Audit findings covered |
|---|---|---|
| `npm run test:auth` | auth | A1 — inactive login rejected, minimal JWT claims, schema strips password/codes |
| `npm run test:administrators` | administrators | A2 — delete guard + cascade, `check_active_bookings` contract |
| `npm run test:users` | users | A3 — booking arrays bounded to 100, full-history totals |
| `npm run test:user-ratings` | user-ratings | A4 — boolean coercion of `approved`/`:status`, rating recompute |
| `npm run test:properties` | properties | A5 — by-id owner scoping (403), delete guard/cascade, approved/published/user_rating gating |
| `npm run test:rooms` | rooms | A6 — list + by-id owner scoping, delete guard/cleanup, suggestion-flag stripping |
| `npm run test:bookings` | bookings | A7 — workflow owner scoping, PII masking, email recipients (product decisions) |
| `npm run test:invoices` | invoices | A8 — write-field allowlist |
| `npm run test:payments` | payments | A8 — capture/return state + guest/hotel emails, no-op guards, email-failure isolation |
| `npm run test:crud` | crud (cities) | A16 — `countries` restored to the list envelope |
| `npm run test:commissions` | commissions | A30 — PUT 200, stub bodies |
| `npm run test:common` | owner-scope helper | A5/A6/A7 — scoping rules |

## Notes

- `jest.setup.js` loads `reflect-metadata` (Nest decorators) and sets a test `API_SECRET`
  (the config fails fast without one since audit A1).
- Shared mocks live in `src/testing/mocks.ts` (excluded from `nest build`).
- These are behaviour/unit tests. For a full end-to-end pass (real Mongo + HTTP), add
  `@nestjs/testing` + `mongodb-memory-server` later; the specs here are the cutover
  gate for the audit fixes specifically.
- Modules with no spec of their own (dashboard, lookups, suggested-rates, app-version,
  remaining CRUD resources) were audited ✅ faithful with no code changes in the fix pass.
