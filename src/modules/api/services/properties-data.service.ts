import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import moment from 'moment-timezone';
import { CheckinService, StayDetailParams } from './checkin.service';
import { DateTimeService } from './date-time.service';
import { SearchService } from './search.service';
import {
  Charge,
  PriceSummary,
  PropertyDoc,
  RateForDate,
  RoomDoc,
  RoomRate,
  SearchOptions,
  SearchParams,
  SearchResult,
} from './pricing.types';
import { UserRating } from '../../user-ratings/schemas/user-rating.schema';

/** Hour keys treated as "early" (pre-standard-check-in) — legacy `properties.js:21`. */
export const EARLY_HOUR_KEYS = [
  'h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'h7', 'h8', 'h9', 'h10', 'h11', 'h12', 'h13',
];

/** Hour keys that start a standard day — legacy `properties.js:22`. */
export const STANDARD_START_HOUR_KEYS = ['h14', 'h15', 'h16', 'h17', 'h18'];

/**
 * Verbatim port of `stayhopper/services/properties.js`.
 *
 * This is the pricing engine behind the customer surface: it turns a stay request into
 * an aggregation over rooms, prices every room for every segment of the stay, and rolls
 * the cheapest room up to the property. The arithmetic and its ordering are reproduced
 * exactly — including the clamping cascade in `getRoomPriceForDates`, which decides what
 * a guest is charged. See CLAUDE.md § Migration rules: no refactors of this math without
 * a contract test proving identical output.
 */
@Injectable()
export class PropertiesDataService {
  private readonly logger = new Logger(PropertiesDataService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly checkinService: CheckinService,
    private readonly dateTimeService: DateTimeService,
    private readonly searchService: SearchService,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel(UserRating.name) private readonly userRatingModel: Model<any>,
    @InjectModel('currencies') private readonly currencyModel: Model<any>,
    @InjectModel('cities') private readonly cityModel: Model<any>,
    @InjectModel('propertytypes') private readonly propertyTypeModel: Model<any>,
    @InjectModel('propertyratings')
    private readonly propertyRatingModel: Model<any>,
    @InjectModel('room_types') private readonly roomTypeModel: Model<any>,
    @InjectModel('bed_types') private readonly bedTypeModel: Model<any>,
    @InjectModel('services') private readonly serviceModel: Model<any>,
  ) {}

  /** Average of the property's approved, non-zero user ratings. */
  async getPropertyRating(property: PropertyDoc): Promise<PropertyDoc> {
    const propertyUserRatings = (await this.userRatingModel
      .find({ approved: true, property: property._id, value: { $gt: 0 } })
      .lean()
      .exec()) as unknown as Array<{ value: number }>;

    const totalRatings = propertyUserRatings.reduce((a, b) => a + b.value, 0);
    const averageRating = totalRatings ? totalRatings / propertyUserRatings.length : 0;

    return { ...property, userRating: averageRating };
  }

  /**
   * M4 — average nightly rate for one city: hourly booking, 2 adults, 1 room, one
   * standard day (14:00 → next day 12:00).
   */
  async getAvgNightlyRateForCity(params: {
    cityId?: string;
    timezone?: string;
    numberAdults?: number | string;
    numberChildren?: number | string;
    numberRooms?: number | string;
  }): Promise<{ averagePrice: number; currency: unknown }> {
    const timezone = params.timezone;
    const checkinTimeMoment = moment()
      .tz(timezone)
      .set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    const checkoutTimeMoment = moment(checkinTimeMoment)
      .add(1, 'day')
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

    const currencyAED = await this.currencyModel.findOne({ code: 'AED' }).exec();

    const propertiesResult = await this.getProperties(
      {
        checkinDate: checkinTimeMoment.format('DD/MM/YYYY'),
        checkoutDate: checkoutTimeMoment.format('DD/MM/YYYY'),
        checkinTime: checkinTimeMoment.format('HH:mm'),
        checkoutTime: checkoutTimeMoment.format('HH:mm'),
        bookingType: 'hourly',
        cityId: params.cityId || '',
        numberAdults: parseInt(String(params.numberAdults), 10) || 2,
        numberChildren: parseInt(String(params.numberChildren), 10) || 0,
        numberRooms: parseInt(String(params.numberRooms), 10) || 1,
        timezone,
        isAllowGuestFilter: true,
      },
      { sort: 'price', orderBy: 'asc', limit: 200000 },
    );

    const totalPrices = propertiesResult.list.reduce(
      (a: number, property: PropertyDoc) => a + (property.priceSummary?.base.amount ?? 0),
      0,
    );
    return {
      // NaN when no property matched — legacy behaviour (0/0), preserved.
      averagePrice: parseInt(String(totalPrices / propertiesResult.list.length), 10),
      currency: currencyAED,
    };
  }

  /** M6/M10 — average nightly rate per city across a country. */
  async getAvgNightlyRateForCitiesOfACountry(params: {
    countryId?: string;
    timezone?: string;
    numberAdults?: number | string;
    numberChildren?: number | string;
    numberRooms?: number | string;
  }): Promise<{ list: unknown[]; query?: Record<string, unknown> }> {
    const timezone = params.timezone;
    const checkinTimeMoment = moment()
      .tz(timezone)
      .set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    const checkoutTimeMoment = moment(checkinTimeMoment)
      .add(1, 'day')
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

    const checkinTime = checkinTimeMoment.format('HH:mm');
    const checkoutTime = checkoutTimeMoment.format('HH:mm');
    const checkinDate = checkinTimeMoment.format('DD/MM/YYYY');
    const checkoutDate = checkoutTimeMoment.format('DD/MM/YYYY');
    const numberAdults = parseInt(String(params.numberAdults), 10) || 2;
    const numberChildren = parseInt(String(params.numberChildren), 10) || 0;
    const numberRooms = parseInt(String(params.numberRooms), 10) || 1;
    const countryId = params.countryId || '';
    const bookingType = 'hourly';

    const cities = await this.cityModel
      .find({ country: new Types.ObjectId(params.countryId) })
      .lean()
      .exec();
    const currencyAED = await this.currencyModel
      .findOne({ code: 'AED' })
      .lean()
      .exec();

    if (!cities || !cities.length) {
      return { list: [] };
    }

    const propertiesResult = await this.searchService.getProperties(
      {
        checkinDate,
        checkoutDate,
        checkinTime,
        checkoutTime,
        bookingType,
        countryId,
        numberAdults,
        numberChildren,
        numberRooms,
        timezone,
        isAllowGuestFilter: true,
      },
      { sort: 'price', orderBy: 'asc', limit: 200000 },
    );

    // Seed one accumulator per city…
    const cityPrices: Record<string, Record<string, unknown>> = {};
    for (const city of cities) {
      const key = city._id.toString();
      cityPrices[key] = cityPrices[key] || {
        count: 0,
        totalPrice: 0,
        averagePrice: 0,
        ...city,
        currency: currencyAED,
      };
    }

    // …fold each property's base price into its city…
    for (const property of propertiesResult.list) {
      const cityIdOfProperty = property.contactinfo?.city?._id?.toString();
      if (cityIdOfProperty && typeof cityPrices[cityIdOfProperty] === 'object') {
        const entry = cityPrices[cityIdOfProperty];
        entry.count = (entry.count as number) + 1;
        entry.totalPrice =
          (entry.totalPrice as number) + (property.priceSummary?.base.amount ?? 0);
      }
    }

    // …then average.
    for (const cityId of Object.keys(cityPrices)) {
      const entry = cityPrices[cityId];
      if (entry && entry.totalPrice && entry.count) {
        entry.averagePrice = parseInt(
          String((entry.totalPrice as number) / (entry.count as number)),
          10,
        );
      }
    }

    let cityPricesArr = Object.keys(cityPrices).map((cityId) => {
      const cityPriceDetails = JSON.parse(JSON.stringify(cityPrices[cityId]));
      delete cityPriceDetails.count;
      delete cityPriceDetails.totalPrice;
      delete cityPriceDetails.country;
      return cityPriceDetails;
    });

    // Cities with no priced property are dropped entirely.
    cityPricesArr = cityPricesArr.filter((city) => !!city.averagePrice);

    return {
      list: cityPricesArr,
      query: {
        checkinDate,
        checkoutDate,
        checkinTime,
        checkoutTime,
        numberAdults,
        numberChildren,
        numberRooms,
        bookingType,
      },
    };
  }

