/**
 * HyperGuest API contracts — captured 2026-07-13 from HyperGuest Hub
 * (https://hub.hyperguest.io/demand/basic). MIGRATION.md phase 4.
 *
 * Auth on every API call: `Authorization: Bearer <token>` +
 * `Accept-Encoding: gzip, deflate`.
 *
 * Endpoints:
 *   Search   GET  {searchUrl}/?<query>
 *   Pre-book POST {bookUrl}booking/pre-book
 *   Create   POST {bookUrl}booking/create
 *   Cancel   POST {bookUrl}booking/cancel
 *   Get      GET  {bookUrl}booking/get/{bookingId}
 *   List     POST {bookUrl}booking/list
 *   Static   GET  {staticUrl}hotels.json  +  {staticUrl}{hotelId}/property-static.json
 *            (429 = back off; supports last_updated deltas)
 */

// ---------------------------------------------------------------------------
// Statuses & errors
// ---------------------------------------------------------------------------

/** Booking lifecycle. Pending resolves to Confirmed or Rejected (reconciliation). */
export type HgBookingStatus = 'Confirmed' | 'Pending' | 'Rejected' | 'Cancelled' | 'Failed';

/**
 * Error envelope returned with HTTP 200/400/401/500.
 * errorCode = "<subsystem>.<code>", e.g. "BN.402".
 */
export interface HgErrorEnvelope {
  error: string;
  errorCode: string;
  errorDetails?: unknown[];
}

/** Known error codes. BN.402 and BN.502 are the book-time re-quote/retry triggers. */
export const HG_ERROR_CODES = {
  SEARCH_BAD_REQUEST: 'SN.400',
  SEARCH_UNAUTHORIZED: 'SN.401',
  SEARCH_INTERNAL: 'SN.500',
  BOOK_BAD_REQUEST: 'BN.400',
  BOOK_UNAUTHORIZED: 'BN.401',
  BOOK_PRICE_CHANGED: 'BN.402',
  BOOK_INTERNAL: 'BN.500',
  BOOK_ERROR: 'BN.501',
  BOOK_AVAILABILITY_GONE: 'BN.502',
  BOOK_PROPERTY_SETUP: 'BN.503',
  BOOK_ARI_REPORT: 'BN.505',
  BOOK_NO_CREDIT: 'BN.506',
  BOOK_CARD: 'BN.507',
} as const;

/** Typed error thrown by HyperGuestClientService for HG error envelopes. */
export class HyperGuestApiError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus: number,
    public readonly errorDetails?: unknown[],
  ) {
    super(`HyperGuest ${errorCode}: ${message}`);
    this.name = 'HyperGuestApiError';
  }

  get isPriceChanged(): boolean {
    return this.errorCode === HG_ERROR_CODES.BOOK_PRICE_CHANGED;
  }

  get isAvailabilityGone(): boolean {
    return this.errorCode === HG_ERROR_CODES.BOOK_AVAILABILITY_GONE;
  }
}

// ---------------------------------------------------------------------------
// Static feed
// ---------------------------------------------------------------------------

/** One row of {staticUrl}hotels.json — the discovery feed. */
export interface HgStaticHotel {
  hotel_id: number;
  name: string;
  country: string;
  city: string;
  region: string;
  city_Id: number;
  /** Delta marker — refetch property-static when this moves. */
  last_updated: string;
  version: number;
}

/**
 * {staticUrl}{hotelId}/property-static.json — full hotel content.
 *
 * Top-level keys CONFIRMED against live payloads (2026-07-27, 333 UAE hotels):
 *   id, hotelOrganizationId, hotelChainId, name, rating, group, status,
 *   coordinates, location, contact, updated, created, isTest, version,
 *   commission, settings, logo, contacts, descriptions, rooms, roomMap, images,
 *   facilities, policies, ratePlans, ratePlanMap, taxesFees, tags, attributes,
 *   taxId, allowSell, ariType, rateType, childPriceType, usePaxConversion,
 *   usePricePerRoom, useDDO, bookingComUrl, roomsAndRatePlansMapping
 *
 * The two that bit us: `images` is `{type, uri, priority, size, …}[]` (the URL key
 * is `uri`), and descriptions live under the PLURAL `descriptions` as
 * `{language, type, description}[]` — there is no singular `description`. The
 * index signature stays because most of the above is still unmodelled; access
 * goes through the extractors in hyperguest-sync.service.ts.
 */
