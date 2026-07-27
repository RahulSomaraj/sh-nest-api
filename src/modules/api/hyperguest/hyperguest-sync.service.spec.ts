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

const feedRow = (hotel_id: number, last_updated = 'lu-1') => ({
  hotel_id,
  name: `Hotel ${hotel_id}`,
  country: 'AE',
  city: 'Dubai',
  region: 'Dubai',
  city_Id: 1,
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

    it('DEFECT 2: batching keeps created / updated / unchanged counters correct', async () => {
      // 45 hotels > MATERIALIZE_CONCURRENCY (20), so this spans three batches.
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
});
