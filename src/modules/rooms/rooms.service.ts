import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { basename } from 'path';
import sharp from 'sharp';
import moment from 'moment-timezone';
import { MailService } from '../../common/mail/mail.service';

// 'property' (legacy) is NOT a path on the rooms schema — populating it throws
// StrictPopulateError under Mongoose 8, so it is intentionally dropped here.
const populations = [
  { path: 'property_id' },
  { path: 'room_type' },
  { path: 'room_name' },
  { path: 'bed_type' },
  { path: 'services' },
  { path: 'number_of_guests' },
];

const singlePopulations = [
  {
    path: 'property_id',
    populate: [
      { path: 'rating' },
      { path: 'company' },
      { path: 'administrator' },
      { path: 'rooms' },
      { path: 'type' },
      { path: 'contactinfo.country' },
      { path: 'contactinfo.city' },
      { path: 'policies' },
      { path: 'terms' },
      { path: 'currency' },
      { path: 'payment.country' },
      { path: 'payment.currency' },
    ],
  },
  { path: 'room_type' },
  { path: 'room_name' },
  { path: 'bed_type' },
  { path: 'services' },
  { path: 'number_of_guests' },
];

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('slots') private readonly slotModel: Model<any>,
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
    for (let n = start; n <= end; n++) {
      pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });
    }
    return pages;
  }

  private preCreateOrUpdate(resourceData: any) {
    if (!resourceData.extrabed_option) resourceData.extrabed_number = 0;
    return resourceData;
  }

  async list(query: any, basePath = '/admin/v2/rooms') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const where: any = {};
    if (query.propertyId) where.property_id = query.propertyId;
    if (query.property) where.property_id = query.property;

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const [list, itemCount] = await Promise.all([
      this.roomModel.find(where).populate(populations).sort(sort).limit(limit).skip(skip).lean().exec(),
      this.roomModel.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  async single(id: string) {
    const resource = await this.roomModel.findOne({ _id: id }).populate(singlePopulations).lean().exec();
    return resource || { notFound: true };
  }

  async create(resourceData: any) {
    resourceData = this.preCreateOrUpdate(resourceData);
    const resource = new this.roomModel(resourceData);
    await resource.save();
    await this.roomModel.populate(resource, singlePopulations);
    return resource;
  }

  async modify(id: string, resourceData: any) {
    resourceData = this.preCreateOrUpdate(resourceData);
    const resource: any = await this.roomModel.findOne({ _id: id });
    if (!resource) return null;
    Object.keys(resourceData).forEach((key) => {
      resource[key] = resourceData[key];
    });
    await resource.save();
    await this.roomModel.populate(resource, singlePopulations);
    return resource;
  }

  async remove(id: string) {
    return this.roomModel.deleteOne({ _id: id }).exec();
  }

  // ---- Rates ----
  async createRate(id: string, resourceData: any) {
    const resource: any = await this.roomModel.findOne({ _id: id });
    if (!resource) return null;
    const rate = resource.rates.create(resourceData);
    resource.rates.push(rate);
    await resource.save();
    return rate;
  }

  private extranetUrl(): string {
    switch (process.env.NODE_ENV) {
      case 'production':
        return 'https://account.stayhopper.com/app/suggested-rates';
      case 'staging':
        return 'https://account.staging.stayhopper.com/app/suggested-rates';
      case 'development':
        return 'http://localhost:3001/app/suggested-rates';
      default:
        return '';
    }
  }

  async modifyRate(id: string, rateId: string, userId: string, resourceData: any) {
    const resource: any = await this.roomModel
      .findOne({ _id: id, 'rates._id': rateId })
      .populate(singlePopulations);
    if (!resource) return null;

    const currency = ` ${resource.property_id?.currency?.code ?? ''}`;
    const suggestedRate: any = resource.rates.find((r: any) => r.isExistPriceSuggestion === true);

    const sendRejected =
      resource.isExistPriceSuggestion &&
      !resourceData.isExistPriceSuggestion &&
      String(resource.property_id?.administrator?._id) !== String(userId);

    // Update the rate subdocument.
    const rate = resource.rates.id(rateId);
    rate.set(resourceData);
    await resource.save();

    if (resourceData.isExistPriceSuggestion) {
      const room: any = await this.roomModel.findById(id);
      room.isExistPriceSuggestion = true;
      room.suggestedRatePercentage =
        resourceData.suggestedRatePercentage != null
          ? Number(resourceData.suggestedRatePercentage).toFixed(2)
          : room.suggestedRatePercentage;
      await room.save();

      await this.mailService.sendRateSuggestionRequest({
        hotelName: resource.property_id?.name,
        extranetUrl: this.extranetUrl(),
        currency,
        high: resourceData.suggested_rates,
        base: resourceData,
      });
    } else {
      const room: any = await this.roomModel.findById(id);
      room.isExistPriceSuggestion = false;
      room.suggestedRatePercentage = 0;
      await room.save();

      if (sendRejected && suggestedRate?.suggested_rates?.[0]) {
        await this.mailService.sendRateSuggestionRejected({
          toEmail: resource.property_id?.primaryReservationEmail,
          hotelName: resource.property_id?.name,
          currency,
          high: suggestedRate.suggested_rates[0],
          base: resourceData,
          reason: resourceData.reason_to_reject,
        });
      }
    }

    return resource.rates.id(rateId);
  }

  async removeRate(id: string, rateId: string) {
    const resource: any = await this.roomModel.findOne({ _id: id, 'rates._id': rateId });
    if (!resource) return null;
    resource.rates.pull(rateId);
    await resource.save();
    return resource;
  }

  // ---- Availability ----
  private getSlotRanges(slots: any[], status: string, date: string, tz: string) {
    const ranges: any[] = [];
    const sorted = [...slots].sort((a, b) => {
      const la = (a.slot.label || '').trim().toLowerCase();
      const lb = (b.slot.label || '').trim().toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

    const fresh = () => ({ slots: [], status } as any);
    let rangeItem: any = fresh();
    const thirtyMins = 30 * 60 * 1000;
    const momentDate = moment.tz(date, tz);

    sorted.forEach((slotItem) => {
      if (slotItem[status]) {
        const [hh, mm] = String(slotItem.slot.label).split(':');
        const startMt = moment(momentDate);
        startMt.set({ hour: parseInt(hh, 10), minute: parseInt(mm, 10) });
        const end = new Date(startMt.toDate().getTime() + thirtyMins);
        if (!rangeItem.start) {
          rangeItem.start = startMt.toDate();
          rangeItem.end = end;
        } else {
          rangeItem.end = end;
        }
        rangeItem.slots.push(slotItem.slot);
      } else if (rangeItem.start) {
        ranges.push(rangeItem);
        rangeItem = fresh();
      }
    });
    if (rangeItem.start) ranges.push(rangeItem);
    return ranges;
  }

  async listAvailability(id: string, date: string) {
    const resource: any = await this.roomModel.findOne({ _id: id }).populate(singlePopulations).lean().exec();
    if (!resource) return { notFound: true };

    const resourceCountry =
      resource.property_id?.contactinfo?.country?.country?.toLowerCase() || '';
    let tzs = moment.tz.zonesForCountry('ae');
    if (['uae', 'united arab emirates'].indexOf(resourceCountry) > -1) tzs = moment.tz.zonesForCountry('ae');
    else if (resourceCountry === 'india') tzs = moment.tz.zonesForCountry('in');
    else if (resourceCountry === 'vietnam') tzs = moment.tz.zonesForCountry('vn');
    const tz = tzs.length ? tzs[0] : 'Asia/Dubai';

    const booking: any = await this.bookingModel
      .findOne({ room: id, date })
      .populate('slots.slot');
    const bookingArray = booking?.slots ? Array.from(booking.slots) : [];
    const slots = await this.slotModel.find().sort({ _id: 1 });

    const slotStatuses: any[][] = [];
    for (let i = 0; i < resource.number_rooms; i++) {
      slotStatuses[i] = [];
      slots.forEach((slot: any) => {
        const status = { _id: slot._id, slot, booked: false, blocked: false, reserved: false };
        const match = (st: string) =>
          bookingArray.some(
            (o: any) => o.slot?.no == slot.no && o.number == i + 1 && o.status == st,
          );
        if (match('BLOCKED')) status.blocked = true;
        if (match('BOOKED')) status.booked = true;
        if (match('RESERVED')) status.reserved = true;
        slotStatuses[i].push(status);
      });
    }

    const list = slotStatuses.map((item) => [
      ...this.getSlotRanges(item, 'booked', date, tz),
      ...this.getSlotRanges(item, 'reserved', date, tz),
      ...this.getSlotRanges(item, 'blocked', date, tz),
    ]);

    return { list, slots };
  }

  async changeAvailability(action: string, body: any) {
    const { room: roomId, dates, slotIds, nos } = body;

    const [room, slots] = await Promise.all([
      this.roomModel.findOne({ _id: roomId }),
      this.slotModel.find({ _id: { $in: slotIds || [] } }).sort({ _id: 1 }).exec(),
    ]);

    if (!(room && slots && slots.length && dates && dates.length)) {
      return { status: 0, data: 'Some error occured. Please contact administrator' };
    }

    const bookLogInsertRecords: any[] = [];
    let bookLogDeleteIds: any[] = [];
    let shouldInsert = false;
    let shouldDelete = false;

    await Promise.all(
      dates.map(async (date: string) => {
        const dateStamp = new Date(moment(new Date(date)).format('YYYY-MM-DD'));
        let booking: any = await this.bookingModel.findOne({ room: room._id, date });
        if (!booking) {
          booking = new this.bookingModel();
          booking.slots = [];
        }
        booking.property = room.property_id;
        booking.room = room._id;
        booking.date = date;

        const makeLog = (slotId: any, no: number) => {
          const slotRecord = slots.find((s: any) => s._id.toString() === slotId.toString());
          const slotLabel = slotRecord ? slotRecord.label : '00:00';
          return {
            property: room.property_id,
            room: room._id,
            slot: slotId,
            number: no,
            date,
            slotStartTime: moment(`${date} ${slotLabel}`, 'YYYY-MM-DD HH:mm').toDate(),
            timestamp: dateStamp,
          };
        };

        if (booking.slots && booking.slots.length) {
          if (action === 'block') {
            (nos || []).forEach((no: number) => {
              const unavailable = booking.slots
                .filter((s: any) => s.status !== 'BLOCKED' && s.number === no)
                .map((s: any) => s._id);
              const available = (slotIds || []).filter((sid: any) => unavailable.indexOf(sid) === -1);
              available.forEach((slotId: any) => {
                booking.slots.push({ slot: slotId, number: no, status: 'BLOCKED' });
                bookLogInsertRecords.push(makeLog(slotId, no));
                shouldInsert = true;
              });
            });
            await booking.save();
          } else if (action === 'unblock') {
            const orQuery: any[] = [];
            booking.slots = booking.slots.filter((bookingSlot: any) => {
              const keep = !(
                (slotIds || []).indexOf(bookingSlot.slot.toString()) > -1 &&
                (nos || []).indexOf(bookingSlot.number) > -1 &&
                bookingSlot.status === 'BLOCKED'
              );
              if (!keep) {
                shouldDelete = true;
                orQuery.push({
                  room: room._id,
                  slot: bookingSlot.slot,
                  date,
                  number: bookingSlot.number,
                });
              }
              return keep;
            });
            if (orQuery.length) {
              const bls = await this.bookingLogModel.find({ $or: orQuery }).lean();
              if (bls && bls.length) {
                bookLogDeleteIds = bookLogDeleteIds.concat(bls.map((b: any) => b._id));
              }
            }
            await booking.save();
          }
        } else if (action === 'block') {
          (nos || []).forEach((no: number) => {
            (slotIds || []).forEach((slotId: any) => {
              booking.slots.push({ slot: slotId, number: no, status: 'BLOCKED' });
              bookLogInsertRecords.push(makeLog(slotId, no));
              shouldInsert = true;
            });
          });
          await booking.save();
        }
      }),
    );

    if (shouldInsert) await this.bookingLogModel.insertMany(bookLogInsertRecords);
    if (shouldDelete) await this.bookingLogModel.deleteMany({ _id: { $in: bookLogDeleteIds } });

    return {
      message:
        action === 'block'
          ? 'Time slots are blocked successfully'
          : 'Time slots are unblocked successfully',
    };
  }

  // ---- Photos ----
  async createPhoto(id: string, file: any) {
    const resource: any = await this.roomModel.findOne({ _id: id });
    if (!resource || !file) return { notFound: true };
    const filename = basename(file.path);
    const target = `public/files/rooms/${filename}`;
    await sharp(file.path).resize(800).toFile(target);
    resource.images = resource.images ? [...resource.images, target] : [target];
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }

  async removePhoto(id: string, image: string) {
    const resource: any = await this.roomModel.findOne({ _id: id });
    if (!resource || !resource.images || resource.images.length === 0) return { notFound: true };
    resource.images = resource.images.filter((i: string) => i !== image);
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }

  async featurePhoto(id: string, image: string) {
    const resource: any = await this.roomModel.findOne({ _id: id });
    if (!resource) return { notFound: true };
    resource.featured = [image];
    const images = (resource.images || []).filter((i: string) => i !== image);
    images.unshift(image);
    resource.images = images;
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }
}
