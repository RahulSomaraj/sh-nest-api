# HyperGuest Integration Plan (Phase 4)

Full integration: client layer + merge into customer `api/*` search and booking flow.
Stage: **CERTIFICATION** — DEV token, property **19912** only, `paymentDetails.details.charge: false`
always, no LIVE bookings. Everything ships behind `HG_ENABLED` (default **off**) so customer
envelopes stay byte-identical until the flag is flipped.

---

## Architecture decisions (defaults — flag if you disagree)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Materialize HG hotels as `properties` docs** (`source: 'HyperGuest'`) via a sync job, rooms stay virtual (live from HG search) | Search/detail/booking all key off the `properties` collection; a real doc means `_id` routing, populate, favourites, dashboards all work unchanged. Enum gets `'HyperGuest'`; dashboard `$or` (dashboard.module.ts:63) updated so HG doesn't count as Extranet. |
| D2 | **HG participates only in nightly-shaped stays** (checkin/checkout on full-day segments; `bookingType: 'hourly'` with fullDay rate, or monthly ≤30 nights) | HG is a nights-based API; sub-day slot stays can't be represented. Cleanest correct subset first. |
| D3 | **Payment: keep the existing MamoPay payment-link flow** (customer pays Stayhopper), HG booking created with `paymentDetails: { type: 'external' }`-equivalent + `charge: false` after payment succeeds | `charge:false` is mandatory for certification anyway; no change to the payment container; HG create happens only after money is collected, so no HG cancel needed on payment failure (only pre-book context is discarded). Product can revisit for LIVE. |
| D4 | Config **env-only** (`hyperguest` block in configuration.ts) | Matches repo pattern; admin CRUD later if needed. |
| D5 | Search merge hook placed **inside `SearchService.getProperties` between rating population (:161) and `sortAndPaginateProperties` (:179)** | Only seam where HG items flow through sort/count/totalPages exactly like native ones → envelope stays identical. Hook is 4 lines (`if (hg?.enabled) list.push(...await hgSearch.search(params))`); all mapping lives in the HG module, keeping the verbatim-port file nearly untouched. |

## Certification safety rails (hard-coded, not just config)

- `charge` is **always literal `false`** in the create-booking body — no config path can set it true.
- When `hyperguest.certification: true` (default): every outbound propertyId is asserted `=== 19912`; sync job materializes only 19912; anything else throws before the wire.
- `HG_ENABLED !== 'true'` ⇒ no HG code runs: no fetches, no search merge, no cron. `app.wiring.spec` still passes with flag off.

---

## Slabs

### A — Foundation (no behavior change) — ✅ built 2026-07-27 (specs pending local run)
1. `configuration.ts`: `hyperguest: { enabled, token, searchUrl, bookUrl, staticUrl, certification, certPropertyId, agencyReference, timeoutMs }` from `HG_*` envs (defaults: cert on, URLs from captured contracts).
2. `src/modules/api/hyperguest/hyperguest.types.ts` — full captured contracts: search (guests grammar `adults-childAges` rooms joined by `.`), pre-book, create, cancel (incl. `simulation`), get, list, static hotels/property-static, error envelope `{error, errorCode, errorDetails[]}`, status union `Confirmed|Pending|Rejected|Cancelled|Failed`, error codes (`BN.402` price change, `BN.502` availability gone, etc.).
3. `hyperguest-client.service.ts` — native `fetch`, `Authorization: Bearer` + `Accept-Encoding: gzip, deflate`, AbortController timeout, typed `HyperGuestApiError` from the envelope, 429 back-off on static endpoints. Methods: `search`, `preBook`, `createBooking`, `cancelBooking`, `getBooking`, `listBookings`, `getHotels`, `getPropertyStatic`.
4. `HyperGuestModule` (providers only, no controller) exported; imported by `ApiServicesModule` and `CustomerBookingsModule`.