  /**
   * Full property search:
   * 1. split the stay into segments, 2. build + run the rooms aggregation,
   * 3. price every room, 4. attach user ratings, 5. sort, 6. echo the query back.
   */
  async getProperties(
    params: SearchParams = {},
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const location = params.location;
    const checkinDate = params.checkinDate;
    const checkoutDate = params.checkoutDate;
    const checkinTime = params.checkinTime;
    const checkoutTime = params.checkoutTime;
    const cityId = params.cityId;
    const countryId = params.countryId;
    const numberAdults = parseInt(String(params.numberAdults), 10) || 2;
    const numberChildren = parseInt(String(params.numberChildren), 10) || 0;
    const numberRooms = parseInt(String(params.numberRooms), 10) || 1;
    const properties = params.properties ? params.properties.split(',') : [];
    const rooms = params.rooms ? params.rooms.split(',') : [];
    const shouldGetPropertiesWithRates = true;
    const isTestingRates = !!params.isTestingRates;
    const timezone = params.timezone;
    const isAllowGuestFilter = params.isAllowGuestFilter;
    const priceMin = params.priceMin;
    const priceMax = params.priceMax;
    const propertyTypes = params.propertyTypes ? params.propertyTypes.split(',') : [];
    const propertyRatings = params.propertyRatings
      ? params.propertyRatings.split(',')
      : [];
    const roomTypes = params.roomTypes ? params.roomTypes.split(',') : [];
    const bedTypes = params.bedTypes ? params.bedTypes.split(',') : [];
    const amenities = params.amenities ? params.amenities.split(',') : [];
    const bookingType = params.bookingType || 'hourly';

    // 1. Hour distribution across the stay.
    const datesAndHoursParams = this.checkinService.getDatesAndHoursStayParams({
      checkinDate,
      checkinTime,
      checkoutDate,
      checkoutTime,
    });

    PropertiesDataService.mergeAdjacentFullDaySegments(datesAndHoursParams);

    // 2. Rooms aggregation (filters applied in-query where possible).
    const aggregateQuery = this.getAggregateQuery({
      shouldGetPropertiesWithRates,
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      datesAndHoursParams,
      cityId,
      countryId,
      location,
      numberAdults,
      numberChildren,
      numberRooms,
      isTestingRates,
      bookingType,
      properties,
      rooms,
      isAllowGuestFilter,
      propertyTypes,
      propertyRatings,
      roomTypes,
      bedTypes,
      amenities,
    });

    let list: PropertyDoc[] = await this.roomModel.aggregate(aggregateQuery).exec();

    // 3. Pricing (price filters can only be applied after the prices exist).
    list = await this.populatePropertiesPricing(list, {
      bookingType,
      datesAndHoursParams,
      priceMin,
      priceMax,
    });

    // 4. User ratings.
    list = await Promise.all(list.map((p) => this.getPropertyRating(p)));

    // 5. Sort. Distance sorting is meaningless without a location, so it is dropped.
    const limit = params.limit ? params.limit : options.limit;
    const sort = params.sort
      ? params.sort === 'distance' && !location
        ? ''
        : params.sort
      : options.sort
        ? options.sort === 'distance' && !location
          ? ''
          : options.sort
        : !location
          ? ''
          : 'distance';
    const orderBy = params.orderBy ? params.orderBy : options.orderBy;
    const page = params.page ? params.page : options.page ? options.page : 1;

    const sortedPaginatedResult = await this.sortAndPaginateProperties(
      list,
      page,
      sort,
      orderBy,
      limit,
    );
    const { count, totalPages } = sortedPaginatedResult;
    list = sortedPaginatedResult.list;

    // Attach the stay-duration labels. Properties that don't allow hourly booking are
    // re-labelled against the standard 14:00 → 12:00 window they will actually be sold at.
    const stayDuration = this.checkinService.getStayDuration({
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
    });
    for (const p of list) {
      if (!p.allowedHourlyBooking && (checkinTime !== '14:00' || checkoutTime !== '12:00')) {
        const newCheckOutDate = moment(`${checkinDate}`, 'DD/MM/YYYY')
          .add(1, 'days')
          .format('DD/MM/YYYY');
        p.stayDuration = this.checkinService.getStayDuration({
          checkinDate,
          checkoutDate: newCheckOutDate,
          checkinTime: '14:00',
          checkoutTime: '12:00',
        });
        p.timeDetails = {
          startDate: checkinDate.split('/').join('-'),
          endDate: newCheckOutDate.split('/').join('-'),
        };
      } else {
        p.stayDuration = stayDuration;
      }
    }

    const originalQuery: Record<string, unknown> = {
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      numberAdults,
      numberChildren,
      numberRooms,
      bookingType: bookingType || 'hourly',
    };
    if (cityId) originalQuery.cityId = cityId;
    if (countryId) originalQuery.countryId = countryId;
    if (properties && properties.length) originalQuery.properties = properties;

    return { list, count, page, totalPages, query: originalQuery };
  }