export interface HgPropertyStatic {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** One room of a search request: 2 adults + children aged 11 and 12 → "2-11,12". */
export interface HgGuestsRoom {
  adults: number;
  childrenAges?: number[];
}

/**
 * Serialize rooms to the HG guests grammar: rooms joined by '.', each room
 * "adults-childAge,childAge". e.g. [{2,[11,12]},{2,[11,12]}] → "2-11,12.2-11,12".
 */
export function toGuestsGrammar(rooms: HgGuestsRoom[]): string {
  return rooms
    .map((r) =>
      r.childrenAges && r.childrenAges.length
        ? `${r.adults}-${r.childrenAges.join(',')}`
        : String(r.adults),
    )
    .join('.');
}

export interface HgSearchParams {
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
  propertyIds: number[];
  /** ISO 3166-1 alpha-2 */
  nationality?: string;
  guests: HgGuestsRoom[];
  currency?: string;
}

export interface HgPrices {
  net?: number;
  sell?: number;
  commission?: number;
  bar?: number;
  fees?: unknown;
  taxes?: unknown;
  currency?: string;
  [key: string]: unknown;
}

export interface HgCancellationPolicy {
  [key: string]: unknown;
}

export interface HgRatePlanPayment {
  /** Who charges the guest. */
  charge?: 'agent' | 'customer';
  chargeType?: 'net' | 'sell';
  [key: string]: unknown;
}

export interface HgRatePlan {
  ratePlanId?: string;
  rateCode?: string;
  prices: HgPrices;
  cancellationPolicies?: HgCancellationPolicy[];
  payment?: HgRatePlanPayment;
  /** false = on-request → booking lands as Pending. */
  isImmediate?: boolean;
  [key: string]: unknown;
}

export interface HgSearchRoom {
  roomId?: string;
  roomCode?: string;
  name?: string;
  ratePlans: HgRatePlan[];
  [key: string]: unknown;
}

export interface HgSearchResult {
  propertyInfo: { propertyId?: number; [key: string]: unknown };
  rooms: HgSearchRoom[];
  [key: string]: unknown;
}

export interface HgSearchResponse {
  results?: HgSearchResult[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pre-book
// ---------------------------------------------------------------------------

export interface HgPreBookRequest {
  search: {
    dates: { from: string; to: string };
    propertyId: number;
    nationality?: string;
    pax: Array<{ adults: number; children?: number[] }>;
  };
  rooms: Array<{
    roomCode?: string;
    roomId?: string;
    rateCode?: string;
    ratePlanId?: string;
    expectedPrice: { amount: number; currency: string };
  }>;
  meta?: Array<{ key: string; value: string }>;
}

export interface HgPreBookRoom {
  /** Present when the price moved between search and pre-book. */
  priceChange?: { fromAmount: number; toAmount: number };
  [key: string]: unknown;
}

export interface HgPreBookResponse {
  content?: {
    paymentOptions?: unknown;
    rooms?: HgPreBookRoom[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Booking create / cancel / get / list
// ---------------------------------------------------------------------------

export type HgGuestTitle = 'MR' | 'MS' | 'MRS' | 'C';

export interface HgLeadGuest {
  /** Contact is mandatory. */
  contact: { email?: string; phone?: string; [key: string]: unknown };
  name?: { first?: string; last?: string; [key: string]: unknown };
  title?: HgGuestTitle;
  [key: string]: unknown;
}

export type HgPaymentType = 'credit_card' | 'credit_balance' | 'bank_transfer' | 'external';

export interface HgCreateBookingRequest {
  /** Max 30 nights. */
  dates: { from: string; to: string };
  propertyId: number;
  leadGuest: HgLeadGuest;
  reference?: { agency?: string; [key: string]: unknown };
  paymentDetails: {
    type: HgPaymentType;
    details?: {
      /**
       * MUST be false unless a charging agreement exists.
       * Certification: always false — enforced in the client, not here.
       */
      charge?: boolean;
      [key: string]: unknown;
    };
  };
  rooms: Array<{
    sel: unknown;
    guests?: unknown[];
    specialRequests?: string[];
    [key: string]: unknown;
  }>;
  meta?: Array<{ key: string; value: string }>;
}

export interface HgBookingRoom {
  itemId?: string;
  /** Present on cancel simulation responses. */
  cancelSimulation?: boolean;
  [key: string]: unknown;
}

export interface HgBookingResponse {
  content?: {
    /** Use for cancel/get/list. */
    bookingId?: string;
    rooms?: HgBookingRoom[];
    status?: HgBookingStatus | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HgCancelRequest {
  bookingId: string;
  /** Max 256 chars. */
  reason?: string;
  /** true = dry-run: returns the penalty, does NOT cancel. Penalty timing is property-local tz. */
  simulation?: boolean;
}

export interface HgListBookingsRequest {
  filters?: {
    dates?: { from?: string; to?: string };
    agencyReference?: string;
    clientEmail?: string;
    /** ≤ 100 */
    limit?: number;
    page?: number;
  };
}

// ---------------------------------------------------------------------------
// Sync bookkeeping (hg_sync_runs docs)
// ---------------------------------------------------------------------------

/**
 * Run lifecycle. The doc is written as `running` BEFORE the loop so an interrupted
 * run (crash/deploy/restart mid-flight) still leaves an audit trail, and so a
 * concurrent run can detect the lock. Terminal states are `completed` / `failed`.
 */
export type HgSyncRunStatus = 'running' | 'completed' | 'failed';

export interface HgSyncSummary {
  trigger: 'cron' | 'manual';
  status: HgSyncRunStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  feedTotal: number;
  /** Hotels excluded by certification mode (everything except 19912). */
  skippedByCertification: number;
  /**
   * Hotels excluded by the scope filter (HG_COUNTRIES / HG_CITIES / HG_CITY_IDS).
   * Counted separately from certification skips: one is a compliance rail, the
   * other is "we don't sell there". Field name kept as-is now that countries are
   * also a scope lever — renaming it would break the persisted run shape.
   */
  skippedByCity: number;
  /** Scope actually applied this run — recorded so a run is interpretable later. */
  scope?: { countries: string[]; cities: string[]; cityIds: number[] };
  /**
   * Repeated hotel_ids collapsed out of the feed before materializing. HG's
   * hotels.json really does repeat ids; without the dedupe each repeat took the
   * create branch again and orphaned the previous property (46% of a full run).
   */
  duplicatesCollapsed: number;
  created: number;
  updated: number;
  /**
   * Hotels deactivated this run: gone from the feed OR fallen outside the current
   * city scope. Never deleted — bookings may reference the property.
   */
  unpublished: number;
  unchanged: number;
  /**
   * First MAX_STORED_ERRORS failures only — the full array across a 53k-hotel feed
   * can approach the 16MB BSON limit, which would throw away the whole summary at
   * exactly the moment it matters. Use errorCount for the true total.
   */
  errors: Array<{ hotel_id: number; message: string }>;
  errorCount: number;
  /** Post-run invariant: active hg_hotels === published HyperGuest properties. */
  invariantOk: boolean;
  ok: boolean;
}
