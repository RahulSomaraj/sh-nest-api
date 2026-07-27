import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HyperGuestClientService } from './hyperguest-client.service';
import { HgPropertyStatic, HgStaticHotel, HgSyncSummary } from './hyperguest.types';

const KEEP_SYNC_RUNS = 50;

/** Checkpoint the run doc every N completed hotels (progress + crash diagnosis). */
const CHECKPOINT_EVERY = 50;

/**
 * Per-hotel failures kept in the run doc. The whole summary is one document, and an
 * unbounded array across a 53k feed can reach the 16MB BSON limit — at which point
 * the write throws and the run summary is lost exactly when it is most needed.
 */
const MAX_STORED_ERRORS = 100;

/** A `running` row older than this is treated as a crashed run, not a live lock. */
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

/** MongoDB duplicate-key — here, the run lock already being held. */
const DUPLICATE_KEY = 11000;

interface HgSyncConfig {
  enabled: boolean;
  certification: boolean;
  certPropertyId: number;
  systemAdminId: string;
  /** Scope filter — see configuration.ts. Empty/absent = whole feed. */
  countries?: string[];
  cities?: string[];
  cityIds?: number[];
  /** Static-feed pacing. */
  staticConcurrency?: number;
  staticRps?: number;
}

/** The projection of `hg_hotels` the diff needs. */
interface HgKnownRow {
  hotel_id: number;
  last_updated?: string;
  active?: boolean;
  property?: Types.ObjectId;
}

/**
 * HyperGuest static sync (MIGRATION.md phase 4, slab B, decision D1).
 *
 * Discovery is a diff: HG offers no webhook, so each run pulls hotels.json and
 * compares against `hg_hotels` by hotel_id —
 *   new      → fetch property-static, insert hg_hotels row + materialize a
 *              `properties` doc (source:'HyperGuest', published)
 *   changed  → feed last_updated moved → refetch static, update both docs
 *   removed  → in hg_hotels but gone from feed → active:false + unpublish the
 *              property (never delete — bookings may reference it)
 *   unchanged→ skipped entirely (no per-hotel fetch)
 *
 * Materialized properties carry rooms: [] — the search pipeline drops zero-room
 * properties, so HG hotels stay invisible to customers until slab C serves
 * virtual rooms from live HG search. Materializing first is deliberate: ids,
 * routing and content are in place before any pricing goes live.
 *
 * Certification mode: only certPropertyId (19912) is materialized; the rest of
 * the feed is counted as skippedByCertification.
 *
 * Full-feed hardening (the defects below only bite with HG_CERTIFICATION=false):
 *  - the feed repeats hotel_id, so it is deduped to one entry per id before the
 *    loop — otherwise each repeat created a second property and orphaned the first;
 *  - hotels are materialized by a worker pool bounded by BOTH staticConcurrency and
 *    staticRps (the supplier throttles hard; concurrency alone still bursts), with
 *    per-hotel error isolation — one bad hotel never aborts the run;
 *  - the run doc is written up front as `running` and checkpointed every
 *    CHECKPOINT_EVERY hotels, so an interrupted run is still diagnosable, and it
 *    doubles as a cross-instance lock.
 */
@Injectable()
export class HyperGuestSyncService {
  private readonly logger = new Logger(HyperGuestSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly client: HyperGuestClientService,
    @InjectModel('hg_hotels') private readonly hgHotelModel: Model<any>,
    @InjectModel('hg_sync_runs') private readonly hgSyncRunModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('currencies') private readonly currencyModel: Model<any>,
  ) {}

