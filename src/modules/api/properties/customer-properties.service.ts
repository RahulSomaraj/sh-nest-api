import { BadRequestException, Injectable } from '@nestjs/common';
import moment from 'moment-timezone';
import { CheckinService } from '../services/checkin.service';
import { PropertiesDataService } from '../services/properties-data.service';
import { PropertyDetailService } from '../services/property-detail.service';
import { SearchService } from '../services/search.service';
import type {
  PropertyDetailDto,
  PropertySearchDto,
} from './customer-properties.controller';

/**
 * The `/api/properties` surface — MIGRATION.md 2d. Ported from
 * `controllers/api/v2/properties.js`; all of the real work lives in the ported
 * `services/*` layer.
 */
@Injectable()
export class CustomerPropertiesService {
  constructor(
    private readonly searchService: SearchService,
    private readonly propertiesService: PropertiesDataService,
    private readonly propertyDetailService: PropertyDetailService,
    private readonly checkinService: CheckinService,
  ) {}

  /** P2 — `POST /api/properties/search`. */
  async search(body: PropertySearchDto, timezone: string) {
    // A monthly stay is always a standard 14:00 → 12:00 window.
    if (body.bookingType === 'monthly') {
      body.checkinTime = '14:00';
      body.checkoutTime = '12:00';
    }

    if (
      !body ||
      !body.checkinDate ||
      !body.checkoutDate ||
      !body.checkinTime ||
      !body.checkoutTime
    ) {
      throw new BadRequestException('Invalid params');
    }

    const properties = await this.searchService.getProperties({
      // The website sends DD-MM-YYYY; the services work in DD/MM/YYYY.
      checkinDate: body.checkinDate.replace(/-/g, '/'),
      checkoutDate: body.checkoutDate.replace(/-/g, '/'),
      checkinTime: body.checkinTime,
      checkoutTime: body.checkoutTime,
      bookingType: body.bookingType || 'hourly',
      location: body.location || '',
      cityId: body.cityId || '',
      countryId: body.countryId || '',
      numberAdults: parseInt(String(body.numberAdults), 10) || 2,
      numberChildren: parseInt(String(body.numberChildren), 10) || 0,
      numberRooms: parseInt(String(body.numberRooms), 10) || 1,
      properties: body.properties || '',
      rooms: body.rooms || '',
      isTestingRates: body.isTestingRates || false,
      limit: body.limit || undefined,
      sort: body.sort || '',
      orderBy: body.orderBy || '',
      priceMin: body.priceMin ?? null,
      priceMax: body.priceMax ?? null,
      propertyTypes: body.propertyTypes || '',
      propertyRatings: body.propertyRatings || '',
      roomTypes: body.roomTypes || '',
      bedTypes: body.bedTypes || '',
      amenities: body.amenities || '',
      timezone,
      // Capacity is enforced by the room-selection step, not by the query.
      isAllowGuestFilter: false,
    });

    return { data: properties };
  }

  /** P3 — `GET /api/properties/filters`. */
  async filters() {
    return { data: await this.propertiesService.getFilters() };
  }

  /** P4 — `POST /api/properties/:id`. */
  async detail(id: string, body: PropertyDetailDto, timezone: string) {
    if (body.bookingType === 'monthly') {
      body.checkinTime = '14:00';
      body.checkoutTime = '12:00';
    }

    const checkinDate = body.checkinDate ? body.checkinDate.replace(/-/g, '/') : '';
    const checkoutDate = body.checkoutDate ? body.checkoutDate.replace(/-/g, '/') : '';
    const checkinTime = body.checkinTime;
    const checkoutTime = body.checkoutTime;

    const propertyDetails = await this.propertyDetailService.getPropertyById({
      location: body.location || '',
      checkinDate,
      checkoutDate,
      checkinTime,
      checkoutTime,
      bookingType: body.bookingType || 'hourly',
      numberAdults: parseInt(String(body.numberAdults), 10) || 2,
      numberChildren: parseInt(String(body.numberChildren), 10) || 0,
      numberRooms: parseInt(String(body.numberRooms), 10) || 1,
      propertyId: id,
      timezone,
    });

    if (propertyDetails) {
      const propertyWithUserRating = await this.propertiesService.getPropertyRating(
        propertyDetails,
      );
      propertyDetails.userRating =
        typeof propertyWithUserRating?.userRating !== 'undefined'
          ? propertyWithUserRating.userRating
          : 0;
    }

    // Properties that don't allow hourly booking are quoted for the standard window they
    // will actually be sold at, so the duration label has to match.
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
      propertyDetails.stayDuration = this.checkinService.getStayDuration({
        checkinDate,
        checkoutDate,
        checkinTime,
        checkoutTime,
      });
      // NOTE (legacy parity): this branch keeps the SLASHED dates, while the branch above
      // converts them to dashes. Reproduced as-is.
      propertyDetails.timeDetails = { startDate: checkinDate, endDate: checkoutDate };
    }

    return { data: propertyDetails };
  }
}
