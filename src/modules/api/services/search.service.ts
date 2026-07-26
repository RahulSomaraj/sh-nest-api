import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import moment from 'moment-timezone';
import { CheckinService, StayDetailParams } from './checkin.service';
import {
  Charge,
  PriceLine,
  PropertyDoc,
  RateForDate,
  RoomDoc,
  RoomRate,
  SearchOptions,
  SearchParams,
  SearchPriceSummary,
  SearchResult,
  TaxSummary,
} from './pricing.types';
import {
  getPropertyDistance,
  groupBy,
  isEmptyArray,
  keyBy,
  removeFirstOccurrence,
  selectRoom,
} from './search-helpers';
import { UserRating } from '../../user-ratings/schemas/user-rating.schema';

/** Hour keys that start a standard day — legacy `search.js:16`. */
const STANDARD_START_HOUR_KEYS = ['h14', 'h15', 'h16', 'h17', 'h18'];

/**
 * Verbatim port of `stayhopper/services/search.js` — the engine behind
 * `POST /api/properties/search` and the home-page property lists.
 *
 * It differs from `services/properties.js` in three ways that matter, all preserved:
 *  - availability is resolved with find + a booking-log aggregation instead of one big
 *    `$lookup` pipeline;
 *  - the base price additionally applies the property's hourly commission, the MamoPay
 *    charge, and a round-up to a whole multiple of the stay length;
 *  - rooms are *selected* to satisfy the requested adults/rooms, and the property price
 *    is the sum over the selected rooms rather than the cheapest single room.
 *
 * This is the live customer pricing path. Do not restructure the arithmetic without a
 * contract test proving byte-identical output (CLAUDE.md § Migration rules).
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly checkinService: CheckinService,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel(UserRating.name) private readonly userRatingModel: Model<any>,
    @InjectModel('bookinglogs') private readonly bookLogModel: Model<any>,
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
   * Search entry point: split the stay, find available rooms, price them, rate them,
   * sort them, and echo the query back.
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

    const datesAndHoursParams = this.checkinService.getDatesAndHoursStayParams({
      checkinDate,
      checkinTime,
      checkoutDate,
      checkoutTime,
    });

    SearchService.mergeAdjacentFullDaySegments(datesAndHoursParams);

    let list = await this.getPropertyBySearchQuery({
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

    // Drop properties that cannot physically hold the party. (Legacy ran this identical
    // filter twice in a row; once is equivalent.)
    list = list.filter((property) => {
      const totalAvailability = property.rooms.reduce(
        (acc, room) =>
          acc + room.numberOfRoomsAvailable * (room.number_of_guests?.value ?? 0),
        0,
      );
      return totalAvailability > numberAdults * numberRooms;
    });

    list = await this.populatePropertiesPricing(list, {
      bookingType,
      datesAndHoursParams,
      priceMin,
      priceMax,
      numberAdults,
      numberRooms,
    });

    list = await Promise.all(list.map((p) => this.getPropertyRating(p)));

    const limit = params.limit ? params.limit : options.limit;
    // Distance sorting is meaningless without an origin, so it is dropped.
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
   * Coalesce adjacent `fullDay` segments — identical to the block in
   * `services/properties.js`; see `PropertiesDataService.mergeAdjacentFullDaySegments`
   * for the rationale. Kept as its own copy because the two legacy services each carry
   * their own, and they must be able to drift independently during the migration.
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
   * Sort the result set. Unlike the properties service this does NOT move sold-out
   * properties to the end (they have already been filtered out upstream) and, despite
   * the name, does not slice — `totalPages` is the only thing `limit` affects.
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

    let sorted = list;
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
            ? Number(a.priceSummary?.base.amount ?? 0) -
              Number(b.priceSummary?.base.amount ?? 0)
            : Number(b.priceSummary?.base.amount ?? 0) -
              Number(a.priceSummary?.base.amount ?? 0),
        );
        break;
    }

    return { list: sorted, count, totalPages };
  }

  /**
   * Price one room for the stay.
   *
   * On top of the base per-segment rate resolution (identical to the properties service)
   * this applies the property's hourly commission, subtracts the tourism fee from the
   * taxable amount, adds the MamoPay processing charge, and finally rounds the base up to
   * a whole multiple of the number of booked hours.
   */
  async getRoomPriceForDates(
    room: RoomDoc,
    bookingType: string,
    datesAndHoursParams: StayDetailParams[],
    anyTimeCheckin?: boolean,
    weekends?: string[],
    currency?: unknown,
    charges?: Charge[],
    contactinfo?: PropertyDoc['contactinfo'],
    agreement?: { commissionHourly?: number },
  ): Promise<RoomDoc> {
    const property =
      (room.property as PropertyDoc) ||
      ({ anyTimeCheckin, weekends, currency, charges, contactinfo } as PropertyDoc);
    const maxRecurringYears = 10;

    if (!room || !room.rates || !room.rates.length) {
      room.priceSummary = {};
      return room;
    }

    const defaultRoomPriceForBookingType = room.rates.find(
      (rr) => rr.isDefault && rr.rateType === bookingType,
    );
    // Earlier-starting custom rates win over later ones covering the same date.
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
      propertyWeekends: string[] = [],
    ): RateForDate => {
      let customRate: RoomRate | null = null;
      const { date, rateType, hoursKeys } = dateParams;
      const targetDateMoment = moment(date, 'DD/MM/YYYY');
      const dateWeekdayName = targetDateMoment.format('ddd').toLowerCase();
      const weekendOrWeekday =
        propertyWeekends.indexOf(dateWeekdayName) > -1 ? 'weekend' : 'weekday';

      for (const roomRate of otherRoomRatesForBookingType) {
        if (customRate) break;
        const customRateDateFromMoment = moment(roomRate.dateFrom, 'DD/MM/YYYY');
        const customRateDateToMoment = moment(roomRate.dateTo, 'DD/MM/YYYY').add(
          1,
          'days',
        );
        if (roomRate.recurring) {
          for (let i = 0; i <= maxRecurringYears; i++) {
            if (customRate) break;
            const from = moment(customRateDateFromMoment).add(i, 'years');
            const to = moment(customRateDateToMoment).add(i, 'years');
            if (
              targetDateMoment.isSameOrAfter(from) &&
              targetDateMoment.isSameOrBefore(to)
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

      if (!property.anyTimeCheckin) {
        return { rate: roomRateInfo.standardDay };
      }
      if (rateType === 'standardDay') {
        return { rate: roomRateInfo[rateType] as number };
      }
      if (rateType === 'fullDay') {
        // Each hour key spans two half-hour slots, so each slot costs half the rate.
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

        if (rate > roomRateInfo.standardDay) rate = roomRateInfo.standardDay;

        return {
          minimumBookingRate: minBookingRateForFullDay,
          rate,
          minimumBookingHourRate,
          hoursAndPrices,
          standardRate: roomRateInfo.standardDay,
        };
      }

      this.logger.warn('Unsupported rateType encountered while pricing a room; charging 0');
      return { rate: 0 };
    };

    const minimumBookingRates: number[] = [];
    const standardRates: number[] = [];
    let hoursAndPricesList: Array<{ hour: string; price: number }> = [];
    const isExistStandardDay =
      datesAndHoursParams.filter((d) => d.rateType === 'standardDay').length > 0;

    // The number of BOOKED HOURS, taken from the first segment only.
    // TODO(⚠️ PRODUCT): for a standard-day stay this is 0, so the divide-and-round-up
    // block below yields NaN, the room fails the `!!base.amount` filter, and the property
    // disappears from search results. That is what production does today, so parity is
    // preserved — but it means monthly/standard-day search is effectively dead. Confirm
    // with the team before changing (it is a pricing change, not a refactor).
    const hours = datesAndHoursParams[0].hours.length / 2;

    const base: PriceLine = {
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

    // Apply the property's hourly commission on top of the room rate.
    base.amount = parseInt(
      String(base.amount + base.amount * (agreement?.commissionHourly / 100)),
      10,
    );

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

    const bookingFee: PriceLine = { label: 'Booking fee', currency: '', amount: 0 };
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

    const taxes: TaxSummary = { label: 'Taxes', breakdown: [], amount: 0 };
    for (const tax of property.charges ?? []) {
      const taxAmount = this.getCalculatedTax(tax, base.amount);
      taxes.breakdown.push({ label: tax.name, amount: taxAmount });
      taxes.amount += taxAmount;
    }

    // The tourism fee is collected by the hotel, not by StayHopper, so it is excluded
    // from the amount the guest pays online (it stays visible in the breakdown).
    const tourismFee = taxes.breakdown.reduce(
      (acc, tax) => (tax.label === 'Tourism Fee' ? acc + tax.amount : acc),
      0,
    );
    taxes.amount -= tourismFee;

    const mamopayCharges = this.config.get<number>('mamopayCharges');
    const mamoPayCommision = (base.amount + taxes.amount) * (mamopayCharges / 100);
    const basePrice = base.amount + mamoPayCommision;

    // Round the base up to a whole multiple of the number of hours booked, so the
    // per-hour price shown to the guest is a round number.
    let quotient = basePrice / hours;
    const integerPart = Math.floor(quotient);
    const remainder = basePrice - integerPart * hours;
    quotient = (basePrice + hours - remainder) / hours;
    base.amount = Math.round(Math.ceil(quotient) * hours);

    room.priceSummary = {
      base,
      taxes,
      bookingFee,
      total: {
        label: 'Total Amount',
        // Legacy emits these as `.toFixed(2)` STRINGS; sh-website receives them that way.
        amount: (
          base.amount +
          bookingFee.amount +
          taxes.amount -
          tourismFee +
          (base.amount + taxes.amount - tourismFee) * (mamopayCharges / 100)
        ).toFixed(2),
      },
      payNow: {
        label: 'Now you pay',
        currency: bookingFee.currency,
        amount:
          bookingType === 'hourly'
            ? (
                base.amount +
                taxes.amount -
                tourismFee +
                (base.amount + taxes.amount) * (mamopayCharges / 100)
              ).toFixed(2)
            : base.amount + bookingFee.amount,
      },
      // Hourly bookings are paid in full online, so nothing is due at the hotel.
      payAtHotel: { label: 'Pay at the hotel', amount: 0 },
    } as SearchPriceSummary;

    return room;
  }

  /**
   * Resolve the candidate properties and their available rooms for a search.
   *
   * Availability = room inventory minus the distinct room numbers held by booking logs
   * overlapping the stay. A room whose whole inventory is held is dropped; a property
   * with no remaining rooms is dropped with it.
   */
  async getPropertyBySearchQuery(params: {
    checkinDate: string;
    checkoutDate: string;
    checkinTime: string;
    checkoutTime: string;
    location?: string;
    propertyTypes: string[];
    propertyRatings: string[];
    roomTypes: string[];
    bedTypes: string[];
    amenities: string[];
    [key: string]: unknown;
  }): Promise<PropertyDoc[]> {
    const {
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      location,
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

    const basePropertyQuery: Record<string, unknown> = {
      approved: true,
      published: true,
      agreement: { $exists: true },
      'agreement.isAgreementSigned': true,
      currency: { $exists: true },
    };

    let latitude: string | null = null;
    let longitude: string | null = null;
    if (location) {
      const latLong = location.split(',');
      latitude = latLong[0];
      longitude = latLong[1];
      basePropertyQuery['location.coordinates'] = {
        // 40 km expressed in radians (Earth radius 6371 km).
        $geoWithin: { $centerSphere: [[longitude, latitude], 40 / 6371] },
      };
    }

    if (!isEmptyArray(propertyTypes)) {
      basePropertyQuery.type = {
        $in: propertyTypes.map((id) => new Types.ObjectId(id)),
      };
    }
    if (!isEmptyArray(propertyRatings)) {
      basePropertyQuery.rating = {
        $in: propertyRatings.map((id) => new Types.ObjectId(id)),
      };
    }

    const propertiesWithBaseInfo = await this.propertyModel
      .find(basePropertyQuery, {
        _id: 1,
        location: 1,
        name: 1,
        featured: 1,
        rating: 1,
        currency: 1,
        user_rating: 1,
        weekends: 1,
        anyTimeCheckin: 1,
        contactinfo: 1,
        charges: 1,
        agreement: 1,
      })
      .populate('currency')
      .populate('rating')
      .populate('contactinfo.country')
      .lean()
      .exec();

    const propertyIds = propertiesWithBaseInfo.map((p: PropertyDoc) => p._id);

    const roomListQuery: Record<string, unknown> = { property_id: { $in: propertyIds } };
    if (!isEmptyArray(roomTypes)) {
      roomListQuery.room_type = { $in: roomTypes.map((id) => new Types.ObjectId(id)) };
    }
    if (!isEmptyArray(bedTypes)) {
      roomListQuery.bed_type = { $in: bedTypes.map((id) => new Types.ObjectId(id)) };
    }
    if (!isEmptyArray(amenities)) {
      roomListQuery.services = { $in: amenities.map((id) => new Types.ObjectId(id)) };
    }

    let roomList: RoomDoc[] = await this.roomModel
      .find(roomListQuery, {
        services: 0,
        images: 0,
        featured: 0,
        extrabed_option: 0,
        extrabed_number: 0,
        amount_extrabed: 0,
        extraslot_cleaning: 0,
        hours_cleaning: 0,
        updatedAt: 0,
      })
      .populate('number_of_guests')
      .lean()
      .exec();

    const roomIds = roomList.map((room) => room._id);

    const bookingLogRows: Array<{ roomId: unknown; totalSoldRoomCount: number }> =
      await this.bookLogModel
        .aggregate([
          {
            $match: {
              room: { $in: roomIds },
              slotStartTime: { $gte: fullCheckinDate, $lt: fullCheckoutDate },
            },
          },
          // Distinct (room, number) pairs first, then count them per room.
          { $group: { _id: { room: '$room', number: '$number' } } },
          { $group: { _id: '$_id.room', totalSoldRoomCount: { $sum: 1 } } },
          { $project: { _id: 0, roomId: '$_id', totalSoldRoomCount: 1 } },
        ])
        .exec();

    const bookingLogs = keyBy(
      bookingLogRows.map((row) => ({ ...row, roomId: String(row.roomId) })),
      'roomId',
    );

    roomList = roomList.map((roomData) => {
      roomData.isAvailable = true;
      roomData.numberOfRoomsAvailable = roomData.number_rooms || 0;
      roomData.numberOfSelectedRooms = 0;
      const sold = bookingLogs[String(roomData._id)];
      if (sold) {
        if (sold.totalSoldRoomCount >= roomData.number_rooms) {
          roomData.isAvailable = false;
        } else {
          roomData.numberOfRoomsAvailable =
            roomData.numberOfRoomsAvailable > 0
              ? roomData.numberOfRoomsAvailable - sold.totalSoldRoomCount
              : 0;
        }
      }
      return roomData;
    });

    roomList = roomList.filter((roomData) => roomData.isAvailable);
    const roomByPropertyId = groupBy(
      roomList as Array<RoomDoc & Record<string, unknown>>,
      'property_id',
    );

    return propertiesWithBaseInfo
      .filter((p: PropertyDoc) => !isEmptyArray(roomByPropertyId[String(p._id)]))
      .map((p: PropertyDoc) => ({
        ...p,
        ...(longitude && latitude
          ? {
              distance: getPropertyDistance(
                [longitude, latitude],
                p.location.coordinates as [number, number],
              ),
            }
          : {}),
        rooms: roomByPropertyId[String(p._id)],
      }));
  }

  /**
   * Price each property's rooms, then choose which rooms actually satisfy the requested
   * party and sum their prices into the property total.
   */
  async populatePropertiesPricing(
    properties: PropertyDoc[],
    params: {
      bookingType: string;
      datesAndHoursParams: StayDetailParams[];
      priceMin?: number;
      priceMax?: number;
      numberAdults: number;
      numberRooms: number;
    },
  ): Promise<PropertyDoc[]> {
    const { bookingType, datesAndHoursParams, priceMin, priceMax, numberAdults, numberRooms } =
      params;

    const priced = await Promise.all(
      properties.map(async (property) => {
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
            this.getRoomPriceForDates(
              room,
              bookingType,
              dateAndHoursTemp,
              property.anyTimeCheckin,
              property.weekends,
              property.currency,
              property.charges,
              property.contactinfo,
              property.agreement,
            ),
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
          // Cheapest first, then smallest capacity first — the selection walks this order.
          property.rooms = property.rooms
            .sort(
              (a, b) =>
                Number((a.priceSummary as SearchPriceSummary).base.amount) -
                Number((b.priceSummary as SearchPriceSummary).base.amount),
            )
            .sort(
              (a, b) =>
                (a.number_of_guests?.value ?? 0) - (b.number_of_guests?.value ?? 0),
            );

          property.rooms = this.selectRoomsForParty(property, numberAdults, numberRooms);

          property.priceSummary = this.sumSelectedRoomPrices(property.rooms);

          property.numberOfRoomsAvailable = property.rooms.reduce(
            (sum, r) => sum + r.numberOfRoomsAvailable,
            0,
          );
          property.numberOfSelectedRooms = property.rooms.reduce(
            (sum, r) => sum + r.numberOfSelectedRooms,
            0,
          );
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

    return priced.filter((p) => p.rooms && p.rooms.length);
  }

  /**
   * Choose rooms until the requested adults (and room count) are covered.
   *
   * Three shapes, in legacy order:
   *  - an exact capacity match exists → take those rooms;
   *  - the party is smaller than the smallest room → take rooms until the room count is
   *    satisfied;
   *  - otherwise → take the largest room available, subtract what it holds, and recurse.
   */
  private selectRoomsForParty(
    property: PropertyDoc,
    numberAdults: number,
    numberRooms: number,
  ): RoomDoc[] {
    const selectedRooms: RoomDoc[] = [];
    const selectedRoomIds: string[] = [];
    let pendingRoomNumbers = numberRooms;
    let numberOfGuestsValues = property.rooms.map((r) => r.number_of_guests?.value);
    const isRoomCountBasedSearch = numberOfGuestsValues.includes(numberAdults);

    // Legacy re-entered this function with an UNCHANGED party size when an exact-capacity
    // room existed in `numberOfGuestsValues` but every instance was already taken — an
    // unbounded recursion. The guard below stops that one no-progress path (and only
    // that path); every terminating case behaves identically.
    let guard = property.rooms.length + 1;

    const getRoomsByAdults = (pendingNumberOfAdults: number): void => {
      if (pendingNumberOfAdults <= 0) return;
      if (guard-- <= 0) {
        this.logger.warn(
          'Room selection made no progress; stopping to avoid unbounded recursion',
        );
        return;
      }

      if (numberOfGuestsValues.includes(pendingNumberOfAdults)) {
        const matchingRooms = property.rooms.filter(
          (room) =>
            room.number_of_guests?.value === pendingNumberOfAdults &&
            !selectedRoomIds.includes(String(room._id)),
        );
        if (matchingRooms.length) {
          if (isRoomCountBasedSearch) {
            for (let roomToSelect of matchingRooms) {
              if (pendingRoomNumbers <= 0) break;
              if (
                numberRooms <= roomToSelect.numberOfRoomsAvailable &&
                !selectedRoomIds.includes(String(roomToSelect._id))
              ) {
                roomToSelect = selectRoom({
                  room: roomToSelect,
                  numberOfSelectedRooms: numberRooms,
                });
                selectedRooms.push(roomToSelect);
                selectedRoomIds.push(String(roomToSelect._id));
                pendingRoomNumbers = 0;
              } else {
                roomToSelect = selectRoom({
                  room: roomToSelect,
                  numberOfSelectedRooms: roomToSelect.numberOfRoomsAvailable,
                });
                selectedRooms.push(roomToSelect);
                selectedRoomIds.push(String(roomToSelect._id));
                pendingRoomNumbers -= roomToSelect.numberOfSelectedRooms;
              }
            }
          } else {
            let roomToSelect = matchingRooms[0];
            roomToSelect = selectRoom({ room: roomToSelect, numberOfSelectedRooms: 1 });
            selectedRooms.push(roomToSelect);
            selectedRoomIds.push(String(roomToSelect._id));
            pendingRoomNumbers = 0;
          }
          // Fully covered by the exact-match rooms.
          return;
        }
      } else {
        const minValue = Math.min(...numberOfGuestsValues);

        if (pendingNumberOfAdults < minValue) {
          for (let roomData of property.rooms) {
            if (pendingRoomNumbers <= 0) break;
            if (
              numberRooms <= roomData.numberOfRoomsAvailable &&
              !selectedRoomIds.includes(String(roomData._id))
            ) {
              roomData = selectRoom({
                room: roomData,
                numberOfSelectedRooms: numberRooms,
              });
              selectedRooms.push(roomData);
              selectedRoomIds.push(String(roomData._id));
              pendingRoomNumbers = 0;
            } else {
              const numberOfSelectedRooms = parseInt(
                String(
                  (roomData.numberOfRoomsAvailable * roomData.number_of_guests.value) /
                    pendingNumberOfAdults,
                ),
                10,
              );
              roomData = selectRoom({ room: roomData, numberOfSelectedRooms });
              selectedRooms.push(roomData);
              selectedRoomIds.push(String(roomData._id));
              pendingRoomNumbers -= roomData.numberOfSelectedRooms;
            }
          }
          return;
        }

        let guestValue = Math.max(...numberOfGuestsValues);
        if (numberOfGuestsValues.includes(pendingNumberOfAdults)) {
          guestValue = pendingNumberOfAdults;
        }

        let roomToSelect = property.rooms.find(
          (room) =>
            room.number_of_guests?.value === guestValue &&
            !selectedRoomIds.includes(String(room._id)),
        );

        if (!roomToSelect) {
          // Nothing left that fits — stop rather than loop forever.
          this.logger.warn('No matching room to select for the remaining guests');
          return;
        }

        if (
          pendingNumberOfAdults <=
          roomToSelect.number_of_guests.value * roomToSelect.numberOfRoomsAvailable
        ) {
          roomToSelect = selectRoom({
            room: roomToSelect,
            numberOfSelectedRooms: Math.ceil(
              pendingNumberOfAdults / roomToSelect.number_of_guests.value,
            ),
          });
          selectedRooms.push(roomToSelect);
          selectedRoomIds.push(String(roomToSelect._id));
          pendingRoomNumbers -= roomToSelect.numberOfSelectedRooms;
          numberOfGuestsValues = removeFirstOccurrence(numberOfGuestsValues, guestValue);
          return;
        }

        roomToSelect = selectRoom({
          room: roomToSelect,
          numberOfSelectedRooms: roomToSelect.numberOfRoomsAvailable,
        });
        selectedRooms.push(roomToSelect);
        selectedRoomIds.push(String(roomToSelect._id));
        pendingRoomNumbers -= roomToSelect.numberOfSelectedRooms;
        const remaining =
          pendingNumberOfAdults -
          roomToSelect.number_of_guests.value * roomToSelect.numberOfRoomsAvailable;
        numberOfGuestsValues = removeFirstOccurrence(numberOfGuestsValues, guestValue);
        getRoomsByAdults(remaining);
        return;
      }

      // The exact-match branch found no free rooms — try again for the same party size
      // now that the taken ones are excluded.
      getRoomsByAdults(pendingNumberOfAdults);
    };

    getRoomsByAdults(numberAdults);
    return selectedRooms;
  }

  /** Fold the selected rooms' `finalPrice` lines into one property-level summary. */
  private sumSelectedRoomPrices(rooms: RoomDoc[]): SearchPriceSummary {
    const summary = rooms.reduce(
      (result, { finalPrice }) => {
        result.base.amount += Number(finalPrice.base.amount);
        result.base.savings += finalPrice.base.savings;
        result.base.label = finalPrice.base.label;

        result.total.amount =
          Number(result.total.amount) + Number(Number(finalPrice.total.amount).toFixed(2));
        result.total.label = finalPrice.total.label;

        result.payNow.amount =
          Number(result.payNow.amount) +
          Number(Number(finalPrice.payNow.amount).toFixed(2));
        result.payNow.label = finalPrice.payNow.label;
        result.payNow.currency = finalPrice.payNow.currency;

        result.payAtHotel.amount =
          Number(result.payAtHotel.amount) + Number(finalPrice.payAtHotel.amount);
        result.payAtHotel.label = finalPrice.payAtHotel.label;

        result.taxes.amount += Number(finalPrice.taxes.amount.toFixed(2));
        result.taxes.label = finalPrice.taxes.label;
        result.taxes.breakdown = [
          ...(result.taxes.breakdown ?? []),
          ...finalPrice.taxes.breakdown,
        ];

        return result;
      },
      {
        base: { label: 'Base Price', amount: 0, savings: 0 },
        total: { label: 'Total Amount', amount: 0 },
        payNow: { label: 'Now you pay', currency: '', amount: 0 },
        payAtHotel: { label: 'Pay at the hotel', amount: 0 },
        taxes: { label: 'Taxes', amount: 0, breakdown: [] },
      } as SearchPriceSummary,
    );

    // Merge duplicate tax lines (one per selected room) into a single line per label.
    summary.taxes.breakdown = Object.values(
      summary.taxes.breakdown.reduce(
        (
          breakdownData: Record<string, { label: string; amount: number }>,
          { label, amount },
        ) => {
          breakdownData[label] = {
            label,
            amount: (breakdownData[label]?.amount ?? 0) + amount,
          };
          return breakdownData;
        },
        {},
      ),
    );

    summary.bookingFee = (rooms[0]?.priceSummary as SearchPriceSummary)?.bookingFee ?? {
      label: 'Booking fee',
      currency: '',
      amount: 0,
    };

    return summary;
  }

  /** Percentage or flat charge, rounded to 2 dp. A zero/absent value contributes 0. */
  getCalculatedTax(tax: Charge, amount: number): number {
    const taxValue = parseInt(String(tax.value || 0), 10);
    if (!taxValue) return 0;
    const chargedTax =
      tax.chargeType === 'percentage' ? amount * (taxValue / 100) : taxValue;
    return parseFloat(chargedTax.toFixed(2));
  }
}