  /**
   * Run one sync. Returns the run summary (also persisted to hg_sync_runs).
   * Callers: 6-hourly cron (jobs module) + POST /admin/v2/hyperguest/sync.
   */
  async syncHotels(trigger: 'cron' | 'manual'): Promise<HgSyncSummary | { skipped: string }> {
    const hg = this.config.get<HgSyncConfig>('hyperguest');
    if (!hg?.enabled) return { skipped: 'HG_ENABLED != true' };

    const startedAt = new Date();
    const summary: HgSyncSummary = {
      trigger,
      status: 'running',
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      feedTotal: 0,
      skippedByCertification: 0,
      skippedByCity: 0,
      scope: {
        countries: hg.countries ?? [],
        cities: hg.cities ?? [],
        cityIds: hg.cityIds ?? [],
      },
      duplicatesCollapsed: 0,
      created: 0,
      updated: 0,
      unpublished: 0,
      unchanged: 0,
      errors: [],
      errorCount: 0,
      invariantOk: true,
      ok: false,
    };

    // Claim the run lock before any work: the doc goes in as `running` and the
    // partial unique index rejects a second one. This doubles as the crash-safe
    // audit trail — an interrupted run leaves a `running` row, not nothing.
    const runId = await this.acquireRunLock(summary);
    if (!runId) return { skipped: 'already running' };

    try {
      const feed = await this.client.getHotels();
      summary.feedTotal = feed.length;

      // Certification: the diff sees the whole feed but only 19912 materializes.
      const certFiltered = hg.certification
        ? feed.filter((h) => h.hotel_id === hg.certPropertyId)
        : feed;
      summary.skippedByCertification = feed.length - certFiltered.length;

      // Scope: restrict to the cities we sell. Applied AFTER certification so the
      // two counters stay meaningful, and before any property-static fetch — the
      // whole point is not paying a round-trip for a hotel we will never list.
      const filtered = certFiltered.filter((h) => inScope(h, hg));
      summary.skippedByCity = certFiltered.length - filtered.length;
      if (summary.skippedByCity > 0) {
        this.logger.log(
          `HG scope filter [countries: ${(hg.countries ?? []).join(', ') || '—'}; ` +
            `cities: ${(hg.cities ?? []).join(', ') || '—'}; city_Ids: ${(hg.cityIds ?? []).join(', ') || '—'}] ` +
            `kept ${filtered.length} of ${certFiltered.length} hotels`,
        );
      }

      // HG's feed repeats hotel_id; keep the last entry per id so one id → one
      // property. Without this every repeat re-entered the create branch (the
      // pre-loop knownById never learns about ids created during the loop) and
      // orphaned the property the previous occurrence had just made — 1,658 of
      // them, 46% of a real full-feed run. Counted separately: a duplicate is not
      // a certification skip.
      const wanted = [...new Map(filtered.map((h) => [h.hotel_id, h])).values()];
      summary.duplicatesCollapsed = filtered.length - wanted.length;
      if (summary.duplicatesCollapsed > 0) {
        this.logger.warn(
          `HG feed repeated ${summary.duplicatesCollapsed} hotel_id(s) — collapsed to last occurrence`,
        );
      }

      const known = (await this.hgHotelModel
        .find({}, { hotel_id: 1, last_updated: 1, active: 1, property: 1 })
        .lean()
        .exec()) as unknown as HgKnownRow[];
      const knownById = new Map<number, HgKnownRow>(known.map((k) => [k.hotel_id, k]));
      const feedIds = new Set(wanted.map((h) => h.hotel_id));

      // Partition first: an unchanged hotel needs no fetch, so keeping it out of the
      // batches means concurrency is spent only on hotels that actually do I/O.
      const pending: Array<{ hotel: HgStaticHotel; existing: HgKnownRow | null }> = [];
      for (const hotel of wanted) {
        const existing = knownById.get(hotel.hotel_id);
        if (!existing) {
          pending.push({ hotel, existing: null });
        } else if (existing.last_updated !== hotel.last_updated || !existing.active) {
          pending.push({ hotel, existing });
        } else {
          summary.unchanged++;
        }
      }

      const concurrency = Math.max(1, hg.staticConcurrency ?? 4);
      const rps = Math.max(0.1, hg.staticRps ?? 3);
      if (pending.length) {
        this.logger.log(
          `HG sync materializing ${pending.length} hotel(s) at ≤${rps}/s across ${concurrency} worker(s) ` +
            `— est. ${Math.ceil(pending.length / rps / 60)} min`,
        );
      }

      let done = 0;
      await this.runPaced(pending, concurrency, rps, async ({ hotel, existing }) => {
        // Per-hotel isolation: each task swallows its own failure, so one bad hotel
        // can never reject a sibling or abort the run.
        try {
          await this.materialize(hotel, existing);
          if (existing) summary.updated++;
          else summary.created++;
        } catch (err) {
          this.recordError(summary, hotel.hotel_id, (err as Error).message);
        }
        // Checkpoint so a run killed mid-flight is still diagnosable, and so a long
        // first import reports progress instead of looking hung.
        if (++done % CHECKPOINT_EVERY === 0) {
          this.logger.log(`HG sync progress: ${done}/${pending.length} hotels`);
          await this.persistProgress(runId, summary);
        }
      });
      await this.persistProgress(runId, summary);

      // Deactivate anything active that is no longer in scope: dropped out of the
      // feed, excluded by certification, or outside the city filter. `feedIds` is
      // the post-filter set, so narrowing HG_CITIES unpublishes the hotels that
      // narrowing excluded — intended: scope is "what we sell now".
      for (const k of known) {
        if (k.active && !feedIds.has(k.hotel_id)) {
          await this.hgHotelModel
            .updateOne({ hotel_id: k.hotel_id }, { $set: { active: false } })
            .exec();
          if (k.property) {
            await this.propertyModel
              .updateOne({ _id: k.property }, { $set: { published: false } })
              .exec();
          }
          summary.unpublished++;
        }
      }

      // Invariant: every active hg_hotels row ↔ one published HyperGuest property.
      const [activeRows, publishedProps] = await Promise.all([
        this.hgHotelModel.countDocuments({ active: true }).exec(),
        this.propertyModel.countDocuments({ source: 'HyperGuest', published: true }).exec(),
      ]);
      summary.invariantOk = activeRows === publishedProps;
      if (!summary.invariantOk) {
        this.logger.error(
          `HG sync invariant BROKEN: ${activeRows} active hg_hotels vs ${publishedProps} published HyperGuest properties`,
        );
      }

      // errorCount, not errors.length — the stored array is capped at 100.
      summary.ok = summary.errorCount === 0 && summary.invariantOk;
      summary.status = 'completed';
    } catch (err) {
      this.recordError(summary, -1, (err as Error).message);
      summary.ok = false;
      summary.status = 'failed';
      this.logger.error(`HG sync failed: ${(err as Error).message}`);
    }

    summary.finishedAt = new Date();
    summary.durationMs = summary.finishedAt.getTime() - summary.startedAt.getTime();
    this.logger.log(
      `HG sync (${trigger}): feed=${summary.feedTotal} new=${summary.created} updated=${summary.updated} ` +
        `unpublished=${summary.unpublished} unchanged=${summary.unchanged} certSkipped=${summary.skippedByCertification} ` +
        `citySkipped=${summary.skippedByCity} duplicates=${summary.duplicatesCollapsed} ` +
        `errors=${summary.errorCount} in ${summary.durationMs}ms`,
    );

    // Terminal update on the row created up front — this also releases the lock,
    // since the partial unique index only covers status:'running'.
    await this.hgSyncRunModel.updateOne({ _id: runId }, { $set: summary }).exec();
    await this.pruneRuns();
    return summary;
  }

