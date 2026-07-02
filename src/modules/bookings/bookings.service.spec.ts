import { ForbiddenException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { mockQuery, userWithPermissions } from '../../testing/mocks';

/**
 * Module: bookings (audit A7)
 * - owner scoping on single + cancellation/no-show workflows
 * - PII masking for non-LIST_ALL_BOOKINGS callers
 * - email recipients: rejection -> hotel (product-approved), cancel request -> support@ (TODO parity)
 */
describe('Module: bookings (A7)', () => {
  const OWNED_PROP = '507f1f77bcf86cd799439033';
  const FOREIGN_PROP = '507f1f77bcf86cd799439044';
  const BOOKING_ID = '507f1f77bcf86cd799439055';

  const activeBooking = (propertyId: any) => ({
    _id: BOOKING_ID,
    property: {
      _id: propertyId,
      name: 'Hotel X',
      primaryReservationEmail: 'hotel@x.com',
      contactinfo: { location: 'Dubai', mobile: '050', email: 'c@x.com' },
    },
    guestinfo: {
      title: 'Mr',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@guest.com',
      mobile: '0501234567',
    },
    room: [],
    book_id: 'BK1',
    checkin_date: '2026-07-01',
    checkin_time: '10:00',
    stayDuration: 3,
    bookingType: 'hourly',
  });

  const build = (booking: any) => {
    const userBookingModel: any = {
      findOne: jest.fn(() => mockQuery(booking)),
      updateOne: jest.fn().mockResolvedValue({}),
      populate: jest.fn(async (items: any[]) => items),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const completedModel: any = {
      findOne: jest.fn(() => mockQuery(booking)),
      updateOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const propertyModel: any = { find: jest.fn(() => mockQuery([{ _id: OWNED_PROP }])) };
    const bookingModel: any = { updateMany: jest.fn().mockResolvedValue({}) };
    const bookingLogModel: any = { deleteMany: jest.fn().mockResolvedValue({}) };
    const mailService: any = { sendTemplated: jest.fn().mockResolvedValue(undefined) };

    const service = new BookingsService(
      userBookingModel,
      completedModel,
      propertyModel,
      bookingModel,
      bookingLogModel,
      mailService,
    );
    return { service, userBookingModel, completedModel, bookingModel, bookingLogModel, mailService };
  };

  const ownScoped = userWithPermissions(['LIST_BOOKINGS', 'LIST_OWN_BOOKINGS']);
  const fullAccess = userWithPermissions(['LIST_BOOKINGS', 'LIST_ALL_BOOKINGS']);

  describe('owner scoping (audit A7)', () => {
    it("single 403s an own-scoped admin on another property's booking", async () => {
      const { service } = build({ _id: BOOKING_ID, property: FOREIGN_PROP, guestinfo: {} });
      await expect(
        service.single(BOOKING_ID, 'active', ownScoped.role.permissions, ownScoped),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cancel / remove / reject-cancellation 403 on a foreign active booking', async () => {
      const { service } = build(activeBooking(FOREIGN_PROP));
      await expect(service.cancel(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.rejectCancellation(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('noshow workflows 403 on a foreign completed booking (propertyInfo.id)', async () => {
      const completed = {
        _id: BOOKING_ID,
        propertyInfo: { id: FOREIGN_PROP, name: 'H' },
        guestInfo: {},
        roomsInfo: [],
      };
      const { service } = build(completed);
      await expect(service.noShow(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.rejectNoShow(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.approveNoShow(BOOKING_ID, ownScoped)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows the workflows on an owned booking and is unrestricted for full access', async () => {
      const own = build(activeBooking(OWNED_PROP));
      await expect(own.service.cancel(BOOKING_ID, ownScoped)).resolves.toMatchObject({
        message: expect.any(String),
      });

      const full = build(activeBooking(FOREIGN_PROP));
      await expect(full.service.cancel(BOOKING_ID, fullAccess)).resolves.toMatchObject({
        message: expect.any(String),
      });
    });
  });

  describe('PII masking (v2 parity)', () => {
    it('masks guest email/mobile for callers without LIST_ALL_BOOKINGS', async () => {
      const { service } = build(activeBooking(OWNED_PROP));
      const result: any = await service.single(
        BOOKING_ID,
        'active',
        ownScoped.role.permissions,
        ownScoped,
      );
      expect(result.guestinfo.email).not.toBe('john.doe@guest.com');
      expect(result.guestinfo.email).toContain('*');
      expect(result.guestinfo.mobile).toMatch(/^\*+\d{4}$/);
    });
  });

  describe('email recipients (audit A7 decisions, 2026-07-02)', () => {
    it("cancel request still targets support@stayhopper.com (kept per product decision, TODO'd)", async () => {
      const { service, mailService, userBookingModel } = build(activeBooking(OWNED_PROP));
      await service.cancel(BOOKING_ID);
      expect(userBookingModel.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING_ID },
        { $set: { cancel_request: 1 } },
      );
      expect(mailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'support@stayhopper.com' }),
      );
    });

    it('rejection email goes to the hotel primaryReservationEmail (product-approved)', async () => {
      const { service, mailService, userBookingModel } = build(activeBooking(OWNED_PROP));
      await service.rejectCancellation(BOOKING_ID);
      expect(userBookingModel.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING_ID },
        { $set: { cancel_approval: 2 } },
      );
      expect(mailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'hotel@x.com' }),
      );
    });

    it('remove (approve cancellation) mails the guest and cleans slots + logs', async () => {
      const { service, mailService, bookingModel, bookingLogModel } = build(
        activeBooking(OWNED_PROP),
      );
      await service.remove(BOOKING_ID);
      expect(bookingModel.updateMany).toHaveBeenCalledWith(
        {},
        { $pull: { slots: { userbooking: BOOKING_ID } } },
      );
      expect(bookingLogModel.deleteMany).toHaveBeenCalledWith({ userbooking: BOOKING_ID });
      expect(mailService.sendTemplated).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'john.doe@guest.com' }),
      );
    });
  });
});
