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
  SearchPriceSummary,
  TaxSummary,
} from './pricing.types';
import {
  isEmptyArray,
  keyBy,
  removeFirstOccurrence,
  selectRoom,
} from './search-helpers';
import { UserRating } from '../../user-ratings/schemas/user-rating.schema';

/**
 * Verbatim port of `stayhopper/services/propertyDetail.js` — the engine behind
 * `POST /api/properties/:id`.
 *
 * It is the search pricing path applied to a single property, with three differences,
 * all preserved:
 *  - EVERY room is returned (unselected ones carry `isSelected: false`), not just the
 *    selected ones, because the detail page renders the full room list;
 *  - the taxes are recomputed after the base has been rounded, and the pre-commission
 *    base is exposed as `roomPrice`;
 *  - `priceSummary.total` is replaced by a NUMBER (not an object) once the property
 *    total is computed, and `payNow.amount` is set to it.
 */
@Injectable()
export class PropertyDetailService {
  private readonly logger = new Logger(PropertyDetailService.name);

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

  /** P4 — full detail for one property, priced for the requested stay. */
  async getPropertyById(params: {
    propertyId: string;
    location?: string;
    checkinDate?: string;
    checkoutDate?: string;
    checkinTime?: string;
    checkoutTime?: string;
    bookingType?: string;
    numberAdults?: number | string;
    numberChildren?: number | string;
    numberRooms?: number | string;
    isAllowGuestFilter?: boolean;
    priceMin?: number;
    priceMax?: number;
    propertyTypes?: string;
    propertyRatings?: string;
    roomTypes?: string;
    bedTypes?: string;
    amenities?: string;
    timezone?: string;
  }): Promise<PropertyDoc> {
    const { location, checkinDate, checkoutDate, checkinTime, checkoutTime, propertyId } =
      params;
    const numberAdults = parseInt(String(params.numberAdults), 10) || 2;
    const numberRooms = parseInt(String(params.numberRooms), 10) || 1;
    const priceMin = params.priceMin;
    const priceMax = params.priceMax;
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

    PropertyDetailService.mergeAdjacentFullDaySegments(datesAndHoursParams);

    let propertyDetails = await this.getPropertyBySearchQuery({
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      location,
      propertyId,
      roomTypes,
      bedTypes,
      amenities,
    });

    propertyDetails = await this.populatePropertyPricing(propertyDetails, {
      bookingType,
      datesAndHoursParams,
      priceMin,
      priceMax,
      numberAdults,
      numberRooms,
    });

    propertyDetails = await this.getPropertyRating(propertyDetails);

    const stayDuration = this.checkinService.getStayDuration({
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
    });
    if (
      !propertyDetails.allowedHourlyBooking &&
      (checkinTime !== '14:00' || checkoutTime !== '12:00')
    ) {
      const newCheckOutDate = moment(`${checkinDate}`, 'DD/MM/YYYY')
        .add(1, 'days')
        .format('DD/MM/YYYY');
      propertyDetails.stayDuration = this.checkinService.getStayDuration({
        checkinDate,
        checkoutDate: newCheckOutDate,
        checkinTime: '14:00',
        checkoutTime: '12:00',
      });
      propertyDetails.timeDetails = {
        startDate: checkinDate.split('/').join('-'),
        endDate: newCheckOutDate.split('/').join('-'),
      };
    } else {
      propertyDetails.stayDuration = stayDuration;
    }

    return propertyDetails;
  }

  /**
   * Coalesce adjacent `fullDay` segments — identical to the block in the properties and
   * search services; see `PropertiesDataService.mergeAdjacentFullDaySegments`.
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

  /** Load the property with its full detail projection plus its available rooms. */
  async getPropertyBySearchQuery(params: {
    propertyId: string;
    checkinDate?: string;
    checkoutDate?: string;
    checkinTime?: string;
    checkoutTime?: string;
    location?: string;
    roomTypes: string[];
    bedTypes: string[];
    amenities: string[];
  }): Promise<PropertyDoc> {
    const {
      propertyId,
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      location,
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
      _id: new Types.ObjectId(propertyId),
      approved: true,
      published: true,
      agreement: { $exists: true },
      'agreement.isAgreementSigned': true,
      currency: { $exists: true },
    };

    if (location) {
      const latLong = location.split(',');
      const latitude = latLong[0];
      const longitude = latLong[1];
      // NOTE (legacy parity): `propertyDetail.js:779` assigns into
      // `basePropertyQuery["location"]["coordinates"]`, but `location` was never
      // initialised on the object — so passing a location to the DETAIL endpoint throws
      // and the route answers 500. sh-website only sends `location` to /search, so this
      // path is dead in practice; the same failure is kept rather than silently changing
      // a 500 into a filtered query.
      (basePropertyQuery.location as Record<string, unknown>).coordinates = {
        $geoWithin: { $centerSphere: [[longitude, latitude], 40 / 6371] },
      };
    }

    const propertyInfo = await this.propertyModel
      .findOne(basePropertyQuery, {
        _id: 1,
        location: 1,
        name: 1,
        legal_name: 1,
        description: 1,
        featured: 1,
        rating: 1,
        currency: 1,
        user_rating: 1,
        weekends: 1,
        anyTimeCheckin: 1,
        contactinfo: 1,
        charges: 1,
        services: 1,
        policies: 1,
        terms: 1,
        images: 1,
        nearby: 1,
        company: 1,
        type: 1,
        agreement: 1,
      })
      .populate('services')
      .populate('policies')
      .populate('terms')
      .populate('company')
      .populate('type')
      .populate('currency')
      .populate('rating')
      .populate('contactinfo.country')
      .lean()
      .exec();

    const roomListQuery: Record<string, unknown> = {
      property_id: new Types.ObjectId(propertyId),
    };
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
      .find(roomListQuery, { updatedAt: 0 })
      .populate('number_of_guests')
      .populate('room_type')
      .populate('room_name')
      .populate('bed_type')
      .populate('services')
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

    return {
      ...propertyInfo,
      rooms: roomList.filter((roomData) => roomData.isAvailable),
    };
  }

