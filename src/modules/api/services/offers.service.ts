import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

export interface OffersResult {
  list: unknown[];
  count: number;
  page: number;
  totalPages: number;
}

/**
 * Verbatim port of `stayhopper/services/offers.js`. The envelope is a fixed single
 * page — legacy never paginated offers — so `page`/`totalPages` are always 1.
 */
@Injectable()
export class OffersService {
  constructor(@InjectModel('offers') private readonly offerModel: Model<any>) {}

  async getOffers(): Promise<OffersResult> {
    const offers = await this.offerModel
      .find({ enabled: true })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return {
      list: offers,
      count: offers.length,
      page: 1,
      totalPages: 1,
    };
  }
}
