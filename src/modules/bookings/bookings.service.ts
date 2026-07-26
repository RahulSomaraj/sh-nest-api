import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import moment from 'moment';
import { MailService } from '../../common/mail/mail.service';
import {
  assertOwned,
  ownedPropertyIds,
  BOOKING_SCOPE,
} from '../../common/auth/owner-scope';
import { scalarOrThrow } from '../../common/util/query.util';
import { UpdateBookingGuestDto } from './dto/update-booking-guest.dto';

const activePopulations = [
  { path: 'user' },
  { path: 'room.room', populate: [{ path: 'room_name' }, { path: 'room_type' }] },
  { path: 'property', populate: [{ path: 'contactinfo.country' }] },
];

const has = (permissions: string[], p: string) =>
  permissions.indexOf('*') > -1 || permissions.indexOf(p) > -1;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.substring(1) : '');

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings') private readonly completedModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('bookings') private readonly bookingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookingLogModel: Model<any>,
    private readonly mailService: MailService,
  ) {}

  private buildPages(basePath: string, limit: number, pageCount: number, currentPage: number) {
    const pages: { number: number; url: string }[] = [];
    const maxPages = 10;
    let start = Math.max(1, currentPage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });
    return pages;
  }

  private maskGuest(guestinfo: any) {
    if (!guestinfo) return;
    if (guestinfo.email) {
      guestinfo.email = guestinfo.email.replace(/^(.)(.*)(.@.*)$/, (_: any, a: string, b: string, c: string) =>
        a + b.replace(/./g, '*') + c,
      );
    }
    if (guestinfo.mobile) guestinfo.mobile = guestinfo.mobile.replace(/\d(?=\d{4})/g, '*');
  }

  private withHotelFinalAmount(item: any, charges: any[]) {
    const finalCharges = (charges || []).filter(
      (c: any) => c && typeof c.value === 'number' && c.value && c.id !== 'tourism_fee',
    );
    const pct = finalCharges.reduce((acc: number, r: any) => acc + r.value, 0);
    if (typeof item.hotelAmt !== 'number' || item.hotelAmt <= 0) {
      return { ...JSON.parse(JSON.stringify(item)), hotelFinalAmount: 0 };
    }
    const hotelFinalAmount = item.hotelAmt + (pct / 100) * item.hotelAmt;
    return { ...JSON.parse(JSON.stringify(item)), hotelFinalAmount };
  }

  private async prepareWhere(query: any, user: any, permissions: string[]) {
    const hasAll = has(permissions, 'LIST_ALL_BOOKINGS');
    const hasOwn = has(permissions, 'LIST_OWN_BOOKINGS');
    const status = query.status;
    const where: any = {};

    if (hasOwn && !hasAll) {
      const propsWithAccess = await this.propertyModel
        .find({ $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }] })
        .select('_id')
        .lean();
      const ids = propsWithAccess.map((p: any) => p._id);
      where.$and = where.$and || [];
      where.$and.push(
        status === 'active' ? { property: { $in: ids } } : { 'propertyInfo.id': { $in: ids } },
      );
      // Hotel Admin / Receptionist roles → only paid bookings
      if (
        String(user.role?._id) === '5efc8ef65694cbf9675b28a3' ||
        String(user.role?._id) === '5f1a9e9a016a9ccac0177d39'
      ) {
        where.paid = true;
      }
    }

    // audit C-2: reject non-scalar (operator-injection) values before they hit the filter.
    const propertyFilter = scalarOrThrow(query.property, 'property');
    const userFilter = scalarOrThrow(query.user, 'user');
    const dateFilter = scalarOrThrow(query.date, 'date');
    if (propertyFilter !== undefined) {
      if (status === 'active') where.property = propertyFilter;
      else where['propertyInfo.id'] = propertyFilter;
    }
    if (userFilter !== undefined) where.user = userFilter;
    if (dateFilter !== undefined) where.checkin_date = moment(new Date(dateFilter)).format('YYYY-MM-DD');
    return where;
  }

  /** Manually attach property docs to completed bookings' propertyInfo.id (no populate). */
  private async attachCompletedProperties(items: any[]) {
    const ids = items.map((i) => i?.propertyInfo?.id).filter(Boolean);
    if (!ids.length) return items;
    const props = await this.propertyModel.find({ _id: { $in: ids } }).lean();
    const byId = new Map(props.map((p: any) => [String(p._id), p]));
    for (const it of items) {
      const pid = it?.propertyInfo?.id;
      if (pid && byId.has(String(pid))) it.propertyInfo.id = byId.get(String(pid));
    }
    return items;
  }

  async list(query: any, user: any, permissions: string[], basePath = '/admin/v2/bookings') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const status = query.status;
    const active = !status || status === 'active';
    const model = active ? this.userBookingModel : this.completedModel;
    const where = await this.prepareWhere(query, user, permissions);

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy && query.orderBy !== 'property') {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const hasAll = has(permissions, 'LIST_ALL_BOOKINGS');
    const isPropertySort = query.orderBy === 'property';
    const isAsc = query.order === 'asc';

    let pageItems: any[];
    if (isPropertySort) {
      // audit perf: sort-by-property no longer loads the whole collection into memory.
      const dir = isAsc ? 1 : -1;
      if (active) {
        // Active bookings reference `property` (name not on the doc): aggregate a $lookup
        // to sort by property name in the DB, take one page of ids, then fetch + populate.
        const paged = await this.userBookingModel.aggregate([
          { $match: where },
          { $lookup: { from: 'properties', localField: 'property', foreignField: '_id', as: '_prop' } },
          { $addFields: { _pname: { $toLower: { $ifNull: [{ $arrayElemAt: ['$_prop.name', 0] }, ''] } } } },
          { $sort: { _pname: dir, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 1 } },
        ]);
        const ids = paged.map((d: any) => d._id);
        pageItems = await this.userBookingModel.find({ _id: { $in: ids } }).lean().exec();
        const order = new Map(ids.map((id: any, i: number) => [String(id), i]));
        pageItems.sort(
          (a: any, b: any) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
        );
        pageItems = await this.userBookingModel.populate(pageItems, activePopulations);
      } else {
        // Completed bookings embed propertyInfo.name — sortable directly in the DB.
        pageItems = await model
          .find(where)
          .sort({ 'propertyInfo.name': dir, _id: 1 })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec();
        pageItems = await this.attachCompletedProperties(pageItems);
      }
    } else {
      pageItems = await model.find(where).sort(sort).skip(skip).limit(limit).lean().exec();
      if (active) pageItems = await this.userBookingModel.populate(pageItems, activePopulations);
      else pageItems = await this.attachCompletedProperties(pageItems);
    }

    const [properties, itemCount] = await Promise.all([
      hasAll
        ? this.propertyModel.find({}).sort({ name: 1 }).select('_id name').lean()
        : this.propertyModel
            .find({ $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }] })
            .sort({ name: 1 })
            .select('_id name')
            .lean(),
      model.countDocuments(where),
    ]);

    if (!hasAll) pageItems.forEach((it) => this.maskGuest(it.guestinfo || it.guestInfo));

    const finalList = pageItems.map((it) => {
      const charges = active ? it?.property?.charges : it?.propertyInfo?.id?.charges;
      return this.withHotelFinalAmount(it, charges);
    });

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list: finalList,
      properties,
      users: [],
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  /**
   * audit A7: owner scoping for by-id booking operations — an own-scoped admin
   * (LIST_OWN_BOOKINGS without LIST_ALL_BOOKINGS) may only act on bookings of their
   * own properties. Active bookings reference `property`; completed use `propertyInfo.id`.
   * Missing docs fall through so handlers keep their 404/error contracts.
   */
  private async assertBookingAccess(user: any, booking: any, active: boolean): Promise<void> {
    if (!booking) return;
    const owned = await ownedPropertyIds(user, this.propertyModel, BOOKING_SCOPE);
    if (owned === null) return;
    assertOwned(owned, active ? booking.property : booking.propertyInfo?.id);
  }

  async single(id: string, status: string, permissions: string[], user?: any) {
    const active = !status || status === 'active';
    const model = active ? this.userBookingModel : this.completedModel;
    let resource: any = await model.findOne({ _id: id }).lean().exec();
    if (!resource) return { notFound: true };
    await this.assertBookingAccess(user, resource, active); // audit A7

    if (active) [resource] = await this.userBookingModel.populate([resource], activePopulations);
    else [resource] = await this.attachCompletedProperties([resource]);

    if (!has(permissions, 'LIST_ALL_BOOKINGS')) this.maskGuest(resource.guestinfo || resource.guestInfo);

    const charges = active ? resource?.property?.charges : resource?.propertyInfo?.id?.charges;
    const withAmt = this.withHotelFinalAmount(resource, charges);
    return { hotelFinalAmount: withAmt.hotelFinalAmount, ...resource };
  }

  /**
   * PUT /bookings/:id — GUEST DETAILS ONLY. Updates guest identity fields
   * (title/first_name/last_name/email/mobile); never dates, room, status, or amounts.
   * Active bookings store these under `guestinfo`, completed under `guestInfo`. Owner-scoped
   * (audit A7); guest PII masked in the response for non-LIST_ALL admins, mirroring single().
   */
  async modifyGuest(id: string, dto: UpdateBookingGuestDto, permissions: string[], user?: any) {
    const allowed: (keyof UpdateBookingGuestDto)[] = [
      'title',
      'first_name',
      'last_name',
      'email',
      'mobile',
    ];
    const provided = allowed.filter((k) => typeof dto[k] !== 'undefined');
    if (!provided.length) return { badRequest: true };

    // Active bookings store guest under `guestinfo`; completed under `guestInfo`.
    let model: Model<any> = this.userBookingModel;
    let field = 'guestinfo';
    let active = true;
    let doc: any = await this.userBookingModel.findOne({ _id: id }).lean().exec();
    if (!doc) {
      doc = await this.completedModel.findOne({ _id: id }).lean().exec();
      if (!doc) return { notFound: true };
      model = this.completedModel;
      field = 'guestInfo';
      active = false;
    }

    await this.assertBookingAccess(user, doc, active); // audit A7 owner scoping

    const set: any = {};
    for (const k of provided) set[`${field}.${k}`] = dto[k];

    const updated: any = await model
      .findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
      .lean()
      .exec();

    if (!has(permissions, 'LIST_ALL_BOOKINGS')) this.maskGuest(updated[field]);
    return updated;
  }

  // ---- Cancellation / no-show flows ----

  private async loadActive(id: string) {
    return this.userBookingModel
      .findOne({ _id: id })
      .populate('property')
      .populate({ path: 'room.room', populate: { path: 'room_type' } })
      .lean()
      .exec();
  }

  private roomTypes(rooms: any[], key: 'room' | 'info') {
    let s = '';
    (rooms || []).forEach((r: any) => {
      s += key === 'room' ? r?.room?.room_type?.name || '' : r?.type || '';
    });
    return s.replace(/,\s*$/, '');
  }

  async cancel(id: string, user?: any) {
    const ub: any = await this.loadActive(id);
    if (!ub) return { error: true };
    await this.assertBookingAccess(user, ub, true); // audit A7
    await this.userBookingModel.updateOne({ _id: id }, { $set: { cancel_request: 1 } });

    const guest = ub.guestinfo || {};
    const date = moment(`${ub.checkin_date} ${ub.checkin_time}`).format('dddd YYYY-MM-DD HH:mm');
    await this.mailService.sendTemplated({
      template: 'order_cancel_request.html',
      // TODO(⚠️ PRODUCT — audit A7, decision 2026-07-02: keep for now): v2 "TESTING"
      // recipient; production target (config.website_cancellation_email) still disabled.
      to: 'support@stayhopper.com',
      subject: 'STAYHOPPER: Booking cancellation request',
      text: 'Booking cancellation request',
      replacements: {
        USERNAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
        HOTEL_NAME: ub.property?.name,
        BOOKID: ub.book_id,
        DATE: date,
        USER_MOBILE: guest.mobile,
        BOOKED_PROPERTY: ub.property?.name,
        BOOKED_PROPERTY_ADDRESS: ub.property?.contactinfo?.location,
        BOOKED_PROPERTY_PHONE: ub.property?.contactinfo?.mobile,
        STAY_DURATION: ub.stayDuration,
        BOOKING_TYPE: cap(ub.bookingType),
        BOOKED_ROOM_TYPES: this.roomTypes(ub.room, 'room'),
        BOOKED_DATE: date,
        HOTEL_CONTACT_NUMBER: ub.property?.contactinfo?.mobile,
        HOTEL_EMAIL: ub.property?.contactinfo?.email,
        CURRENT_YEAR: String(new Date().getFullYear()),
      },
    });
    return { message: 'Booking Cancellation Request sent successfully!' };
  }

  async remove(id: string, user?: any) {
    const ub: any = await this.loadActive(id);
    if (!ub) return { error: true };
    await this.assertBookingAccess(user, ub, true); // audit A7

    await this.bookingModel.updateMany({}, { $pull: { slots: { userbooking: id } } });
    await this.bookingLogModel.deleteMany({ userbooking: id });
    await this.userBookingModel.updateOne({ _id: id }, { $set: { cancel_approval: 1 } });

    const guest = ub.guestinfo || {};
    const date = moment(`${ub.checkin_date} ${ub.checkin_time}`).format('dddd YYYY-MM-DD hh:mm A');
    await this.mailService.sendTemplated({
      template: 'order_cancelled.html',
      to: guest.email,
      bcc: ['noreply@stayhopper.com'],
      subject: 'STAYHOPPER: Booking cancellation request',
      text: 'Booking cancellation request',
      replacements: {
        USER_NAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
        HOTEL_NAME: ub.property?.name,
        BOOK_ID: ub.book_id,
        DATE: date,
        ADDRESS: ub.property?.contactinfo?.location,
        HOTEL_PHONE: ub.property?.contactinfo?.mobile,
        STAY_DURATION: ub.stayDuration,
        BOOKING_TYPE: cap(ub.bookingType),
        ROOM_TYPE: this.roomTypes(ub.room, 'room'),
        CURRENT_YEAR: String(new Date().getFullYear()),
      },
    });
    return { message: 'Booking deleted successfully!' };
  }

  async rejectCancellation(id: string, user?: any) {
    const ub: any = await this.loadActive(id);
    if (!ub) return { error: true };
    await this.assertBookingAccess(user, ub, true); // audit A7
    await this.userBookingModel.updateOne({ _id: id }, { $set: { cancel_approval: 2 } });

    // audit A7: v2 had this `to:` commented out (bcc only) — product approved sending
    // to the hotel on 2026-07-02; hotels start receiving rejection notices at cutover.
    const primary = ub.property?.primaryReservationEmail;
    if (primary) {
      const guest = ub.guestinfo || {};
      const date = moment(`${ub.checkin_date} ${ub.checkin_time}`).format('dddd YYYY-MM-DD hh:mm A');
      const secondary = ub.property?.secondaryReservationEmails;
      const bcc = ['noreply@stayhopper.com'];
      if (secondary && secondary.length) secondary.split(',').forEach((e: string) => bcc.push(e.trim()));
      await this.mailService.sendTemplated({
        template: 'order_cancel_request_rejected.html',
        to: primary,
        bcc,
        subject: 'STAYHOPPER: booking cancellation request rejected!',
        text: 'Your booking cancellation request has been rejected',
        replacements: {
          GUEST_NAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
          HOTEL_NAME: ub.property?.name,
          BOOK_ID: ub.book_id,
          DATE: date,
          GUEST_PHONE: guest.mobile,
          PROPERTY_NAME: ub.property?.name,
          PROPERTY_ADDRESS: ub.property?.contactinfo?.location,
          PROPERTY_PHONE: ub.property?.contactinfo?.mobile,
          STAY_DURATION: ub.stayDuration,
          BOOKING_TYPE: cap(ub.bookingType),
          PROPERTY_ROOMS: this.roomTypes(ub.room, 'room'),
          CURRENT_YEAR: String(new Date().getFullYear()),
        },
      });
    }
    return { message: 'Cancellation request rejected by admin' };
  }

  async noShow(id: string, user?: any) {
    const cb: any = await this.completedModel.findOne({ _id: id }).lean().exec();
    if (!cb) return { error: true };
    await this.assertBookingAccess(user, cb, false); // audit A7
    await this.completedModel.updateOne({ _id: id }, { $set: { noshow_request: 1 } });

    const guest = cb.guestInfo || {};
    const info = cb.propertyInfo || {};
    const date = moment(`${cb.checkin_date} ${cb.checkin_time}`).format('dddd YYYY-MM-DD HH:mm');
    await this.mailService.sendTemplated({
      template: 'order_noshow_request.html',
      // TODO(⚠️ PRODUCT — audit A7): v2 "TESTING" recipient, kept pending product decision.
      to: 'support@stayhopper.com',
      subject: 'STAYHOPPER: Booking Noshow request',
      text: 'Booking Noshow request',
      replacements: {
        USERNAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
        HOTEL_NAME: info.name,
        BOOKID: cb.book_id,
        DATE: date,
        USER_MOBILE: guest.mobile || '',
        BOOKED_PROPERTY: info.name || '',
        BOOKED_PROPERTY_ADDRESS: info.location,
        BOOKED_PROPERTY_PHONE: info.mobile || '',
        STAY_DURATION: cb.stayDuration,
        BOOKING_TYPE: cap(cb.bookingType),
        BOOKED_ROOM_TYPES: this.roomTypes(cb.roomsInfo, 'info'),
        BOOKED_DATE: date,
        HOTEL_CONTACT_NUMBER: info.mobile || '',
        HOTEL_EMAIL: info.email || '',
        CURRENT_YEAR: String(new Date().getFullYear()),
      },
    });
    return { message: 'Booking No show Request sent successfully!' };
  }

  async rejectNoShow(id: string, user?: any) {
    const cb: any = await this.completedModel.findOne({ _id: id }).lean().exec();
    if (!cb) return { error: true };
    await this.assertBookingAccess(user, cb, false); // audit A7
    await this.completedModel.updateOne({ _id: id }, { $set: { nowshow_approval: 2 } });

    // audit A7: as in rejectCancellation — product approved the real hotel recipient (2026-07-02).
    const info = cb.propertyInfo || {};
    if (info.primaryReservationEmail) {
      const guest = cb.guestInfo || {};
      const date = moment(`${cb.checkin_date} ${cb.checkin_time}`).format('dddd YYYY-MM-DD hh:mm A');
      const bcc = ['noreply@stayhopper.com'];
      if (info.secondaryReservationEmails && info.secondaryReservationEmails.length) {
        info.secondaryReservationEmails.split(',').forEach((e: string) => bcc.push(e.trim()));
      }
      await this.mailService.sendTemplated({
        template: 'order_noshow_request_rejected.html',
        to: info.primaryReservationEmail,
        bcc,
        subject: 'STAYHOPPER: booking cancellation request rejected!',
        text: 'Your booking cancellation request has been rejected',
        replacements: {
          GUEST_NAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
          HOTEL_NAME: info.name,
          BOOK_ID: cb.book_id,
          DATE: date,
          GUEST_PHONE: '',
          PROPERTY_NAME: info.name || '',
          PROPERTY_ADDRESS: info.location,
          PROPERTY_PHONE: info.mobile || '',
          STAY_DURATION: cb.stayDuration,
          BOOKING_TYPE: cap(cb.bookingType),
          PROPERTY_ROOMS: this.roomTypes(cb.roomsInfo, 'info'),
          CURRENT_YEAR: String(new Date().getFullYear()),
        },
      });
    }
    return { message: 'Cancellation request rejected by admin' };
  }

  async approveNoShow(id: string, user?: any) {
    const cb: any = await this.completedModel.findOne({ _id: id }).lean().exec();
    if (!cb) return { error: true };
    await this.assertBookingAccess(user, cb, false); // audit A7

    await this.bookingModel.updateMany({}, { $pull: { slots: { userbooking: id } } });
    await this.bookingLogModel.deleteMany({ userbooking: id });
    await this.completedModel.updateOne({ _id: id }, { $set: { nowshow_approval: 1 } });

    const guest = cb.guestInfo || {};
    const info = cb.propertyInfo || {};
    const date = moment(`${cb.checkin_date} ${cb.checkin_time}`).format('dddd YYYY-MM-DD hh:mm A');
    await this.mailService.sendTemplated({
      template: 'order_noshow.html',
      // TODO(⚠️ PRODUCT — audit A7): v2 "TESTING" recipient (guest email disabled in v2),
      // kept pending product decision.
      to: 'support@stayhopper.com',
      bcc: ['noreply@stayhopper.com'],
      subject: 'STAYHOPPER: Booking Noshow request',
      text: 'Booking cancellation request',
      replacements: {
        USER_NAME: `${guest.title}. ${guest.first_name} ${guest.last_name}`,
        HOTEL_NAME: info.name,
        BOOK_ID: cb.book_id,
        DATE: date,
        ADDRESS: info.location,
        HOTEL_PHONE: info.mobile || '',
        STAY_DURATION: cb.stayDuration,
        BOOKING_TYPE: cap(cb.bookingType),
        ROOM_TYPE: this.roomTypes(cb.roomsInfo, 'info'),
        CURRENT_YEAR: String(new Date().getFullYear()),
      },
    });
    return { message: 'Booking deleted successfully!' };
  }
}
