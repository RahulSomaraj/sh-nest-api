import { Request, Response, NextFunction } from 'express';
import * as qs from 'qs';

/**
 * audit C-2: NoSQL operator-injection guard.
 *
 * Recursively strips any object key that begins with `$` or contains `.` — the shapes
 * Express's qs parser produces from payloads like `?user[$ne]=` or `?a[$gt]=` and that
 * would otherwise be assigned verbatim into a Mongo filter.
 *
 * Two layers, because req.query in Express 4 is a getter that re-parses on every access
 * (mutating it in a middleware wouldn't stick):
 *   - `sanitizingQueryParser()` replaces the app's query parser so req.query is clean at
 *     the source (this is what actually protects query params).
 *   - `mongoSanitize()` middleware scrubs req.body and req.params (real, writable props).
 */
export function scrub(value: any): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) scrub(item);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
      continue;
    }
    scrub(value[key]);
  }
}

/** Express 'query parser fn' that parses (extended/qs) then strips operator keys. */
export function sanitizingQueryParser() {
  return (str: string) => {
    const parsed = qs.parse(str ?? '', { allowPrototypes: true });
    scrub(parsed);
    return parsed;
  };
}

/** Middleware that scrubs req.body and req.params in place. */
export function mongoSanitize() {
  return (req: Request, _res: Response, next: NextFunction) => {
    scrub(req.body);
    scrub(req.params);
    next();
  };
}
