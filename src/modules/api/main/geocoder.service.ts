import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  city?: string;
}

/**
 * Replaces the legacy `node-geocoder` google provider used by
 * `controllers/api/v2/main.js:14-21`, which had its API key committed in source
 * (MIGRATION.md 2g#4 — the key must come from `GOOGLE_MAPS_API_KEY` and the old one
 * must be rotated).
 *
 * Only the fields the redirect route reads are returned: latitude, longitude and the
 * locality component (`node-geocoder`'s `city`).
 */
@Injectable()
export class GeocoderService {
  private readonly logger = new Logger(GeocoderService.name);

  constructor(private readonly config: ConfigService) {}

  async geocode(address: string): Promise<GeocodeResult[]> {
    const apiKey = this.config.get<string>('googleMapsApiKey');
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is not configured');
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Geocoding request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: Array<{ long_name: string; types: string[] }>;
      }>;
    };

    if (body.status !== 'OK' || !body.results?.length) {
      this.logger.warn(`Geocoding returned status ${body.status} for "${address}"`);
      return [];
    }

    return body.results.map((result) => ({
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      city: result.address_components?.find((c) => c.types.includes('locality'))
        ?.long_name,
    }));
  }
}
