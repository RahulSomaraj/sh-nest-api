import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import moment from 'moment';
import { MailService } from '../../common/mail/mail.service';
import { HALF_HOUR_TIMESLOTS } from '../../common/util/timeslots';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationChild,
} from '../api/website/schemas/notification.schema';
import { PushService } from './push.service';

/**
 * Background jobs — MIGRATION.md phase 3, ported from `stayhopper/cron.js`.
 *
 * ⚠ These MUST run on exactly one process. They delete booking logs, move bookings
 * between collections and mutate slot state; two instances would double-fire every one
 * of them. `ENABLE_CRON=true` should therefore be set on a single PM2 instance, and the
 * legacy `require("./cron")` must be removed from `sh-api/index.js` before this ships —
 * otherwise nest and legacy race each other.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly push: PushService,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings')
    private readonly completedBookingModel: Model<any>,
    @InjectModel('bookings') private readonly bookingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookLogModel: Model<any>,
    @InjectModel('slots') private readonly slotModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('cron_blockslots')
    private readonly blockSlotModel: Model<any>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<any>,
    @InjectModel(NotificationChild.name)
    private readonly notificationChildModel: Model<any>,
  ) {}

  /** Every job checks this first so a non-cron instance stays completely inert. */
  private get enabled(): boolean {
    return !!this.config.get<boolean>('enableCron');
  }

  /**
   * C1 — purge booking logs older than two days (`cron.js:26`).
   * The logs only exist to answer availability queries for current/near-future stays.
   */
  @Cron('*/30 * * * *', { name: 'purge-old-booking-logs' })
  async purgeOldBookingLogs(): Promise<void> {
    if (!this.enabled) return;
    const cutoff = moment().add(-2, 'days').format('YYYY-MM-DD');
    const result = await this.bookLogModel.deleteMany({ date: { $lt: cutoff } }).exec();
    this.logger.log(`Purged ${result.deletedCount} booking logs older than ${cutoff}`);
  }

  /**
   * C2 — move checked-out bookings into `completed_bookings` and ask the guest for a
   * review (`cron.js:39`).
   *
   * The active `userbookings` collection only holds live stays; once checkout has passed
   * the booking is flattened into a self-contained `completed_bookings` document (the
   * property and room details are embedded, not referenced, so history survives the
   * property being edited or deleted) and the original row is removed.
   */
  @Cron('0 * * * *', { name: 'archive-completed-bookings' })
  async archiveCompletedBookings(): Promise<void> {
    if (!this.enabled) return;

    const bookings = await this.userBookingModel
      .find({ date_checkout: { $lte: new Date() } })
      .populate({
        path: 'property',
        populate: [{ path: 'contactinfo.country' }, { path: 'contactinfo.city' }],
      })
      .populate({
        path: 'room.room',
        populate: [{ path: 'room_name' }, { path: 'room_type' }],
      })
      .exec();
    if (!bookings.length) return;

    let archived = 0;
    // Sequential on purpose: legacy used `forEach(async …)`, which fired every iteration
    // at once and swallowed rejections. One at a time keeps the writes ordered and lets a
    // single bad booking be logged without taking the run down.
    for (const book of bookings) {
      try {
        // Guard against a booking whose stored checkout strings disagree with
        // `date_checkout` — only archive once the checkout instant has really passed.
        const checkoutMoment = moment(
          new Date(`${book.checkout_date} ${book.checkout_time}`),
        );
        if (checkoutMoment.diff(moment()) > 0) continue;

        const completedBooking = this.toCompletedBooking(book);

        await this.userBookingModel.deleteOne({ _id: book._id }).exec();
        const userDetails = await this.userModel.findOne({ _id: book.user }).exec();
        if (book.property) {
          await this.completedBookingModel.create(completedBooking);
        }
        archived++;

        // No review request for a cancelled or unpaid stay.
        if (book.cancel_approval !== 1 && book.paid) {
          await this.requestReview(book, userDetails);
        }
      } catch (e) {
        this.logger.error(`Archiving booking ${String(book._id)} failed: ${e}`);
      }
    }
    this.logger.log(`Archived ${archived} completed bookings`);
  }

  /** Flatten a live booking into the embedded shape `completed_bookings` stores. */
  private toCompletedBooking(book: Record<string, any>): Record<string, unknown> {
    const roomsInfo: Array<Record<string, unknown>> = [];
    for (const room of book.room ?? []) {
      const roomDoc = room.room;
      if (!roomDoc || !Object.keys(roomDoc).length) continue;
      roomsInfo.push({
        id: roomDoc._id,
        images: roomDoc.images,
        // NOTE (legacy parity): the override is keyed off `room.custom_name` but reads
        // `roomDoc.custom_name` — reproduced exactly.
        name: room.custom_name ? roomDoc.custom_name : roomDoc.room_name?.name,
        number: room.number,
        type: roomDoc.room_type?.name,
      });
    }

    return {
      book_id: book.book_id,
      hotel_vcc_authenticated: book.hotel_vcc_authenticated,
      otp_recieved: book.otp_recieved,
      ub_id: book._id,
      user: book.user,
      guestInfo: book.guestinfo,
      paid: book.paid,
      ...(book.property
        ? {
            propertyInfo: {
              id: book.property._id,
              name: book.property.name,
              images: book.property.images,
              country: book.property.contactinfo?.country?.country,
              city: book.property.contactinfo?.city?.name,
              address_1: book.property.contactinfo?.address_1,
              address_2: book.property.contactinfo?.address_2,
              location: book.property.contactinfo?.location,
              zip: book.property.contactinfo?.zip,
            },
            latlng: book.property.contactinfo?.latlng,
          }
        : {}),
      roomsInfo,
      bookingType: book.bookingType,
      trip_type: book.trip_type,
      no_of_adults: book.no_of_adults,
      no_of_children: book.no_of_children,
      selected_hours: book.selected_hours,
      stayDuration: book.stayDuration,
      checkin_time: book.checkin_time,
      checkin_date: book.checkin_date,
      checkout_time: book.checkout_time,
      checkout_date: book.checkout_date,
      date_checkin: book.date_checkin,
      date_checkout: book.date_checkout,
      date_booked: book.date_booked,
      tax: book.tax,
      ref: book.ref,
      bookingFee: book.bookingFee,
      currencyCode: book.currencyCode,
      discount: book.discount,
      total_amt: book.total_amt,
      paymentAmt: book.paymentAmt,
      cancel_approval: book.cancel_approval,
      vcc: book.vcc,
      hotel_approved: book.hotel_approved,
      hotel_cancelled: book.hotel_cancelled,
      hotelAmt: book.hotelAmt,
    };
  }

  /** Create the in-app review notification and push it, if the guest has a device. */
  private async requestReview(
    book: Record<string, any>,
    userDetails: UserDocument | null,
  ): Promise<void> {
    const notification = await this.notificationModel.create({
      title: 'Review property',
      description: `How was your stay at ${book.property.name}?`,
      book_id: book._id,
      booking_no: book.book_id,
      notification_type: 'REVIEW',
      device_token: userDetails?.device_token,
      property_name: book.property.name,
      property_id: book.property._id,
    });

    const notificationChild = await this.notificationChildModel.create({
      notification_id: notification._id,
      user_id: book.user,
    });

    if (userDetails?.device_token) {
      await this.push.sendReviewRequest({
        device_token: userDetails.device_token,
        device_type: userDetails.device_type,
        property_name: book.property.name,
        property_id: book.property._id,
        book_id: book._id,
        notification_id: notificationChild._id,
      });
    }
  }

  /**
   * C3 — remind the guest 30 minutes before check-in (`cron.js:179`).
   *
   * Runs on the half hour and matches bookings whose `checkin_time` equals the NEXT
   * half-hour boundary, so each booking is notified exactly once.
   */
  @Cron('*/30 * * * *', { name: 'checkin-reminder-push' })
  async sendCheckinReminders(): Promise<void> {
    if (!this.enabled) return;

    const start = moment();
    const remainder = 30 - (start.minute() % 30);
    const slot = moment(start).add(remainder, 'minutes').format('HH:mm');
    const today = moment().format('YYYY-MM-DD');

    const bookings: Array<Record<string, any>> = await this.userBookingModel
      .aggregate([
        {
          $match: {
            paid: true,
            checkin_date: today,
            checkin_time: slot,
            cancel_approval: { $ne: 1 },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user_detail',
          },
        },
        {
          $lookup: {
            from: 'properties',
            localField: 'property',
            foreignField: '_id',
            as: 'property_detail',
          },
        },
        {
          $project: {
            property_name: {
              $ifNull: [{ $arrayElemAt: ['$property_detail.name', 0] }, ''],
            },
            device_token: {
              $ifNull: [{ $arrayElemAt: ['$user_detail.device_token', 0] }, false],
            },
            device_type: { $arrayElemAt: ['$user_detail.device_type', 0] },
            user_id: { $arrayElemAt: ['$user_detail._id', 0] },
            booking_no: { $ifNull: ['$book_id', ''] },
            booking_id: '$_id',
          },
        },
        // A guest with no device token can't be pushed to.
        { $match: { device_token: { $ne: false } } },
      ])
      .exec();

    if (!bookings.length) return;

    const recipients: Array<{
      device_token: string;
      device_type?: string;
      property_name: string;
      id: unknown;
      notification_id: unknown;
    }> = [];

    for (const booking of bookings) {
      try {
        const notification = await this.notificationModel.create({
          title: 'Booking Notification',
          description: `Your booking at ${booking.property_name} in 30 minutes.`,
          book_id: booking.booking_id,
          booking_no: booking.booking_no,
          notification_type: 'BOOKED',
          device_token: booking.device_token,
        });
        const notificationChild = await this.notificationChildModel.create({
          notification_id: notification._id,
          user_id: booking.user_id,
        });
        recipients.push({
          device_token: booking.device_token,
          device_type: booking.device_type,
          property_name: booking.property_name,
          id: booking.booking_id,
          notification_id: notificationChild._id,
        });
      } catch (e) {
        this.logger.error(
          `Check-in reminder for ${String(booking.booking_id)} failed: ${e}`,
        );
      }
    }

    await this.push.sendBookingReminder(recipients);
    this.logger.log(`Sent ${recipients.length} check-in reminders for slot ${slot}`);
  }

  /**
   * C6 — offer to extend the stay 30 minutes before checkout (`cron.js:366`).
   *
   * Only offered when the room is actually free for the following 3 hours; see
   * `isExtensionAvailable`.
   */
  @Cron('*/30 * * * *', { name: 'extend-stay-push' })
  async sendExtendStayOffers(): Promise<void> {
    if (!this.enabled) return;

    const start = moment();
    const remainder = 30 - (start.minute() % 30);
    const slot = moment(start).add(remainder, 'minutes').format('HH:mm');
    const today = new Date(moment().format('YYYY-MM-DD'));
    const tomorrow = new Date(moment().add(1, 'day').format('YYYY-MM-DD'));

    const bookings: Array<Record<string, any>> = await this.userBookingModel
      .aggregate([
        {
          $match: {
            cancel_approval: 0,
            paid: true,
            date_checkout: { $gte: today, $lte: tomorrow },
            checkout_time: slot,
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user_detail',
          },
        },
        {
          $project: {
            device_token: {
              $ifNull: [{ $arrayElemAt: ['$user_detail.device_token', 0] }, false],
            },
            device_type: { $arrayElemAt: ['$user_detail.device_type', 0] },
            user_id: { $arrayElemAt: ['$user_detail._id', 0] },
            book_no: '$book_id',
          },
        },
        { $match: { device_token: { $ne: false } } },
      ])
      .exec();

    if (!bookings.length) return;

    const recipients: Array<{
      device_token: string;
      device_type?: string;
      id: unknown;
      notification_id: unknown;
    }> = [];

    for (const booking of bookings) {
      try {
        if (!(await this.isExtensionAvailable(booking._id))) continue;

        const notification = await this.notificationModel.create({
          title: 'Extend your stay?',
          description: 'Your checkout is in 30 minutes. Do you want to extend?',
          book_id: booking._id,
          booking_no: booking.book_no,
          notification_type: 'EXTEND',
          device_token: booking.device_token,
        });
        const notificationChild = await this.notificationChildModel.create({
          notification_id: notification._id,
          user_id: booking.user_id,
        });
        recipients.push({
          device_token: booking.device_token,
          device_type: booking.device_type,
          id: booking._id,
          notification_id: notificationChild._id,
        });
      } catch (e) {
        this.logger.error(`Extend-stay offer for ${String(booking._id)} failed: ${e}`);
      }
    }

    await this.push.sendBookingExtension(recipients);
    this.logger.log(`Sent ${recipients.length} extend-stay offers for slot ${slot}`);
  }

  /**
   * Can this booking be extended by another block? True when no OTHER booking already
   * holds the slots the extension would need, for any of the room numbers this guest
   * currently occupies.
   *
   * TODO(⚠️ PRODUCT): legacy called this WITHOUT `await` (`cron.js:511`), so the caller
   * always saw a truthy Promise and the "extend your stay?" push went to every guest
   * regardless of availability. On top of that the helper's return value is inverted
   * relative to its name — it returns 1 when a CONFLICT exists and 0 when the room is
   * free. Awaiting it as-written would have flipped the job to "only offer when the room
   * is taken", which is plainly not the intent, so this implementation awaits it AND
   * reads it the sensible way: offer the extension only when nothing conflicts. This is
   * the one behavioural change in phase 3 — confirm with the team that guests should stop
   * receiving offers for rooms that are already re-booked.
   */
  private async isExtensionAvailable(userBookingId: unknown): Promise<boolean> {
    const slots = await this.slotModel.find().sort('_id').exec();
    const slotIds = slots.map((s: { _id: Types.ObjectId }) => s._id);

    const userbooking = await this.userBookingModel
      .findOne({ _id: userBookingId, cancel_approval: { $ne: 1 } })
      .populate('property')
      .populate('room.room')
      .exec();
    if (!userbooking) return false;

    // Which physical room numbers this booking currently occupies, per room type.
    const bookedRooms: Array<{ room: unknown; room_nos: number[] }> =
      await this.bookLogModel
        .aggregate([
          { $match: { userbooking: userbooking._id } },
          { $group: { _id: { room: '$room' }, room_nos: { $addToSet: '$number' } } },
          { $project: { room: '$_id.room', room_nos: '$room_nos' } },
        ])
        .exec();

    const roomDetails = userbooking.room;
    if (!roomDetails?.length) return false;

    // The property's shortest bookable block, in hours.
    const timeslot = Math.min(...(userbooking.property?.timeslots ?? []));

    const rooms = roomDetails.map((entry: Record<string, any>) => ({
      id: entry.room._id,
      extraslots: entry.room.extraslot_cleaning ?? 0,
      number: entry.number,
      room_nos:
        bookedRooms.find((b) => String(b.room) === String(entry.room._id))?.room_nos ?? [],
    }));

    // The extension starts where the current stay ends.
    const checkinDate = moment(userbooking.date_checkout).format('YYYY-MM-DD');
    const checkinTime = moment(userbooking.date_checkout).format('HH:mm');
    const firstIndex = HALF_HOUR_TIMESLOTS.indexOf(checkinTime, 0);
    if (firstIndex === -1) return false;

    const filter: Array<Record<string, unknown>> = [];
    for (const room of rooms) {
      // A block of `timeslot` hours is 2 slots per hour, plus the room's cleaning slots.
      let numberSlotsRequired = timeslot * 2 + room.extraslots;
      const requestedSlots: Array<{ slots: Types.ObjectId[]; date: string }> = [];

      const sameDay = slotIds.slice(firstIndex, firstIndex + numberSlotsRequired);
      requestedSlots.push({ slots: sameDay, date: checkinDate });

      // The block can run past midnight — carry the remainder onto the next day.
      if (numberSlotsRequired > sameDay.length) {
        numberSlotsRequired -= sameDay.length;
        const nextDate = moment(checkinDate).add(1, 'days').format('YYYY-MM-DD');
        requestedSlots.push({
          slots: slotIds.slice(0, numberSlotsRequired),
          date: nextDate,
        });
      }

      for (const roomNo of room.room_nos) {
        for (const requested of requestedSlots) {
          filter.push({
            $and: [
              { slot: { $in: requested.slots } },
              { date: requested.date },
              { number: roomNo },
              { room: new Types.ObjectId(String(room.id)) },
              { userbooking: { $ne: new Types.ObjectId(String(userBookingId)) } },
            ],
          });
        }
      }
    }

    if (!filter.length) return false;

    const conflicts = await this.bookLogModel
      .aggregate([{ $match: { $or: filter } }, { $count: 'exist' }])
      .exec();
    return conflicts.length === 0;
  }

  /**
   * C4 — delete unpaid bookings whose checkout has passed (`cron.js:326`).
   * They can never be paid for, and leaving them behind skews reporting.
   */
  @Cron('0 0 * * *', { name: 'purge-unpaid-past-checkout-bookings' })
  async purgeUnpaidPastCheckoutBookings(): Promise<void> {
    if (!this.enabled) return;
    const result = await this.userBookingModel
      .deleteMany({ paid: false, date_checkout: { $lte: new Date() } })
      .exec();
    this.logger.log(`Deleted ${result.deletedCount} unpaid past-checkout bookings`);
  }

  /**
   * C7 — apply queued bulk UNBLOCK requests (`cron.js:1102`).
   *
   * The extranet's bulk-availability screen writes `cron_blockslots` rows rather than
   * updating slots inline, because a wide date range touches thousands of subdocuments.
   * Five rows are drained per minute, matching legacy.
   */
  @Cron('* * * * *', { name: 'process-bulk-unblock-requests' })
  async processBulkUnblockRequests(): Promise<void> {
    if (!this.enabled) return;

    const blockslots = await this.blockSlotModel
      .find({ status: false, block_type: 'UNBLOCK' })
      .limit(5)
      .exec();
    if (!blockslots.length) return;

    for (const request of blockslots) {
      try {
        await this.applyUnblockRequest(request);
        await this.blockSlotModel
          .updateOne({ _id: request._id }, { $set: { status: true } })
          .exec();

        // The extranet marks the final row of a batch so the hotel gets one mail, not N.
        if (request.is_last && request.user_email) {
          await this.mail.sendTemplated({
            template: 'slotblockcompleted.html',
            replacements: { CURRENT_YEAR: String(new Date().getFullYear()) },
            to: request.user_email,
            bcc: [this.config.get<string>('mail.bccEmail')].filter(Boolean),
            subject: 'STAYHOPPER: Your inventory update is live now',
            text: 'Your inventory update is live now',
          });
        }
      } catch (e) {
        this.logger.error(`Bulk unblock ${String(request._id)} failed: ${e}`);
      }
    }
  }

  /** Remove the BLOCKED slots covered by one unblock request. */
  private async applyUnblockRequest(request: {
    from_date: string;
    to_date: string;
    room?: string;
    property?: string;
    from_slot: string;
    to_slot: string;
  }): Promise<void> {
    const from = new Date(request.from_date);
    const to = new Date(request.to_date);
    const diffDays = Math.ceil(
      Math.abs(to.getTime() - from.getTime()) / (1000 * 3600 * 24),
    );
    const dates = [moment(from).format('YYYY-MM-DD')];
    for (let i = 1; i <= diffDays; i++) {
      dates.push(moment(from).add(i, 'days').format('YYYY-MM-DD'));
    }

    // Slots are ordered by their `no` field; the request names the first and last.
    const fromSlot = await this.slotModel.findOne({ _id: request.from_slot }).exec();
    const toSlot = await this.slotModel.findOne({ _id: request.to_slot }).exec();
    if (!fromSlot || !toSlot) return;

    const skip = parseInt(fromSlot.no, 10);
    const limit = parseInt(toSlot.no, 10);
    const selectSlots = await this.slotModel
      .find()
      .skip(skip - 1)
      .limit(limit - skip + 1)
      .sort({ _id: 1 })
      .exec();
    const selectSlotIds = selectSlots.map((s: { _id: unknown }) => String(s._id));

    let rooms: Array<{ _id: unknown; number_rooms: number; property_id: unknown }> = [];
    if (request.room) {
      const room = await this.roomModel.findOne({ _id: request.room }).exec();
      if (room) rooms = [room];
    } else {
      const property = await this.propertyModel
        .findOne({ _id: request.property })
        .populate('rooms')
        .exec();
      rooms = property?.rooms ?? [];
    }
    if (!rooms.length) return;

    for (const room of rooms) {
      // Legacy iterates 0..number_rooms inclusive and uses z+1 as the room number, so it
      // covers 1..number_rooms+1. The extra number simply never matches anything.
      for (let z = 0; z <= room.number_rooms; z++) {
        const roomNo = z + 1;
        for (const date of dates) {
          const booking = await this.bookingModel
            .findOne({
              room: room._id,
              date,
              'slots.number': roomNo,
              'slots.status': { $eq: 'BLOCKED' },
            })
            .exec();
          if (!booking) continue;

          const remaining: Array<Record<string, unknown>> = [];
          const removed: Array<{ room: unknown; slot: unknown }> = [];
          for (const slot of booking.slots) {
            if (
              slot.status === 'BLOCKED' &&
              slot.number === roomNo &&
              selectSlotIds.includes(String(slot.slot))
            ) {
              removed.push({ room: room._id, slot: slot.slot });
            } else {
              remaining.push(slot);
            }
          }
          if (!removed.length) continue;

          await this.bookLogModel
            .deleteMany({
              $or: removed.map((r) => ({
                room: new Types.ObjectId(String(r.room)),
                number: roomNo,
                slot: new Types.ObjectId(String(r.slot)),
              })),
            })
            .exec();
          await this.bookingModel
            .updateOne({ room: room._id, date }, { $set: { slots: remaining } })
            .exec();
        }
      }
    }
  }
}
