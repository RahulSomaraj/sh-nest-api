import { randomBytes, randomInt } from 'crypto';

/**
 * audit (auth hardening): cryptographically secure replacements for the legacy
 * `Math.floor(Math.random() * 9000) + 1000` 4-digit codes (only 9000 values, trivially
 * brute-forceable).
 */

/**
 * A secure numeric code for values a human types (e.g. email activation code).
 * Uses crypto.randomInt (uniform, no modulo bias). Default 6 digits = 900k space,
 * which, combined with per-endpoint throttling, makes brute force infeasible.
 */
export function secureNumericCode(digits = 6): string {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  return String(randomInt(min, max));
}

/**
 * A high-entropy token for values delivered via link (e.g. auto-login token in a URL).
 * 24 bytes = 192 bits of entropy, hex-encoded.
 */
export function secureToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}
