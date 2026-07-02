import { PaymentsService } from './payments.module';
import { mockQuery, flushPromises } from '../../testing/mocks';

/**
 * Module: payments (audit A8)
 * - capture: state transition + guest & hotel confirmation emails
 * - return: state transition + guest & hotel cancellation emails (recipients = v2 parity)
 * - guards: already-approved/cancelled bookings are no-ops, no emails
 * - email failures never break the money-movement response
 */
describe('Module: payments (A8)', () => {
  const BOOKING_ID = '507f1f77bcf86cd799439055';
  const ROOM_ID = '507f1f77bcf86cd799439066';

  const makeBooking = (overrides: any = {}) => ({
    _id: BOOKING_ID,
    book_id: 'BK1',
    charge_uid: 'ch_1',
    hotel_approved: 0,
    hotel_cancelled: 0,
    invoice_id: undefined,
    paymentAmt: 110,
    hotelAmt: 100,
    total_amt: 120,
    bookingFee: 10,
    discount: 0,
    currencyCode: 'AED',
    stayDuration: 3,
    bookingType: 'hourly',
    no_of_adults: 2,
    date_checkin: new Date('2026-07-10T10:00:00Z').toString(),
    date_checkout: new Date('2026-07-10T16:00:00Z').toString(),
    date_booked: new Date('2026-07-01T09:00:00Z').toString(),
    guestinfo: { first_name: 'John', email: 'guest@x.com' },
    room: [{ number: 1, room: ROOM_ID }],
    property: {
      name: 'Hotel X',
      primaryReservationEmail: 'hotel@x.com',
      secondaryReservationEmails: 'a@x.com, b@x.com',
      agreement: { commissionHourly: 10 },
      charges: [{ name: 'VAT', chargeType: 'percentage', value: 5 }],
    },
    ...overrides,
  });

  const build = (booking: any) => {
    const userBookingModel: any = {
      findOne: jest.fn(() => mockQuery(booking)),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const invoiceModel: any = { findOne: jest.fn(() => mockQuery(null)) };
    const roomModel: any = {
      findOne: jest.fn(() => mockQuery({ _id: ROOM_ID, room_type: { name: 'Deluxe' } })),
    };
    // Empty container URL -> containerPost short-circuits to null (no fetch in tests).
    const config: any = {
      get: jest.fn((key: string) => (key === 'appUrl' ? 'https://app.test/' : '')),
    };
    const mailService: any = {
      sendCapturedPaymentEmail: jest.fn().mockResolvedValue(undefined),
      sendCapturedHotelEmail: jest.fn().mockResolvedValue(undefined),
      sendCancelledPaymentEmail: jest.fn().mockResolvedValue(undefined),
      sendCancelledHotelEmail: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentsService(userBookingModel, invoiceModel, roomModel, config, mailService);
    return { service, userBookingModel, mailService };
  };

  describe('capture', () => {
    it('marks the booking paid + hotel_approved and sends guest + hotel emails (audit A8)', async () => {
      const b = build(makeBooking());
      await b.service.capture(BOOKING_ID, undefined, 'txn_123');
      await flushPromises();

      expect(b.userBookingModel.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING_ID },
        { $set: { paid: 1, hotel_approved: 1 } },
      );
      expect(b.mailService.sendCapturedPaymentEmail).toHaveBeenCalledWith(
        'guest@x.com',
        expect.objectContaining({
          TRANSACTION_AMOUNT: 'AED 110',
          TRANSACTION_REFERENCE: 'txn_123',
          TYPE_OF_ROOM: 'Deluxe',
          ORDER_NO: 'BK1',
        }),
      );
      expect(b.mailService.sendCapturedHotelEmail).toHaveBeenCalledWith(
        'hotel@x.com',
        ['a@x.com', 'b@x.com'],
        expect.objectContaining({
          COMMISSION_AMOUNT: 'AED 10.00', // 10% of hotelAmt 100
          TRANSACTION_AMOUNT: 'AED 110.00', // hotelAmt + commission
          GUEST_FIRST_NAME: 'JOHN',
        }),
      );
    });

    it('is a no-op (status 0, no emails) when the booking is already approved', async () => {
      const b = build(makeBooking({ hotel_approved: 1 }));
      const result: any = await b.service.capture(BOOKING_ID);
      await flushPromises();
      expect(result).toEqual({ status: 0 });
      expect(b.userBookingModel.updateOne).not.toHaveBeenCalled();
      expect(b.mailService.sendCapturedPaymentEmail).not.toHaveBeenCalled();
    });

    it('email failure does not break the money-movement response (audit A8)', async () => {
      const b = build(makeBooking());
      b.mailService.sendCapturedPaymentEmail.mockRejectedValue(new Error('sendgrid down'));
      await expect(b.service.capture(BOOKING_ID)).resolves.toBeDefined();
      await flushPromises();
      expect(b.userBookingModel.updateOne).toHaveBeenCalled();
    });
  });

  describe('return', () => {
    it('marks the booking cancelled and sends both cancellation emails (audit A8)', async () => {
      const b = build(makeBooking());
      const result: any = await b.service.return(BOOKING_ID);
      await flushPromises();

      expect(result).toEqual({ status: 1 });
      expect(b.userBookingModel.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING_ID },
        { $set: { paid: 0, hotel_cancelled: 1 } },
      );
      expect(b.mailService.sendCancelledPaymentEmail).toHaveBeenCalledWith(
        'guest@x.com',
        expect.objectContaining({ TRANSACTION_AMOUNT: 'AED 110' }),
      );
      // v2 parity (⚠️ PRODUCT TODO): the hotel-cancellation email goes to the GUEST address.
      expect(b.mailService.sendCancelledHotelEmail).toHaveBeenCalledWith(
        'guest@x.com',
        expect.objectContaining({ TOTAL_PRICE: expect.stringContaining('AED') }),
      );
    });

    it('is a no-op when the booking is already cancelled or approved', async () => {
      const cancelled = build(makeBooking({ hotel_cancelled: 1 }));
      await expect(cancelled.service.return(BOOKING_ID)).resolves.toEqual({ status: 0 });

      const approved = build(makeBooking({ hotel_approved: 1 }));
      await expect(approved.service.return(BOOKING_ID)).resolves.toEqual({ status: 0 });
      await flushPromises();
      expect(approved.mailService.sendCancelledPaymentEmail).not.toHaveBeenCalled();
    });
  });
});
