/**
 * The 48 half-hour slot labels that make up a day (`00:00` … `23:30`).
 *
 * Legacy hardcodes this array in several places (`controllers/api/website.js:507`,
 * `cron.js:547`) and relies on the INDEX of a label lining up with the position of the
 * matching row in the `slots` collection when it is sorted by `_id`. Frozen so a caller
 * can never mutate the shared array.
 */
export const HALF_HOUR_TIMESLOTS: readonly string[] = Object.freeze(
  Array.from({ length: 48 }, (_, i) => {
    const h = String(Math.floor(i / 2)).padStart(2, '0');
    const m = i % 2 === 0 ? '00' : '30';
    return `${h}:${m}`;
  }),
);
