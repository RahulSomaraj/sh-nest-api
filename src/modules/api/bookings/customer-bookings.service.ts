import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import moment from 'moment';
import { MailService } from '../../../common/mail/mail.service';
import { CheckinService } from '../services/checkin.service';
import { DateTimeService } from '../services/date-time.service';
import { PropertiesDataService } from '../services/properties-data.service';
import { User, UserDocument } from '../../users/schemas/user.schema';

/** One (room, quantity) pair from the booking request body. */
interface RequestedRoom {
  room: string;
  number: number;
}

/** A slot document staged for insertion into `bookings`. */
interface StagedBookingSlot {
  property: Types.ObjectId;
  room: Types.ObjectId;
  date: string;
  userbooking: Types.ObjectId;
  slots: Array<{
    status: 'BOOKED' | 'RESERVED';
    slot: Types.ObjectId;
    number: number;
    userbooking: Types.ObjectId;
  }>;
}

/** A six-digit numeric suffix, matching legacy `randomatic("0", 6)`. */
function randomBookingSuffix(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

/**
 * The `/api/bookings` and `/api/payment` surfaces — MIGRATION.md 2e. Ported from
 * `controllers/api/v2/bookings.js`, `controllers/api/v2/payment.js` and the two
 * `/api/v3` booking routes.
 *
 * This is the money path: it allocates slots, creates the booking, and asks the payment
 * container for a hosted payment link. The ordering of the writes (booking first, then
 * slots + logs, then the payment link, unwinding everything on any failure) is legacy's
 * and is preserved.
 */
@Injectable()
export class CustomerBookingsService {
  private readonly logger = new Logger(CustomerBookingsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly checkinService: CheckinService,
    private readonly dateTimeService: DateTimeService,
    private readonly propertiesService: PropertiesDataService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings')
    private readonly completedBookingModel: Model<any>,
    @InjectModel('bookings') private readonly bookingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookLogModel: Model<any>,
    @InjectModel('slots') private readonly slotModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('promocodes') private readonly promoCodeModel: Model<any>,
    @InjectModel('invoices') private readonly invoiceModel: Model<any>,
  ) {}

  /**
   * B1 — `POST /api/bookings/checkpromo`. A code is only offered if the user has not
   * already redeemed it.
   */
  async checkPromo(userId: Types.ObjectId, emailId: string | undefined, code: string) {
    const trimmedCode = (code || '').trim();
    const promocode = (await this.promoCodeModel
      .findOne({ code: trimmedCode })
      .lean()
      .exec()) as unknown as { code: string } | null;

    if (!promocode || !(userId || emailId)) {
      return { status: 'Failed', message: 'Promocode doesnot exists' };
    }

    const alreadyApplied = await this.userModel
      .countDocuments({ _id: userId, promocodes: promocode.code })
      .exec();
    if (alreadyApplied) {
      return { status: 'Failed', message: 'Promocode doesnot exists' };
    }
    return { status: 'Success', data: promocode };
  }

  /**
   * B2 — `POST /api/bookings`.
   *
   * Creates the booking, blocks the slots (plus the room's cleaning slots) and returns a
   * payment link. Any failure along the way rolls back the slots, booking logs and the
   * booking itself so a half-created booking never holds inventory.
   */
  async createBooking(
    userId: Types.ObjectId,
    data: Record<string, any>,
    timezone: string,
  ): Promise<Record<string, unknown>> {
    const rooms: RequestedRoom[] = Object.keys(data.room || {}).map((roomId) => ({
      room: roomId,
      number: data.room[roomId],
    }));

    const platform = data.platform || 'app';
    const userinfo = {
      title: data.title,
      first_name: data.first_name || data.firstName,
      last_name: data.last_name || data.lastName,
      nationality: data.nationality,
      city: data.city,
      mobile: data.mobile,
      email: data.email,
    };

    const guestUserDetails = await this.userModel.find({ email: data.email }).exec();

    // NOTE (legacy parity): legacy computed a sequential `SH-<n>` id from the latest
    // booking and then immediately overwrote it with a random 6-digit suffix, so only
    // the random form is ever used. The dead sequential lookup is not ported.
    const newBookingId = `SH-${randomBookingSuffix()}`;

    let promocode = data.promocode || '';
    const checkinDateMoment = moment(
      `${data.checkinDate} ${data.checkinTime}`,
      'DD/MM/YYYY HH:mm',
    );
    const checkoutDateMoment = moment(
      `${data.checkoutDate} ${data.checkoutTime}`,
      'DD/MM/YYYY HH:mm',
    );

    const accurateStayDurationLabel = this.checkinService.getAccurateStayDurationLabel({
      checkinDate: data.checkinDate,
      checkoutDate: data.checkoutDate,
      checkinTime: data.checkinTime,
      checkoutTime: data.checkoutTime,
    });
    let additionalStayDurationInfo = '';
    if (data.bookingType === 'monthly') {
      let numDays = checkoutDateMoment.diff(checkinDateMoment, 'days');
      // 12:00 → 14:00 the next day isn't a whole day, so a standard-window monthly stay
      // gets one buffer day added rather than being reported short.
      if (data.checkinTime === '14:00' && data.checkoutTime === '12:00') numDays++;
      additionalStayDurationInfo = ` ( ${numDays} days )`;
    }
    const stayDuration = accurateStayDurationLabel + additionalStayDurationInfo;

    const paymentAmt = parseFloat(data.payment_amt || data.paymentAmt);

    const UB = new this.userBookingModel({
      book_id: newBookingId,
      user: userId || guestUserDetails[0]?._id,
      property: data.property,
      room: rooms,
      hotelAmt: +data.variance,
      no_of_adults: data.numberAdults,
      no_of_children: data.numberChildren,
      guestinfo: userinfo,
      platform,
      ...(data.trip_type ? { trip_type: data.trip_type } : {}),
      checkin_date: moment(data.checkinDate, 'DD/MM/YYYY').format('YYYY-MM-DD'),
      checkin_time: data.checkinTime,
      checkout_date: moment(data.checkoutDate, 'DD/MM/YYYY').format('YYYY-MM-DD'),
      checkout_time: data.checkoutTime,
      bookingType: data.bookingType,
      stayDuration,
      date_checkin: checkinDateMoment.toDate(),
      date_checkout: checkoutDateMoment.toDate(),
      date_booked: new Date(),
      currencyCode: data.currencyCode,
      tax: data.tax,
      bookingFee: parseInt(data.bookingFee, 10),
      discount: data.discount,
      total_amt: data.total_amt || data.totalAmt,
      paymentAmt,
    });

    try {
      await UB.save();
    } catch (error) {
      this.logger.error(`Booking ${newBookingId}: could not save user booking`, error);
      return { status: 'Failed', message: 'Cannot save booking', log: error };
    }

    const stagedSlots = await this.stageBookingSlots(UB, data, rooms, timezone);
    if (!stagedSlots) {
      await this.rollbackBooking(UB._id);
      throw new NotFoundException({
        status: 'Failed',
        message: 'Booking not available for your request',
      });
    }

    const persisted = await this.persistBookingSlots(UB._id, stagedSlots);
    if (!persisted) {
      await this.rollbackBooking(UB._id, true);
      return { status: 'Failed', message: 'Booking not available for your request' };
    }

    // --- Payment link ---
    const apiUrl = this.config.get<string>('apiUrl');
    let paymentUrl: string;
    let paymentRef: string;
    try {
      const response = await fetch(
        `${this.config.get<string>('paymentContainerUrl')}/paymentlink`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: paymentAmt,
            currency: 'AED',
            failure_url: `${apiUrl}api/payment/failed`,
            return_url: `${apiUrl}api/payment/success`,
            description: 'Stayhopper Booking',
            first_name: userinfo.first_name,
            last_name: userinfo.last_name,
            email: userinfo.email,
            book_id: UB.book_id,
            custom_data: {
              booking_id: UB._id,
              user_id: userId || guestUserDetails[0]?._id,
              platform,
              promocode,
            },
          }),
        },
      );
      const body = (await response.json()) as { payment_url?: string; id?: string };
      if (!body.payment_url) {
        this.logger.error(
          `Booking ${newBookingId}: payment container returned no payment_url`,
        );
        await this.rollbackBooking(UB._id, true);
        return { status: 'Failed', message: 'Booking could not save successfully!' };
      }
      paymentUrl = body.payment_url;
      paymentRef = body.id;
    } catch (error) {
      this.logger.error(`Booking ${newBookingId}: payment container call failed`, error);
      await this.rollbackBooking(UB._id, true);
      return { status: 'Failed', message: 'Booking could not save successfully!' };
    }

    // Record the redeemed promo code against the user so it cannot be reused.
    if (promocode) {
      await this.userModel
        .updateOne({ _id: data.user }, { $addToSet: { promocodes: promocode } })
        .exec();
    }

    await this.sendUnpaidBookingAlert(UB._id);

    return {
      status: 'Success',
      message: 'Booking saved successfully!',
      payment_link: paymentUrl,
      booking_id: UB._id,
      book_id: UB.book_id,
      ref: paymentRef,
    };
  }

  /**
   * Work out which physical room numbers are free and build the slot documents for the
   * stay plus the room's post-checkout cleaning window. Returns null when any requested
   * room cannot be satisfied.
   */
  private async stageBookingSlots(
    UB: { _id: Types.ObjectId },
    data: Record<string, any>,
    rooms: RequestedRoom[],
    timezone: string,
  ): Promise<StagedBookingSlot[] | null> {
    const allSlots = (await this.slotModel
      .find({})
      .select('_id label')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; label: string }>;
    const datesAndHoursStayParams = this.checkinService.getDatesAndHoursStayParams({
      checkinDate: data.checkinDate,
      checkoutDate: data.checkoutDate,
      checkinTime: data.checkinTime,
      checkoutTime: data.checkoutTime,
    });

    const slotIdForLabel = (label: string): Types.ObjectId | null => {
      const target = allSlots.find((s) => s.label === label);
      return target?._id ? new Types.ObjectId(String(target._id)) : null;
    };

    const bookingSlots: StagedBookingSlot[] = [];

    for (const requested of rooms) {
      const roomDetails = await this.roomModel.findOne({ _id: requested.room }).exec();

      // Cleaning window immediately after checkout — held as RESERVED, not BOOKED.
      let cleaningParams: ReturnType<CheckinService['getDatesAndHoursStayParams']> = [];
      if (roomDetails?.hours_cleaning) {
        const cleaningStart = moment(
          `${data.checkoutDate} ${data.checkoutTime}`,
          'DD/MM/YYYY HH:mm',
        );
        const cleaningEnd = moment(cleaningStart).add(roomDetails.hours_cleaning, 'hour');
        cleaningParams = this.checkinService.getDatesAndHoursStayParams({
          checkinDate: cleaningStart.format('DD/MM/YYYY'),
          checkoutDate: cleaningEnd.format('DD/MM/YYYY'),
          checkinTime: cleaningStart.format('HH:mm'),
          checkoutTime: cleaningEnd.format('HH:mm'),
        });
      }

      // Inventory may be 8 rooms with only #2, #5 and #8 actually free.
      const availableRoomNumbers: number[] = [];
      const availability = await this.propertiesService.getProperties({
        checkinDate: data.checkinDate,
        checkoutDate: data.checkoutDate,
        checkinTime: data.checkinTime,
        checkoutTime: data.checkoutTime,
        bookingType: data.bookingType || 'hourly',
        numberRooms: parseInt(String(requested.number), 10) || 1,
        rooms: requested.room.toString(),
        timezone,
      });

      if (availability?.count) {
        const targetRoom = availability.list[0].rooms.find(
          (r) => String(r._id) === requested.room.toString(),
        ) as { blockedRoomNumbers?: number[]; number_rooms?: number };
        const blocked = targetRoom?.blockedRoomNumbers ?? [];
        for (let currNum = 1; currNum <= (targetRoom?.number_rooms ?? 0); currNum++) {
          if (blocked.indexOf(currNum) === -1) availableRoomNumbers.push(currNum);
        }
      }

      if (availableRoomNumbers.length < requested.number) {
        this.logger.warn(
          `Booking ${String(UB._id)}: room ${requested.room} has ${availableRoomNumbers.length} free of ${requested.number} requested`,
        );
        return null;
      }

      for (let j = 0; j < requested.number; j++) {
        const roomNumber = Number(availableRoomNumbers[j]);

        for (const segment of datesAndHoursStayParams) {
          if (segment.rateType === 'fullDay') {
            bookingSlots.push({
              property: new Types.ObjectId(data.property),
              room: new Types.ObjectId(requested.room),
              date: moment(segment.date, 'DD/MM/YYYY').format('YYYY-MM-DD'),
              userbooking: UB._id,
              slots: segment.hours
                .map((label) => slotIdForLabel(label))
                .filter(Boolean)
                .map((slot) => ({
                  status: 'BOOKED' as const,
                  slot,
                  number: roomNumber,
                  userbooking: UB._id,
                })),
            });
          } else if (segment.rateType === 'standardDay') {
            // A standard day spans two calendar dates: 14:00→00:00, then 00:00→12:00.
            const standardDayDatesAndHours = [
              {
                date: moment(segment.date, 'DD/MM/YYYY').format('YYYY-MM-DD'),
                hours: this.dateTimeService.getHoursFromTo('14:00', '00:00'),
              },
              {
                date: moment(segment.date, 'DD/MM/YYYY')
                  .add(1, 'day')
                  .format('YYYY-MM-DD'),
                hours: this.dateTimeService.getHoursFromTo('00:00', '12:00'),
              },
            ];
            for (const day of standardDayDatesAndHours) {
              bookingSlots.push({
                property: new Types.ObjectId(data.property),
                room: new Types.ObjectId(requested.room),
                date: day.date,
                userbooking: UB._id,
                slots: day.hours
                  .map((label) => slotIdForLabel(label))
                  .filter(Boolean)
                  .map((slot) => ({
                    status: 'BOOKED' as const,
                    slot,
                    number: roomNumber,
                    userbooking: UB._id,
                  })),
              });
            }
          }
        }

        for (const segment of cleaningParams) {
          bookingSlots.push({
            property: new Types.ObjectId(data.property),
            room: new Types.ObjectId(requested.room),
            date: moment(segment.date, 'DD/MM/YYYY').format('YYYY-MM-DD'),
            userbooking: UB._id,
            slots: segment.hours
              .map((label) => slotIdForLabel(label))
              .filter(Boolean)
              .map((slot) => ({
                status: 'RESERVED' as const,
                slot,
                number: roomNumber,
                userbooking: UB._id,
              })),
          });
        }
      }
    }

    return bookingSlots;
  }

  /** Write the staged slots into `bookings` and mirror them into `bookinglogs`. */
  private async persistBookingSlots(
    userBookingId: Types.ObjectId,
    bookingSlots: StagedBookingSlot[],
  ): Promise<boolean> {
    const allSlots = (await this.slotModel
      .find({})
      .select('_id label')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; label: string }>;
    const labelForSlot = new Map<string, string>(
      allSlots.map((s) => [String(s._id), s.label] as [string, string]),
    );

    try {
      for (const staged of bookingSlots) {
        const booking = await this.bookingModel
          .findOne({ room: staged.room, date: staged.date })
          .exec();
        if (booking) {
          booking.slots.push(...staged.slots);
          await booking.save();
        } else {
          await new this.bookingModel(staged).save();
        }

        const bookinglogs = staged.slots.map((slot) => {
          const slotLabel = labelForSlot.get(String(slot.slot)) ?? '00:00';
          return {
            ...slot,
            property: staged.property,
            room: staged.room,
            date: staged.date,
            slotStartTime: moment(
              `${staged.date} ${slotLabel}`,
              'YYYY-MM-DD HH:mm',
            ).toDate(),
            timestamp: moment(staged.date, 'YYYY-MM-DD').toDate(),
          };
        });
        if (bookinglogs.length) await this.bookLogModel.insertMany(bookinglogs);
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Booking ${String(userBookingId)}: failed while saving booking slots`,
        error,
      );
      return false;
    }
  }

  /** Release everything a failed booking attempt had already written. */
  private async rollbackBooking(
    userBookingId: Types.ObjectId,
    includeLogs = false,
  ): Promise<void> {
    await this.bookingModel
      .updateMany({}, { $pull: { slots: { userbooking: userBookingId } } })
      .exec();
    if (includeLogs) {
      await this.bookLogModel.deleteMany({ userbooking: userBookingId }).exec();
    }
    await this.userBookingModel.deleteOne({ _id: userBookingId }).exec();
  }

  /** Internal "booking awaiting payment" alert, sent once the payment link exists. */
  private async sendUnpaidBookingAlert(userBookingId: Types.ObjectId): Promise<void> {
    const userbooking = await this.userBookingModel
      .findOne({ _id: userBookingId })
      .populate('property')
      .populate({ path: 'room.room', populate: { path: 'room_type' } })
      .exec();
    if (!userbooking) return;

    // Legacy flags the booking as cancel_request while it waits for payment; the
    // payment-success handler clears it.
    userbooking.cancel_request = 1;
    await userbooking.save();

    const property = userbooking.property;
    const guestName = `${userbooking.guestinfo.title}. ${userbooking.guestinfo.first_name} ${userbooking.guestinfo.last_name}`;
    const bookedRoomTypes = (userbooking.room || [])
      .map((r: { room?: { room_type?: { name?: string } } }) => r.room?.room_type?.name)
      .filter(Boolean)
      .join('');

    await this.mail.sendUnpaidBookingAlert({
      USERNAME: guestName,
      HOTEL_NAME: property.name,
      BOOKID: userbooking.book_id,
      DATE: moment(`${userbooking.checkin_date} ${userbooking.checkin_time}`).format(
        'dddd YYYY-MM-DD HH:mm',
      ),
      BOOKING_TYPE: capitalize(userbooking.bookingType),
      STAY_DURATION: userbooking.stayDuration,
      USER_MOBILE: userbooking.guestinfo.mobile,
      BOOKED_PROPERTY: property.name,
      BOOKED_PROPERTY_ADDRESS: property.contactinfo?.location ?? '',
      BOOKED_PROPERTY_PHONE: property.contactinfo?.mobile ?? '',
      SELECTED_HOURS: userbooking.selected_hours ?? '',
      BOOKED_ROOM_TYPES: bookedRoomTypes,
      CHECKIN_DATE: moment(userbooking.date_checkin).format('dddd DD-MM-YYYY | hh:mm A'),
      CHECKOUT_DATE: moment(userbooking.date_checkout).format('dddd DD-MM-YYYY | hh:mm A'),
      HOTEL_CONTACT_NUMBER: property.contactinfo?.mobile ?? '',
      HOTEL_EMAIL: property.contactinfo?.email ?? '',
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
  }

  /**
   * B3 — `GET /api/bookings/:id` (book_id, e.g. `SH-123456`).
   *
   * ⚠ Unauthenticated in legacy, and the id is guessable, so guest PII is exposed to
   * anyone who enumerates ids. Parity is kept for the cutover; adding auth is on the
   * post-cutover hardening backlog (MIGRATION.md 2g).
   */
  async getByBookId(bookId: string) {
    const bookingDetails = await this.userBookingModel
      .findOne({ book_id: bookId })
      .populate([
        { path: 'user' },
        {
          path: 'room.room',
          select: '-price -rates',
          populate: [{ path: 'room_name' }, { path: 'room_type' }],
        },
        { path: 'property' },
      ])
      .lean()
      .exec();

    if (!bookingDetails) {
      return { status: 'Failed', message: 'Booking expired!' };
    }
    return bookingDetails;
  }

  /**
   * B4 — `GET /api/payment/success`: the payment gateway's return URL. Marks the booking
   * paid and notifies the guest and the hotel.
   *
   * Returns either a redirect target (web) or a JSON body (app), matching legacy.
   */
  async paymentSuccess(query: Record<string, string>): Promise<
    { redirect: string } | { body: Record<string, unknown> }
  > {
    // A hotel paying an invoice comes back through the same URL.
    if (query.invoice_id) {
      const pay = await this.invoiceModel.findOne({ _id: query.invoice_id }).exec();
      if (!pay) return { body: { status: 0 } };
      pay.status = 'pending';
      pay.datepayed = new Date();
      await pay.save();
      return {
        redirect: `${this.config.get<string>('extranetUrl')}app/invoices/${query.invoice_id}`,
      };
    }

    const platform = query.platform || 'app';
    const UB = await this.userBookingModel.findOne({ _id: query.booking_id }).exec();
    if (!UB) return { body: { status: 0 } };

    try {
      UB.paid = 1;
      UB.abandoned = 0;
      UB.cancel_request = 0;
      UB.charge_uid = query.chargeUID;
      UB.payment_link_id = query.paymentLinkId;
      UB.transaction_id = query.transactionId;
      UB.invoice_id = query.invoice_id ? query.invoice_id : null;
      await UB.save();

      await this.sendBookingConfirmationEmails(UB._id, query.transactionId || '');

      if (platform === 'web') {
        return {
          redirect: `${this.config.get<string>('paymentWebsiteUrl')}payment/?status=success&booking_id=${UB.book_id}`,
        };
      }
      return { body: { status: 1 } };
    } catch (error) {
      this.logger.error(`Payment success handling failed for ${query.booking_id}`, error);
      if (platform === 'web') {
        return {
          redirect: `${this.config.get<string>('paymentWebsiteUrl')}payment/?status=failed&booking_id=${UB.book_id}`,
        };
      }
      return { body: { error: (error as Error).message } };
    }
  }

  /** Guest confirmation + hotel notification for a paid booking. */
  private async sendBookingConfirmationEmails(
    userBookingId: Types.ObjectId,
    transactionReference: string,
  ): Promise<void> {
    const ub = await this.userBookingModel
      .findOne({ _id: userBookingId })
      .populate('property')
      .populate('room.room')
      .exec();
    if (!ub) return;

    const property = ub.property;
    const currencyCode = ub.currencyCode;
    const rooms = ub.room || [];

    const totalRooms = rooms.reduce(
      (sum: number, r: { number: number }) => sum + r.number,
      0,
    );
    let noOfGuests = `${totalRooms} room, `;
    if (ub.no_of_adults) noOfGuests += `${ub.no_of_adults} adults `;
    if (ub.no_of_children) noOfGuests += `${ub.no_of_children} child`;

    const typeOfRooms: string[] = [];
    for (const r of rooms) {
      const room = await this.roomModel
        .findOne({ _id: r.room })
        .populate('room_type')
        .exec();
      if (room?.room_type?.name) typeOfRooms.push(room.room_type.name);
    }

    const checkinDate = moment(ub.date_checkin).format('dddd DD-MM-YYYY | hh:mm A');
    const checkoutDate = moment(ub.date_checkout).format('dddd DD-MM-YYYY | hh:mm A');
    const paymentDate = moment(ub.date_booked).format('dddd DD-MM-YYYY | hh:mm A');

    // The booking fee is discounted by a percentage, not an absolute amount.
    const discountAmount = +ub.bookingFee * (ub.discount ? parseInt(ub.discount, 10) / 100 : 0);
    const totalPrice = +ub.total_amt + (+ub.bookingFee - +discountAmount);
    const balancePrice = +totalPrice - +ub.paymentAmt;
    const transactionAmount = +ub.paymentAmt;

    // What the hotel is owed: their share plus non-tourism charges, plus commission.
    let hotelTotalPrice = +ub.hotelAmt;
    const commissionAmount = (
      ((property.agreement?.commissionHourly ?? 0) / 100) *
      ub.hotelAmt
    ).toFixed(2);
    const taxesBreakdown: string[] = [];
    for (const c of property.charges ?? []) {
      const chargeValue =
        c.chargeType === 'percentage'
          ? `@ ${c.value}% (${currencyCode} ${parseFloat(
              parseFloat(String(ub.total_amt * (c.value / 100))).toFixed(2),
            )} )`
          : `(${ub.currencyCode} ${c.value})`;
      // The tourism fee is collected at the hotel, so it is excluded from their payout.
      if (c.name !== 'Tourism Fee') {
        taxesBreakdown.push(`${c.name} ${chargeValue}`);
        hotelTotalPrice += (ub.hotelAmt / 100) * c.value;
      }
    }
    const hotelTotalPriceStr = hotelTotalPrice.toFixed(2);
    const hotelPrice = (+ub.hotelAmt + +commissionAmount).toFixed(2);
    const vats = taxesBreakdown.length ? `- ${taxesBreakdown.join(', ')} *` : '';

    const latlng = (property.contactinfo?.latlng ?? []).join(',');
    const addressLine1 = property.contactinfo
      ? `${property.contactinfo.address_1} ${property.contactinfo.address_2}`
      : '';
    const balancePriceTransformed =
      balancePrice > 0
        ? `${currencyCode} ${balancePrice}`
        : vats
          ? 'Taxes (Approx.) as below'
          : `${currencyCode} 0`;

    // --- Guest ---
    await this.mail.sendBookingHoldEmail(ub.guestinfo.email, {
      NAME: ub.guestinfo.first_name,
      ORDER_NO: ub.book_id,
      HEADING_PROPERTY_NAME: property.name,
      PROPERTY_NAME: property.name,
      BOOKING_TYPE: capitalize(ub.bookingType),
      NO_OF_GUESTS: noOfGuests,
      TYPE_OF_ROOM: typeOfRooms.join(', '),
      STAY_DURATION: ub.stayDuration,
      CHECKIN_DATE: checkinDate,
      CHECKOUT_DATE: checkoutDate,
      PAYMENT_DATE: paymentDate,
      TRANSACTION_TIME: paymentDate,
      TRANSACTION_REFERENCE: transactionReference,
      TRANSACTION_AMOUNT: `${currencyCode} ${transactionAmount}`,
      TOTAL_PRICE: `${currencyCode} ${transactionAmount}`,
      VATS: vats,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });

    // --- Hotel --- guest contact details are masked in the hotel's copy.
    const maskedEmail = String(ub.guestinfo.email ?? '').replace(
      /^(.)(.*)(.@.*)$/,
      (_m, a, b, c) => a + b.replace(/./g, '*') + c,
    );
    const maskedMobile = String(ub.guestinfo.mobile ?? '').replace(/\d(?=\d{4})/g, '*');

    const secondaryBcc: string[] = (property.secondaryReservationEmails || '')
      .split(',')
      .map((em: string) => em.trim())
      .filter(Boolean);

    await this.mail.sendHotelBookedEmail(property.primaryReservationEmail, secondaryBcc, {
      HEADING_PROPERTY_NAME: property.name,
      ORDER_NO: ub.book_id,
      GUEST_FIRST_NAME: String(ub.guestinfo.first_name ?? '').toUpperCase(),
      ACCOUNT_URL: `${process.env.ACCOUNT_URL ?? this.config.get<string>('appUrl')}/app/bookings/${ub._id}/active`,
      CHECKIN_DATE: checkinDate,
      CHECKOUT_DATE: checkoutDate,
      NAME: ub.guestinfo.first_name,
      PROPERTY_NAME: property.name,
      BOOKING_TYPE: capitalize(ub.bookingType),
      STAY_DURATION: ub.stayDuration,
      NO_OF_GUESTS: noOfGuests,
      TYPE_OF_ROOM: typeOfRooms.join(', '),
      ROOM_AND_TAXES: `${currencyCode} ${(+ub.hotelAmt).toFixed(2)}`,
      TOTAL_PRICE: `${currencyCode} ${hotelTotalPriceStr}`,
      BALANCE_PRICE: balancePriceTransformed,
      ADDRESS_LINE1: addressLine1,
      PHONE: property.contactinfo?.mobile ?? '',
      DIRECTION_URL: `https://www.google.ae/maps/dir/${latlng}/${latlng}`,
      TRANSACTION_REFERENCE: transactionReference,
      TRANSACTION_AMOUNT: `${currencyCode} ${hotelPrice}`,
      TRANSACTION_TIME: paymentDate,
      VATS: vats,
      GUESTNAME: `${ub.guestinfo.title}.${ub.guestinfo.first_name} ${ub.guestinfo.last_name}`,
      GUEST_ADDRESS: maskedEmail,
      GUEST_PHONE: maskedMobile,
      ROOM_AND_TAXES_AND_COMMISSION_AMOUNT: `${currencyCode} ${hotelPrice}`,
      COMMISSION_AMOUNT: `${currencyCode} ${commissionAmount}`,
      VCC_AMOUNT: `${currencyCode} ${(+hotelTotalPriceStr).toFixed(2)}`,
      PRINT_URL: `${this.config.get<string>('apiUrl')}print/booking/${ub._id}`,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
  }

  /**
   * B5 — `GET /api/payment/failed`: release the held slots and send the guest back.
   * The booking document itself is intentionally kept (legacy left it for reporting).
   */
  async paymentFailed(query: Record<string, string>): Promise<
    { redirect: string } | { body: Record<string, unknown> }
  > {
    const platform = query.platform || 'app';
    const UB = await this.userBookingModel.findOne({ _id: query.booking_id }).exec();
    if (!UB) return { body: { status: 0 } };

    try {
      if (query.promocode) {
        await this.userModel
          .updateOne({ _id: UB.user }, { $pull: { promocodes: query.promocode } })
          .exec();
      }
      await this.bookingModel
        .updateMany({}, { $pull: { slots: { userbooking: UB._id } } })
        .exec();
      await this.bookLogModel.deleteMany({ userbooking: UB._id }).exec();

      if (platform === 'web') {
        return {
          redirect: `${this.config.get<string>('paymentWebsiteUrl')}payment/?status=failed&booking_id=${UB.book_id}`,
        };
      }
      return { body: { status: 1 } };
    } catch (error) {
      this.logger.error(`Payment failure handling errored for ${query.booking_id}`, error);
      if (platform === 'web') {
        return {
          redirect: `${this.config.get<string>('paymentWebsiteUrl')}payment/?status=failed&booking_id=${UB.book_id}`,
        };
      }
      return { body: { error: (error as Error).message } };
    }
  }

  /** B6 — `POST /api/v3/myBookings`: completed bookings for a `book_id`. */
  async myBookings(bookId: string) {
    const completedBookingDetails = await this.completedBookingModel
      .find({ book_id: bookId })
      .lean()
      .exec();
    return { bookings: completedBookingDetails };
  }

  /**
   * B7 — `POST /api/v3/resendConfirmMail`: re-send the confirmation for a booking that
   * is still active.
   */
  async resendConfirmMail(
    bookId: string,
  ): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
    const ub = await this.userBookingModel
      .findOne({ book_id: bookId })
      .populate('property')
      .populate('room.room')
      .exec();

    if (!ub) {
      return {
        httpStatus: 400,
        // NOTE (legacy parity): legacy answers 400 with `status: "Success"` here.
        body: { status: 'Success', message: 'Invalid Book ID' },
      };
    }

    const user = await this.userModel.findById(ub.user).lean().exec();
    const property = ub.property;
    const currencyCode = ub.currencyCode || '';
    const rooms = ub.room || [];

    const totalRooms = rooms.reduce(
      (sum: number, r: { number: number }) => sum + r.number,
      0,
    );
    let noOfGuests = `${totalRooms} room, `;
    if (ub.no_of_adults) noOfGuests += `${ub.no_of_adults} adults `;
    if (ub.no_of_children) noOfGuests += `${ub.no_of_children} child`;

    const typeOfRooms: string[] = [];
    for (const r of rooms) {
      const room = await this.roomModel
        .findOne({ _id: r.room })
        .populate('room_type')
        .exec();
      if (room?.room_type?.name) typeOfRooms.push(room.room_type.name);
    }

    const discountAmount =
      +ub.bookingFee * (ub.discount ? parseInt(ub.discount, 10) / 100 : 0);
    const totalPrice = +ub.total_amt + (+ub.bookingFee - +discountAmount);
    const balancePrice = +totalPrice - +ub.paymentAmt;

    const taxesBreakdown: string[] = [];
    for (const c of property.charges ?? []) {
      const chargeValue =
        c.chargeType === 'percentage'
          ? `@ ${c.value}% (${currencyCode} ${parseFloat(
              parseFloat(String(ub.total_amt * (c.value / 100))).toFixed(2),
            )} )`
          : `(${ub.currencyCode} ${c.value})`;
      taxesBreakdown.push(`${c.name} ${chargeValue}`);
    }
    const vats = taxesBreakdown.length
      ? ub.bookingType === 'hourly'
        ? `- Excluding Charges Approx ${taxesBreakdown.join(', ')} *`
        : `- ${taxesBreakdown.join(', ')} *`
      : '';

    const latlng = (property.contactinfo?.latlng ?? []).join(',');
    const balancePriceTransformed =
      balancePrice > 0
        ? `${currencyCode} ${balancePrice}`
        : vats
          ? 'Taxes (Approx.) as below'
          : `${currencyCode} 0`;

    await this.mail.resendBookingConfirmation(user?.email, {
      HEADING_PROPERTY_NAME: property.name,
      ORDER_NO: bookId,
      CHECKIN_DATE: moment(ub.date_checkin).format('dddd DD-MM-YYYY | hh:mm A'),
      CHECKOUT_DATE: moment(ub.date_checkout).format('dddd DD-MM-YYYY | hh:mm A'),
      NAME: ub.guestinfo?.first_name || '',
      PROPERTY_NAME: property.name || '',
      BOOKING_TYPE: capitalize(ub.bookingType),
      STAY_DURATION: ub.stayDuration,
      NO_OF_GUESTS: noOfGuests,
      TYPE_OF_ROOM: typeOfRooms.join(', '),
      TOTAL_PRICE: `${currencyCode} ${totalPrice}`,
      BALANCE_PRICE: balancePriceTransformed,
      ADDRESS_LINE1: property.contactinfo
        ? `${property.contactinfo.address_1} ${property.contactinfo.address_2}`
        : '',
      PHONE: property.contactinfo?.mobile || '',
      DIRECTION_URL: `https://www.google.ae/maps/dir/${latlng}/${latlng}`,
      TRANSACTION_REFERENCE: String(ub.ref || '').substring(0, 10),
      TRANSACTION_AMOUNT: `${currencyCode} ${+ub.paymentAmt}`,
      TRANSACTION_TIME: moment(ub.date_booked).format('dddd DD-MM-YYYY | hh:mm A'),
      VATS: vats,
      PRINT_URL: `${this.config.get<string>('apiUrl')}print/booking/${ub._id}`,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });

    return {
      httpStatus: 200,
      body: { status: 'Success', message: 'mail sent successfully!' },
    };
  }
}

/** "hourly" => "Hourly"; empty for a missing value. */
function capitalize(value?: string): string {
  return value ? value.charAt(0).toUpperCase() + value.substring(1) : '';
}
