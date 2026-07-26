import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request, Response, NextFunction } from 'express';

/**
 * Country/timezone resolution for the customer surface, extended to `req` the same
 * way it is in Express.
 */
export interface CountryAwareRequest extends Request {
  country?: string;
  timezone?: string;
}

/**
 * Port of `stayhopper/middleware/countrySelection.js`, mounted on `/api` in
 * legacy `index.js:56`.
 *
 * Nothing upstream ever sets `req.country`, so in practice this always resolves to
 * the UAE country id and that document's timezone (falling back to `Asia/Dubai`).
 * The behaviour is kept as-is — the search/booking services read `req.timezone`.
 *
 * The country document is cached for the process lifetime: it is a single static
 * lookup row and legacy hit the DB on every customer request.
 */
@Injectable()
export class CountrySelectionMiddleware implements NestMiddleware {
  private cachedTimezone: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectModel('countries') private readonly countryModel: Model<any>,
  ) {}

  async use(req: CountryAwareRequest, _res: Response, next: NextFunction) {
    const fallback = this.config.get<string>('defaultTimezone');
    const usersCountry = req.country || this.config.get<string>('countryId.UAE');

    if (this.cachedTimezone === null) {
      const country = await this.countryModel
        .findOne({ _id: usersCountry })
        .lean()
        .exec()
        .catch(() => null);
      this.cachedTimezone = (country as any)?.timezone || fallback;
    }

    req.country = usersCountry;
    req.timezone = this.cachedTimezone;
    next();
  }
}
