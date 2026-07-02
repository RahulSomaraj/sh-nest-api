import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRating, UserRatingDocument } from './schemas/user-rating.schema';

const resourcePopulations = [
  { path: 'property', select: 'name' },
  { path: 'user' },
];

@Injectable()
export class UserRatingsService {
  constructor(
    @InjectModel(UserRating.name)
    private readonly userRatingModel: Model<UserRatingDocument>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
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

  /**
   * GET /user-ratings.
   * Optimisation over legacy: legacy loaded the *entire* userratings collection into
   * memory and Array.splice()'d for pagination (heap risk). Here pagination is pushed
   * to the DB with skip/limit/lean. The one case the DB can't sort natively — orderBy
   * 'property' (a populated field) — is handled with an aggregation + $lookup so we
   * still only materialise one page.
   */
  async list(query: any, hasPropertiesAccess: boolean, basePath = '/admin/v2/user-ratings') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const where: any = {};
    if (query.property) where.property = query.property;
    // Legacy applied approved only when the param was a non-empty string.
    if (query.approved !== undefined && query.approved !== '') {
      where.approved = query.approved;
    }

    const isPropertySort = query.orderBy === 'property';
    const isAsc = query.order === 'asc';

    let list: any[];
    if (isPropertySort) {
      const dir = isAsc ? 1 : -1;
      list = await this.userRatingModel
        .aggregate([
          { $match: where },
          {
            $lookup: {
              from: 'properties',
              localField: 'property',
              foreignField: '_id',
              as: 'property',
            },
          },
          { $unwind: { path: '$property', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'user',
            },
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              _propSort: { $toLower: { $trim: { input: { $ifNull: ['$property.name', ''] } } } },
              property: { _id: '$property._id', name: '$property.name' },
            },
          },
          { $sort: { _propSort: dir, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _propSort: 0 } },
        ])
        .exec();
    } else {
      let sort: any = { _id: 1 };
      if (query.order && query.orderBy) {
        sort = {};
        sort[query.orderBy] = isAsc ? 1 : -1;
      }
      list = await this.userRatingModel
        .find(where)
        .sort(sort)
        .populate(resourcePopulations)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();
    }

    const [properties, itemCount] = await Promise.all([
      hasPropertiesAccess
        ? this.propertyModel.find({}).sort({ name: 1 }).select('_id name').lean().exec()
        : Promise.resolve([]),
      this.userRatingModel.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      itemCount,
      properties,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  /**
   * Recomputes property.user_rating as the rounded (1 dp) average of approved ratings.
   * Mirrors legacy updatePropertyRating.
   */
  private async updatePropertyRating(propertyId: any) {
    if (!propertyId) return;
    try {
      const ratings = await this.userRatingModel.aggregate([
        { $match: { property: new Types.ObjectId(propertyId), approved: true } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]);

      const userRating =
        ratings.length > 0 && ratings[0].count > 0
          ? Math.round((ratings[0].value / ratings[0].count) * 10) / 10
          : 0;

      await this.propertyModel
        .updateOne({ _id: propertyId }, { $set: { user_rating: userRating } })
        .exec();
    } catch (e) {
      // Match legacy: log and continue; ratings recompute is best-effort.
      // eslint-disable-next-line no-console
      console.log('error in updating property ratings', e);
    }
  }

  /** PUT /user-ratings/:id/approval/:status */
  async approval(id: string, status: string) {
    const resource: any = await this.userRatingModel
      .findOneAndUpdate({ _id: id }, { $set: { approved: status } }, { new: true })
      .populate(resourcePopulations)
      .exec();

    if (!resource) return null;

    const propId =
      resource.property && resource.property._id
        ? resource.property._id
        : resource.property;
    await this.updatePropertyRating(propId);
    return resource;
  }
}
