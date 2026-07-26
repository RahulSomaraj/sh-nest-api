import { RoomDoc, SearchPriceSummary } from './pricing.types';

/**
 * Local replacements for the handful of lodash / haversine-distance calls the legacy
 * search service makes, so the port keeps its behaviour without pulling in two more
 * runtime dependencies. Each helper matches the semantics the callers rely on.
 */

/** `_.isEmpty` for the array/undefined cases the search code passes. */
export function isEmptyArray(value: unknown[] | undefined | null): boolean {
  return !value || value.length === 0;
}

/** `_.keyBy(list, key)` for string-valued keys. */
export function keyBy<T extends Record<string, unknown>>(
  list: T[],
  key: keyof T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of list) out[String(item[key])] = item;
  return out;
}

/** `_.groupBy(list, key)`. */
export function groupBy<T extends Record<string, unknown>>(
  list: T[],
  key: keyof T,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of list) {
    const k = String(item[key]);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

/** Port of `utils/commonUtils.js#removeFirstOccurrence` — mutates and returns `array`. */
export function removeFirstOccurrence<T>(array: T[], element: T): T[] {
  const indexToRemove = array.indexOf(element);
  if (indexToRemove !== -1) array.splice(indexToRemove, 1);
  return array;
}

const EARTH_RADIUS_METRES = 6371000;

/**
 * Port of `utils/propertyUtils.js#getPropertyDistance`, which wraps the
 * `haversine-distance` package. That package reads a coordinate array as
 * `[latitude, longitude]`.
 *
 * NOTE (legacy parity): the caller passes `[longitude, latitude]` for the search origin
 * and a GeoJSON `coordinates` array (`[lng, lat]`) for the property, so both points are
 * effectively transposed. The value is only ever used to order results, and reproducing
 * it keeps that ordering identical to legacy — do not "fix" the axis order in isolation.
 */
export function getPropertyDistance(
  point1: [number | string, number | string],
  point2: [number | string, number | string],
): number {
  const lat1 = (Number(point1[0]) * Math.PI) / 180;
  const lat2 = (Number(point2[0]) * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((Number(point2[1]) - Number(point1[1])) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

/**
 * Port of `utils/propertyUtils.js#getRoomFinalPrice` — scale every line by the number of
 * rooms selected.
 *
 * `total.amount` / `payNow.amount` arrive as `.toFixed(2)` strings from the search
 * pricing step; legacy multiplied them with `*`, which coerces, so the resulting
 * `finalPrice` always carries numbers. `Number(...)` reproduces that.
 */
export function getRoomFinalPrice(roomData: RoomDoc): SearchPriceSummary {
  const summary = roomData.priceSummary as SearchPriceSummary;
  const n = roomData.numberOfSelectedRooms;
  return {
    ...summary,
    base: {
      ...summary.base,
      amount: summary.base.amount * n,
      savings: summary.base.savings * n,
    },
    taxes: {
      ...summary.taxes,
      breakdown: summary.taxes.breakdown.map((breakdown) => ({
        ...breakdown,
        amount: breakdown.amount * n,
      })),
      amount: summary.taxes.amount * n,
    },
    bookingFee: {
      ...summary.bookingFee,
      amount: summary.bookingFee.amount * n,
    },
    total: { ...summary.total, amount: Number(summary.total.amount) * n },
    payNow: { ...summary.payNow, amount: Number(summary.payNow.amount) * n },
    payAtHotel: {
      ...summary.payAtHotel,
      amount: Number(summary.payAtHotel.amount) * n,
    },
  };
}

/** Port of `utils/propertyUtils.js#selectRoom` — mark a room as chosen and price it. */
export function selectRoom(params: {
  room: RoomDoc;
  numberOfSelectedRooms: number;
}): RoomDoc {
  const { room, numberOfSelectedRooms } = params;
  room.numberOfSelectedRooms = numberOfSelectedRooms;
  room.isSelected = true;
  room.finalPrice = getRoomFinalPrice(room);
  return room;
}