  /** Last N run summaries, newest first (admin trigger response / ops). */
  recentRuns(limit = 10): Promise<any[]> {
    return this.hgSyncRunModel.find({}).sort({ startedAt: -1 }).limit(limit).lean().exec();
  }

  /**
   * Scope discovery: aggregate the feed index by city so HG_CITIES / HG_CITY_IDS
   * can be set from real values instead of guesses (the feed's spelling and
   * city_Id are the only things that matter to `inScope`). Costs ONE request —
   * hotels.json only, no property-static — so it is safe to call before committing
   * to a multi-thousand-hotel import.
   *
   * `match` filters the returned list case-insensitively, e.g. ?match=dub.
   */
  async feedCities(
    match?: string,
  ): Promise<
    { cities: Array<{ city: string; city_Id: number; country: string; hotels: number }>; feedTotal: number } | { skipped: string }
  > {
    const hg = this.config.get<HgSyncConfig>('hyperguest');
    if (!hg?.enabled) return { skipped: 'HG_ENABLED != true' };

    const feed = await this.client.getHotels();
    const byKey = new Map<string, { city: string; city_Id: number; country: string; hotels: number }>();
    // Dedupe hotel_id first: the feed repeats ids, and a duplicate is not a hotel.
    for (const h of new Map(feed.map((f) => [f.hotel_id, f])).values()) {
      const key = `${h.city_Id}|${h.city}`;
      const row = byKey.get(key);
      if (row) row.hotels++;
      else byKey.set(key, { city: h.city, city_Id: h.city_Id, country: h.country, hotels: 1 });
    }

    const needle = match?.trim().toLowerCase();
    const cities = [...byKey.values()]
      .filter((c) => !needle || c.city?.toLowerCase().includes(needle))
      .sort((a, b) => b.hotels - a.hotels);

    return { cities, feedTotal: feed.length };
  }