### B — Static sync + property materialization — ✅ built 2026-07-27 (specs pending local run; property-static payload shape to verify on first real sync)
5. `hg_hotels` schema (new collection — migration note per CLAUDE.md): hotel_id, name, city_Id, geo, last_updated, static blob, propertyRef. Registered in `reference.module.ts`.
6. `HyperGuestSyncService` + cron in `src/modules/jobs/` (`@Cron`, `if (!this.enabled) return` + HG flag; every 6h): pull `hotels.json` (delta via `last_updated`), pull `property-static.json` per changed hotel (429 back-off), upsert `hg_hotels`, upsert `properties` doc (`source:'HyperGuest'`, approved/published true, signed-agreement stub, images/geo/name from static). Certification: 19912 only.
7. `property.schema.ts` source enum + `'HyperGuest'`; dashboard `$or` fix.

### C — Search + detail integration
8. `HyperGuestSearchService.searchForParams(params: SearchParams)`: skip unless stay is nightly-shaped (D2); resolve candidate HG properties (by geo radius / cityId from `hg_hotels`); call HG search; map `results[].rooms[].ratePlans[]` → the exact per-property item + per-room shapes (priceSummary `base/taxes/bookingFee/total/payNow/payAtHotel` incl. the string-vs-number quirks, `finalPrice`, `numberOfRoomsAvailable`, `allowedHourlyBooking:false`, `userRating`, `stayDuration`, `timeDetails`). `sell` price drives `base.amount`; cancellationPolicies + `ratePlanId/roomCode` stashed under a `hg` key on the room item (additive field — verify sh-website tolerates it; it should, envelope adds are non-breaking there).
9. Hook in `SearchService.getProperties` (D5). Home-page lists (`MainService`) deliberately **not** merged in this pass.
10. Detail branch in `CustomerPropertiesService.detail`: `source==='HyperGuest'` → `HyperGuestDetailService` builds the detail shape from `hg_hotels` static + live HG search (fresh prices), same envelope.

### D — Booking integration
11. `createBooking` branch at the slots seam (customer-bookings.service.ts:191): HG property → `preBook` (validate `expectedPrice`; on `priceChange`/`BN.402` → fail with the legacy `{status:'Failed', ...}` envelope so the client re-searches), persist UB doc with `source:'HyperGuest'`, `hg: { propertyId, rooms(sel/rateCode), preBook snapshot }` (strict:false — no migration), **skip** stage/persist slots. Payment link flow unchanged.
12. `paymentSuccess` (after :597): HG booking → `client.createBooking` (charge:false, leadGuest from guestinfo, `reference.agency` = our `book_id`) → store `hg.bookingId`, `hg.status`. `Confirmed` → existing confirmation emails; `Pending` → mark, hold emails until reconciliation confirms; create-failure → flag `hg.createFailed` for ops + skip emails (money already taken → manual/auto refund is an open product item, surfaced in summary).
13. `paymentFailed`: HG branch discards pre-book context only (nothing was created on HG side).
14. Admin cancel flow (`bookings.service.ts cancel/approve`): HG branch → `cancelBooking` (optional `simulation:true` first to surface penalty), map returned status.
15. Reconciliation cron (every 5 min, jobs pattern): `listBookings` filtered by `agencyReference` → sync `Pending → Confirmed/Rejected`, fire held emails, mark rejects.

### E — Tests + verification
16. Specs (repo pattern: direct `new Service()`, `src/testing/mocks.ts`, mocked global fetch): client (headers, error envelope, 429 back-off, cert-property assertion, charge:false literal), search mapper (fixture → exact envelope shapes), booking branch (pre-book fail/price-change/create paths), sync upsert. npm scripts `test:hyperguest`.
17. `app.wiring.spec.ts`: assert graph resolves with HG module, flag off and on.
18. `npm run build && npx jest --testMatch="**/*.spec.ts"`; MIGRATION.md Phase 4 section → row table with statuses.

Slab order respects "never change query/business logic and routing in the same PR": A+B are additive, C touches search only behind the flag, D touches booking only behind the flag, each lands separately.

## Open items (not blockers, tracked)
- Refund path when HG create fails *after* customer payment (D3 consequence) — needs product decision before LIVE.
- Home-page list merge (MainService) — later slab if wanted.
- LIVE cutover checklist: LIVE token, certification flag off, charging model revisit.
