import { CitiesCrudService } from './crud.services';
import { mockQuery } from '../../testing/mocks';

/**
 * Module: crud / cities (audit A16)
 * - list envelope restores the `countries` array (v2 parity for the FE dropdown)
 * - standard envelope shape preserved
 */
describe('Module: crud cities (A16)', () => {
  const build = () => {
    const citiesQuery = mockQuery([{ _id: 'c1', name: 'Dubai' }]);
    const countriesQuery = mockQuery([{ _id: 'k1', country: 'UAE' }]);
    const citiesModel: any = {
      find: jest.fn(() => citiesQuery),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const countriesModel: any = { find: jest.fn(() => countriesQuery) };
    const service = new CitiesCrudService(citiesModel, countriesModel);
    return { service, citiesModel, countriesModel, countriesQuery };
  };

  it('list envelope includes the sorted countries array (audit A16)', async () => {
    const b = build();
    const result: any = await b.service.list({});
    expect(result.countries).toEqual([{ _id: 'k1', country: 'UAE' }]);
    expect(b.countriesQuery.sort).toHaveBeenCalledWith({ country: 1 });
  });

  it('keeps the standard {list,itemCount,pageCount,pages,active_page} envelope', async () => {
    const { service } = build();
    const result: any = await service.list({});
    expect(result.list).toEqual([{ _id: 'c1', name: 'Dubai' }]);
    expect(result.itemCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(Array.isArray(result.pages)).toBe(true);
    expect(result.active_page).toBe(1);
  });

  it('passes the country filter into the where clause (v2 parity)', async () => {
    const b = build();
    await b.service.list({ country: 'k1' });
    expect(b.citiesModel.find).toHaveBeenCalledWith({ country: 'k1' });
  });
});
