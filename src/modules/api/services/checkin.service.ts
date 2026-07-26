import { Injectable } from '@nestjs/common';
import moment from 'moment';
import { DateTimeService } from './date-time.service';

/** One night/segment of a stay, as consumed by the pricing code. */
export interface StayDetailParams {
  date: string;
  rateType: 'fullDay' | 'standardDay';
  hours: string[];
  hoursKeys: string[];
}

export interface StayDurationInput {
  checkinDate?: string;
  checkoutDate?: string;
  checkinTime?: string;
  checkoutTime?: string;
}

export interface StayDuration {
  label: string;
  fullLabel: string;
  value: number | string;
  unit: string;
}

interface PreciseDiff {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  firstDateWasLater: boolean;
}

/** value === 1 ? singular : plural — port of `services/generic.js`. */
function pluralize(val: number | string, singular: string, plural: string): string {
  return val === 1 ? singular : plural;
}

/**
 * Verbatim port of `stayhopper/services/checkin.js`.
 *
 * This decides how a stay is split into billable segments ("standardDay" 14:00→12:00
 * blocks vs. loose hourly runs) and how its duration is labelled. It is the input to
 * every price the customer sees, so the branching is reproduced exactly, comments and
 * all. Any change here changes what guests are charged.
 */
@Injectable()
export class CheckinService {
  constructor(private readonly dateTimeService: DateTimeService) {}

  /**
   * Split a stay into per-segment pricing params.
   *
   * Walks forward from check-in. At each step it decides whether a full 22-hour
   * "standard day" (14:00 → 12:00 next day) fits before check-out; if it does the whole
   * block is billed at the standard-day rate, otherwise the remaining half-hour slots of
   * that day are billed individually.
   */
  getDatesAndHoursStayParams(params: {
    checkinDate: string;
    checkinTime: string;
    checkoutDate: string;
    checkoutTime: string;
  }): StayDetailParams[] {
    const checkinDateMoment = moment(
      `${params.checkinDate} ${params.checkinTime}`,
      'DD/MM/YYYY HH:mm',
    );
    const checkoutDateMoment = moment(
      `${params.checkoutDate} ${params.checkoutTime}`,
      'DD/MM/YYYY HH:mm',
    );

    let timeRemaining = this.dateTimeService.getDiffInMins(
      checkoutDateMoment,
      checkinDateMoment,
    );

    let currentCheckinDateMoment = moment(checkinDateMoment);
    const stayDetailParams: StayDetailParams[] = [];

    do {
      const checkinTimeStr = currentCheckinDateMoment.format('HH:mm');
      let checkoutTimeStr = '00:00';
      if (
        currentCheckinDateMoment.format('DD/MM/YYYY') ===
        checkoutDateMoment.format('DD/MM/YYYY')
      ) {
        checkoutTimeStr = checkoutDateMoment.format('HH:mm');
      }

      const checkinTimeHours = parseInt(currentCheckinDateMoment.format('HH'), 10);
      let rateType: 'fullDay' | 'standardDay' = 'fullDay';
      let hours: string[] = [];

      if (checkinTimeHours >= 14 && checkinTimeHours <= 18 && checkinTimeStr !== '18:30') {
        // Scenario 1: a standard check-in window — does a whole 22h block fit?
        const nextDateForStandardCheckinMoment = moment(currentCheckinDateMoment).add(
          22,
          'hours',
        );
        if (nextDateForStandardCheckinMoment.isSameOrBefore(checkoutDateMoment)) {
          rateType = 'standardDay';
        } else {
          hours = this.dateTimeService.getHoursFromTo(checkinTimeStr, checkoutTimeStr);
        }
      } else if (checkinTimeHours < 14) {
        // Scenario 2: before 14:00 — check whether TODAY's 14:00 standard day fits.
        const supposeNextDay = moment(currentCheckinDateMoment);
        supposeNextDay.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
        const nextDateForStandardCheckinMoment = moment(supposeNextDay).add(22, 'hours');

        if (nextDateForStandardCheckinMoment.isSameOrBefore(checkoutDateMoment)) {
          const previousDayParams = stayDetailParams[stayDetailParams.length - 1];
          if (previousDayParams && previousDayParams.rateType === 'standardDay') {
            // Back-to-back standard days: jump straight to the next standard block.
            rateType = 'standardDay';
            currentCheckinDateMoment.set({
              hour: 14,
              second: 0,
              minute: 0,
              millisecond: 0,
            });
          } else {
            // Otherwise bill the run up to 14:00 hourly, then restart the loop there.
            checkoutTimeStr = '14:00';
            hours = this.dateTimeService.getHoursFromTo(checkinTimeStr, checkoutTimeStr);
          }
        } else {
          // No standard day fits — bill the rest of the day hourly.
          hours = this.dateTimeService.getHoursFromTo(checkinTimeStr, checkoutTimeStr);
        }
      } else {
        // Scenario 3: after the standard window — hours of the remaining day.
        hours = this.dateTimeService.getHoursFromTo(checkinTimeStr, checkoutTimeStr);
      }

      stayDetailParams.push({
        date: currentCheckinDateMoment.format('DD/MM/YYYY'),
        rateType,
        hours,
        hoursKeys: this.dateTimeService.getHoursKeysFromHours(hours),
      });

      if (rateType === 'standardDay') {
        // Next segment starts 22 hours later (i.e. at the same time next day).
        currentCheckinDateMoment = moment(currentCheckinDateMoment).add(22, 'hours');
      } else if (checkoutTimeStr === '00:00') {
        // Ran to midnight — continue at 00:00 the next day.
        currentCheckinDateMoment = moment(currentCheckinDateMoment).add(1, 'days');
        currentCheckinDateMoment.set({
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
        });
      } else {
        // Stopped part-way through the day — continue from that time.
        const newCheckinTime = checkoutTimeStr.split(':');
        currentCheckinDateMoment.set({
          hour: parseInt(newCheckinTime[0], 10),
          minute: parseInt(newCheckinTime[1], 10),
          second: 0,
          millisecond: 0,
        });
      }

      timeRemaining = this.dateTimeService.getDiffInMins(
        checkoutDateMoment,
        currentCheckinDateMoment,
      );
    } while (timeRemaining);

    return stayDetailParams;
  }

