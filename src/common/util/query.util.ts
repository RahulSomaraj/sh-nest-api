import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * audit C-2/C-3: helpers for safely handling user-supplied query/path values before
 * they reach a Mongo filter.
 */

/** Escape regex metacharacters so user input can't cause ReDoS / injection. */
export function escapeRegex(input: unknown): string {
  return String(input ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coerce a value that is meant to be a Mongo ObjectId. Rejects objects (operator
 * injection like { $ne: null }) and malformed ids. Returns an ObjectId.
 */
export function toObjectId(value: unknown, field = 'id'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return new Types.ObjectId(value);
}

/**
 * Coerce an optional filter value that must be a plain scalar (string/number).
 * Returns undefined for empty; throws on objects/arrays (injection attempts).
 * Use for `where[x] = query.x` assignments where x is not necessarily an id.
 */
export function scalarOrThrow(value: unknown, field = 'value'): string | number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new BadRequestException(`Invalid ${field}`);
}
