import { Types } from 'mongoose';
import { HyperGuestSyncService } from './hyperguest-sync.service';

/**
 * HyperGuestSyncService — the hotels.json diff: new / changed / removed /
 * unchanged, certification filtering, invariant check and run bookkeeping.
 */

const hgCfg = {
  enabled: true,
  certification: true,
  certPropertyId: 19912,
  systemAdminId: 'ffffffffffff000000004847',
  // No scope filter by default; individual tests opt in.
  cities: [] as string[],
  cityIds: [] as number[],
  // Pacing effectively off in tests — the real defaults (4 workers, 3 req/s) would
  // make the 150-hotel cases take ~50s. Pacing itself is asserted explicitly below.
  staticConcurrency: 50,
  staticRps: 100_000,
};

const configWith = (overrides = {}) =>
  ({ get: jest.fn(() => ({ ...hgCfg, ...overrides })) }) as any;

/** Chainable, thenable query mock: q(result).sort().skip().lean().exec() → result. */
function q(result: any) {
  const query: any = {};
  for (const m of ['sort', 'limit', 'skip', 'lean', 'select']) query[m] = () => query;
  query.exec = jest.fn().mockResolvedValue(result);
  return query;
}

const feedRow = (
  hotel_id: number,
  last_updated = 'lu-1',
  city = 'Dubai',
  city_Id = 1,
  country = 'AE',
) => ({
  hotel_id,
  country,
  name: `Hotel ${hotel_id}`,
  city,
  region: city,
  city_Id,
  last_updated,
  version: 1,
});

function build({
  feed = [feedRow(19912)],
  known = [] as any[],
  activeCount = 1,
  publishedCount = 1,
  cfg = {} as Record<string, unknown>,
} = {}) {
  const client = {
    getHotels: jest.fn().mockResolvedValue(feed),
    getPropertyStatic: jest.fn().mockResolvedValue({
      name: 'Static Name',
      description: 'Desc',
      images: ['https://img.example/1.jpg'],
      geo: { lat: 25.2, lng: 55.27 },
    }),
  } as any;

  const hgHotelModel = {
    find: jest.fn(() => q(known)),
    updateOne: jest.fn(() => q({ acknowledged: true })),
    countDocuments: jest.fn(() => q(activeCount)),
  } as any;

  // create() returns the run doc whose _id the service updates in place.
  const runId = new Types.ObjectId();
  const hgSyncRunModel = {
    create: jest.fn().mockResolvedValue({ _id: runId }),
    updateOne: jest.fn(() => q({})),
    updateMany: jest.fn(() => q({ modifiedCount: 0 })),
    find: jest.fn(() => q([])),
    deleteMany: jest.fn(() => q({})),
  } as any;

  const propertyModel = {
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    updateOne: jest.fn(() => q({ acknowledged: true })),
    countDocuments: jest.fn(() => q(publishedCount)),
  } as any;

  const currencyModel = {
    findOne: jest.fn(() => q({ _id: new Types.ObjectId(), code: 'AED' })),
  } as any;

  const service = new HyperGuestSyncService(
    configWith(cfg),
    client,
    hgHotelModel,
    hgSyncRunModel,
    propertyModel,
    currencyModel,
  );
  return { service, client, hgHotelModel, hgSyncRunModel, propertyModel, currencyModel, runId };
}

/** The terminal `$set` written to the run doc (the last updateOne call). */
const finalRunUpdate = (hgSyncRunModel: any) =>
  hgSyncRunModel.updateOne.mock.calls.at(-1)[1].$set;