  /**
   * Human stay-duration label, e.g. "3 Hours", "2 Days", "1 Month", "3+ Months".
   * `fullLabel` adds the leftover hours for multi-day hourly stays ("2 Days, 7 Hours").
   */
  getStayDuration({
    checkinDate,
    checkoutDate,
    checkinTime,
    checkoutTime,
  }: StayDurationInput): StayDuration {
    let value: number | string = '';
    let unit = '';
    let label = '';
    let fullLabel = '';

    if (checkinDate && checkoutDate && checkinTime && checkoutTime) {
      const checkinDateMoment = moment(
        `${checkinDate} ${checkinTime}`,
        'DD/MM/YYYY HH:mm',
      );
      const checkoutDateMoment = moment(
        `${checkoutDate} ${checkoutTime}`,
        'DD/MM/YYYY HH:mm',
      );
      const isStandardDayBooking = checkinTime === '14:00' && checkoutTime === '12:00';

      if (isStandardDayBooking) {
        const daysDiff = checkoutDateMoment.diff(checkinDateMoment, 'days');
        if (daysDiff < 30) {
          value = checkoutDateMoment.diff(checkinDateMoment, 'days') + 1;
          unit = 'days';
          label = `${value} ${pluralize(value, 'Day', 'Days')}`;
        } else if (daysDiff < 31) {
          value = 1;
          unit = 'months';
          label = '1 Month';
        } else {
          value = checkoutDateMoment.diff(checkinDateMoment, 'months');
          unit = 'months';
          label = value === 12 ? `${value} Months` : `${value}+ Months`;
        }
        // Standard-day bookings have no loose hours, so both labels match.
        fullLabel = label;
      } else {
        const hours = checkoutDateMoment.diff(checkinDateMoment, 'hours');
        const totalDuration = moment.duration(
          checkoutDateMoment.diff(checkinDateMoment),
        );
        const minutes = Math.trunc(totalDuration.asMinutes()) % 60;

        if (hours <= 24) {
          // A trailing part-hour is reported as a half hour, matching legacy.
          value = minutes && minutes > 0 ? hours + 0.5 : hours;
          unit = 'hours';
          label = `${value} ${pluralize(value, 'Hour', 'Hours')}`;
          fullLabel = label;
        } else if (hours <= 24 * 30) {
          value = Math.ceil(hours / 24);
          unit = 'days';
          label = `${value} ${pluralize(value, 'Day', 'Days')}`;
          const realValue = Math.floor(hours / 24);
          const realHours = hours % 24;
          fullLabel =
            `${realValue} ${pluralize(realValue, 'Day', 'Days')}, ` +
            `${realHours} ${pluralize(realHours, 'Hour', 'Hours')}`;
        } else if (hours <= 24 * 31) {
          value = 1;
          unit = 'months';
          label = '1 Month';
          fullLabel = label;
        } else {
          value = Math.floor(hours / (24 * 30));
          unit = 'months';
          label = value === 12 ? `${value} Months` : `${value}+ Months`;
          fullLabel = label;
        }
      }
    }

    return { label, fullLabel, value, unit };
  }

