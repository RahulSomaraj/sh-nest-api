import { ForbiddenException, HttpException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { mockQuery, userWithPermissions, mockConnection } from '../../testing/mocks';

const withSession = expect.objectContaining({ session: expect.anything() });

/**
 * Module: properties (audit A5)
 * - owner scoping (IDOR fix) on by-id operations
 * - delete guard + cascade
 * - mass-assignment gating (user_rating / approved / published)
 */
describe('Module: properties (A5)', () => {
  const OWNED_ID = '507f1f77bcf86cd799439033';
  const FOREIGN_ID = '507f1f77bcf86cd799439044';

  const build = (opts: { activeBookings?: number; resource?: any } = {}) => {
    const resource = opts.resource ?? { _id: OWNED_ID, save: jest.fn().mockResolvedValue(undefined) };
    const propertyModel: any = {
      find: jest.fn(() => mockQuery([{ _id: OWNED_ID }])), // owned set for scoping
      findOne: jest.fn(() => mockQuery(resource)),
      deleteOne: jest.fn(() => mockQuery({ deletedCount: 1 })),
      populate: jest.fn().mockResolvedValue(resource),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const roomModel: any = {
      aggregate: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    const administratorModel: any = { find: jest.fn(() => mockQuery([])) };
    const roleModel: any = { find: jest.fn(() => mockQuery([])) };
    const countryModel: any = { find: jest.fn(() => mockQuery([])) };
    const userModel: any = { updateMany: jest.fn().mockResolvedValue({}) };
    const userBookingModel: any = {
      countDocuments: jest.fn().mockResolvedValue(opts.activeBookings ?? 0),
    };
    const availabilityBookingModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const bookingLogModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const config: any = { get: jest.fn((k: string) => (k === 'commission.hourly' ? 15 : 15)) };

    const service = new PropertiesService(
      propertyModel,
      roomModel,
      administratorModel,
      roleModel,
      countryModel,
      userModel,
      userBookingModel,
      availabilityBookingModel,
      bookingLogModel,
      config,
      mockConnection(),
    );
    return {
      service,
      resource,
      propertyModel,
      roomModel,
      userModel,
      userBookingModel,
      availabilityBookingModel,
      bookingLogModel,
    };
  };

  const ownScoped = userWithPermissions(['LIST_PROPERTIES', 'LIST_OWN_PROPERTIES']);
  const fullAccess = userWithPermissions(['LIST_PROPERTIES', 'LIST_ALL_PROPERTIES']);

  describe('owner scoping on by-id operations (audit A5)', () => {
    it("403s an own-scoped admin reading another property's detail", async () => {
      const { service } = build();
      await expect(service.single(FOREIGN_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an own-scoped admin to read their own property', async () => {
      const { service } = build({ resource: { _id: OWNED_ID, agreement: {} } });
      const result: any = await service.single(OWNED_ID, ownScoped);
      expect(result._id).toBe(OWNED_ID);
      expect(result.agreement.commissionHourly).toBe(15); // commission defaults preserved
    });

    it('does not restrict a full-access admin', async () => {
      const { service, propertyModel } = build({ resource: { _id: FOREIGN_ID, agreement: {} } });
      await expect(service.single(FOREIGN_ID, fullAccess)).resolves.toBeDefined();
      expect(propertyModel.find).not.toHaveBeenCalled(); // no owned-set lookup needed
    });

    it('403s an own-scoped admin modifying / removing a foreign property', async () => {
      const { service } = build();
      await expect(
        service.modify(FOREIGN_ID, { name: 'X' }, undefined, ownScoped.role.permissions, ownScoped),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(FOREIGN_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('delete guard + cascade (audit A5)', () => {
    it('blocks deletion with 400 while active bookings exist', async () => {
      const { service, propertyModel } = build({ activeBookings: 2 });
      await expect(service.remove(OWNED_ID)).rejects.toBeInstanceOf(HttpException);
      await expect(service.remove(OWNED_ID)).rejects.toMatchObject({ status: 400 });
      expect(propertyModel.deleteOne).not.toHaveBeenCalled();
    });

    it('cascades favourites/availability docs/rooms on a permitted delete', async () => {
      const b = build({ activeBookings: 0 });
      await b.service.remove(OWNED_ID);
      expect(b.userModel.updateMany).toHaveBeenCalledWith(
        { favourites: OWNED_ID },
        { $pull: { favourites: OWNED_ID } },
        withSession,
      );
      expect(b.availabilityBookingModel.deleteMany).toHaveBeenCalledWith(
        { property: OWNED_ID },
        withSession,
      );
      expect(b.bookingLogModel.deleteMany).toHaveBeenCalledWith({ property: OWNED_ID }, withSession);
      expect(b.roomModel.deleteMany).toHaveBeenCalledWith({ property_id: OWNED_ID }, withSession);
      expect(b.propertyModel.deleteOne).toHaveBeenCalledWith({ _id: OWNED_ID }, withSession);
    });
  });

  describe('mass-assignment gating (audit A5)', () => {
    it('always strips the system-computed user_rating', async () => {
      const { service, resource } = build();
      await service.modify(OWNED_ID, { name: 'N', user_rating: 9.9 }, undefined, [
        'LIST_PROPERTIES',
        'LIST_ALL_PROPERTIES',
      ]);
      expect((resource as any).name).toBe('N');
      expect((resource as any).user_rating).toBeUndefined();
    });

    it('strips approved/published for callers without LIST_ALL_PROPERTIES', async () => {
      const { service, resource } = build();
      await service.modify(OWNED_ID, { name: 'N', approved: true, published: true }, undefined, [
        'LIST_PROPERTIES',
      ]);
      expect((resource as any).approved).toBeUndefined();
      expect((resource as any).published).toBeUndefined();
    });

    it('keeps approved/published for full-property admins', async () => {
      const { service, resource } = build();
      await service.modify(OWNED_ID, { approved: true, published: false }, undefined, [
        'LIST_PROPERTIES',
        'LIST_ALL_PROPERTIES',
      ]);
      expect((resource as any).approved).toBe(true);
      expect((resource as any).published).toBe(false);
    });
  });
});
