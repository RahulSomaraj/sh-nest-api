import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HyperGuestClientService } from './hyperguest-client.service';
import { HgPropertyStatic, HgStaticHotel, HgSyncSummary } from './hyperguest.types';

const KEEP_SYNC_RUNS = 50;

/**
 * HyperGuest static sync (HYPERGUEST_PLAN.md slab B, decision D1).
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
    const hg = this.config.get<any>('hyperguest');
    if (!hg?.enabled) return { skipped: 'HG_ENABLED != true' };

    const startedAt = new Date();
    const summary: HgSyncSummary = {
      trigger,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      feedTotal: 0,
      skippedByCertification: 0,
      created: 0,
      updated: 0,
      unpublished: 0,
      unchanged: 0,
      errors: [],
      invariantOk: true,
      ok: false,
    };

    try {
      const feed = await this.client.getHotels();
      summary.feedTotal = feed.length;

      // Certification: the diff sees the whole feed but only 19912 materializes.
      const wanted = hg.certification
        ? feed.filter((h) => h.hotel_id === hg.certPropertyId)
        : feed;
      summary.skippedByCertification = feed.length - wanted.length;

      const known = await this.hgHotelModel
        .find({}, { hotel_id: 1, last_updated: 1, active: 1, property: 1 })
        .lean()
        .exec();
      const knownById = new Map<number, any>(known.map((k: any) => [k.hotel_id, k]));
      const feedIds = new Set(wanted.map((h) => h.hotel_id));

      for (const hotel of wanted) {
        try {
          const existing = knownById.get(hotel.hotel_id);
          if (!existing) {
            await this.materialize(hotel, null);
            summary.created++;
          } else if (existing.last_updated !== hotel.last_updated || !existing.active) {
            await this.materialize(hotel, existing);
            summary.updated++;
          } else {
            summary.unchanged++;
          }
        } catch (err) {
          summary.errors.push({ hotel_id: hotel.hotel_id, message: (err as Error).message });
          this.logger.error(`sync hotel ${hotel.hotel_id} failed: ${(err as Error).message}`);
        }
      }

      // Removed: known + active but no longer in the (certification-filtered) feed.
      // In certification mode only the cert property is ever materialized, so this
      // correctly ignores the rest of the feed.
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

      summary.ok = summary.errors.length === 0 && summary.invariantOk;
    } catch (err) {
      summary.errors.push({ hotel_id: -1, message: (err as Error).message });
      this.logger.error(`HG sync failed: ${(err as Error).message}`);
    }

    summary.finishedAt = new Date();
    summary.durationMs = summary.finishedAt.getTime() - summary.startedAt.getTime();
    this.logger.log(
      `HG sync (${trigger}): feed=${summary.feedTotal} new=${summary.created} updated=${summary.updated} ` +
        `unpublished=${summary.unpublished} unchanged=${summary.unchanged} certSkipped=${summary.skippedByCertification} ` +
        `errors=${summary.errors.length} in ${summary.durationMs}ms`,
    );

    await this.hgSyncRunModel.create(summary);
    await this.pruneRuns();
    return summary;
  }

  /** Last N run summaries, newest first (admin trigger response / ops). */
  recentRuns(limit = 10): Promise<any[]> {
    return this.hgSyncRunModel.find({}).sort({ startedAt: -1 }).limit(limit).lean().exec();
  }

  // -------------------------------------------------------------------------

  /** Fetch static + upsert hg_hotels row + upsert the materialized property. */
  private async materialize(hotel: HgStaticHotel, existing: any | null): Promise<void> {
    const hg = this.config.get<any>('hyperguest');
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
    return {
      name,
      legal_name: name,
      description: str(staticData.description) || '',
      source: 'HyperGuest',
      published: true,
      currency: await this.aedCurrencyId(),
      images: extractImages(staticData),
      featured: extractImages(staticData).slice(0, 1),
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

// ---------------------------------------------------------------------------
// Defensive extractors for the unverified property-static payload
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && typeof (v as any).en === 'string') return (v as any).en;
  return undefined;
}

function extractImages(s: HgPropertyStatic): string[] {
  const raw = (s.images ?? s.photos ?? s.media) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) => (typeof i === 'string' ? i : (i as any)?.url || (i as any)?.href || ''))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
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
