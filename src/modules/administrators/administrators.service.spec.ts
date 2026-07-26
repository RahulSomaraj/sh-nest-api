import { HttpException } from '@nestjs/common';
import { AdministratorsService } from './administrators.service';
import { mockQuery, mockConnection } from '../../testing/mocks';

const withSession = expect.objectContaining({ session: expect.anything() });

/**
 * Module: administrators (audit A2)
 * - delete blocked while owned properties have active bookings
 * - permitted delete cascades favourites/availability docs/rooms/properties
 * - check_active_bookings contract {status:1, count}
 */
describe('Module: administrators (A2)', () => {
  const ADMIN_ID = '507f1f77bcf86cd799439011';
  const PROP_ID = '507f1f77bcf86cd799439033';

  const build = (opts: { properties?: any[]; activeBookings?: number } = {}) => {
    const administratorModel: any = {
      deleteOne: jest.fn(() => mockQuery({ deletedCount: 1 })),
      findOne: jest.fn(() => mockQuery(null)),
    };
    const roleModel: any = { find: jest.fn(() => mockQuery([])) };
    const propertyModel: any = {
      find: jest.fn(() => mockQuery(opts.properties ?? [])),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    const currencyModel: any = { findOne: jest.fn(() => mockQuery(null)) };
    const userModel: any = { updateMany: jest.fn().mockResolvedValue({}) };
    const userBookingModel: any = {
      countDocuments: jest.fn().mockResolvedValue(opts.activeBookings ?? 0),
    };
    const roomModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const availabilityBookingModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const bookingLogModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const config: any = { get: jest.fn() };
    const mailService: any = {};
    const connection = mockConnection();

    const service = new AdministratorsService(
      administratorModel,
      roleModel,
      propertyModel,
      currencyModel,
      userModel,
      userBookingModel,
      roomModel,
      availabilityBookingModel,
      bookingLogModel,
      config,
      mailService,
      connection,
    );

    return {
      service,
      administratorModel,
      propertyModel,
      userModel,
      userBookingModel,
      roomModel,
      availabilityBookingModel,
      bookingLogModel,
    };
  };

  describe('remove', () => {
    it('blocks deletion with 400 when a property has active bookings (audit A2)', async () => {
      const { service, administratorModel } = build({
        properties: [{ _id: PROP_ID }],
        activeBookings: 3,
      });

      await expect(service.remove(ADMIN_ID)).rejects.toBeInstanceOf(HttpException);
      try {
        await service.remove(ADMIN_ID);
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse()).toMatchObject({ status: 0, count: 3 });
      }
      expect(administratorModel.deleteOne).not.toHaveBeenCalled();
    });

    it('cascades favourites/availability/rooms/properties before deleting the admin (audit A2)', async () => {
      const b = build({ properties: [{ _id: PROP_ID }], activeBookings: 0 });

      const result: any = await b.service.remove(ADMIN_ID);

      expect(b.userModel.updateMany).toHaveBeenCalledWith(
        { favourites: { $in: [PROP_ID] } },
        { $pull: { favourites: { $in: [PROP_ID] } } },
        withSession,
      );
      expect(b.availabilityBookingModel.deleteMany).toHaveBeenCalledWith(
        { property: { $in: [PROP_ID] } },
        withSession,
      );
      expect(b.bookingLogModel.deleteMany).toHaveBeenCalledWith(
        { property: { $in: [PROP_ID] } },
        withSession,
      );
      expect(b.roomModel.deleteMany).toHaveBeenCalledWith(
        { property_id: { $in: [PROP_ID] } },
        withSession,
      );
      expect(b.propertyModel.deleteMany).toHaveBeenCalledWith(
        { _id: { $in: [PROP_ID] } },
        withSession,
      );
      // audit C-4: admin doc is deleted after the atomic cascade.
      expect(b.administratorModel.deleteOne).toHaveBeenCalledWith({ _id: ADMIN_ID });
      expect(result).toEqual({ deletedCount: 1 });
    });

    it('deletes an admin with no properties without any cascade calls', async () => {
      const b = build({ properties: [] });
      await b.service.remove(ADMIN_ID);
      expect(b.userModel.updateMany).not.toHaveBeenCalled();
      expect(b.roomModel.deleteMany).not.toHaveBeenCalled();
      expect(b.administratorModel.deleteOne).toHaveBeenCalled();
    });
  });

  describe('checkActiveBookings', () => {
    it('returns the legacy {status:1, count} contract (audit A2)', async () => {
      const { service } = build({ properties: [{ _id: PROP_ID }], activeBookings: 5 });
      await expect(service.checkActiveBookings(ADMIN_ID)).resolves.toEqual({
        status: 1,
        count: 5,
      });
    });

    it('returns count 0 when no administrator id is given', async () => {
      const { service } = build();
      await expect(service.checkActiveBookings('')).resolves.toEqual({ status: 1, count: 0 });
    });
  });
});