  /**
   * Long-form duration, e.g. "1 Months, 4 Days and 12 Hours".
   *
   * NOTE (legacy parity): only months/days/hours/minutes are rendered — `years` is
   * dropped, so a 14-month stay reads as "2 Months". Preserved deliberately; the booking
   * confirmation copy on sh-website expects this exact string.
   */
  getAccurateStayDurationLabel({
    checkinDate,
    checkoutDate,
    checkinTime,
    checkoutTime,
  }: StayDurationInput): string {
    if (!(checkinDate && checkoutDate && checkinTime && checkoutTime)) return '';

    const checkinDateMoment = moment(
      `${checkinDate} ${checkinTime}`,
      'DD/MM/YYYY HH:mm',
    );
    const checkoutDateMoment = moment(
      `${checkoutDate} ${checkoutTime}`,
      'DD/MM/YYYY HH:mm',
    );
    const isStandardDayBooking = checkinTime === '14:00' && checkoutTime === '12:00';
    if (isStandardDayBooking) {
      checkoutDateMoment.set({ hour: 14 });
    }

    const preciseDiff = CheckinService.preciseDiff(checkinDateMoment, checkoutDateMoment);
    const applicableUnits = (['months', 'days', 'hours', 'minutes'] as const).filter(
      (unit) => !!preciseDiff[unit],
    );

    const messageArr = applicableUnits.map((unit) => {
      const unitCapitalCase = unit.charAt(0).toUpperCase() + unit.slice(1);
      return `${preciseDiff[unit]} ${unitCapitalCase}`;
    });

    let messageStr = messageArr.join(', ');
    // Replace the final "," with " and".
    const lastCommaPos = messageStr.lastIndexOf(',');
    if (lastCommaPos > -1) {
      messageStr = `${messageStr.substr(0, lastCommaPos)} and${messageStr.substr(
        lastCommaPos + 1,
      )}`;
    }
    return messageStr;
  }

  /**
   * Calendar-aware difference, reimplementing `moment-precise-range-plugin`'s
   * `moment.preciseDiff(a, b, true)` (the legacy dependency) so the port needs no
   * untyped third-party plugin. Borrowing is done unit by unit, using the length of the
   * month preceding the later date — the same as the plugin.
   */
  private static preciseDiff(d1: moment.Moment, d2: moment.Moment): PreciseDiff {
    let m1 = moment(d1);
    let m2 = moment(d2);
    m1.add(m2.utcOffset() - m1.utcOffset(), 'minutes');

    let firstDateWasLater = false;
    if (m1.isAfter(m2)) {
      const tmp = m1;
      m1 = m2;
      m2 = tmp;
      firstDateWasLater = true;
    }

    let yDiff = m2.year() - m1.year();
    let mDiff = m2.month() - m1.month();
    let dDiff = m2.date() - m1.date();
    let hourDiff = m2.hour() - m1.hour();
    let minDiff = m2.minute() - m1.minute();
    let secDiff = m2.second() - m1.second();

    if (secDiff < 0) {
      secDiff = 60 + secDiff;
      minDiff--;
    }
    if (minDiff < 0) {
      minDiff = 60 + minDiff;
      hourDiff--;
    }
    if (hourDiff < 0) {
      hourDiff = 24 + hourDiff;
      dDiff--;
    }
    if (dDiff < 0) {
      const daysInLastFullMonth = moment(`${m2.year()}-${m2.month() + 1}`, 'YYYY-MM')
        .subtract(1, 'M')
        .daysInMonth();
      dDiff =
        daysInLastFullMonth < m1.date()
          ? daysInLastFullMonth + dDiff + (m1.date() - daysInLastFullMonth)
          : daysInLastFullMonth + dDiff;
      mDiff--;
    }
    if (mDiff < 0) {
      mDiff = 12 + mDiff;
      yDiff--;
    }

    return {
      years: yDiff,
      months: mDiff,
      days: dDiff,
      hours: hourDiff,
      minutes: minDiff,
      seconds: secDiff,
      firstDateWasLater,
    };
  }
}
