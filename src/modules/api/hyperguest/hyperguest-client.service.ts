import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HgBookingResponse,
  HgCancelRequest,
  HgCreateBookingRequest,
  HgErrorEnvelope,
  HgListBookingsRequest,
  HgPreBookRequest,
  HgPreBookResponse,
  HgPropertyStatic,
  HgSearchParams,
  HgSearchResponse,
  HgStaticHotel,
  HyperGuestApiError,
  toGuestsGrammar,
} from './hyperguest.types';

interface HgConfig {
  enabled: boolean;
  token: string;
  searchUrl: string;
  bookUrl: string;
  staticUrl: string;
  certification: boolean;
  certPropertyId: number;
  agencyReference: string;
  timeoutMs: number;
}

/**
 * Thin typed transport for the HyperGuest API (HYPERGUEST_PLAN.md slab A).
 * Native fetch (repo rule: no axios), bearer auth + gzip on every call,
 * AbortController timeouts, HG error-envelope → HyperGuestApiError, and
 * exponential back-off on 429 for the static host.
 *
 * CERTIFICATION RAILS (hard-coded, not config-switchable):
 *  - every outbound propertyId is asserted against certPropertyId while
 *    `hyperguest.certification` is true (default);
 *  - booking create ALWAYS sends paymentDetails.details.charge:false — a caller
 *    passing charge:true is an error, regardless of certification mode, until a
 *    charging agreement exists (revisit at LIVE cutover).
 */
@Injectable()
export class HyperGuestClientService {
  private readonly logger = new Logger(HyperGuestClientService.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): HgConfig {
    return this.config.get<HgConfig>('hyperguest');
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private assertEnabled(): void {
    if (!this.cfg?.enabled) {
      throw new Error('HyperGuest integration is disabled (HG_ENABLED != true)');
    }
  }

  /** Certification rail: only the certification property may go over the wire. */
  assertCertificationProperty(propertyId: number): void {
    const { certification, certPropertyId } = this.cfg;
    if (certification && propertyId !== certPropertyId) {
      throw new Error(
        `HyperGuest certification mode: propertyId ${propertyId} blocked (only ${certPropertyId} allowed)`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      'Accept-Encoding': 'gzip, deflate',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    url: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    /** Retries with back-off on 429 (static host politeness). */
    retryOn429 = 0,
  ): Promise<T> {
    this.assertEnabled();

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method,
          headers: this.headers(),
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        throw new Error(
          `HyperGuest request failed (${init.method} ${url}): ${(err as Error).message}`,
        );
      }
      clearTimeout(timer);

      if (res.status === 429 && attempt < retryOn429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
        const delayMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 1000 * 2 ** attempt;
        this.logger.warn(`429 from ${url} — backing off ${delayMs}ms (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `HyperGuest non-JSON response (${init.method} ${url}, HTTP ${res.status}): ${text.slice(0, 200)}`,
        );
      }

      // HG returns its error envelope with HTTP 200/400/401/500 alike.
      const envelope = json as Partial<HgErrorEnvelope>;
      if (envelope && typeof envelope.errorCode === 'string') {
        throw new HyperGuestApiError(
          envelope.errorCode,
          envelope.error || 'Unknown HyperGuest error',
          res.status,
          envelope.errorDetails,
        );
      }
      if (!res.ok) {
        throw new Error(`HyperGuest HTTP ${res.status} (${init.method} ${url})`);
      }
      return json as T;
    }
  }

  // -------------------------------------------------------------------------
  // Static content (discovery + hotel content)
  // -------------------------------------------------------------------------

  /** Full hotels feed — the only "new hotels" discovery mechanism HG offers. */
  getHotels(): Promise<HgStaticHotel[]> {
    return this.request<HgStaticHotel[]>(
      `${this.cfg.staticUrl}hotels.json`,
      { method: 'GET' },
      3,
    );
  }

  getPropertyStatic(hotelId: number): Promise<HgPropertyStatic> {
    return this.request<HgPropertyStatic>(
      `${this.cfg.staticUrl}${hotelId}/property-static.json`,
      { method: 'GET' },
      3,
    );
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  // async so guard failures reject instead of throwing synchronously.
  async search(params: HgSearchParams): Promise<HgSearchResponse> {
    for (const id of params.propertyIds) this.assertCertificationProperty(id);
    const qs = new URLSearchParams({
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      propertyIds: params.propertyIds.join(','),
      guests: toGuestsGrammar(params.guests),
    });
    if (params.nationality) qs.set('nationality', params.nationality);
    if (params.currency) qs.set('currency', params.currency);
    return this.request<HgSearchResponse>(`${this.cfg.searchUrl}?${qs.toString()}`, {
      method: 'GET',
    });
  }

  // -------------------------------------------------------------------------
  // Booking (NOTE: dev token cannot pre-book or create — exercised only under
  // HyperGuest's certification runbook, then LIVE token)
  // -------------------------------------------------------------------------

  async preBook(body: HgPreBookRequest): Promise<HgPreBookResponse> {
    this.assertCertificationProperty(body.search.propertyId);
    return this.request<HgPreBookResponse>(`${this.cfg.bookUrl}booking/pre-book`, {
      method: 'POST',
      body,
    });
  }

  async createBooking(body: HgCreateBookingRequest): Promise<HgBookingResponse> {
    this.assertCertificationProperty(body.propertyId);
    // HARD RAIL: charging the card is forbidden without a charging agreement.
    // charge is forced to literal false; a caller asking for true is a bug.
    if (body.paymentDetails?.details?.charge === true) {
      throw new Error(
        'HyperGuest: paymentDetails.details.charge:true is forbidden (no charging agreement — see HYPERGUEST_PLAN.md)',
      );
    }
    const safeBody: HgCreateBookingRequest = {
      ...body,
      paymentDetails: {
        ...body.paymentDetails,
        details: { ...(body.paymentDetails?.details || {}), charge: false },
      },
    };
    return this.request<HgBookingResponse>(`${this.cfg.bookUrl}booking/create`, {
      method: 'POST',
      body: safeBody,
    });
  }

  cancelBooking(body: HgCancelRequest): Promise<HgBookingResponse> {
    return this.request<HgBookingResponse>(`${this.cfg.bookUrl}booking/cancel`, {
      method: 'POST',
      body,
    });
  }

  getBooking(bookingId: string): Promise<HgBookingResponse> {
    return this.request<HgBookingResponse>(
      `${this.cfg.bookUrl}booking/get/${encodeURIComponent(bookingId)}`,
      { method: 'GET' },
    );
  }

  /** Reconciliation fallback — poll with filters.agencyReference. */
  listBookings(body: HgListBookingsRequest): Promise<HgBookingResponse[]> {
    return this.request<HgBookingResponse[]>(`${this.cfg.bookUrl}booking/list`, {
      method: 'POST',
      body,
    });
  }
}