  /**
   * Coalesce adjacent `fullDay` segments so a stay that straddles midnight is priced as
   * one run of hours rather than two part-days, splitting at 14:00/12:00 where a standard
   * day would start. Mutates `datesAndHoursParams` in place, as legacy did.
   *
   * This block is the "NEW LOGIC" section of `properties.js:307-378`; it is intricate and
   * order-dependent, so it is reproduced branch for branch.
   */
  private static mergeAdjacentFullDaySegments(
    datesAndHoursParams: Array<StayDetailParams & { isChecked?: boolean }>,
  ): void {
    if (datesAndHoursParams.length < 2) return;

    if (datesAndHoursParams.length > 2) {
      if (
        datesAndHoursParams[0].rateType === 'fullDay' &&
        datesAndHoursParams[1].rateType === 'fullDay'
      ) {
        if (datesAndHoursParams[1].hours.indexOf('14:00') > 0) {
          datesAndHoursParams[0].hours = datesAndHoursParams[0].hours.concat(
            datesAndHoursParams[1].hours.slice(
              0,
              datesAndHoursParams[1].hours.indexOf('14:00'),
            ),
          );
          datesAndHoursParams[0].hoursKeys = datesAndHoursParams[0].hoursKeys.concat(
            datesAndHoursParams[1].hoursKeys.slice(
              0,
              datesAndHoursParams[1].hoursKeys.lastIndexOf('h14'),
            ),
          );
          datesAndHoursParams[1].hoursKeys.splice(
            0,
            datesAndHoursParams[1].hoursKeys.indexOf('h14'),
          );
          datesAndHoursParams[1].hours.splice(
            0,
            datesAndHoursParams[1].hours.indexOf('14:00'),
          );
        } else {
          datesAndHoursParams[0].hours = datesAndHoursParams[0].hours.concat(
            datesAndHoursParams[1].hours,
          );
          datesAndHoursParams[0].hoursKeys = datesAndHoursParams[0].hoursKeys.concat(
            datesAndHoursParams[1].hoursKeys,
          );
          datesAndHoursParams.splice(1, 1);
        }
        datesAndHoursParams[0].isChecked = true;
      }
      if (
        datesAndHoursParams[1] &&
        datesAndHoursParams[2] &&
        datesAndHoursParams[1].rateType === 'fullDay' &&
        datesAndHoursParams[2].rateType === 'fullDay'
      ) {
        datesAndHoursParams[1].hoursKeys = datesAndHoursParams[1].hoursKeys.concat(
          datesAndHoursParams[2].hoursKeys,
        );
        datesAndHoursParams[1].hours = datesAndHoursParams[1].hours.concat(
          datesAndHoursParams[2].hours,
        );
        datesAndHoursParams.splice(2, 1);
        datesAndHoursParams[1].isChecked = true;
      }
    } else if (
      datesAndHoursParams[0].rateType === 'fullDay' &&
      datesAndHoursParams[1].rateType === 'fullDay'
    ) {
      if (datesAndHoursParams[1].hours.indexOf('12:00') > 0) {
        datesAndHoursParams[0].hours = datesAndHoursParams[0].hours.concat(
          datesAndHoursParams[1].hours.slice(
            0,
            datesAndHoursParams[1].hours.indexOf('12:00'),
          ),
        );
        datesAndHoursParams[0].hoursKeys = datesAndHoursParams[0].hoursKeys.concat(
          datesAndHoursParams[1].hoursKeys.slice(
            0,
            datesAndHoursParams[1].hoursKeys.lastIndexOf('h12'),
          ),
        );
        datesAndHoursParams[1].hoursKeys.splice(
          0,
          datesAndHoursParams[1].hoursKeys.indexOf('h12'),
        );
        datesAndHoursParams[1].hours.splice(
          0,
          datesAndHoursParams[1].hours.indexOf('12:00'),
        );
      } else {
        if (datesAndHoursParams[0].hours.indexOf('14:00') > 0) {
          // Move the 14:00-onwards tail of day 1 onto day 2 so day 2 starts standard.
          const modifiedHoursSectionOne = datesAndHoursParams[0].hours.slice(
            0,
            datesAndHoursParams[0].hours.indexOf('14:00'),
          );
          const modifiedHoursKeySectionOne = datesAndHoursParams[0].hoursKeys.slice(
            0,
            datesAndHoursParams[0].hoursKeys.indexOf('h14'),
          );
          datesAndHoursParams[1].hours = datesAndHoursParams[0].hours
            .slice(datesAndHoursParams[0].hours.indexOf('14:00'))
            .concat(datesAndHoursParams[1].hours);
          datesAndHoursParams[1].hoursKeys = datesAndHoursParams[0].hoursKeys
            .slice(datesAndHoursParams[0].hoursKeys.indexOf('h14'))
            .concat(datesAndHoursParams[1].hoursKeys);
          datesAndHoursParams[0].hours = modifiedHoursSectionOne;
          datesAndHoursParams[0].hoursKeys = modifiedHoursKeySectionOne;
        } else {
          datesAndHoursParams[0].hours = datesAndHoursParams[0].hours.concat(
            datesAndHoursParams[1].hours,
          );
          datesAndHoursParams[0].hoursKeys = datesAndHoursParams[0].hoursKeys.concat(
            datesAndHoursParams[1].hoursKeys,
          );
          datesAndHoursParams.splice(1, 1);
        }
        if (datesAndHoursParams[1]) {
          datesAndHoursParams[1].isChecked = true;
        }
      }
      datesAndHoursParams[0].isChecked = true;
    }

    // Finally, fold the last two segments together if neither has been merged yet.
    const last = datesAndHoursParams[datesAndHoursParams.length - 1];
    const secondLast = datesAndHoursParams[datesAndHoursParams.length - 2];
    if (
      last &&
      secondLast &&
      last.rateType === 'fullDay' &&
      secondLast.rateType === 'fullDay' &&
      !last.isChecked
    ) {
      secondLast.hours = secondLast.hours.concat(last.hours);
      secondLast.hoursKeys = secondLast.hoursKeys.concat(last.hoursKeys);
      secondLast.isChecked = true;
      datesAndHoursParams.pop();
    }
  }

