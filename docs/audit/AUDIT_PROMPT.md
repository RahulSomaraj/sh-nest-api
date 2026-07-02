# Reusable Audit Prompt (NestJS migration verification)

Use this prompt each time you want one API audited. Replace `<MODULE>` with a row from the TODO list in `API_MIGRATION_AUDIT.md` (e.g. `properties`, `bookings`, `auth`).

**Three layers under comparison:**
- **Legacy v1** — `sh-api/stayhopper/admin/controllers/*.js` (routes disabled; original behaviour spec).
- **Express v2** — `sh-api/stayhopper/admin/controllers/v2/*.js` (interim; the NestJS "source of truth" per `MIGRATION.md`).
- **NestJS** — `sh-api-nest/src/modules/<module>/*` (the true migration target being verified).

Guest API layers: legacy `sh-api/stayhopper/controllers/api/*.js` → v2/v3 `.../api/v2|v3/*.js`.

---

## The Prompt

```
Audit the "<MODULE>" API from the TODO list in docs/audit/API_MIGRATION_AUDIT.md.

1. Read all three layers for this module:
   - Legacy v1 controller(s)  (sh-api/stayhopper/admin/controllers/<module>.js)
   - Express v2 controller(s) (sh-api/stayhopper/admin/controllers/v2/<module>.js)
   - NestJS module            (sh-api-nest/src/modules/<module>/*: controller, service, dto, schema)
2. Enumerate every endpoint in each (method, path, guard/auth, params, body).
3. Compare one endpoint at a time, v2 → NestJS (with legacy as the behavioural
   reference):
   - Request contract: params, query, body/DTO fields, validation
   - Auth: JwtAuthGuard / PermissionsGuard vs the v2 permission check
   - Business logic: DB queries, filters, computations, side effects
     (emails, payments, cascades)
   - Response contract: envelope shape, status codes, error handling
4. Verify correctness statically. In particular confirm whether the NestJS port
   FIXED or REPRODUCED the v2 issues already logged for this module, and flag any
   NEW divergence (dropped field, changed default, missing endpoint, unguarded route).
5. Classify each endpoint: MATCH / CHANGED (intentional) / REGRESSION (bug) /
   MISSING (not ported) / NEW.
6. Update docs/audit/API_MIGRATION_AUDIT.md:
   - Fill the module's report section (endpoint table + findings + accuracy %)
   - Mark the module's checkbox in the TODO list with its status
7. Give me a short summary in chat: what the NestJS port got right, what's still
   broken, accuracy score.
```

---

## Conventions

- Accuracy score = endpoints correctly ported to NestJS / total live v2 endpoints for the module, with notes on intentional changes.
- Severity tags: `[BLOCKER]` broken/regression, `[WARN]` behavioural difference, `[INFO]` intentional improvement or note.
- When the NestJS port fixes a v2 bug, log it as `[INFO]` (fixed) so the delta is visible; when it carries the bug forward, log it as `[BLOCKER]`/`[WARN]` (reproduced).
- Legacy `/migrate-*` and other one-off/backfill routes are intentionally not ported — note, don't flag.

## Canonical location

This audit set now lives in the **NestJS repo** (`sh-api-nest/docs/audit/`) because the reports are the verification spec for what Nest must implement/fix. A copy also exists in `sh-api/audit/` from the initial pass; treat `sh-api-nest/docs/audit/` as canonical going forward.