describe('HyperGuestSyncService', () => {
  it('is a no-op when HG_ENABLED is off', async () => {
    const { client, hgHotelModel } = build();
    const service = new HyperGuestSyncService(
      configWith({ enabled: false }),
      client,
      hgHotelModel,
      {} as any,
      {} as any,
      {} as any,
    );

    const res = await service.syncHotels('cron');

    expect(res).toEqual({ skipped: 'HG_ENABLED != true' });
    expect(client.getHotels).not.toHaveBeenCalled();
  });

  it('materializes a NEW hotel: fetches static, creates the property, upserts hg_hotels', async () => {
    const { service, client, propertyModel, hgHotelModel } = build();

    const res: any = await service.syncHotels('manual');

    expect(res.created).toBe(1);
    expect(client.getPropertyStatic).toHaveBeenCalledWith(19912);
    const created = propertyModel.create.mock.calls[0][0];
    expect(created.source).toBe('HyperGuest');
    expect(created.published).toBe(true);
    expect(created.approved).toBe(true);
    expect(created.rooms).toEqual([]);
    expect(created.agreement.isAgreementSigned).toBe(true);
    expect(created.location.coordinates).toEqual([55.27, 25.2]); // GeoJSON [lng, lat]
    expect(String(created.administrator)).toBe(hgCfg.systemAdminId);
    const upsert = hgHotelModel.updateOne.mock.calls[0];
    expect(upsert[0]).toEqual({ hotel_id: 19912 });
    expect(upsert[2]).toEqual({ upsert: true });
  });

  it('certification mode: everything except 19912 is counted as skipped, never fetched', async () => {
    const { service, client } = build({ feed: [feedRow(19912), feedRow(111), feedRow(222)] });

    const res: any = await service.syncHotels('manual');

    expect(res.feedTotal).toBe(3);
    expect(res.skippedByCertification).toBe(2);
    expect(res.created).toBe(1);
    expect(client.getPropertyStatic).toHaveBeenCalledTimes(1);
    expect(client.getPropertyStatic).toHaveBeenCalledWith(19912);
  });

  it('UNCHANGED hotel (same last_updated): no static fetch, no writes', async () => {
    const propId = new Types.ObjectId();
    const { service, client, propertyModel } = build({
      known: [{ hotel_id: 19912, last_updated: 'lu-1', active: true, property: propId }],
    });

    const res: any = await service.syncHotels('cron');

    expect(res.unchanged).toBe(1);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(client.getPropertyStatic).not.toHaveBeenCalled();
    expect(propertyModel.create).not.toHaveBeenCalled();
  });

  it('CHANGED hotel (last_updated moved): refetches static and updates the existing property', async () => {
    const propId = new Types.ObjectId();
    const { service, client, propertyModel } = build({
      feed: [feedRow(19912, 'lu-2')],
      known: [{ hotel_id: 19912, last_updated: 'lu-1', active: true, property: propId }],
    });

    const res: any = await service.syncHotels('cron');

    expect(res.updated).toBe(1);
    expect(client.getPropertyStatic).toHaveBeenCalledWith(19912);
    expect(propertyModel.create).not.toHaveBeenCalled();
    const [filter, update] = propertyModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: propId });
    expect(update.$set.source).toBe('HyperGuest');
  });

  it('REMOVED hotel (gone from feed): deactivates the row and unpublishes the property', async () => {
    const propId = new Types.ObjectId();
    const { service, hgHotelModel, propertyModel } = build({
      feed: [],
      known: [{ hotel_id: 19912, last_updated: 'lu-1', active: true, property: propId }],
    });

    const res: any = await service.syncHotels('cron');

    expect(res.unpublished).toBe(1);
    expect(hgHotelModel.updateOne).toHaveBeenCalledWith(
      { hotel_id: 19912 },
      { $set: { active: false } },
    );
    expect(propertyModel.updateOne).toHaveBeenCalledWith(
      { _id: propId },
      { $set: { published: false } },
    );
  });

  it('flags a broken invariant and persists every run summary', async () => {
    const { service, hgSyncRunModel } = build({ activeCount: 2, publishedCount: 1 });

    const res: any = await service.syncHotels('cron');

    expect(res.invariantOk).toBe(false);
    expect(res.ok).toBe(false);
    // The row goes in as `running` BEFORE the work, then is updated terminally.
    expect(hgSyncRunModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'cron', status: 'running' }),
    );
    expect(finalRunUpdate(hgSyncRunModel)).toEqual(
      expect.objectContaining({ status: 'completed', invariantOk: false, ok: false }),
    );
  });

  it('a per-hotel failure is recorded and does not abort the run', async () => {
    const { service, client, hgSyncRunModel } = build();
    client.getPropertyStatic.mockRejectedValueOnce(new Error('429 forever'));

    const res: any = await service.syncHotels('cron');

    expect(res.errors).toEqual([{ hotel_id: 19912, message: '429 forever' }]);
    expect(res.ok).toBe(false);
    expect(hgSyncRunModel.create).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Full-feed hardening (HG_CERTIFICATION=false — none of this bites in cert mode)
  // -------------------------------------------------------------------------

  describe('full-feed hardening', () => {
    it('DEFECT 1: a hotel_id repeated in the feed creates exactly ONE property', async () => {
      const { service, propertyModel, hgHotelModel } = build({
        cfg: { certification: false },
        feed: [feedRow(500), feedRow(500)],
      });

      const res: any = await service.syncHotels('manual');

      expect(res.duplicatesCollapsed).toBe(1);
      expect(res.created).toBe(1);
      // The orphan bug: the 2nd occurrence used to re-enter the create branch.
      expect(propertyModel.create).toHaveBeenCalledTimes(1);
      const upserts = hgHotelModel.updateOne.mock.calls.filter(
        (c: any[]) => c[0].hotel_id === 500,
      );
      expect(upserts).toHaveLength(1);
    });

    it('DEFECT 1: skippedByCertification counts cert-filtered hotels only, never dupes', async () => {
      // Certification ON: 111 is filtered out (1 cert skip); 19912 appears twice
      // (1 duplicate collapsed). The two counters must not bleed into each other.
      const { service, propertyModel } = build({
        feed: [feedRow(19912), feedRow(19912), feedRow(111)],
      });

      const res: any = await service.syncHotels('manual');

      expect(res.feedTotal).toBe(3);
      expect(res.skippedByCertification).toBe(1);
      expect(res.duplicatesCollapsed).toBe(1);
      expect(res.created).toBe(1);
      expect(propertyModel.create).toHaveBeenCalledTimes(1);
    });

    it('DEFECT 3: a static fetch failing every retry is recorded and leaves NO orphan property', async () => {
      // Retry itself lives in HyperGuestClientService (see its spec); from here the
      // client has already exhausted its attempts. getPropertyStatic is the first
      // await in materialize(), so a failure must not have written a property.
      const { service, client, propertyModel, hgHotelModel } = build();
      client.getPropertyStatic.mockRejectedValue(new Error('This operation was aborted'));

      const res: any = await service.syncHotels('cron');

      expect(res.created).toBe(0);
      expect(res.errorCount).toBe(1);
      expect(res.errors[0]).toEqual({
        hotel_id: 19912,
        message: 'This operation was aborted',
      });
      expect(propertyModel.create).not.toHaveBeenCalled();
      expect(hgHotelModel.updateOne).not.toHaveBeenCalled();
    });

    it('DEFECT 4: errors[] is capped at 100 while errorCount keeps the true total', async () => {
      const feed = Array.from({ length: 150 }, (_, i) => feedRow(1000 + i));
      const { service, client, hgSyncRunModel } = build({
        cfg: { certification: false },
        feed,
      });
      client.getPropertyStatic.mockRejectedValue(new Error('boom'));

      const res: any = await service.syncHotels('cron');

      expect(res.errorCount).toBe(150);
      expect(res.errors).toHaveLength(100);
      // ok is derived from errorCount, not the truncated array.
      expect(res.ok).toBe(false);
      expect(finalRunUpdate(hgSyncRunModel).errorCount).toBe(150);
    });

    it('DEFECT 5+6: a second run while one is `running` is skipped, not started', async () => {
      const { service, client, hgSyncRunModel } = build();
      // The partial unique index on {status:'running'} rejects the second insert.
      hgSyncRunModel.create.mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );

      const res: any = await service.syncHotels('cron');

      expect(res).toEqual({ skipped: 'already running' });
      expect(client.getHotels).not.toHaveBeenCalled();
      // Stale-run reaping still ran, so a crashed run cannot deadlock forever.
      expect(hgSyncRunModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' }),
        { $set: { status: 'failed', ok: false } },
      );
    });

    it('DEFECT 2: the worker pool keeps created / updated / unchanged counters correct', async () => {
      // 45 hotels across a pool that pulls from a shared cursor.
      const feed = Array.from({ length: 45 }, (_, i) => feedRow(i + 1, 'lu-1'));
      const known = [
        // 1-20 unchanged (same last_updated, active) → no fetch at all
        ...Array.from({ length: 20 }, (_, i) => ({
          hotel_id: i + 1,
          last_updated: 'lu-1',
          active: true,
          property: new Types.ObjectId(),
        })),
        // 21-35 changed (last_updated moved) → refetch + update
        ...Array.from({ length: 15 }, (_, i) => ({
          hotel_id: i + 21,
          last_updated: 'lu-0',
          active: true,
          property: new Types.ObjectId(),
        })),
        // 36-45 unknown → create
      ];
      const { service, client, propertyModel } = build({
        cfg: { certification: false },
        feed,
        known,
      });

      const res: any = await service.syncHotels('cron');

      expect(res.unchanged).toBe(20);
      expect(res.updated).toBe(15);
      expect(res.created).toBe(10);
      expect(res.errorCount).toBe(0);
      // Only the 25 that actually changed hit the network.
      expect(client.getPropertyStatic).toHaveBeenCalledTimes(25);
      expect(propertyModel.create).toHaveBeenCalledTimes(10);
    });
  });

  // -------------------------------------------------------------------------
  // Scope filter (HG_CITIES / HG_CITY_IDS) — the lever that makes a first import
  // minutes instead of hours: out-of-scope hotels cost no property-static call.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Content extraction against the REAL property-static shape, captured
  // 2026-07-27. The first guesses (`url`/`href`, singular `description`) matched
  // nothing, and an empty result is indistinguishable from a hotel with no
  // content — so all 333 UAE properties materialized blank without a single error.
  // -------------------------------------------------------------------------

  describe('property-static extraction', () => {
    const realStatic = {
      name: 'Rove Downtown',
      coordinates: { lat: 25.2031, lng: 55.279 },
      images: [
        {
          type: 'photo',
          description: '',
          priority: 50,
          id: 524713,
          uri: 'https://hg-static.hyperguest.com/19732/images/image_524713_original.jpg',
          size: { height: 900, width: 1103 },
          tags: [],
        },
        { type: 'photo', priority: 60, id: 2, uri: 'https://hg-static.example/b.jpg' },
      ],
      descriptions: [
        { language: 'fr_FR', type: 'general', description: 'Non-English first.' },
        { language: 'en_US', type: 'general', description: 'Adjacent to Burj Khalifa.' },
      ],
    };

    const created = async (staticData: Record<string, unknown>) => {
      const { service, client, propertyModel } = build();
      client.getPropertyStatic.mockResolvedValue(staticData);
      await service.syncHotels('manual');
      return propertyModel.create.mock.calls[0][0];
    };

    it('reads image URLs from `uri`, and featured is the first of them', async () => {
      const prop = await created(realStatic);

      expect(prop.images).toEqual([
        'https://hg-static.hyperguest.com/19732/images/image_524713_original.jpg',
        'https://hg-static.example/b.jpg',
      ]);
      expect(prop.featured).toEqual([prop.images[0]]);
    });

    it('reads the English general entry out of the plural `descriptions` array', async () => {
      const prop = await created(realStatic);

      expect(prop.description).toBe('Adjacent to Burj Khalifa.');
    });

    it('falls back to a non-English description rather than leaving it blank', async () => {
      const prop = await created({
        ...realStatic,
        descriptions: [{ language: 'fr_FR', type: 'general', description: 'Seulement.' }],
      });

      expect(prop.description).toBe('Seulement.');
    });

    it('skips a blank English entry rather than losing a populated one', async () => {
      // The feed really does ship {language:'en_US', type:'general', description:''}.
      const prop = await created({
        ...realStatic,
        descriptions: [
          { language: 'en_US', type: 'general', description: '' },
          { language: 'de_DE', type: 'general', description: 'Am Burj Khalifa.' },
        ],
      });

      expect(prop.description).toBe('Am Burj Khalifa.');
    });

    it('still tolerates a payload with neither key', async () => {
      const prop = await created({ name: 'Bare Hotel' });

      expect(prop.images).toEqual([]);
      expect(prop.featured).toEqual([]);
      expect(prop.description).toBe('');
      expect(prop.name).toBe('Bare Hotel');
    });
  });

  describe('country scope filter', () => {
    // Mirrors the real feed: the UAE's 333 hotels span 12 city_Ids, and several of
    // them are districts rather than cities. HG_CITIES=Dubai finds 238 of 333.
    const uaeFeed = [
      feedRow(1, 'lu-1', 'Dubai', 1773, 'AE'),
      feedRow(2, 'lu-1', 'Abu Dhabi', 6532, 'AE'),
      feedRow(3, 'lu-1', 'Jumeirah', 23402, 'AE'), // a Dubai district, own city_Id
      feedRow(4, 'lu-1', 'Aljada, Sharjah', 24356, 'AE'),
      feedRow(5, 'lu-1', 'Paris', 900, 'FR'),
      feedRow(6, 'lu-1', 'Mumbai', 901, 'IN'),
    ];

    it('HG_COUNTRIES=AE keeps every UAE hotel whatever its city is called', async () => {
      const { service, client } = build({
        cfg: { certification: false, countries: ['AE'] },
        feed: uaeFeed,
      });

      const res: any = await service.syncHotels('manual');

      expect(res.created).toBe(4);
      expect(res.skippedByCity).toBe(2); // FR + IN
      expect(client.getPropertyStatic).not.toHaveBeenCalledWith(5);
      expect(client.getPropertyStatic).not.toHaveBeenCalledWith(6);
    });

    it('a city list silently drops UAE districts that a country code keeps', async () => {
      // This is the regression the country filter exists to prevent: same feed,
      // HG_CITIES=Dubai, and the Jumeirah / Aljada hotels vanish without a word.
      const { service } = build({
        cfg: { certification: false, cities: ['dubai'] },
        feed: uaeFeed,
      });

      const res: any = await service.syncHotels('manual');

      expect(res.created).toBe(1); // only the literal "Dubai" row
      expect(res.skippedByCity).toBe(5);
    });

  });

  describe('city scope filter', () => {
    const mixedFeed = [
      feedRow(1, 'lu-1', 'Dubai', 1),
      feedRow(2, 'lu-1', 'Abu Dhabi', 2),
      feedRow(3, 'lu-1', 'Paris', 3),
      feedRow(4, 'lu-1', 'dubai', 1), // casing drift in the feed
    ];

    it('keeps only the named cities and never fetches the rest', async () => {
      const { service, client } = build({
        cfg: { certification: false, cities: ['dubai'] },
        feed: mixedFeed,
      });

      const res: any = await service.syncHotels('manual');

      expect(res.created).toBe(2); // ids 1 and 4 — matched case-insensitively
      expect(res.skippedByCity).toBe(2);
      expect(res.skippedByCertification).toBe(0);
      expect(client.getPropertyStatic).toHaveBeenCalledTimes(2);
      expect(client.getPropertyStatic).not.toHaveBeenCalledWith(3);
    });

    it('matches on city_Id too, so feed spelling cannot silently drop hotels', async () => {
      const { service, client } = build({
        cfg: { certification: false, cityIds: [2] },
        feed: mixedFeed,
      });

      const res: any = await service.syncHotels('manual');

      expect(res.created).toBe(1);
      expect(res.skippedByCity).toBe(3);
      expect(client.getPropertyStatic).toHaveBeenCalledWith(2);
    });

    it('no filter configured = whole feed, unchanged behaviour', async () => {
      const { service } = build({ cfg: { certification: false }, feed: mixedFeed });

      const res: any = await service.syncHotels('manual');

      expect(res.skippedByCity).toBe(0);
      expect(res.created).toBe(4);
    });

    it('narrowing the scope unpublishes hotels that fall outside it', async () => {
      // Paris was synced by an earlier unfiltered run; the Dubai-only run must
      // deactivate it rather than leave a property we no longer sell published.
      const parisProp = new Types.ObjectId();
      const { service, hgHotelModel, propertyModel } = build({
        cfg: { certification: false, cities: ['dubai'] },
        feed: mixedFeed,
        known: [{ hotel_id: 3, last_updated: 'lu-1', active: true, property: parisProp }],
      });

      const res: any = await service.syncHotels('manual');

      expect(res.unpublished).toBe(1);
      expect(hgHotelModel.updateOne).toHaveBeenCalledWith(
        { hotel_id: 3 },
        { $set: { active: false } },
      );
      expect(propertyModel.updateOne).toHaveBeenCalledWith(
        { _id: parisProp },
        { $set: { published: false } },
      );
    });

    it('records the scope on the run doc so a run stays interpretable later', async () => {
      const { service, hgSyncRunModel } = build({
        cfg: { certification: false, cities: ['dubai'], cityIds: [1] },
        feed: mixedFeed,
      });

      await service.syncHotels('manual');

      expect(hgSyncRunModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { countries: [], cities: ['dubai'], cityIds: [1] } }),
      );
    });

    it('feedCities aggregates the index by city without fetching any static', async () => {
      const { service, client } = build({ feed: mixedFeed });

      const res: any = await service.feedCities();

      expect(client.getPropertyStatic).not.toHaveBeenCalled();
      expect(res.feedTotal).toBe(4);
      // 'Dubai' and 'dubai' share city_Id 1 but are distinct feed spellings — both
      // are surfaced so the operator can see exactly what to filter on.
      expect(res.cities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ city: 'Paris', city_Id: 3, hotels: 1 }),
        ]),
      );
    });

    it('feedCities?match filters the returned list', async () => {
      const { service } = build({ feed: mixedFeed });

      const res: any = await service.feedCities('dub');

      expect(res.cities.every((c: any) => /dubai/i.test(c.city))).toBe(true);
      expect(res.cities.some((c: any) => c.city === 'Paris')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Pacing — the supplier throttles hard; staying under the limit is the fix,
  // retrying harder is not.
  // -------------------------------------------------------------------------

  describe('pacing', () => {
    it('spaces requests to the configured rate and caps concurrency', async () => {
      const feed = Array.from({ length: 6 }, (_, i) => feedRow(i + 1));
      const { service, client } = build({
        cfg: { certification: false, staticConcurrency: 2, staticRps: 50 }, // 20ms apart
        feed,
      });

      let inFlight = 0;
      let peakInFlight = 0;
      const starts: number[] = [];
      client.getPropertyStatic.mockImplementation(async () => {
        starts.push(Date.now());
        peakInFlight = Math.max(peakInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { name: 'x' };
      });

      await service.syncHotels('manual');

      expect(client.getPropertyStatic).toHaveBeenCalledTimes(6);
      expect(peakInFlight).toBeLessThanOrEqual(2);
      // 6 starts at 20ms spacing ≈ 100ms; allow generous slack for timer jitter.
      expect(starts.at(-1)! - starts[0]).toBeGreaterThanOrEqual(60);
    }, 10_000);
  });
});
