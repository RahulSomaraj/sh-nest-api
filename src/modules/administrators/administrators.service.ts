import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as generator from 'generate-password';
import {
  Administrator,
  AdministratorDocument,
} from './schemas/administrator.schema';
import { Role } from './schemas/role.schema';
import { MailService } from '../../common/mail/mail.service';

const resourcePopulations = [
  { path: 'properties', populate: { path: 'rooms type company rating' } },
  { path: 'role' },
  { path: 'country' },
  { path: 'city' },
];

const propertiesPopulations = [
  { path: 'rooms' },
  { path: 'type' },
  { path: 'company' },
  { path: 'rating' },
];

@Injectable()
export class AdministratorsService {
  constructor(
    @InjectModel(Administrator.name)
    private readonly administratorModel: Model<AdministratorDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('currencies') private readonly currencyModel: Model<any>,
    // audit A2: models needed by the delete guard + cascade.
    @InjectModel('users') private readonly userModel: Model<any>,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('bookings') private readonly availabilityBookingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookingLogModel: Model<any>,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /** express-paginate getArrayPages equivalent: sliding window of up to `limit` pages. */
  private buildPages(basePath: string, limit: number, pageCount: number, currentPage: number) {
    const pages = [];
    const maxPages = 10;
    let start = Math.max(1, currentPage - Math.floor(maxPages / 2));
    let end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) {
      pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });
    }
    return pages;
  }

  async list(query: any, basePath = '/admin/v2/administrators') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const keyword = query.q;
    const role = query.role;
    const rolesQuery = query.roles;
    const shouldGetProperties = query.getProperties;

    const where: any = {};
    if (keyword) {
      where.$or = [
        { name: new RegExp(keyword, 'i') },
        { email: new RegExp(keyword, 'i') },
        { legal_name: new RegExp(keyword, 'i') },
      ];
    }
    if (role) where.role = role;
    if (rolesQuery) where.role = { $in: rolesQuery.split(',') };

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    let [roles, administrators, itemCount] = await Promise.all([
      this.roleModel.find(),
      this.administratorModel
        .find(where)
        .select('+email')
        .sort(sort)
        .populate(resourcePopulations)
        .limit(limit)
        .skip(skip)
        .lean()
        .exec(),
      this.administratorModel.countDocuments(where),
    ]);

    if (shouldGetProperties) {
      administrators = await Promise.all(
        administrators.map(async (admin: any) => {
          admin.properties = await this.propertyModel
            .find({
              $or: [
                { allAdministrators: { $in: [admin._id] } },
                { administrator: admin._id },
              ],
            })
            .select('_id')
            .select('name');
          return admin;
        }),
      );
    } else {
      administrators = administrators.map((a: any) => {
        a.properties = [];
        return a;
      });
    }

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list: administrators,
      properties: [],
      roles,
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  async getMe(userId: string) {
    return this.administratorModel
      .findOne({ _id: userId })
      .select('+email')
      .populate(resourcePopulations)
      .lean()
      .exec();
  }

  async getById(id: string) {
    const resource: any = await this.administratorModel
      .findOne({ _id: id })
      .select('+email')
      .populate(resourcePopulations)
      .lean()
      .exec();
    if (!resource) {
      return { notFound: true };
    }
    resource.properties = await this.propertyModel
      .find({
        $or: [
          { allAdministrators: { $in: [resource._id] } },
          { administrator: resource._id },
        ],
      })
      .populate(propertiesPopulations);
    return resource;
  }

  async create(resourceData: any) {
    const password = generator.generate({ length: 10, numbers: true });
    resourceData.password = bcrypt.hashSync(password, 10);
    if (!resourceData.city) delete resourceData.city;
    if (!resourceData.country) delete resourceData.country;

    const resource = new this.administratorModel(resourceData);
    await resource.save();
    return resource;
  }

  async modify(id: string, resourceData: any) {
    if (!resourceData.city) delete resourceData.city;
    if (!resourceData.country) delete resourceData.country;

    return this.administratorModel
      .findOneAndUpdate({ _id: id }, { $set: resourceData }, { new: true })
      .select('+email')
      .populate(resourcePopulations)
      .exec();
  }

  /** audit A2: count active bookings (date_checkin >= now) across an admin's properties
   *  — legacy hoteladmins POST /check_active_bookings. */
  async checkActiveBookings(administratorId: string): Promise<{ status: number; count: number }> {
    let count = 0;
    if (administratorId) {
      const propertyIds = await this.findAdministratorPropertyIds(administratorId);
      if (propertyIds.length) {
        count = await this.userBookingModel.countDocuments({
          property: { $in: propertyIds },
          date_checkin: { $gte: new Date() },
        });
      }
    }
    return { status: 1, count };
  }

  private async findAdministratorPropertyIds(administratorId: string): Promise<any[]> {
    const properties = await this.propertyModel
      .find({
        $or: [
          { administrator: administratorId },
          { allAdministrators: { $in: [administratorId] } },
        ],
      })
      .select('_id')
      .lean();
    return properties.map((p: any) => p._id);
  }

  async remove(id: string) {
    // audit A2: legacy hoteladmins delete guard + cascade, re-added.
    // Refuse when any of the admin's properties has an active booking; otherwise
    // cascade-delete the properties, their rooms (+ availability bookings/bookinglogs)
    // and $pull the properties from users' favourites.
    const propertyIds = await this.findAdministratorPropertyIds(id);
    if (propertyIds.length) {
      const activeBookings = await this.userBookingModel.countDocuments({
        property: { $in: propertyIds },
        date_checkin: { $gte: new Date() },
      });
      if (activeBookings) {
        throw new HttpException(
          {
            status: 0,
            message: 'Administrator has properties with active bookings and cannot be deleted',
            count: activeBookings,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.userModel.updateMany(
        { favourites: { $in: propertyIds } },
        { $pull: { favourites: { $in: propertyIds } } },
      );
      // availability docs + logs carry `property`, so clean by property directly
      // (goes beyond legacy, which orphaned these).
      await this.availabilityBookingModel.deleteMany({ property: { $in: propertyIds } });
      await this.bookingLogModel.deleteMany({ property: { $in: propertyIds } });
      await this.roomModel.deleteMany({ property_id: { $in: propertyIds } });
      await this.propertyModel.deleteMany({ _id: { $in: propertyIds } });
    }
    return this.administratorModel.deleteOne({ _id: id }).exec();
  }

  /** service.sendWelcomeEmailToAdmin — resets password and emails welcome.html. */
  async sendWelcomeEmail(administratorId: string): Promise<{ status: number }> {
    try {
      const administrator = await this.administratorModel
        .findOne({ _id: administratorId })
        .select('+email')
        .select('+password')
        .exec();
      if (!administrator) return { status: 404 };

      const password = generator.generate({ length: 10, numbers: true });
      administrator.password = bcrypt.hashSync(password, 10);
      await administrator.save();

      await this.mailService.sendWelcome(administrator.email, password);
      return { status: 200 };
    } catch (e) {
      return { status: 500 };
    }
  }

  private async createOnboardingProperty(resourceData: any) {
    const administrator = await this.administratorModel.findOne({
      status: true,
      email: resourceData.email,
    });
    if (!administrator) return { status: 404 };

    const currencyAED = await this.currencyModel.findOne({
      name: new RegExp('dirham', 'i'),
    });
    const property = new this.propertyModel({
      name: resourceData.propertyName,
      location: resourceData.location,
      primaryReservationEmail: resourceData.email,
      administrator,
      allAdministrators: [administrator],
      currency: currencyAED ? currencyAED._id : '',
      contactinfo: { contact_person: resourceData.name, email: resourceData.email },
      status: false,
      source: 'Website',
    });
    await property.save();
    return { status: 200, property };
  }

  /** POST /administrators/onboarding (public). Returns a status object for the controller. */
  async onboarding(resourceData: any) {
    let resource: any;
    let sendEmail = true;

    const existing = await this.administratorModel
      .findOne({ email: resourceData.email })
      .select('+email')
      .select('+activationCode')
      .exec();

    if (existing) {
      if (existing.get('status') === false) {
        const code = Math.floor(Math.random() * 9000) + 1000;
        existing.set('activationCode', String(code));
        await existing.save();
        resource = existing;
      } else {
        sendEmail = false;
      }
    } else {
      let role = '';
      const code = Math.floor(Math.random() * 9000) + 1000;

      const hotelAdminRole = await this.roleModel.findOne({
        permissions: {
          $in: ['LIST_OWN_PROPERTIES', 'LIST_INVOICES'],
          $nin: ['LIST_ALL_PROPERTIES'],
        },
      });
      if (hotelAdminRole) role = hotelAdminRole._id;

      const passwordRaw = generator.generate({ length: 10, numbers: true });
      const password = bcrypt.hashSync(passwordRaw, 10);

      const administratorData: any = {
        name: resourceData.name,
        email: resourceData.email,
        password,
        activationCode: String(code),
        status: false,
      };
      if (role) administratorData.role = role;

      resource = new this.administratorModel(administratorData);
      await resource.save();
    }

    if (sendEmail) {
      await this.mailService.sendActivationCode(
        resource.email,
        String(resource.get('activationCode')),
      );
      return { ok: true, message: 'Email sent successfully!' };
    }
    return {
      ok: false,
      message: 'Sorry, the account with this email address is already active',
      messageCode: 'emailExists',
    };
  }

  /** POST /administrators/onboarding/verify (public). */
  async onboardingVerify(resourceData: any) {
    const existing = await this.administratorModel
      .findOne({ status: false, email: resourceData.email })
      .populate('role')
      .select('+email')
      .select('+password')
      .select('+activationCode')
      .exec();

    if (!existing) {
      return {
        ok: false,
        message:
          'Sorry, either the activation code is invalid, or the user is already activated',
      };
    }

    if (
      !resourceData.activationCode ||
      existing.get('activationCode') !== resourceData.activationCode
    ) {
      return { ok: false, message: 'Sorry, the activation code is invalid' };
    }

    existing.set('status', true);
    existing.set('activationCode', '');
    const autoLoginCode = Math.floor(Math.random() * 9000) + 1000;
    existing.set('autoLoginCode', String(autoLoginCode));
    await existing.save();

    await this.sendWelcomeEmail(existing._id.toString());
    const createPropertyResponse = await this.createOnboardingProperty(resourceData);
    const property =
      createPropertyResponse && createPropertyResponse.status === 200
        ? createPropertyResponse.property
        : '';

    let extranetPropertyUrl = '';
    if (property && property._id) {
      const queryParams = `loginEmail=${encodeURIComponent(
        existing.email,
      )}&loginToken=${autoLoginCode}`;
      extranetPropertyUrl = `${this.config.get('mail.extranetUrl')}app/properties/${property._id}?${queryParams}`;
    }

    return { ok: true, message: 'Activated', extranetPropertyUrl };
  }
}
