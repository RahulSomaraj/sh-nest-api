import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

const resourcePopulations: any[] = [];

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel('userbookings')
    private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings')
    private readonly completedBookingModel: Model<any>,
    @InjectModel('countries') private readonly countryModel: Model<any>,
  ) {}

  /** express-paginate getArrayPages equivalent (sliding window, max 10 links). */
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

  /**
   * GET /users — mirrors legacy list(): aggregation with $lookup into userbookings +
   * completed_bookings, projecting a combined `bookings` count. Keyword filter on
   * name/email. Sort by order/orderBy (default _id asc).
   */
  async list(query: any, basePath = '/admin/v2/users') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const keyword = query.q;
    const where: any = {};
    if (keyword) {
      where.$or = [
        { name: new RegExp(keyword, 'i') },
        { email: new RegExp(keyword, 'i') },
      ];
    }

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const aggregateQuery: any[] = [
      { $match: where },
      {
        $lookup: {
          from: 'userbookings',
          localField: '_id',
          foreignField: 'user',
          as: 'userBookings',
        },
      },
      {
        $lookup: {
          from: 'completed_bookings',
          localField: '_id',
          foreignField: 'user',
          as: 'completedBookings',
        },
      },
      {
        $project: {
          _id: '$_id',
          name: 1,
          last_name: 1,
          email: 1,
          mobile: 1,
          city: 1,
          country: 1,
          promocodes: 1,
          image: 1,
          favourites: 1,
          status: 1,
          device_token: 1,
          device_type: 1,
          bookings: {
            $add: [{ $size: '$userBookings' }, { $size: '$completedBookings' }],
          },
        },
      },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
    ];

    const [countries, list, itemCount] = await Promise.all([
      this.countryModel.find({}),
      this.userModel.aggregate(aggregateQuery).exec(),
      this.userModel.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      countries,
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  /** Attaches aggregated booking totals/counts + booking lists, mirroring getExtraUserInformation. */
  private async getExtraUserInformation(user: any) {
    const userId = user._id;
    const [sum1, sum2, bookings, completedBookings] = await Promise.all([
      this.userBookingModel.aggregate([
        { $match: { user: new Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$user',
            totalAmount: { $sum: '$total_amt' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.completedBookingModel.aggregate([
        { $match: { user: new Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$user',
            totalAmount: { $sum: '$total_amt' },
            count: { $sum: 1 },
          },
        },
      ]),
      // audit A3: v2 inlined the user's ENTIRE booking history (unbounded heap/payload
      // growth). Bound the inlined arrays to the latest 100 each; the aggregate
      // totals/counts above still cover the full history.
      this.userBookingModel.find({ user: userId }).sort({ _id: -1 }).limit(100),
      this.completedBookingModel.find({ user: userId }).sort({ _id: -1 }).limit(100),
    ]);

    let totalBookingAmt = 0;
    let totalBookingCount = 0;
    let totalCompletedBookingAmt = 0;
    let totalCompletedBookingCount = 0;

    if (sum1.length > 0) {
      totalBookingAmt = sum1[0].totalAmount;
      totalBookingCount = sum1[0].count;
    }
    if (sum2.length > 0) {
      totalCompletedBookingAmt = sum2[0].totalAmount;
      totalCompletedBookingCount = sum2[0].count;
    }

    user.bookings = {
      amount: (totalBookingAmt || 0) + (totalCompletedBookingAmt || 0),
      count: (totalBookingCount || 0) + (totalCompletedBookingCount || 0),
      bookings,
      completedBookings,
    };

    return user;
  }

  /** GET /users/:id — returns { notFound: true } when missing (controller maps to 404). */
  async getById(id: string) {
    const resource: any = await this.userModel
      .findOne({ _id: id })
      .populate(resourcePopulations)
      .lean()
      .exec();

    if (!resource) {
      return { notFound: true };
    }
    return this.getExtraUserInformation(resource);
  }

  /** PUT /users/:id — findOneAndUpdate($set), then re-attach booking info. */
  async modify(id: string, resourceData: any) {
    let resource: any = await this.userModel
      .findOneAndUpdate({ _id: id }, { $set: resourceData }, { new: true })
      .populate(resourcePopulations)
      .exec();

    if (!resource) return null;
    resource = await this.getExtraUserInformation(resource);
    return resource;
  }

  /** DELETE /users/:id */
  async remove(id: string) {
    return this.userModel.deleteOne({ _id: id }).exec();
  }
}
