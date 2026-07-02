import { UsersService } from './users.service';
import { mockQuery } from '../../testing/mocks';

/**
 * Module: users (audit A3)
 * - GET/PUT /:id booking arrays are bounded (latest 100 each)
 * - aggregate totals still computed over the full history
 */
describe('Module: users (A3)', () => {
  const USER_ID = '507f1f77bcf86cd799439011';

  const build = () => {
    const activeFindQuery = mockQuery([{ _id: 'ub1' }]);
    const completedFindQuery = mockQuery([{ _id: 'cb1' }]);

    const userModel: any = {
      findOne: jest.fn(() => mockQuery({ _id: USER_ID, name: 'John' })),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(() => mockQuery([])),
    };
    const userBookingModel: any = {
      aggregate: jest.fn().mockResolvedValue([{ _id: USER_ID, totalAmount: 100, count: 2 }]),
      find: jest.fn(() => activeFindQuery),
    };
    const completedBookingModel: any = {
      aggregate: jest.fn().mockResolvedValue([{ _id: USER_ID, totalAmount: 50, count: 1 }]),
      find: jest.fn(() => completedFindQuery),
    };
    const countryModel: any = { find: jest.fn(() => mockQuery([])) };

    const service = new UsersService(userModel, userBookingModel, completedBookingModel, countryModel);
    return { service, userModel, userBookingModel, completedBookingModel, activeFindQuery, completedFindQuery };
  };

  it('getById bounds both inlined booking arrays to the latest 100 (audit A3)', async () => {
    const b = build();
    const result: any = await b.service.getById(USER_ID);

    expect(b.activeFindQuery.sort).toHaveBeenCalledWith({ _id: -1 });
    expect(b.activeFindQuery.limit).toHaveBeenCalledWith(100);
    expect(b.completedFindQuery.sort).toHaveBeenCalledWith({ _id: -1 });
    expect(b.completedFindQuery.limit).toHaveBeenCalledWith(100);

    expect(result.bookings.bookings).toEqual([{ _id: 'ub1' }]);
    expect(result.bookings.completedBookings).toEqual([{ _id: 'cb1' }]);
  });

  it('getById keeps full-history totals from the aggregates', async () => {
    const b = build();
    const result: any = await b.service.getById(USER_ID);
    expect(result.bookings.amount).toBe(150); // 100 active + 50 completed
    expect(result.bookings.count).toBe(3); // 2 + 1
  });

  it('getById returns {notFound:true} for a missing user', async () => {
    const b = build();
    b.userModel.findOne = jest.fn(() => mockQuery(null));
    await expect(b.service.getById(USER_ID)).resolves.toEqual({ notFound: true });
  });
});
