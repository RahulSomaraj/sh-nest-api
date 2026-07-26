import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { cached } from '../../../common/cache/ttl-cache';
import { DateTimeService } from '../services/date-time.service';
import { OffersService } from '../services/offers.service';
import { PropertiesDataService } from '../services/properties-data.service';
import { PropertyDoc, SearchResult } from '../services/pricing.types';
import { GeocoderService } from './geocoder.service';

/**
 * TTL for the `/api/main/v2/*` responses.
 *
 * MIGRATION.md 2g#7: legacy cached these in module-level `let` variables that were
 * populated on the first request and then NEVER invalidated — a price change or a new
 * offer only appeared after a process restart. A 5-minute TTL keeps the load-shedding
 * benefit without serving indefinitely stale prices.
 */
const V2_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The `/api/main` surface — MIGRATION.md 2c. Ported from
 * `controllers/api/v2/main.js`.
 */
@Injectable()
export class MainService {
  constructor(
    private readonly config: ConfigService,
    private readonly dateTimeService: DateTimeService,
    private readonly offersService: OffersService,
    private readonly propertiesService: PropertiesDataService,
    private readonly geocoder: GeocoderService,
    @InjectModel('app_version') private readonly appVersionModel: Model<any>,
  ) {}

  /** M2 — `GET /api/main/app/version/:appType?`. */
  async appVersion(appType?: string) {
    if (appType === 'ios' || appType === 'android') {
      const resource = await this.appVersionModel.findOne({ appType }).exec();
      if (!resource) {
        throw new NotFoundException({ message: 'Sorry, resource does not exist' });
      }
      return { success: true, data: resource };
    }

    // No appType: the most recently inserted row, whichever platform it belongs to.
    const latestAppVersion = await this.appVersionModel
      .find()
      .select('-_id')
      .sort({ _id: -1 })
      .exec();
    return { success: true, data: latestAppVersion[0] };
  }

  /**
   * M3 — `GET /api/main/redirect/:encodedParams`.
   * Decodes a base64 JSON payload (`{ route | location, bookingType }`), geocodes it,
   * and returns the search query the website should navigate to.
   */
  async redirect(encodedParams: string) {
    const decodedString = JSON.parse(
      Buffer.from(encodedParams, 'base64').toString('utf8'),
    ) as { route?: unknown; location?: string; bookingType?: string };

    const stringToSearch = decodedString.route
      ? String(decodedString.route)
      : decodedString.location;

    const result = await this.geocoder.geocode(stringToSearch);
    const bookingType = decodedString.bookingType || 'hourly';

    const [earliestCheckinTimeMoment, earliestCheckoutTimeMoment] =
      this.dateTimeService.getNearestCheckinCheckOutTimes(bookingType);

    // Legacy formats these as D-M-YYYY (no zero padding) — the website parses that form.
    const formatDate = (d: Date) =>
      `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;

    return {
      success: 'true',
      params: {
        location: `${result[0].latitude},${result[0].longitude}`,
        inTime: earliestCheckinTimeMoment.format('HH:mm'),
        outTime: earliestCheckoutTimeMoment.format('HH:mm'),
        inDate: formatDate(earliestCheckinTimeMoment.toDate()),
        outDate: formatDate(earliestCheckoutTimeMoment.toDate()),
        Adults: 2,
        Rooms: 1,
        bookingType,
      },
      localstorage: {
        locationName: result[0].city,
        locationCoordinates: `${result[0].latitude},${result[0].longitude}`,
      },
    };
  }

  /** M4 — `POST /api/main/city`. */
  async city(cityId: string, timezone: string) {
    const avgRateOfACity = await this.propertiesService.getAvgNightlyRateForCity({
      cityId: cityId || '',
      timezone,
    });
    return { data: avgRateOfACity };
  }

  /** M5 — `GET /api/main/home`: offers + cheapest + popular + city averages. */
  async home(timezone: string) {
    const offers = await this.offersService.getOffers();
    const cheapestProperties = await this.propertiesService.getCheapestProperties({
      timezone,
    });
    const popularProperties = await this.propertiesService.getPopularProperties({
      timezone,
    });
    const cities = await this.propertiesService.getAvgNightlyRateForCitiesOfACountry({
      timezone,
      countryId: this.config.get<string>('countryId.UAE'),
    });

    return { offers, popularProperties, cheapestProperties, cities };
  }

  /** M6 — `POST /api/main/cities`. */
  async cities(countryId: string | undefined, timezone: string) {
    const data = await this.propertiesService.getAvgNightlyRateForCitiesOfACountry({
      timezone,
      countryId: countryId || this.config.get<string>('countryId.UAE'),
    });
    return { data };
  }

  /** M7 — `GET /api/main/offers`. */
  async offers() {
    return { data: await this.offersService.getOffers() };
  }

  /** M8 — `GET /api/main/hotels-cheapest`. */
  async hotelsCheapest(timezone: string) {
    return { data: await this.propertiesService.getCheapestProperties({ timezone }) };
  }

  /** M9 — `GET /api/main/hotels-popular`. */
  async hotelsPopular(timezone: string) {
    return { data: await this.propertiesService.getPopularProperties({ timezone }) };
  }

  /**
   * Strip the heavy/internal keys from a cached property list — port of the `filterData`
   * helper in `main.js:282`.
   */
  private static filterData(dataOriginal: SearchResult): SearchResult {
    if (dataOriginal?.list?.length) {
      for (const data of dataOriginal.list as PropertyDoc[]) {
        delete data.agreement;
        delete data.contactinfo;
        delete data.rooms;
      }
    }
    return dataOriginal;
  }

  /** M10 — `POST /api/main/v2/cities` (cached). */
  async citiesV2(countryId: string | undefined, timezone: string) {
    const resolvedCountryId = countryId || this.config.get<string>('countryId.UAE');
    const cities = await cached(`main:v2:cities:${resolvedCountryId}`, V2_CACHE_TTL_MS, () =>
      this.propertiesService.getAvgNightlyRateForCitiesOfACountry({
        timezone,
        countryId: resolvedCountryId,
      }),
    );
    return { cities };
  }

  /** M11 — `GET /api/main/v2/offers` (cached). */
  async offersV2() {
    const offers = await cached('main:v2:offers', V2_CACHE_TTL_MS, () =>
      this.offersService.getOffers(),
    );
    return { offers };
  }

  /** M12 — `GET /api/main/v2/hotels-cheapest` (cached). */
  async hotelsCheapestV2(timezone: string) {
    const cheapestProperties = await cached(
      'main:v2:hotels-cheapest',
      V2_CACHE_TTL_MS,
      async () =>
        MainService.filterData(
          await this.propertiesService.getCheapestProperties({ timezone }),
        ),
    );
    return { cheapestProperties };
  }

  /**
   * M13 — `GET /api/main/v2/hotels-popular` (cached).
   *
   * MIGRATION.md 2g: legacy wrote `await filterData(getPopularProperties(...))` — it
   * awaited `filterData` rather than the promise passed into it, so the cache held an
   * unresolved Promise and the route returned `{}` from the second request onwards.
   * The intended behaviour (await the data, then filter) is implemented here.
   */
  async hotelsPopularV2(timezone: string) {
    const popularProperties = await cached(
      'main:v2:hotels-popular',
      V2_CACHE_TTL_MS,
      async () =>
        MainService.filterData(
          await this.propertiesService.getPopularProperties({ timezone }),
        ),
    );
    return { popularProperties };
  }
}
