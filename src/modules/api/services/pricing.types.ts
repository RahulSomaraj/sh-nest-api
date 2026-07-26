/**
 * Shapes used by the ported pricing/search services (`services/properties.js`,
 * `services/search.js`, `services/propertyDetail.js`).
 *
 * These documents come out of raw aggregation pipelines rather than a Mongoose schema,
 * so the fields below describe exactly what the legacy code reads and writes. Anything
 * the pipeline carries through untouched is covered by the index signature.
 */

export interface RateBand {
  fullDay?: number;
  standardDay?: number;
  hours?: Record<string, number>;
}

export interface RoomRate {
  _id?: unknown;
  name?: string;
  isDefault?: boolean;
  rateType?: string;
  recurring?: boolean;
  dateFrom?: string;
  dateTo?: string;
  minimumBookingRate?: number;
  weekday?: RateBand;
  weekend?: RateBand;
  [key: string]: unknown;
}

export interface Charge {
  name?: string;
  chargeType?: string;
  value?: number;
  [key: string]: unknown;
}

export interface PriceLine {
  label: string;
  amount: number;
  currency?: unknown;
  savings?: number;
}

export interface TaxSummary {
  label: string;
  breakdown: Array<{ label: string; amount: number }>;
  amount: number;
}

export interface PriceSummary {
  base: PriceLine;
  taxes: TaxSummary;
  bookingFee: PriceLine;
  total: PriceLine;
  payNow: PriceLine;
  payAtHotel: PriceLine;
}

/**
 * The search surface's variant. `search.js` writes `total.amount` and (for hourly)
 * `payNow.amount` via `.toFixed(2)`, so those land in the response as STRINGS. That is
 * what sh-website receives today, so the type admits it rather than silently
 * normalising and changing the payload.
 */
export interface LoosePriceLine {
  label: string;
  amount: number | string;
  currency?: unknown;
  savings?: number;
}

export interface SearchPriceSummary {
  base: PriceLine;
  taxes: TaxSummary;
  bookingFee: PriceLine;
  total: LoosePriceLine;
  payNow: LoosePriceLine;
  payAtHotel: LoosePriceLine;
}

export interface HourAndPrice {
  hour: string;
  price: number;
}

/** Result of resolving the applicable rate for one segment of a stay. */
export interface RateForDate {
  rate: number;
  minimumBookingRate?: number;
  minimumBookingHourRate?: number;
  hoursAndPrices?: HourAndPrice[];
  standardRate?: number;
}

export interface RoomDoc {
  _id?: unknown;
  property?: PropertyDoc;
  rates?: RoomRate[];
  number_rooms?: number;
  number_of_guests?: { value?: number; childrenValue?: number };
  priceSummary?: PriceSummary | SearchPriceSummary | Record<string, never>;
  numberOfRoomsInventory?: number;
  numberOfRoomsBlocked?: number;
  numberOfRoomsAvailable?: number;
  adultsCapacity?: number;
  childrenCapacity?: number;
  numberOfSelectedRooms?: number;
  isSelected?: boolean;
  finalPrice?: SearchPriceSummary;
  [key: string]: unknown;
}

export interface ContactInfo {
  country?: { _id?: unknown; [key: string]: unknown };
  city?: { _id?: unknown; [key: string]: unknown };
  latlng?: number[];
  address_1?: string;
  address_2?: string;
  mobile?: string;
  [key: string]: unknown;
}

export interface PropertyDoc {
  _id?: unknown;
  name?: string;
  currency?: { code?: string; [key: string]: unknown };
  contactinfo?: ContactInfo;
  charges?: Charge[];
  weekends?: string[];
  anyTimeCheckin?: boolean;
  allowedHourlyBooking?: boolean;
  rooms?: RoomDoc[];
  priceSummary?: PriceSummary | SearchPriceSummary;
  numberOfSelectedRooms?: number;
  agreement?: { commissionHourly?: number; [key: string]: unknown };
  location?: { coordinates?: number[]; [key: string]: unknown };
  userRating?: number;
  distance?: number;
  numberOfRoomsAvailable?: number;
  timeDetails?: { startDate: string; endDate: string };
  stayDuration?: unknown;
  [key: string]: unknown;
}

/** Query parameters shared by the search entry points. */
export interface SearchParams {
  location?: string;
  checkinDate?: string;
  checkoutDate?: string;
  checkinTime?: string;
  checkoutTime?: string;
  cityId?: string;
  countryId?: string;
  numberAdults?: number | string;
  numberChildren?: number | string;
  numberRooms?: number | string;
  properties?: string;
  rooms?: string;
  isTestingRates?: boolean;
  timezone?: string;
  isAllowGuestFilter?: boolean;
  priceMin?: number;
  priceMax?: number;
  propertyTypes?: string;
  propertyRatings?: string;
  roomTypes?: string;
  bedTypes?: string;
  amenities?: string;
  bookingType?: string;
  limit?: number;
  sort?: string;
  orderBy?: string;
  page?: number;
}

export interface SearchOptions {
  sort?: string;
  orderBy?: string;
  limit?: number;
  page?: number;
}

export interface SearchResult {
  list: PropertyDoc[];
  count: number;
  page: number;
  totalPages: number;
  query: Record<string, unknown>;
}
