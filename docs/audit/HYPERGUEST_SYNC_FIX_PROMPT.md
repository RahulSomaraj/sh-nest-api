# Claude Code prompt — harden `HyperGuestSyncService` for full-feed sync

> Copy everything below the line into Claude Code.

---

## Context

Repo: `sh-api-nest` (NestJS 10 + Mongoose 8). Read `CLAUDE.md` first and follow its conventions.

The HyperGuest supplier integration lives in:

- `src/modules/api/hyperguest/hyperguest-sync.service.ts` — the sync (main target)
- `src/modules/api/hyperguest/hyperguest-client.service.ts` — HTTP client for the HG feed/static endpoints
- `src/modules/api/hyperguest/hyperguest.types.ts` — payload types
- `src/modules/api/hyperguest/schemas/hg-hotel.schema.ts` — `hg_hotels` + `hg_sync_runs` schemas
- `src/modules/hyperguest-admin/hyperguest-admin.module.ts` — `POST /admin/v2/hyperguest/sync`, `GET /admin/v2/hyperguest/sync-runs`
- `src/modules/jobs/hyperguest-sync.job.ts` — 6-hourly cron (gated on `ENABLE_CRON` + `HG_ENABLED`)
- Existing specs: `hyperguest-sync.service.spec.ts`, `hyperguest-client.service.spec.ts`

`syncHotels()` pulls HyperGuest's `hotels.json` feed (~53,000 hotels), diffs it against the
`hg_hotels` collection by `hotel_id`, and for each new/changed hotel fetches
`property-static.json` and materializes a Stayhopper `properties` document
(`source: 'HyperGuest'`, `published: true`, `rooms: []`).

`HG_CERTIFICATION` defaults to `true`, which restricts the run to a single certification
property (`HG_CERT_PROPERTY_ID`, default 19912). It works fine in that mode. **The defects
below only surface when `HG_CERTIFICATION=false` and the full feed is processed.**

## Defects to fix — all six were reproduced against the live feed

Observed during a real full-feed run: **3,606 HyperGuest properties created against only
1,948 `hg_hotels` rows — 1,658 orphans (46%)**, plus repeated 15s timeouts, and zero
persisted run summary after the process was restarted mid-run.

### 1. Duplicate `hotel_id` in the feed creates orphaned properties — **the critical one**

`hyperguest-sync.service.ts:78-96`. `knownById` is built **once before the loop** and never
updated inside it:

```ts
const knownById = new Map<number, any>(known.map((k: any) => [k.hotel_id, k]));

for (const hotel of wanted) {
  const existing = knownById.get(hotel.hotel_id);   // still undefined on the 2nd occurrence
  if (!existing) {
    await this.materialize(hotel, null);            // → propertyModel.create() AGAIN
    summary.created++;
  }
```

The HG feed repeats `hotel_id` values. For each repeat, `materialize(hotel, null)` takes the
create branch again and inserts a **second** `properties` document, while the
`hgHotelModel.updateOne({ hotel_id }, …, { upsert: true })` at line 181 collapses both into a
single `hg_hotels` row pointing at the newer property. The earlier property is orphaned:
unreferenced by any `hg_hotels` row, but `source: 'HyperGuest'` and `published: true`, and
therefore invisible to the removal pass at lines 106-118 which only walks `hg_hotels`.
Nothing ever cleans it up, and `invariantOk` (line 125) can never hold.

**Fix:** dedupe by `hotel_id` before the loop, keeping the last entry per id. Compute
`skippedByCertification` from the certification filter only — the dedupe must **not** be
counted as a certification skip:

```ts
const filtered = hg.certification
  ? feed.filter((h) => h.hotel_id === hg.certPropertyId)
  : feed;
summary.skippedByCertification = feed.length - filtered.length;
// HG's feed repeats hotel_id; keep the last entry per id so one id → one property.
const wanted = [...new Map(filtered.map((h) => [h.hotel_id, h])).values()];
```

Add a `duplicatesCollapsed: number` field to the summary (= `filtered.length - wanted.length`)
so this stays visible in `hg_sync_runs` rather than silently disappearing.

### 2. The loop is fully serial — a full run takes ~4 hours

`hyperguest-sync.service.ts:85-101` is a plain `for…of` with `await this.materialize()`
inside; each iteration makes its own `getPropertyStatic()` HTTP round-trip. Measured
throughput was ~3.5 hotels/sec → ~4 hours for the full feed.

**Fix:** process in batches of ~20 concurrently (`Promise.all` over a chunk, sequential
between chunks). Do not use unbounded `Promise.all` over all 53k. Keep per-hotel error
isolation exactly as it is — one failure must not abort the batch or the run. Make the batch
size a named constant (e.g. `MATERIALIZE_CONCURRENCY = 20`) so it can be tuned.

Counter increments (`summary.created++` etc.) must stay correct under concurrency.

### 3. No retry on `getPropertyStatic` — timeouts silently drop hotels

Real errors from the run:

```
ERROR [HyperGuestSyncService] sync hotel 26252 failed: HyperGuest request failed
  (GET https://hg-static.hyperguest.com/26252/property-static.json): This operation was aborted
```

