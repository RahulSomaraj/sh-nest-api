import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { basename } from 'path';
import { promises as fsp } from 'fs';
import sharp from 'sharp';
import {
  assertOwned,
  ownedPropertyIds,
  PROPERTY_SCOPE,
} from '../../common/auth/owner-scope';

const populations = [
  { path: 'rating' },
  { path: 'company' },
  { path: 'administrator' },
  { path: 'allAdministrators', populate: { path: 'role' } },
  { path: 'rooms' },
  { path: 'services' },
  { path: 'type' },
  { path: 'contactinfo.country' },
  { path: 'contactinfo.city' },
  { path: 'policies' },
  { path: 'terms' },
  { path: 'currency' },
  { path: 'payment.country' },
  { path: 'payment.currency' },
];

const has = (permissions: string[], p: string) => permissions.indexOf(p) > -1;

@Injectable()
export class PropertiesService {
  constructor(
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('Administrator') private readonly administratorModel: Model<any>,
    @InjectModel('Role') private readonly roleModel: Model<any>,
    @InjectModel('countries') private readonly countryModel: Model<any>,
    // audit A5: delete guard + cascade cleanup.
    @InjectModel('users') private readonly userModel: Model<any>,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('bookings') private readonly availabilityBookingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookingLogModel: Model<any>,
    private readonly config: ConfigService,
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

  /** Mirrors legacy prepareQueryForListing (owner scoping + filters). */
  private prepareQueryForListing(query: any, user: any, permissions: string[]) {
    const hasAll = has(permissions, 'LIST_ALL_PROPERTIES');
    const hasOwn = has(permissions, 'LIST_OWN_PROPERTIES');
    const where: any = {};

    const pushAnd = (cond: any) => {
      where.$and = where.$and || [];
      where.$and.push(cond);
    };

    if (hasOwn && !hasAll) {
      pushAnd({
        $or: [
          { administrator: user._id },
          { allAdministrators: { $in: [user._id] } },
        ],
      });
    }

    if (query.q) {
      pushAnd({ $or: [{ name: new RegExp(query.q, 'i') }] });
    }

    if (query.company) {
      pushAnd({
        $or: [
          { administrator: query.company },
          { allAdministrators: { $in: [query.company] } },
        ],
      });
    }

    if (query.country) where['contactinfo.country'] = query.country;
    if (query.city) where['contactinfo.city'] = query.city;

    if (query.source) {
      const or: any[] = [];
      if (query.source === 'Extranet') {
        or.push({ source: 'Extranet' }, { source: '' }, { source: { $exists: false } });
      } else if (query.source === 'Website') {
        or.push({ source: 'Website' });
      }
      if (or.length) pushAnd({ $or: or });
    }

    const isAgreementSigned = query.isAgreementSigned;
    if (typeof isAgreementSigned !== 'undefined' && isAgreementSigned !== '') {
      if (isAgreementSigned === true || isAgreementSigned === 'true') {
        where['agreement.isAgreementSigned'] = true;
      } else {
        pushAnd({
          $or: [
            { agreement: { $exists: false } },
            { 'agreement.isAgreementSigned': { $exists: false } },
            { 'agreement.isAgreementSigned': false },
          ],
        });
      }
    }

    if (query.approved === true || query.approved === 'true') where.approved = true;
    else if (query.approved === false || query.approved === 'false') where.approved = false;

    if (query.published === true || query.published === 'true') where.published = true;
    else if (query.published === false || query.published === 'false') where.published = false;

    return where;
  }

  private async getExtraResourceInformation(resource: any) {
    const rooms = await this.roomModel.aggregate([
      { $match: { property_id: new Types.ObjectId(resource._id) } },
      { $group: { _id: '$property_id', totalRooms: { $sum: '$number_rooms' } } },
      { $limit: 1 },
    ]);
    resource.total_rooms = rooms.length > 0 ? rooms[0].totalRooms : 0;
    return resource;
  }

  async list(query: any, user: any, permissions: string[], basePath = '/admin/v2/properties') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const hasAll = has(permissions, 'LIST_ALL_PROPERTIES');
    const where = this.prepareQueryForListing(query, user, permissions);

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    // Hotel-admin / receptionist roles (own-properties-only) for the company filter list.
    const [hotelAdminRoles, receptionistRoles] = await Promise.all([
      this.roleModel.find({
        permissions: { $in: ['LIST_OWN_PROPERTIES', 'LIST_INVOICES'], $nin: ['LIST_ALL_PROPERTIES'] },
      }).select('_id').lean(),
      this.roleModel.find({
        permissions: { $in: ['LIST_OWN_PROPERTIES'], $nin: ['LIST_ALL_PROPERTIES', 'LIST_INVOICES'] },
      }).select('_id').lean(),
    ]);
    const ids = [...hotelAdminRoles, ...receptionistRoles].map((r: any) => r._id);

    let [hotelAdmins, countries, list, itemCount] = await Promise.all([
      hasAll
        ? this.administratorModel
            .find({ role: { $in: ids } })
            .select('_id name legal_name')
            .lean()
        : Promise.resolve([]),
      this.countryModel.find({}).lean(),
      this.propertyModel
        .find(where)
        .populate(populations)
        .sort(sort)
        .limit(limit)
        .skip(skip)
        .lean()
        .exec(),
      this.propertyModel.countDocuments(where),
    ]);

    list = await Promise.all(list.map((r: any) => this.getExtraResourceInformation(r)));

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      hotelAdmins,
      countries,
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  async hasAgreementSigned(user: any, permissions: string[]) {
    const hasAll = has(permissions, 'LIST_ALL_PROPERTIES');
    const hasOwn = has(permissions, 'LIST_OWN_PROPERTIES');
    const where: any = {};
    if (hasOwn && !hasAll) {
      where.$and = [
        { $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }] },
      ];
    }
    where['agreement.isAgreementSigned'] = true;
    const count = await this.propertyModel.countDocuments(where);
    return { result: count > 0 };
  }

  /** audit A5: owner scoping for by-id operations — same rule as `list`, else 403. */
  private async assertPropertyAccess(user: any, propertyId: string): Promise<void> {
    const owned = await ownedPropertyIds(user, this.propertyModel, PROPERTY_SCOPE);
    if (owned === null) return;
    assertOwned(owned, propertyId);
  }

  async single(id: string, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    const resource: any = await this.propertyModel
      .findOne({ _id: id })
      .populate(populations)
      .lean()
      .exec();
    if (!resource) return { notFound: true };

    resource.agreement = resource.agreement || {};
    if (!resource.agreement.commissionHourly) {
      resource.agreement.commissionHourly = this.config.get('commission.hourly');
    }
    if (!resource.agreement.commissionMonthly) {
      resource.agreement.commissionMonthly = this.config.get('commission.monthly');
    }
    return resource;
  }

  /** Mirrors legacy preCreateOrUpdate: file wiring + defensive field normalisation. */
  private preCreateOrUpdate(resourceData: any, files: any, permissions: string[]) {
    resourceData.trade_licence = resourceData.trade_licence || {};
    const tla = files?.['trade_licence[trade_licence_attachment]']?.[0];
    const pa = files?.['trade_licence[passport_attachment]']?.[0];
    if (tla) resourceData.trade_licence.trade_licence_attachment = tla.path || null;
    if (pa) resourceData.trade_licence.passport_attachment = pa.path || null;

    if (resourceData.weekends) {
      if (typeof resourceData.weekends === 'string') {
        resourceData.weekends = resourceData.weekends
          .split(',')
          .map((w: string) => w.trim().toLowerCase());
      }
    } else {
      resourceData.weekends = [];
    }

    if (resourceData.location && !resourceData.location.type) {
      resourceData.location.type = 'Point';
    }
    if (!resourceData.location) {
      resourceData.location = { type: 'Point', coordinates: [55.2277468, 25.0753483] };
    }

    if (resourceData.secondaryReservationEmails) {
      resourceData.secondaryReservationEmails =
        String(resourceData.secondaryReservationEmails).toLowerCase();
    }

    if (resourceData.payment && !resourceData.payment.country) {
      delete resourceData.payment.country;
    }

    if (typeof resourceData.rating === 'string' && resourceData.rating === '') delete resourceData.rating;
    if (typeof resourceData.type === 'string' && resourceData.type === '') delete resourceData.type;

    if (resourceData.contactinfo) {
      if (resourceData.contactinfo.country === '') delete resourceData.contactinfo.country;
      if (resourceData.contactinfo.city === '') delete resourceData.contactinfo.city;
    }

    if (resourceData.agreement && !has(permissions, 'MANAGE_AGREEMENT')) {
      if (typeof resourceData.agreement.commissionHourly === 'string') {
        delete resourceData.agreement.commissionHourly;
      }
      if (typeof resourceData.agreement.commissionMonthly === 'string') {
        delete resourceData.agreement.commissionMonthly;
      }
    }

    return resourceData;
  }

  async create(resourceData: any, files: any, permissions: string[]) {
    if (
      !resourceData.max_day_price_percentage_to_normal_price ||
      parseInt(resourceData.max_day_price_percentage_to_normal_price, 10) < 25
    ) {
      resourceData.max_day_price_percentage_to_normal_price = 25;
    }
    resourceData = this.preCreateOrUpdate(resourceData, files, permissions);

    const resource = new this.propertyModel(resourceData);
    await resource.save();
    await this.propertyModel.populate(resource, populations);
    return resource;
  }

  async modify(id: string, resourceData: any, files: any, permissions: string[], user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    resourceData = this.preCreateOrUpdate(resourceData, files, permissions);

    const resource: any = await this.propertyModel.findOne({ _id: id });
    if (!resource) return null;

    Object.keys(resourceData).forEach((key) => {
      resource[key] = resourceData[key];
    });
    await resource.save();
    await this.propertyModel.populate(resource, populations);
    return resource;
  }

  async remove(id: string, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    // audit A5: refuse deletion while the property has active bookings, then cascade
    // (rooms + availability bookings/bookinglogs + users' favourites) so no orphans remain.
    const activeBookings = await this.userBookingModel.countDocuments({
      property: id,
      date_checkin: { $gte: new Date() },
    });
    if (activeBookings) {
      throw new HttpException(
        {
          status: 0,
          message: 'Property has active bookings and cannot be deleted',
          count: activeBookings,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.userModel.updateMany(
      { favourites: id },
      { $pull: { favourites: id } },
    );
    await this.availabilityBookingModel.deleteMany({ property: id });
    await this.bookingLogModel.deleteMany({ property: id });
    await this.roomModel.deleteMany({ property_id: id });
    return this.propertyModel.deleteOne({ _id: id }).exec();
  }

  // ---- Nearby ----
  async createNearby(id: string, name: string, file: any, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    const resource: any = await this.propertyModel.findOne({ _id: id });
    if (!resource) return { notFound: true };
    if (!name) return { badRequest: true, message: 'Nearby location name is required' };

    const image = file ? file.path || null : undefined;
    const record = resource.nearby.create({ name, image });
    resource.nearby.push(record);
    await resource.save();
    return { record };
  }

  async removeNearby(id: string, nearbyId: string, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    if (!nearbyId) return { badRequest: true, message: 'Sorry, invalid nearby place specified to remove' };
    const resource: any = await this.propertyModel.findOne({ _id: id, 'nearby._id': nearbyId });
    if (!resource) return { notFound: true };
    resource.nearby.pull(nearbyId);
    await resource.save();
    return { resource };
  }

  // ---- Photos ----
  async createPhoto(id: string, file: any, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    const resource: any = await this.propertyModel.findOne({ _id: id });
    if (!resource || !file) return { notFound: true };

    const filename = basename(file.path);
    const target = `public/files/properties/${filename}`;
    // Resize the uploaded original in place (legacy fetched via api_url then piped to sharp).
    await sharp(file.path).resize(800).toFile(target);

    const image = target;
    resource.images = resource.images ? [...resource.images, image] : [image];
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }

  async removePhoto(id: string, image: string, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    const resource: any = await this.propertyModel.findOne({ _id: id });
    if (!resource || !resource.images || resource.images.length === 0) {
      return { notFound: true };
    }
    resource.images = resource.images.filter((i: string) => i !== image);
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }

  async featurePhoto(id: string, image: string, user?: any) {
    await this.assertPropertyAccess(user, id); // audit A5
    const resource: any = await this.propertyModel.findOne({ _id: id });
    if (!resource) return { notFound: true };
    resource.featured = [image];
    const images = (resource.images || []).filter((i: string) => i !== image);
    images.unshift(image);
    resource.images = images;
    await resource.save();
    return { images: resource.images, featured: resource.featured };
  }
}