  // -------------------------------------------------------------------------

  /**
   * Run `worker` over `items` with BOTH a concurrency cap and a request-rate cap.
   *
   * Two limits, because they solve different problems: concurrency bounds how many
   * sockets are open at once, while the rate gate bounds how fast starts are issued.
   * Concurrency alone still bursts — N workers all fire the instant the previous
   * batch returns, which is exactly what tripped the supplier's 429s.
   *
   * Workers pull from a shared cursor rather than running fixed slices, so one slow
   * hotel never idles the pool (the batched version waited for its slowest member).
   */
  private async runPaced<T>(
    items: T[],
    concurrency: number,
    rps: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    if (!items.length) return;
    const minIntervalMs = 1000 / rps;
    let cursor = 0;
    let nextSlot = Date.now();

    /** Reserve the next start slot; serialised because JS is single-threaded here. */
    const takeSlot = async (): Promise<void> => {
      const now = Date.now();
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + minIntervalMs;
      const wait = slot - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    };

    const runWorker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        await takeSlot();
        await worker(items[index]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  }

  /** Fetch static + upsert hg_hotels row + upsert the materialized property. */
  private async materialize(hotel: HgStaticHotel, existing: HgKnownRow | null): Promise<void> {
    const hg = this.config.get<HgSyncConfig>('hyperguest');
    const staticData = await this.client.getPropertyStatic(hotel.hotel_id);

    const propertyFields = await this.buildPropertyFields(hotel, staticData);
    let propertyId: Types.ObjectId | undefined = existing?.property;

    if (propertyId) {
      await this.propertyModel.updateOne({ _id: propertyId }, { $set: propertyFields }).exec();
    } else {
      const created = await this.propertyModel.create({
        ...propertyFields,
        administrator: new Types.ObjectId(hg.systemAdminId),
        allAdministrators: [new Types.ObjectId(hg.systemAdminId)],
        company: null,
        rooms: [],
        approved: true,
        status: true,
      });
      propertyId = created._id;
    }

    await this.hgHotelModel
      .updateOne(
        { hotel_id: hotel.hotel_id },
        {
          $set: {
            name: hotel.name,
            country: hotel.country,
            city: hotel.city,
            region: hotel.region,
            city_Id: hotel.city_Id,
            last_updated: hotel.last_updated,
            version: hotel.version,
            active: true,
            property: propertyId,
            static: staticData,
            staticFetchedAt: new Date(),
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Property fields refreshed on every materialize (create AND update).
   * property-static.json's exact shape is unverified until certification
   * (hyperguest.types.ts) — extraction is defensive throughout.
   */
  private async buildPropertyFields(
    hotel: HgStaticHotel,
    staticData: HgPropertyStatic,
  ): Promise<Record<string, unknown>> {
    const name = str(staticData.name) || hotel.name;
    const coords = extractCoordinates(staticData);
    const images = extractImages(staticData);
    return {
      name,
      legal_name: name,
      description: extractDescription(staticData),
      source: 'HyperGuest',
      published: true,
      currency: await this.aedCurrencyId(),
      images,
      featured: images.slice(0, 1),
      timeslots: [24], // nightly-only supplier (decision D2)
      anyTimeCheckin: false,
      contactinfo: {
        contact_person: 'HyperGuest',
        legal_name: name,
        address_1: str(staticData.address) || `${hotel.city}, ${hotel.country}`,
        location: hotel.city,
        latlng: coords ? [coords.lat, coords.lng] : [],
        email: 'hg-noreply@stayhopper.com', // required subfield; supplier hotels have no direct contact
        mobile: '',
      },
      // Search's base query requires a signed agreement; commission is settled
      // on the HG side (net/sell spread), not via Stayhopper commission math.
      agreement: {
        contactName: 'HyperGuest',
        contactEmail: 'hg-noreply@stayhopper.com',
        signedDate: new Date(),
        isAgreementSigned: true,
        commissionHourly: 0,
        commissionMonthly: 0,
      },
      primaryReservationEmail: 'hg-noreply@stayhopper.com',
      secondaryReservationEmails: '',
      location: {
        address: `${hotel.city}, ${hotel.country}`,
        type: 'Point',
        coordinates: coords ? [coords.lng, coords.lat] : [], // GeoJSON [lng, lat]
      },
    };
  }

  private aedId: Types.ObjectId | null = null;

  private async aedCurrencyId(): Promise<Types.ObjectId> {
    if (this.aedId) return this.aedId;
    const aed = (await this.currencyModel.findOne({ code: 'AED' }).lean().exec()) as {
      _id: Types.ObjectId;
    } | null;
    if (!aed) throw new Error('HG sync: AED currency row missing — cannot materialize properties');
    this.aedId = aed._id;
    return this.aedId;
  }

  /**
   * Insert the `running` row — that insert IS the lock, enforced by the partial
   * unique index on {status:'running'}. Returns null when another instance holds it.
   *
   * Stale rows are reaped first: the app runs multi-instance under PM2 and a run
   * killed by a deploy would otherwise hold the lock forever and deadlock every
   * future sync.
   */
  private async acquireRunLock(summary: HgSyncSummary): Promise<Types.ObjectId | null> {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const reaped = await this.hgSyncRunModel
      .updateMany(
        { status: 'running', startedAt: { $lt: staleBefore } },
        { $set: { status: 'failed', ok: false } },
      )
      .exec();
    if (reaped?.modifiedCount) {
      this.logger.warn(
        `reaped ${reaped.modifiedCount} stale HG sync run(s) (older than ${LOCK_STALE_MS}ms) — assumed crashed`,
      );
    }

    try {
      // Snapshot: `summary` is mutated for the rest of the run, and this insert must
      // record the run as it started (status:'running', zeroed counters).
      const run = await this.hgSyncRunModel.create({ ...summary, errors: [] });
      return run._id as Types.ObjectId;
    } catch (err) {
      if ((err as { code?: number })?.code === DUPLICATE_KEY) {
        this.logger.warn(`HG sync (${summary.trigger}) skipped — another run is in progress`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Checkpoint the counters onto the running row. Best-effort: a failed checkpoint
   * is a diagnostics loss, never a reason to abort a multi-hour run.
   */
  private async persistProgress(runId: Types.ObjectId, summary: HgSyncSummary): Promise<void> {
    try {
      await this.hgSyncRunModel
        .updateOne(
          { _id: runId },
          {
            $set: {
              feedTotal: summary.feedTotal,
              skippedByCertification: summary.skippedByCertification,
              duplicatesCollapsed: summary.duplicatesCollapsed,
              created: summary.created,
              updated: summary.updated,
              unchanged: summary.unchanged,
              errors: summary.errors,
              errorCount: summary.errorCount,
            },
          },
        )
        .exec();
    } catch (err) {
      this.logger.warn(`HG sync progress checkpoint failed: ${(err as Error).message}`);
    }
  }

  /** Count every failure; store only the first MAX_STORED_ERRORS of them. */
  private recordError(summary: HgSyncSummary, hotel_id: number, message: string): void {
    summary.errorCount++;
    if (summary.errors.length < MAX_STORED_ERRORS) {
      summary.errors.push({ hotel_id, message });
    }
    if (hotel_id >= 0) {
      this.logger.error(`sync hotel ${hotel_id} failed: ${message}`);
    }
  }

  private async pruneRuns(): Promise<void> {
    const stale = await this.hgSyncRunModel
      .find({}, { _id: 1 })
      .sort({ startedAt: -1 })
      .skip(KEEP_SYNC_RUNS)
      .lean()
      .exec();
    if (stale.length) {
      await this.hgSyncRunModel
        .deleteMany({ _id: { $in: stale.map((s: any) => s._id) } })
        .exec();
    }
  }
}

/**
 * Scope predicate. A hotel is in scope when ANY configured list matches, so
 * HG_COUNTRIES (whole market), HG_CITY_IDS (exact) and HG_CITIES (human-readable)
 * can be mixed while the id list is still being discovered. All lists empty = no
 * filter.
 *
 * Country is checked first and is the coarsest: the UAE's hotels sit under 12
 * distinct city_Ids including districts like "Jumeirah" and "Bur Duba", which a
 * city-name list misses without ever reporting that it did.
 */
function inScope(
  hotel: HgStaticHotel,
  hg: { countries?: string[]; cities?: string[]; cityIds?: number[] },
): boolean {
  const countries = hg.countries ?? [];
  const cities = hg.cities ?? [];
  const cityIds = hg.cityIds ?? [];
  if (!countries.length && !cities.length && !cityIds.length) return true;
  if (countries.length && typeof hotel.country === 'string') {
    if (countries.includes(hotel.country.trim().toUpperCase())) return true;
  }
  if (cityIds.length && Number.isFinite(hotel.city_Id) && cityIds.includes(hotel.city_Id)) {
    return true;
  }
  if (cities.length && typeof hotel.city === 'string') {
    return cities.includes(hotel.city.trim().toLowerCase());
  }
  return false;
}

// ---------------------------------------------------------------------------
// Defensive extractors for the unverified property-static payload
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && typeof (v as any).en === 'string') return (v as any).en;
  return undefined;
}

/**
 * VERIFIED against live payloads (2026-07-27, 333 UAE hotels): images are
 * `{type, uri, priority, size, ...}` and the URL key is `uri`. The original
 * guesses (`url` / `href`) matched nothing, so every property materialized with
 * images: [] — silently, because an empty array is indistinguishable from a hotel
 * that simply has no photos. url/href/string are kept as fallbacks in case other
 * suppliers' payloads differ. Feed order is preserved rather than sorted by
 * `priority`, whose semantics are still unconfirmed.
 */
function extractImages(s: HgPropertyStatic): string[] {
  const raw = (s.images ?? s.photos ?? s.media) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) =>
      typeof i === 'string'
        ? i
        : (i as any)?.uri || (i as any)?.url || (i as any)?.href || '',
    )
    .filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
}

/**
 * VERIFIED against live payloads: descriptions are an ARRAY of
 * `{language, type, description}` under the plural key `descriptions`. The
 * original `staticData.description` (singular) matched nothing, so all 333 UAE
 * properties landed with an empty description.
 *
 * Prefers the general English entry, then any English one, then the first
 * available — a non-English description beats none. The singular key is kept as a
 * last resort for payload variants.
 */
function extractDescription(s: HgPropertyStatic): string {
  const raw = s.descriptions as unknown;
  if (Array.isArray(raw)) {
    // Only entries that actually carry text are candidates: the feed does ship
    // `{language:'en_US', type:'general', description:''}`, and preferring that
    // blank entry over a populated one would lose a description we do have.
    const entries = raw.filter(
      (d): d is Record<string, unknown> =>
        !!d && typeof d === 'object' && !!str((d as Record<string, unknown>).description),
    );
    const isEn = (d: Record<string, unknown>) =>
      typeof d.language === 'string' && d.language.toLowerCase().startsWith('en');
    const pick =
      entries.find((d) => isEn(d) && d.type === 'general') ??
      entries.find(isEn) ??
      entries[0];
    const text = pick && str(pick.description);
    if (text) return text;
  }
  return str(s.description) || '';
}

function extractCoordinates(s: HgPropertyStatic): { lat: number; lng: number } | null {
  const candidates = [
    s.geo,
    s.location,
    s.coordinates,
    { lat: s.latitude, lng: s.longitude },
    { lat: s.lat, lng: s.lng },
  ];
  for (const c of candidates) {
    const lat = Number((c as any)?.lat ?? (c as any)?.latitude);
    const lng = Number((c as any)?.lng ?? (c as any)?.lon ?? (c as any)?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return null;
}