  /**
   * Price one room for the stay. Same resolution and clamping as the search service,
   * but the tax breakdown is recomputed against the FINAL (rounded) base and the
   * pre-commission base is kept as `roomPrice`.
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
        const from = moment(roomRate.dateFrom, 'DD/MM/YYYY');
        const to = moment(roomRate.dateTo, 'DD/MM/YYYY').add(1, 'days');
        if (roomRate.recurring) {
          for (let i = 0; i <= maxRecurringYears; i++) {
            if (customRate) break;
            const yearFrom = moment(from).add(i, 'years');
            const yearTo = moment(to).add(i, 'years');
            if (
              targetDateMoment.isSameOrAfter(yearFrom) &&
              targetDateMoment.isSameOrBefore(yearTo)
            ) {
              customRate = roomRate;
            }
          }
        } else if (
          targetDateMoment.isSameOrAfter(from) &&
          targetDateMoment.isSameOrBefore(to)
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

    const isExistStandardDay =
      datesAndHoursParams.filter((d) => d.rateType === 'standardDay').length > 0;

    // Number of booked hours, taken from the first segment — see the note in
    // SearchService.getRoomPriceForDates about standard-day stays yielding NaN.
    const hours = datesAndHoursParams[0].hours.length / 2;

    const base: PriceLine = {
      label: 'Base Price',
      amount: parseFloat(
        String(
          datesAndHoursParams.reduce((accumulator, dateParams) => {
            const resolved = getRateForTheDateParams(dateParams, property.weekends);
            const { minimumBookingRate, minimumBookingHourRate, standardRate } = resolved;
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
            return accumulator + rate;
          }, 0),
        ),
      ),
    };

    // The room rate before the platform commission — surfaced to the detail page.
    const roomPrice = base.amount;

    base.amount = parseInt(
      String(base.amount + base.amount * (agreement?.commissionHourly / 100)),
      10,
    );

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

    // The tourism fee is collected by the hotel, so it is excluded from what is charged
    // online and instead surfaces as `payAtHotel`.
    const tourismFee = taxes.breakdown.reduce(
      (acc, tax) => (tax.label === 'Tourism Fee' ? acc + tax.amount : acc),
      0,
    );
    taxes.amount -= tourismFee;

    const mamopayCharges = this.config.get<number>('mamopayCharges');
    const mamoPayCommision = (base.amount + taxes.amount) * (mamopayCharges / 100);
    const basePrice = base.amount + mamoPayCommision;

    // Round the base up to a whole multiple of the number of hours booked.
    let quotient = basePrice / hours;
    const integerPart = Math.floor(quotient);
    const remainder = basePrice - integerPart * hours;
    quotient = (basePrice + hours - remainder) / hours;
    base.amount = Math.round(Math.ceil(quotient) * hours);

    // Recompute the tax breakdown against the final base so the displayed lines add up.
    taxes.breakdown = [];
    taxes.amount = 0;
    for (const tax of property.charges ?? []) {
      const taxAmount = this.getCalculatedTax(tax, base.amount);
      taxes.breakdown.push({ label: tax.name, amount: taxAmount });
      taxes.amount += taxAmount;
    }
    taxes.amount -= tourismFee;

    const totalPrice = base.amount + taxes.amount;

    room.priceSummary = {
      base,
      roomPrice,
      taxes,
      bookingFee,
      total: { label: 'Total Amount', amount: totalPrice.toFixed(2) },
      payNow: {
        label: 'Now you pay',
        currency: bookingFee.currency,
        amount:
          bookingType === 'hourly'
            ? totalPrice.toFixed(2)
            : // NOTE (legacy parity): `.toFixed(2)` binds to the parenthesised
              // percentage here, not to the product — reproduced exactly.
              (base.amount + taxes.amount - tourismFee) *
              Number((mamopayCharges / 100).toFixed(2)),
      },
      payAtHotel: {
        label: 'Pay at the hotel',
        amount: bookingType === 'hourly' ? tourismFee.toFixed(2) : 0,
      },
    } as unknown as SearchPriceSummary;

    return room;
  }

  /**
   * Price the property's rooms, choose the ones that satisfy the party, and roll the
   * selected rooms up into the property total. Unselected rooms stay in the list with
   * `isSelected: false` so the detail page can still render them.
   */
  async populatePropertyPricing(
    property: PropertyDoc,
    params: {
      bookingType: string;
      datesAndHoursParams: StayDetailParams[];
      priceMin?: number;
      priceMax?: number;
      numberAdults: number;
      numberRooms: number;
    },
  ): Promise<PropertyDoc> {
    const { bookingType, datesAndHoursParams, priceMin, priceMax, numberAdults, numberRooms } =
      params;

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
          endDate: dateAndHoursTemp[dateAndHoursTemp.length - 1].date.split('/').join('-'),
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
      property.rooms = property.rooms
        .sort(
          (a, b) =>
            Number((a.priceSummary as SearchPriceSummary).base.amount) -
            Number((b.priceSummary as SearchPriceSummary).base.amount),
        )
        .sort((a, b) => (a.number_of_guests?.value ?? 0) - (b.number_of_guests?.value ?? 0));

      const { selectedRooms, selectedRoomIds } = this.selectRoomsForParty(
        property,
        numberAdults,
        numberRooms,
      );

      // Keep every room; the unselected ones just carry their own price as finalPrice.
      const selectedRoomByRoomId = keyBy(
        selectedRooms as Array<RoomDoc & Record<string, unknown>>,
        '_id',
      );
      property.rooms = property.rooms.map((roomData) => {
        if (selectedRoomIds.includes(String(roomData._id))) {
          return selectedRoomByRoomId[String(roomData._id)];
        }
        return {
          ...roomData,
          isSelected: false,
          finalPrice: roomData.priceSummary as SearchPriceSummary,
        };
      });

      const summary = property.rooms
        .filter((roomData) => roomData.isSelected)
        .reduce(
          (result, { finalPrice }) => {
            result.base.amount += finalPrice.base.amount;
            result.base.savings += finalPrice.base.savings;
            result.base.label = finalPrice.base.label;

            result.total.amount =
              Number(result.total.amount) + Number(finalPrice.total.amount);
            result.total.label = finalPrice.total.label;

            result.payNow.amount =
              Number(result.payNow.amount) + Number(finalPrice.payNow.amount);
            result.payNow.label = finalPrice.payNow.label;
            result.payNow.currency = finalPrice.payNow.currency;

            result.payAtHotel.amount =
              Number(result.payAtHotel.amount) + Number(finalPrice.payAtHotel.amount);
            result.payAtHotel.label = finalPrice.payAtHotel.label;

            result.taxes.amount += finalPrice.taxes.amount;
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

      summary.bookingFee = (property.rooms[0]?.priceSummary as SearchPriceSummary)
        ?.bookingFee ?? { label: 'Booking fee', currency: '', amount: 0 };

      property.priceSummary = summary;

      // NOTE (legacy parity): `total` is REPLACED by a bare number here — it is no longer
      // the `{label, amount}` object it was a moment ago. sh-website reads it as a number.
      const propertyTotal =
        Number(summary.base.amount) +
        Number(summary.taxes.amount) +
        Number(summary.bookingFee.amount) +
        (Number(summary.base.amount) +
          Number(summary.taxes.amount) +
          Number(summary.bookingFee.amount)) *
          (this.config.get<number>('mamopayCharges') / 100);
      (property.priceSummary as unknown as Record<string, unknown>).total = propertyTotal;
      summary.payNow.amount = propertyTotal;

      property.numberOfRoomsAvailable = property.rooms.reduce(
        (sum, r) => sum + r.numberOfRoomsAvailable,
        0,
      );
      property.numberOfSelectedRooms = property.rooms.reduce(
        (sum, r) => sum + (r.numberOfSelectedRooms ?? 0),
        0,
      );
    }

    // Strip only what the detail page must not see. NOTE: unlike the search path,
    // `charges` is deliberately KEPT here — legacy has a no-op `property.charges;`
    // statement where the delete would be, and the detail page renders the breakdown.
    delete property.weekends;
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
  }

  /**
   * Choose rooms until the requested adults (and room count) are covered — the same
   * algorithm as `SearchService.selectRoomsForParty`, but the caller also needs the
   * selected ids so it can keep the unselected rooms in the list.
   */
  private selectRoomsForParty(
    property: PropertyDoc,
    numberAdults: number,
    numberRooms: number,
  ): { selectedRooms: RoomDoc[]; selectedRoomIds: string[] } {
    const selectedRooms: RoomDoc[] = [];
    const selectedRoomIds: string[] = [];
    let pendingRoomNumbers = numberRooms;
    let numberOfGuestsValues = property.rooms.map((r) => r.number_of_guests?.value);
    const isRoomCountBasedSearch = numberOfGuestsValues.includes(numberAdults);

    // See SearchService: legacy could re-enter with an unchanged party size and never
    // terminate. The guard stops only that no-progress path.
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
              roomData = selectRoom({ room: roomData, numberOfSelectedRooms: numberRooms });
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

      getRoomsByAdults(pendingNumberOfAdults);
    };

    getRoomsByAdults(numberAdults);
    return { selectedRooms, selectedRoomIds };
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
