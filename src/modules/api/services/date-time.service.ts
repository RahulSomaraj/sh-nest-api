import { Injectable } from '@nestjs/common';
import moment from 'moment-timezone';

/**
 * Verbatim port of `stayhopper/services/date-time.js`.
 *
 * Every helper here feeds slot allocation and pricing, so the arithmetic is reproduced
 * exactly — including the quirks (the `getHoursFromTo` loop stopping at midnight, the
 * `startOf('minutes')` truncation). Do not "clean up" this math without a contract test
 * proving the output is unchanged; see CLAUDE.md § Migration rules.
 */
@Injectable()
export class DateTimeService {
  /**
   * Nearest check-in time rounded UP to the next 30 minutes, in `timezone`.
   * @example current time 09:33 => 10:00
   */
  getNearestCheckinTimeMoment(timezone: string): moment.Moment {
    const mins = 30;
    const todayMoment = moment().tz(timezone);
    const remainder = mins - (todayMoment.minute() % mins);
    const nearestCheckinTimeMoment = moment(todayMoment).add(remainder, 'minutes');
    return nearestCheckinTimeMoment.startOf('minutes');
  }

  /** 2 => "02", 12 => "12". */
  getNumberWithLeadingZero(num: number | string): string {
    return `0${num}`.substr(-2);
  }

  /**
   * Half-hour steps from `hoursFromStr` up to (excluding) `hoursToStr`.
   *
   * The loop also stops at midnight, so a range that crosses 00:00 is truncated there —
   * `('22:30','02:00')` yields `["22:30","23:00","23:30","00:00"]`, not the full span.
   * That is legacy behaviour and callers depend on it.
   */
  getHoursFromTo(hoursFromStr: string, hoursToStr: string): string[] {
    const hoursFromArr = hoursFromStr.split(':');
    const hoursToArr = hoursToStr.split(':');
    let currentHour = parseInt(hoursFromArr[0], 10);
    let currentMins = parseInt(hoursFromArr[1], 10);
    const targetHour = parseInt(hoursToArr[0], 10);
    const targetMins = parseInt(hoursToArr[1], 10);
    const hours: string[] = [];
    // do/while so a range starting at 00:00 still emits its first entry.
    do {
      hours.push(
        [
          this.getNumberWithLeadingZero(currentHour),
          this.getNumberWithLeadingZero(currentMins),
        ].join(':'),
      );

      if (currentMins === 0) {
        currentMins = 30;
      } else {
        currentMins = 0;
        currentHour = currentHour + 1 === 24 ? 0 : currentHour + 1;
      }
    } while (
      !(
        (currentHour === targetHour && currentMins === targetMins) ||
        (currentHour === 0 && currentMins === 0)
      )
    );
    return hours;
  }

  /**
   * '12:00' => 'h12', '03:30' => 'h3'.
   *
   * IMPORTANT: an hour key covers BOTH half-hour slots, so a caller pricing a single
   * 30-minute slot must halve the rate stored under the key.
   */
  getHoursKeysFromHours(hours?: string[]): string[] {
    return (hours || []).map((hour) => `h${parseInt(hour.split(':')[0], 10)}`);
  }

  /**
   * Next hourly check-in boundary. `inclusive` rewinds one millisecond so a time that is
   * already exactly on a boundary is accepted instead of being pushed 30 minutes out.
   */
  getNearestHourlyCheckinTimeMoment(date?: Date, inclusive?: boolean): moment.Moment {
    const mins = 30;
    const target = date ? (inclusive ? new Date(date.getTime() - 1) : date) : new Date();

    const targetMoment = moment(target);
    const remainder = mins - (targetMoment.minute() % mins);
    return moment(targetMoment).add(remainder, 'minutes').startOf('minutes');
  }

  /** Next monthly check-in: today at 14:00 if we are still before 14:00, else tomorrow. */
  getNearestMonthlyCheckinTimeMoment(date?: Date, inclusive?: boolean): moment.Moment {
    const checkinHour = 14;
    const target = date ? (inclusive ? new Date(date.getTime() - 1) : date) : new Date();

    const nearestCheckinDateMoment = moment(target);
    if (nearestCheckinDateMoment.hour() >= checkinHour) {
      nearestCheckinDateMoment.add(1, 'days');
    }
    nearestCheckinDateMoment.set({
      hour: 14,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    return nearestCheckinDateMoment;
  }

  /**
   * Default check-in/check-out pair for a booking type: hourly = +3 hours,
   * monthly = +31 days at 12:00.
   */
  getNearestCheckinCheckOutTimes(
    bookingType: string,
    date?: Date,
    inclusive?: boolean,
  ): [moment.Moment, moment.Moment] {
    const target = date || new Date();
    let checkinTimeMoment: moment.Moment;
    let checkoutTimeMoment: moment.Moment;

    if (bookingType === 'hourly') {
      checkinTimeMoment = this.getNearestHourlyCheckinTimeMoment(target, inclusive);
      checkoutTimeMoment = moment(checkinTimeMoment).add(3, 'hours');
    } else {
      checkinTimeMoment = this.getNearestMonthlyCheckinTimeMoment(target, inclusive);
      checkoutTimeMoment = moment(checkinTimeMoment).add(31, 'days');
      checkoutTimeMoment.set({ hour: 12 });
    }
    return [checkinTimeMoment, checkoutTimeMoment];
  }

  getDiffInHours(futureDateMoment: moment.Moment, pastDateMoment: moment.Moment): number {
    return futureDateMoment.diff(pastDateMoment, 'hours');
  }

  getDiffInMins(futureDateMoment: moment.Moment, pastDateMoment: moment.Moment): number {
    return futureDateMoment.diff(pastDateMoment, 'minutes');
  }
}
