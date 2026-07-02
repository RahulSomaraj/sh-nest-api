import { ForbiddenException, HttpException } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { mockQuery, userWithPermissions } from '../../testing/mocks';

/**
 * Module: rooms (audit A6)
 * - owner scoping on list + by-id operations (keyed on the properties permission pair)
 * - delete guard + cleanup (availability docs, bookinglogs, property.rooms pull)
 * - mass-assignment: room-level suggestion flags stripped
 */
describe('Module: rooms (A6)', () => {
  const OWNED_PROP = '507f1f77bcf86cd799439033';
  const FOREIGN_PROP = '507f1f77bcf86cd799439044';
  const ROOM_ID = '507f1f77bcf86cd799439055';

  let lastCreated: any;

  const build = (opts: { room?: any; referencingBookings?: number } = {}) => {
    const room = opts.room ?? { _id: ROOM_ID, property_id: OWNED_PROP };

    function RoomModelCtor(this: any, data: any) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue(this);
      lastCreated = this;
    }
    const roomModel: any = RoomModelCtor;
    roomModel.find = jest.fn(() => mockQuery([]));
    roomModel.findOne = jest.fn(() => mockQuery(room));
    roomModel.findById = jest.fn(() => Promise.resolve({ save: jest.fn() }));
    roomModel.deleteOne = jest.fn(() => mockQuery({ deletedCount: 1 }));
    roomModel.countDocuments = jest.fn().mockResolvedValue(0);
    roomModel.populate = jest.fn().mockResolvedValue(room);

    const slotModel: any = { find: jest.fn(() => mockQuery([])) };
    const bookingModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const bookingLogModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const userBookingModel: any = {
      countDocuments: jest.fn().mockResolvedValue(opts.referencingBookings ?? 0),
    };
    const propertyModel: any = {
      find: jest.fn(() => mockQuery([{ _id: OWNED_PROP }])),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const mailService: any = {};

    const service = new RoomsService(
      roomModel,
      slotModel,
      bookingModel,
      bookingLogModel,
      userBookingModel,
      propertyModel,
      mailService,
    );
    return { service, roomModel, bookingModel, bookingLogModel, userBookingModel, propertyModel };
  };

  const ownScoped = userWithPermissions(['LIST_ROOMS', 'LIST_OWN_PROPERTIES']);
  const fullAccess = userWithPermissions(['LIST_ROOMS', 'LIST_ALL_PROPERTIES']);

  describe('owner scoping (audit A6)', () => {
    it('list is filtered to owned properties for own-scoped admins', async () => {
      const { service, roomModel } = build();
      await service.list({}, ownScoped);
      expect(roomModel.find).toHaveBeenCalledWith({ property_id: { $in: [OWNED_PROP] } });
    });

    it('list 403s when an own-scoped admin filters by a foreign property', async () => {
      const { service } = build();
      await expect(service.list({ propertyId: FOREIGN_PROP }, ownScoped)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('list is unfiltered for full-access admins', async () => {
      const { service, roomModel } = build();
      await service.list({}, fullAccess);
      expect(roomModel.find).toHaveBeenCalledWith({});
    });

    it("single/modify/remove 403 on another property's room", async () => {
      const foreignRoom = { _id: ROOM_ID, property_id: FOREIGN_PROP };
      const { service } = build({ room: foreignRoom });
      await expect(service.single(ROOM_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.modify(ROOM_ID, { name: 'X' }, ownScoped)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.remove(ROOM_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('create 403s when the body targets a foreign property', async () => {
      const { service } = build();
      await expect(
        service.create({ property_id: FOREIGN_PROP, name: 'R' }, ownScoped),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an own-scoped admin to read their own room', async () => {
      const { service } = build();
      await expect(service.single(ROOM_ID, ownScoped)).resolves.toMatchObject({ _id: ROOM_ID });
    });
  });

  describe('delete guard + cleanup (audit A6)', () => {
    it('blocks deletion (400, legacy message) while userbookings reference the room', async () => {
      const { service, roomModel } = build({ referencingBookings: 1 });
      await expect(service.remove(ROOM_ID)).rejects.toBeInstanceOf(HttpException);
      await expect(service.remove(ROOM_ID)).rejects.toMatchObject({ status: 400 });
      expect(roomModel.deleteOne).not.toHaveBeenCalled();
    });

    it('cleans availability docs + logs and detaches from the property on delete', async () => {
      const b = build({ referencingBookings: 0 });
      await b.service.remove(ROOM_ID);
      expect(b.bookingModel.deleteMany).toHaveBeenCalledWith({ room: ROOM_ID });
      expect(b.bookingLogModel.deleteMany).toHaveBeenCalledWith({ room: ROOM_ID });
      expect(b.propertyModel.updateOne).toHaveBeenCalledWith(
        { _id: OWNED_PROP },
        { $pull: { rooms: ROOM_ID } },
      );
      expect(b.roomModel.deleteOne).toHaveBeenCalledWith({ _id: ROOM_ID });
    });
  });

  describe('mass assignment (audit A6)', () => {
    it('strips room-level suggestion flags on create', async () => {
      const { service } = build();
      await service.create({
        property_id: OWNED_PROP,
        name: 'R1',
        isExistPriceSuggestion: true,
        suggestedRatePercentage: 40,
      });
      expect(lastCreated.name).toBe('R1');
      expect(lastCreated.isExistPriceSuggestion).toBeUndefined();
      expect(lastCreated.suggestedRatePercentage).toBeUndefined();
    });

    it('strips suggestion flags on modify but keeps normal fields', async () => {
      const room: any = { _id: ROOM_ID, property_id: OWNED_PROP, save: jest.fn() };
      const { service } = build({ room });
      await service.modify(ROOM_ID, { name: 'R2', isExistPriceSuggestion: true });
      expect(room.name).toBe('R2');
      expect(room.isExistPriceSuggestion).toBeUndefined();
    });
  });
});
