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

  const hgSyncRunModel = {
    create: jest.fn().mockResolvedValue({}),
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
    configWith(),
    client,
    hgHotelModel,
    hgSyncRunModel,
    propertyModel,
    currencyModel,
  );
  return { service, client, hgHotelModel, hgSyncRunModel, propertyModel, currencyModel };
}

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
    expect(hgSyncRunModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'cron', invariantOk: false }),
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
});