  /**
   * Sort the result set. Sold-out properties are pulled out, the rest are sorted, then
   * the sold-out ones are appended so they always rank last.
   *
   * NOTE: despite the name, this does NOT paginate — legacy commented the `splice` out,
   * so the full list is returned and only `totalPages` reflects `limit`. Callers (and
   * sh-website) depend on receiving everything.
   */
  async sortAndPaginateProperties(
    list: PropertyDoc[],
    page?: number,
    sort?: string,
    orderBy?: string,
    limit?: number,
  ): Promise<{ list: PropertyDoc[]; count: number; totalPages: number }> {
    const count = list.length;
    const pageSize = parseInt(
      String(this.config.get<number>('pageSize.searchProperties')),
      10,
    );
    const effectiveLimit = limit || pageSize;
    const effectiveSort = sort || 'price';
    const effectiveOrderBy = orderBy || 'asc';
    const totalPages = Math.ceil(count / effectiveLimit);

    const soldOutedProperties = list.filter(
      (p) => (p.numberOfRoomsAvailable ?? 0) <= 0,
    );
    let sorted = list.filter((p) => (p.numberOfRoomsAvailable ?? 0) > 0);

    switch (effectiveSort) {
      case 'userRating':
        sorted = sorted.sort((a, b) =>
          effectiveOrderBy === 'asc'
            ? (a.userRating ?? 0) - (b.userRating ?? 0)
            : (b.userRating ?? 0) - (a.userRating ?? 0),
        );
        break;
      case 'distance':
        sorted = sorted.sort((a, b) =>
          effectiveOrderBy === 'asc'
            ? (a.distance ?? 0) - (b.distance ?? 0)
            : (b.distance ?? 0) - (a.distance ?? 0),
        );
        break;
      case 'price':
      default:
        sorted = sorted.sort((a, b) =>
          effectiveOrderBy === 'asc'
            ? (a.priceSummary?.base.amount ?? 0) - (b.priceSummary?.base.amount ?? 0)
            : (b.priceSummary?.base.amount ?? 0) - (a.priceSummary?.base.amount ?? 0),
        );
        break;
    }

    return {
      list: [...sorted, ...soldOutedProperties],
      count,
      totalPages,
    };
  }

  /** M9/M13 — highest-rated properties available for the next minimum-length booking. */
  async getPopularProperties(params: {
    timezone?: string;
    cityId?: string;
    countryId?: string;
    numberAdults?: number | string;
    numberChildren?: number | string;
    numberRooms?: number | string;
  } = {}): Promise<SearchResult> {
    // NOTE (legacy parity): reads `config.pageSize.popularPropertiesPageSize`, which does
    // not exist (the key is `popularProperties`), so the limit is undefined and
    // `sortAndPaginateProperties` falls back to the search page size. Since that method
    // does not actually slice, the only observable effect is on `totalPages`. Kept as-is.
    const popularPropertiesPageSize = this.config.get<number>(
      'pageSize.popularPropertiesPageSize',
    );
    const numberOfHours = this.config.get<number>('minNumberOfBookingHours');
    const timezone = params.timezone;
    const checkinTimeMoment = this.dateTimeService.getNearestCheckinTimeMoment(timezone);
    const checkoutTimeMoment = moment(checkinTimeMoment).add(numberOfHours, 'hours');

    return this.searchService.getProperties(
      {
        checkinDate: checkinTimeMoment.format('DD/MM/YYYY'),
        checkoutDate: checkoutTimeMoment.format('DD/MM/YYYY'),
        checkinTime: checkinTimeMoment.format('HH:mm'),
        checkoutTime: checkoutTimeMoment.format('HH:mm'),
        bookingType: 'hourly',
        cityId: params.cityId || '',
        countryId: params.countryId || '',
        numberAdults: params.numberAdults || 2,
        numberChildren: params.numberChildren || 0,
        numberRooms: params.numberRooms || 1,
        timezone,
        isAllowGuestFilter: true,
      },
      { sort: 'userRating', orderBy: 'desc', limit: popularPropertiesPageSize },
    );
  }

  /** M8/M12 — cheapest properties available for the next minimum-length booking. */
  async getCheapestProperties(params: {
    timezone?: string;
    cityId?: string;
    countryId?: string;
    numberAdults?: number | string;
    numberChildren?: number | string;
    numberRooms?: number | string;
  } = {}): Promise<SearchResult> {
    const cheapestPropertiesPageSize = this.config.get<number>(
      'pageSize.cheapestProperties',
    );
    const numberOfHours = this.config.get<number>('minNumberOfBookingHours');
    const timezone = params.timezone;
    const checkinTimeMoment = this.dateTimeService.getNearestCheckinTimeMoment(timezone);
    const checkoutTimeMoment = moment(checkinTimeMoment).add(numberOfHours, 'hours');

    return this.searchService.getProperties(
      {
        checkinDate: checkinTimeMoment.format('DD/MM/YYYY'),
        checkoutDate: checkoutTimeMoment.format('DD/MM/YYYY'),
        checkinTime: checkinTimeMoment.format('HH:mm'),
        checkoutTime: checkoutTimeMoment.format('HH:mm'),
        bookingType: 'hourly',
        cityId: params.cityId || '',
        countryId: params.countryId || '',
        numberAdults: parseInt(String(params.numberAdults), 10) || 2,
        numberChildren: parseInt(String(params.numberChildren), 10) || 0,
        numberRooms: parseInt(String(params.numberRooms), 10) || 1,
        timezone,
        isAllowGuestFilter: true,
      },
      { sort: 'price', orderBy: 'asc', limit: cheapestPropertiesPageSize },
    );
  }