That is `AbortSignal.timeout` (`HG_TIMEOUT_MS`, default 15000) firing. Four consecutive
failures on adjacent ids suggests supplier-side throttling under serial load, not random
network noise. There is no retry, so each timeout drops that hotel for the entire run.

**Fix:** retry `getPropertyStatic` with exponential backoff (3 attempts, ~500ms → 1s → 2s,
with jitter). Retry only on network/timeout/5xx; do **not** retry 4xx. After the final
attempt, record the error and skip that hotel (current behaviour) — do not fail the run.
Prefer implementing the retry in `hyperguest-client.service.ts` so both the static and feed
calls benefit; check what's already there before adding a second mechanism.

Note: `getPropertyStatic` is the first `await` in `materialize()`, so a timeout currently
leaves no partial property. **Preserve that ordering** — do not move the property write
before the static fetch.

### 4. `errors[]` is unbounded and persisted as one document

`hyperguest-sync.service.ts:98` pushes `{ hotel_id, message }` per failure, and the whole
array is written into a single `hg_sync_runs` doc by `create(summary)` at line 146. Across
53k hotels with a meaningful failure rate this can approach MongoDB's **16 MB BSON limit**,
at which point the final `create()` throws and the entire run summary is lost — exactly when
it is most needed.

**Fix:** cap the stored array at the first 100 entries and add an `errorCount: number` field
carrying the true total. `ok` must be derived from `errorCount === 0 && invariantOk`, not
from `errors.length`. Update `HgSyncSummary` in `hyperguest.types.ts` and the `hg_sync_runs`
schema accordingly.

### 5. A run interrupted mid-flight records nothing

`create(summary)` only runs at line 146, after the whole loop. A restart, crash or deploy
during a 4-hour run leaves thousands of created properties and **zero** audit trail —
confirmed: after a mid-run restart, `hg_sync_runs` still contained only the two earlier
certification runs.

**Fix:** create the run document **before** the loop with `status: 'running'`, then update it
on completion to `status: 'completed' | 'failed'` with the final counters. Persist progress
periodically (e.g. after each batch) so an interrupted run is diagnosable. `recentRuns()`
should keep returning newest-first and must not break its current response shape for
`GET /admin/v2/hyperguest/sync-runs`.

### 6. No run lock — manual and cron runs can overlap

`POST /admin/v2/hyperguest/sync` and the 6-hourly `@Cron('0 */6 * * *')` both call
`syncHotels()`. A full run takes longer than the cron interval, so runs *will* overlap,
racing on the same upserts.

**Fix:** guard entry so a second concurrent run returns `{ skipped: 'already running' }`
instead of starting. Implement it via the `hg_sync_runs` collection (conditional insert /
`status: 'running'` check) rather than an in-process flag — the app runs multi-instance under
PM2, so an in-memory lock is insufficient. Include a staleness timeout (e.g. treat a
`running` row older than 6h as dead) so a crashed run cannot deadlock all future syncs.

## Constraints

- Follow `CLAUDE.md`: no `axios` (native `fetch`), no `require()`, no `any` in new code,
  constructor injection only, `HttpException` subclasses for errors.
- **Do not change** the response shape of `POST /admin/v2/hyperguest/sync` or
  `GET /admin/v2/hyperguest/sync-runs` beyond the *additive* fields specified above
  (`duplicatesCollapsed`, `errorCount`, `status`).
- **Do not change** `materialize()`'s property-field mapping (`buildPropertyFields`) or the
  `rooms: []` behaviour — HG properties are deliberately invisible to search until slab C.
- **Do not** relax or remove certification mode.
- Keep the existing per-hotel error isolation semantics: one bad hotel never aborts the run.
- Preserve the existing removal/unpublish pass semantics (never delete a property — bookings
  may reference it).

## Tests

Extend `src/modules/api/hyperguest/hyperguest-sync.service.spec.ts`. Required cases:

1. A feed containing the same `hotel_id` twice produces **exactly one** `properties` create
   and one `hg_hotels` row, and reports `duplicatesCollapsed: 1`.
2. `skippedByCertification` counts only certification-filtered hotels, not deduped ones.
3. A `getPropertyStatic` failure that succeeds on retry materializes normally; one that fails
   all attempts is recorded as an error and skipped, with no orphan property created.
4. With >100 failures, `errors` has length 100 and `errorCount` reflects the true total.
5. A second `syncHotels()` invocation while one is `running` returns `{ skipped: … }`.
6. Batching preserves correct `created` / `updated` / `unchanged` counters.

## Verify

```bash
npm run build
npx jest hyperguest
npx jest              # full suite must stay green — 73 tests were passing before this work
npx tsc --noEmit
```

## Out of scope — do not do these

- Do not turn `HG_CERTIFICATION` off anywhere in code or config.
- Do not add a cleanup migration for the 1,658 existing orphan properties; the dev database
  is disposable (`docker compose down -v && docker compose up -d --build mongo` re-seeds).
  Mention in your summary that a production cleanup script would be needed if this ever ran
  against real data.
- Do not touch the admin controller's auth/permissions.

## Deliverable

One commit on a branch. In your summary, state the measured effect of the batching change on
expected full-feed runtime, and confirm each of the six defects with the test that covers it.