  /**
   * Price one room across every segment of the stay and attach `room.priceSummary`.
   *
   * The rate for a segment comes from the first matching custom rate (earliest `dateFrom`
   * wins, recurring rates checked across 10 years) or the default rate. `fullDay` segments
   * are priced per half-hour — each hour key covers two slots, so its rate is halved —
   * and then clamped so an hourly stay never costs more than the standard-day rate and
   * never less than the property's minimum booking rate.
   */
  async getRoomPriceForDates(
    room: RoomDoc,
    bookingType: string,
    datesAndHoursParams: StayDetailParams[],
  ): Promise<RoomDoc> {
    const property = room.property as PropertyDoc;
    const maxRecurringYears = 10;

    if (!room || !room.rates || !room.rates.length) {
      room.priceSummary = {};
      return room;
    }

    const defaultRoomPriceForBookingType = room.rates.find(
      (rr) => rr.isDefault && rr.rateType === bookingType,
    );
    // Earlier-starting custom rates win: a 4–6 Oct rate beats a 5 Oct rate.
    const otherRoomRatesForBookingType = room.rates
      .filter((rr) => !rr.isDefault && rr.rateType === bookingType)
      .sort((a, b) => {
        const aDateFrom = new Date(a.dateFrom).getTime();
        const bDateFrom = new Date(b.dateFrom).getTime();
        if (aDateFrom < bDateFrom) return -1;
        if (aDateFrom > bDateFrom) return 1;
        return 0;
      });

    const getRateForTheDateParams = (
      dateParams: StayDetailParams,
      weekends: string[] = [],
    ): RateForDate => {
      let customRate: RoomRate | null = null;
      const { date, rateType, hoursKeys } = dateParams;
      const targetDateMoment = moment(date, 'DD/MM/YYYY');
      const dateWeekdayName = targetDateMoment.format('ddd').toLowerCase();
      const weekendOrWeekday =
        weekends.indexOf(dateWeekdayName) > -1 ? 'weekend' : 'weekday';

      for (const roomRate of otherRoomRatesForBookingType) {
        if (customRate) break;
        const customRateDateFromMoment = moment(roomRate.dateFrom, 'DD/MM/YYYY');
        const customRateDateToMoment = moment(roomRate.dateTo, 'DD/MM/YYYY').add(
          1,
          'days',
        );
        if (roomRate.recurring) {
          // A recurring range repeats yearly; look ahead maxRecurringYears occurrences.
          for (let i = 0; i <= maxRecurringYears; i++) {
            if (customRate) break;
            const currentYearDateFromMoment = moment(customRateDateFromMoment).add(
              i,
              'years',
            );
            const currentYearDateToMoment = moment(customRateDateToMoment).add(i, 'years');
            if (
              targetDateMoment.isSameOrAfter(currentYearDateFromMoment) &&
              targetDateMoment.isSameOrBefore(currentYearDateToMoment)
            ) {
              customRate = roomRate;
            }
          }
        } else if (
          targetDateMoment.isSameOrAfter(customRateDateFromMoment) &&
          targetDateMoment.isSameOrBefore(customRateDateToMoment)
        ) {
          customRate = roomRate;
        }
      }

      let minBookingRateForFullDay: number | null = null;
      const activeRate = customRate || defaultRoomPriceForBookingType;
      const roomRateInfo = activeRate?.[weekendOrWeekday] as {
        standardDay?: number;
        hours?: Record<string, number>;
      };
      if (activeRate?.minimumBookingRate && rateType === 'fullDay') {
        minBookingRateForFullDay = activeRate.minimumBookingRate;
      }

      // A property without any-time check-in can only ever be sold as a standard day.
      if (!property.anyTimeCheckin) {
        return { rate: roomRateInfo.standardDay };
      }
      if (rateType === 'standardDay') {
        return { rate: roomRateInfo[rateType] as number };
      }
      if (rateType === 'fullDay') {
        // Each hour key spans two 30-minute slots, so every slot costs half the hour rate:
        // keys ['h10','h10','h11'] with {h10:12, h11:15} => 6 + 6 + 7.5 = 19.5
        let minimumBookingHourRate = 0;
        const hoursAndPrices: Array<{ hour: string; price: number }> = [];
        const minSlots =
          parseInt(String(this.config.get<number>('minNumberOfBookingHours')), 10) * 2 - 1;

        let rate = hoursKeys.reduce((a, b, index) => {
          hoursAndPrices.push({ hour: b, price: roomRateInfo.hours[b] / 2 });
          if (index === minSlots) {
            minimumBookingHourRate = a + roomRateInfo.hours[b] / 2;
          }
          return a + roomRateInfo.hours[b] / 2;
        }, 0);

        // Hourly can never exceed the standard-day price.
        if (rate > roomRateInfo.standardDay) {
          rate = roomRateInfo.standardDay;
        }

        return {
          minimumBookingRate: minBookingRateForFullDay,
          rate,
          minimumBookingHourRate,
          hoursAndPrices,
          standardRate: roomRateInfo.standardDay,
        };
      }

      this.logger.warn(
        'Unsupported rateType encountered while pricing a room; charging 0',
      );
      return { rate: 0 };
    };

    const minimumBookingRates: number[] = [];
    const standardRates: number[] = [];
    let hoursAndPricesList: Array<{ hour: string; price: number }> = [];
    const isExistStandardDay =
      datesAndHoursParams.filter((d) => d.rateType === 'standardDay').length > 0;

    const base: { label: string; amount: number; savings?: number } = {
      label: 'Base Price',
      amount: parseFloat(
        String(
          datesAndHoursParams.reduce((accumulator, dateParams) => {
            const resolved = getRateForTheDateParams(dateParams, property.weekends);
            const {
              minimumBookingRate,
              minimumBookingHourRate,
              hoursAndPrices,
              standardRate,
            } = resolved;
            let rate = resolved.rate;

            // Pure-hourly stays are lifted to the minimum booking rate, but never past
            // the standard-day rate.
            if (!isExistStandardDay) {
              if (rate < standardRate) {
                if (rate < minimumBookingRate) {
                  rate =
                    rate > minimumBookingHourRate
                      ? parseFloat(
                          String(rate - minimumBookingHourRate + minimumBookingRate),
                        )
                      : minimumBookingRate;
                  if (rate >= standardRate) rate = standardRate;
                } else if (minimumBookingHourRate < minimumBookingRate) {
                  rate = parseFloat(
                    String(minimumBookingRate + rate - minimumBookingHourRate),
                  );
                  if (rate >= standardRate) rate = standardRate;
                }
              } else if (rate === standardRate) {
                rate = parseInt(String(rate), 10);
              } else if (rate >= standardRate) {
                rate = standardRate;
              }
            }

            if (minimumBookingRate) minimumBookingRates.push(minimumBookingRate);
            if (standardRate) standardRates.push(standardRate);
            hoursAndPricesList = hoursAndPricesList.concat(hoursAndPrices ?? []);
            return accumulator + rate;
          }, 0),
        ),
      ),
    };

    base.amount = parseInt(String(base.amount), 10);

    // Savings: what the same stay would have cost billed as standard days.
    if (datesAndHoursParams.find((dh) => dh.rateType === 'fullDay')) {
      const normalBookingDatesAndHoursParams: StayDetailParams[] = JSON.parse(
        JSON.stringify(datesAndHoursParams),
      ).map((dh: StayDetailParams) => {
        dh.rateType = 'standardDay';
        dh.hours = [];
        return dh;
      });

      const normalRate = parseInt(
        String(
          normalBookingDatesAndHoursParams.reduce((accumulator, dateParams) => {
            const { rate } = getRateForTheDateParams(dateParams, property.weekends);
            return accumulator + rate;
          }, 0),
        ),
        10,
      );
      if (normalRate > 0 && normalRate > base.amount) {
        base.savings = normalRate - base.amount;
      }
    }

    // Booking fee: the platform's per-country, per-booking-type cut.
    const bookingFee: { label: string; currency: unknown; amount: number } = {
      label: 'Booking fee',
      currency: '',
      amount: 0,
    };
    const bookingFeeTable = this.config.get<
      Record<string, Array<{ bookingType: string; fee: number }>>
    >('bookingFee');
    const countryKey = property.contactinfo?.country?._id
      ? String(property.contactinfo.country._id)
      : '';
    if (countryKey && bookingFeeTable && bookingFeeTable[countryKey]) {
      const bookingFeeForCountry = bookingFeeTable[countryKey].find(
        (bf) => bf.bookingType === bookingType,
      );
      bookingFee.amount = bookingFeeForCountry.fee;
      bookingFee.currency = property.currency;
    }

    const taxes: {
      label: string;
      breakdown: Array<{ label: string; amount: number }>;
      amount: number;
    } = { label: 'Taxes', breakdown: [], amount: 0 };

    for (const tax of property.charges ?? []) {
      const taxAmount = this.getCalculatedTax(tax, base.amount);
      taxes.breakdown.push({ label: tax.name, amount: taxAmount });
      taxes.amount += taxAmount;
    }

    room.priceSummary = {
      base,
      taxes,
      bookingFee,
      total: {
        label: 'Total Amount',
        amount: base.amount + bookingFee.amount,
      },
      payNow: {
        label: 'Now you pay',
        currency: bookingFee.currency,
        // Hourly guests pay only the booking fee up front, the rest at the hotel.
        amount:
          bookingType === 'hourly' ? bookingFee.amount : base.amount + bookingFee.amount,
      },
      payAtHotel: {
        label: 'Pay at the hotel',
        amount: bookingType === 'hourly' ? base.amount : 0,
      },
    };
    return room;
  }

  /**
   * Build the rooms aggregation: populate the property and lookup tables, apply the
   * property/room filters, group rooms per property, then subtract booked room numbers
   * from inventory to derive availability and guest capacity.
   */
  getAggregateQuery(params: {
    shouldGetPropertiesWithRates: boolean;
    checkinDate: string;
    checkoutDate: string;
    checkinTime: string;
    checkoutTime: string;
    datesAndHoursParams: StayDetailParams[];
    cityId?: string;
    countryId?: string;
    location?: string;
    numberAdults: number;
    numberChildren: number;
    numberRooms: number;
    isTestingRates?: boolean;
    bookingType: string;
    properties: string[];
    rooms: string[];
    isAllowGuestFilter?: boolean;
    propertyTypes: string[];
    propertyRatings: string[];
    roomTypes: string[];
    bedTypes: string[];
    amenities: string[];
  }): PipelineStage[] {
    const {
      shouldGetPropertiesWithRates,
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      datesAndHoursParams,
      cityId,
      countryId,
      location,
      numberAdults,
      numberChildren,
      numberRooms,
      isTestingRates,
      bookingType,
      properties,
      rooms,
      isAllowGuestFilter,
      propertyTypes,
      propertyRatings,
      roomTypes,
      bedTypes,
      amenities,
    } = params;

    const fullCheckinDate = moment(
      `${checkinDate} ${checkinTime}`,
      'DD/MM/YYYY HH:mm',
    ).toDate();
    const fullCheckoutDate = moment(
      `${checkoutDate} ${checkoutTime}`,
      'DD/MM/YYYY HH:mm',
    ).toDate();

    const propertiesQuery: { $and: Record<string, unknown>[] } = { $and: [] };

    // When a hotel/admin is previewing rates, the publication gates are skipped so they
    // can see prices for a property that is not live yet.
    if (!isTestingRates) {
      propertiesQuery.$and.push({ 'property.approved': true });
      propertiesQuery.$and.push({ 'property.published': true });
      propertiesQuery.$and.push({ 'property.agreement': { $exists: true } });
      propertiesQuery.$and.push({ 'property.agreement.isAgreementSigned': true });
    }

    propertiesQuery.$and.push({ 'property.currency': { $exists: true } });

    // A non-standard stay can only be served by properties that allow any-time check-in.
    if (datesAndHoursParams.find((dh) => dh.rateType === 'fullDay')) {
      propertiesQuery.$and.push({ 'property.anyTimeCheckin': true });
    }

    if (countryId) {
      propertiesQuery.$and.push({
        'property.contactinfo.country._id': new Types.ObjectId(countryId),
      });
    }
    if (cityId) {
      propertiesQuery.$and.push({
        'property.contactinfo.city._id': new Types.ObjectId(cityId),
      });
    }
    if (properties && properties.length) {
      propertiesQuery.$and.push({
        'property._id': { $in: properties.map((p) => new Types.ObjectId(p)) },
      });
    }
    if (propertyTypes && propertyTypes.length) {
      const propertyTypesIds = propertyTypes
        .filter((id) => !!id)
        .map((id) => new Types.ObjectId(id));
      if (propertyTypesIds.length) {
        propertiesQuery.$and.push({ 'property.type._id': { $in: propertyTypesIds } });
      }
    }
    if (propertyRatings && propertyRatings.length) {
      const propertyStarRatingsIds = propertyRatings
        .filter((id) => !!id)
        .map((id) => new Types.ObjectId(id));
      if (propertyStarRatingsIds.length) {
        propertiesQuery.$and.push({
          'property.rating._id': { $in: propertyStarRatingsIds },
        });
      }
    }

    const roomsQuery: { $and: Record<string, unknown>[] } = { $and: [] };

    if (shouldGetPropertiesWithRates) {
      roomsQuery.$and.push({ 'rates.0': { $exists: true } });
      roomsQuery.$and.push({ rates: { $elemMatch: { rateType: bookingType } } });
    }
    for (const [ids, path] of [
      [roomTypes, 'room_type._id'],
      [bedTypes, 'bed_type._id'],
      [amenities, 'services._id'],
    ] as Array<[string[], string]>) {
      if (ids && ids.length) {
        const objectIds = ids.filter((id) => !!id).map((id) => new Types.ObjectId(id));
        if (objectIds.length) {
          roomsQuery.$and.push({ [path]: { $in: objectIds } });
        }
      }
    }
    if (rooms && rooms.length) {
      roomsQuery.$and.push({
        _id: { $in: rooms.filter((id) => !!id).map((id) => new Types.ObjectId(id)) },
      });
    }

    let propertyPipeline: Record<string, unknown>[] = [
      { $match: { $expr: { $eq: ['$_id', '$$roomPropertyId'] } } },
    ];

    // With a location, restrict to properties within 40 km and expose the distance.
    if (location) {
      const latLng = location.split(',');
      const lat = latLng[0].trim();
      const lng = latLng[1].trim();
      propertyPipeline = [
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
            key: 'location',
            spherical: true,
            distanceMultiplier: 0.001,
            distanceField: 'distance',
          },
        },
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$_id', '$$roomPropertyId'] },
                { $lte: ['$distance', 40] },
              ],
            },
          },
        },
      ];
    }

    const propertyPopulations: PipelineStage[] = [
      {
        $lookup: {
          from: 'properties',
          let: { roomPropertyId: '$property_id' },
          pipeline: propertyPipeline,
          as: 'property',
        },
      },
      { $unwind: '$property' },
      {
        $lookup: {
          from: 'currencies',
          localField: 'property.currency',
          foreignField: '_id',
          as: 'property.currency',
        },
      },
      { $unwind: '$property.currency' },
      {
        $lookup: {
          from: 'property_ratings',
          localField: 'property.rating',
          foreignField: '_id',
          as: 'property.rating',
        },
      },
      { $unwind: '$property.rating' },
      {
        $lookup: {
          from: 'countries',
          localField: 'property.contactinfo.country',
          foreignField: '_id',
          as: 'property.contactinfo.country',
        },
      },
      { $unwind: '$property.contactinfo.country' },
      {
        $lookup: {
          from: 'cities',
          localField: 'property.contactinfo.city',
          foreignField: '_id',
          as: 'property.contactinfo.city',
        },
      },
      { $unwind: '$property.contactinfo.city' },
      {
        $lookup: {
          from: 'property_types',
          localField: 'property.type',
          foreignField: '_id',
          as: 'property.type',
        },
      },
      { $unwind: '$property.type' },
    ] as PipelineStage[];

    const roomPopulations: PipelineStage[] = [
      {
        $lookup: {
          from: 'guest_numbers',
          localField: 'number_of_guests',
          foreignField: '_id',
          as: 'number_of_guests',
        },
      },
      { $unwind: '$number_of_guests' },
      {
        $lookup: {
          from: 'room_types',
          localField: 'room_type',
          foreignField: '_id',
          as: 'room_type',
        },
      },
      { $unwind: '$room_type' },
      {
        $lookup: {
          from: 'room_names',
          localField: 'room_name',
          foreignField: '_id',
          as: 'room_name',
        },
      },
      { $unwind: '$room_name' },
      {
        $lookup: {
          from: 'bed_types',
          localField: 'bed_type',
          foreignField: '_id',
          as: 'bed_type',
        },
      },
      { $unwind: '$bed_type' },
      {
        $lookup: {
          from: 'services',
          localField: 'services',
          foreignField: '_id',
          as: 'services',
        },
      },
    ] as PipelineStage[];

    const projectionAndGrouping: PipelineStage[] = [
      {
        $project: {
          images: 1,
          featured: 1,
          rates: 1,
          room_type: 1,
          number_rooms: 1,
          room_name: 1,
          custom_name: 1,
          bed_type: 1,
          services: 1,
          number_of_guests: 1,
          room_size: 1,
          agreement: 1,
          property: {
            _id: 1,
            name: 1,
            description: 1,
            distance: 1,
            location: 1,
            images: 1,
            featured: 1,
            currency: 1,
            contactinfo: 1,
            charges: 1,
            rating: 1,
            type: 1,
            weekends: 1,
            anyTimeCheckin: 1,
            agreement: 1,
          },
        },
      },
      {
        $group: {
          _id: '$property._id',
          property: { $first: '$property' },
          rooms: { $push: '$$ROOT' },
        },
      },
      {
        $replaceRoot: {
          newRoot: { $mergeObjects: ['$property', { rooms: '$rooms' }] },
        },
      },
    ] as PipelineStage[];

    // Availability: for each room, count the distinct room numbers blocked by booking
    // logs overlapping the stay, subtract from inventory, and derive guest capacity.
    const stockInformation: PipelineStage[] = [
      { $unwind: '$rooms' },
      {
        $lookup: {
          from: 'bookinglogs',
          let: { roomId: '$rooms._id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $gte: ['$slotStartTime', fullCheckinDate] },
                    { $lt: ['$slotStartTime', fullCheckoutDate] },
                    { $eq: ['$room', '$$roomId'] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: { property: '$property', room: '$room' },
                property: { $first: '$property' },
                room: { $first: '$room' },
                blockedRoomNumbers: { $addToSet: '$number' },
              },
            },
            {
              $lookup: {
                from: 'rooms',
                let: { roomId: '$room' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$_id', '$$roomId'] } } },
                  {
                    $lookup: {
                      from: 'guest_numbers',
                      localField: 'number_of_guests',
                      foreignField: '_id',
                      as: 'number_of_guests',
                    },
                  },
                  { $unwind: '$number_of_guests' },
                ],
                as: 'room',
              },
            },
            { $unwind: '$room' },
            {
              $project: {
                room: 1,
                _id: '$room._id',
                blockedRoomNumbers: 1,
                numberOfRoomsInventory: '$room.number_rooms',
                numberOfRoomsBlocked: { $size: '$blockedRoomNumbers' },
              },
            },
            {
              $project: {
                room: 1,
                blockedRoomNumbers: 1,
                numberOfRoomsInventory: 1,
                numberOfRoomsBlocked: 1,
                numberOfRoomsAvailable: {
                  $subtract: ['$numberOfRoomsInventory', '$numberOfRoomsBlocked'],
                },
              },
            },
            {
              $project: {
                blockedRoomNumbers: 1,
                numberOfRoomsInventory: 1,
                numberOfRoomsBlocked: 1,
                numberOfRoomsAvailable: 1,
                adultsCapacity: {
                  $multiply: [
                    { $toInt: '$numberOfRoomsAvailable' },
                    { $ifNull: [{ $toInt: '$room.number_of_guests.value' }, 0] },
                  ],
                },
                childrenCapacity: {
                  $multiply: [
                    { $toInt: '$numberOfRoomsAvailable' },
                    { $ifNull: [{ $toInt: '$room.number_of_guests.childrenValue' }, 0] },
                  ],
                },
              },
            },
          ],
          as: 'stock',
        },
      },
      { $unwind: { path: '$stock', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: '$_id',
          name: 1,
          description: 1,
          distance: 1,
          location: 1,
          images: 1,
          featured: 1,
          currency: 1,
          contactinfo: 1,
          charges: 1,
          rating: 1,
          type: 1,
          weekends: 1,
          anyTimeCheckin: 1,
          rooms: 1,
          agreement: 1,
          // No booking logs for this room => nothing blocked => full inventory available.
          stock: {
            $ifNull: [
              '$stock',
              {
                numberOfRoomsAvailable: '$rooms.number_rooms',
                adultsCapacity: {
                  $multiply: [
                    { $toInt: '$rooms.number_rooms' },
                    { $ifNull: [{ $toInt: '$rooms.number_of_guests.value' }, 0] },
                  ],
                },
                childrenCapacity: {
                  $multiply: [
                    { $toInt: '$rooms.number_rooms' },
                    { $ifNull: [{ $toInt: '$rooms.number_of_guests.childrenValue' }, 0] },
                  ],
                },
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$_id',
          name: { $first: '$name' },
          agreement: { $first: '$agreement' },
          description: { $first: '$description' },
          distance: { $first: '$distance' },
          location: { $first: '$location' },
          images: { $first: '$images' },
          featured: { $first: '$featured' },
          currency: { $first: '$currency' },
          contactinfo: { $first: '$contactinfo' },
          charges: { $first: '$charges' },
          rating: { $first: '$rating' },
          type: { $first: '$type' },
          weekends: { $first: '$weekends' },
          anyTimeCheckin: { $first: '$anyTimeCheckin' },
          numberOfRoomsAvailable: { $sum: '$stock.numberOfRoomsAvailable' },
          adultsCapacity: { $sum: '$stock.adultsCapacity' },
          childrenCapacity: { $sum: '$stock.childrenCapacity' },
          rooms: { $push: { $mergeObjects: ['$rooms', '$stock'] } },
        },
      },
    ] as PipelineStage[];

    const guestsFiltering: PipelineStage[] = [
      {
        $match: {
          $and: [
            { numberOfRoomsAvailable: { $gte: numberRooms } },
            { adultsCapacity: { $gte: numberAdults } },
            { childrenCapacity: { $gte: numberChildren } },
          ],
        },
      },
    ];

    const roomsAggregateQuery: PipelineStage[] = [
      ...propertyPopulations,
      ...roomPopulations,
      { $match: propertiesQuery } as PipelineStage,
      { $match: roomsQuery } as PipelineStage,
      ...projectionAndGrouping,
      ...stockInformation,
    ];
    if (isAllowGuestFilter) {
      roomsAggregateQuery.push(...guestsFiltering);
    }
    return roomsAggregateQuery;
  }

  /**
   * Price every room of every property, drop unpriced/filtered-out rooms, roll the
   * cheapest remaining room's price up to the property, and strip internal fields.
   */
  async populatePropertiesPricing(
    properties: PropertyDoc[],
    params: {
      bookingType: string;
      datesAndHoursParams: StayDetailParams[];
      priceMin?: number;
      priceMax?: number;
    },
  ): Promise<PropertyDoc[]> {
    const { bookingType, datesAndHoursParams, priceMin, priceMax } = params;

    const priced = await Promise.all(
      properties.map(async (property) => {
        // Each property gets its own copy: a property without any-time check-in has its
        // fullDay segments rewritten to standardDay before pricing.
        const dateAndHoursTemp: StayDetailParams[] = JSON.parse(
          JSON.stringify(datesAndHoursParams),
        );

        if (property.anyTimeCheckin) {
          property.allowedHourlyBooking = true;
        } else {
          property.allowedHourlyBooking = false;
          for (const timeSlot of dateAndHoursTemp) {
            if (timeSlot.rateType === 'fullDay' && timeSlot.hoursKeys.includes('h14')) {
              timeSlot.rateType = 'standardDay';
              timeSlot.hours = [];
              timeSlot.hoursKeys = [];
            }
            property.timeDetails = {
              startDate: dateAndHoursTemp[0].date.split('/').join('-'),
              endDate: dateAndHoursTemp[dateAndHoursTemp.length - 1].date
                .split('/')
                .join('-'),
            };
          }
        }

        await Promise.all(
          (property.rooms ?? []).map((room) =>
            this.getRoomPriceForDates(room, bookingType, dateAndHoursTemp),
          ),
        );

        property.rooms = (property.rooms ?? []).filter((room) => {
          const summary = room.priceSummary as { base?: { amount?: number } };
          let isValidRoom = !!(summary && summary.base && summary.base.amount);
          if (priceMin === 0 || !!priceMin) {
            isValidRoom = isValidRoom && summary.base.amount >= priceMin;
          }
          if (priceMax === 0 || !!priceMax) {
            isValidRoom = isValidRoom && summary.base.amount <= priceMax;
          }
          return isValidRoom;
        });

        if (property.rooms.length) {
          // Every room left after the filter above has a priced summary.
          let cheapestPrice = (property.rooms[0].priceSummary as PriceSummary).base.amount;
          property.priceSummary = property.rooms[0].priceSummary as PriceSummary;
          for (const room of property.rooms) {
            const summary = room.priceSummary as PriceSummary;
            if (summary?.base?.amount && summary.base.amount < cheapestPrice) {
              property.priceSummary = summary;
              cheapestPrice = summary.base.amount;
            }
          }
        }

        // Strip fields the customer surface must not expose.
        delete property.weekends;
        delete property.charges;
        delete property.anyTimeCheckin;
        property.contactinfo = {
          country: property.contactinfo.country,
          city: property.contactinfo.city,
        };
        for (const room of property.rooms) {
          delete room.rates;
          delete room.property;
        }

        return property;
      }),
    );

    // A property with no priced rooms is not bookable, so it drops out of the results.
    return priced.filter((p) => p.rooms && p.rooms.length);
  }

  /** Percentage or flat charge, rounded to 2 dp. A zero/absent value contributes 0. */
  getCalculatedTax(tax: Charge, amount: number): number {
    const taxValue = parseInt(String(tax.value || 0), 10);
    if (!taxValue) return 0;
    const chargedTax =
      tax.chargeType === 'percentage' ? amount * (taxValue / 100) : taxValue;
    return parseFloat(chargedTax.toFixed(2));
  }

  /** Fill in inventory/capacity fields for a room the aggregation didn't annotate. */
  populateRoomsInventoryAndGuests(room: RoomDoc): RoomDoc {
    const numberOfRoomsInventory =
      typeof room.numberOfRoomsInventory === 'undefined'
        ? room.number_rooms || 0
        : room.numberOfRoomsInventory;
    const numberOfRoomsBlocked =
      typeof room.numberOfRoomsBlocked === 'undefined' ? 0 : room.numberOfRoomsBlocked;
    const numberOfRoomsAvailable =
      typeof room.numberOfRoomsAvailable === 'undefined'
        ? numberOfRoomsInventory
        : room.numberOfRoomsAvailable;
    const adultsCapacity =
      typeof room.adultsCapacity === 'undefined'
        ? numberOfRoomsAvailable * (room.number_of_guests?.value || 0)
        : room.adultsCapacity;
    const childrenCapacity =
      typeof room.childrenCapacity === 'undefined'
        ? numberOfRoomsAvailable * (room.number_of_guests?.childrenValue || 0)
        : room.childrenCapacity;

    room.numberOfRoomsInventory = numberOfRoomsInventory;
    room.numberOfRoomsBlocked = numberOfRoomsBlocked;
    room.numberOfRoomsAvailable = numberOfRoomsAvailable;
    room.adultsCapacity = adultsCapacity;
    room.childrenCapacity = childrenCapacity;
    return room;
  }

  /** P3 — the filter lookups shown on the search page. */
  async getFilters(): Promise<Record<string, unknown[]>> {
    const [propertyTypes, propertyRatings, roomTypes, bedTypes, services] =
      await Promise.all([
        this.propertyTypeModel.find({}).sort({ name: 1 }).select('_id name').lean().exec(),
        this.propertyRatingModel
          .find({})
          .sort({ name: 1 })
          .select('_id name')
          .lean()
          .exec(),
        this.roomTypeModel.find({}).sort({ name: 1 }).select('_id name').lean().exec(),
        this.bedTypeModel.find({}).sort({ name: 1 }).select('_id name').lean().exec(),
        this.serviceModel.find({}).sort({ name: 1 }).select('_id name').lean().exec(),
      ]);

    return { propertyTypes, propertyRatings, roomTypes, bedTypes, services };
  }
}
