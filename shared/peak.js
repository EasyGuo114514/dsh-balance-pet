/**
 * Peak / off-peak billing calculation.
 *
 * THE RULE THIS IMPLEMENTS (DeepSeek official pricing page, verbatim):
 *
 *   "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00
 *    and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public
 *    holidays. All other hours are off-peak, including weekends and Chinese
 *    public holidays in full."
 *
 * Peak is therefore exactly 2x off-peak, which is what the pet's warning says.
 * The two windows are 09:00-12:00 and 14:00-18:00 in Chinese civil time (UTC+8).
 *
 * WHY EVERY STATE CHANGE LANDS ON AN HOUR BOUNDARY
 * Both windows are hour-aligned and expressed in UTC; the weekday flips at UTC
 * midnight; and a Chinese holiday flips at Chinese midnight, which is 16:00 UTC
 * - also hour-aligned. So {@link peakStateAt} finds the next change by stepping
 * whole hours instead of scanning minutes, which makes it exact AND cheap.
 *
 * @module dsh-balance-pet/shared/peak
 */

import {
  chinaDateKey,
  holidayDataCovers,
  holidayNameAt,
  makeupWorkdayNameAt,
} from './holidays.js';

/**
 * Peak windows as `[startHour, endHour)` pairs in UTC.
 * Half-open on purpose: 04:00 UTC is already off-peak, which is the reading a
 * user checking a clock expects.
 */
export const PEAK_WINDOWS_UTC = Object.freeze([
  Object.freeze([1, 4]),
  Object.freeze([6, 10]),
]);

/** Peak billing multiplier relative to the off-peak baseline. */
export const PEAK_MULTIPLIER = 2;

/** Hour-step ceiling when searching for the next state change (14 days). */
const MAX_SEARCH_HOURS = 14 * 24;

/** `getUTCDay()` values that count as "Monday through Friday". */
const WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

/**
 * Whether an instant falls inside a peak window purely by clock time,
 * ignoring the day entirely.
 *
 * @param date - instant to test.
 * @returns `true` when the UTC hour is inside one of the two windows.
 */
export function inPeakWindow(date) {
  const hour = date.getUTCHours();
  for (const [start, end] of PEAK_WINDOWS_UTC) {
    if (hour >= start && hour < end) return true;
  }
  return false;
}

/**
 * Normalize the caller's options once, so the hot path stays allocation-free.
 *
 * @param options - raw {@link PeakOptions}.
 * @returns resolved options with defaults applied.
 */
function resolveOptions(options) {
  const source = options === undefined || options === null ? {} : options;
  return {
    holidays: source.holidays,
    // Literal reading of the official text: "Monday through Friday". A makeup
    // workday is a weekend day, so it stays off-peak unless the user opts in.
    treatMakeupWorkdaysAsWeekday: source.treatMakeupWorkdaysAsWeekday === true,
  };
}

/**
 * Decide whether one instant is peak, and why.
 *
 * This is the primitive the whole feature rests on, so it returns the reason
 * alongside the verdict: the UI has to explain *why* today is cheap (weekend vs
 * holiday vs simply outside the window), and the tests assert each branch.
 *
 * @param date - instant to classify.
 * @param options - holiday overrides and makeup-workday policy.
 * @returns the classification.
 */
export function classify(date, options) {
  const resolved = resolveOptions(options);
  const holiday = holidayNameAt(date, resolved.holidays);
  const makeup = makeupWorkdayNameAt(date, resolved.holidays);
  const utcWeekday = date.getUTCDay();
  const inWindow = inPeakWindow(date);

  let weekdayLike = WEEKDAYS.includes(utcWeekday);
  if (!weekdayLike && resolved.treatMakeupWorkdaysAsWeekday && makeup !== null) {
    weekdayLike = true;
  }

  // A holiday outranks everything: the official text excludes holidays "in
  // full", including a holiday that happens to fall inside a window.
  if (holiday !== null) {
    return {
      peak: false,
      reason: 'holiday',
      holiday,
      makeupWorkday: makeup,
      utcWeekday,
      inWindow,
      chinaDate: chinaDateKey(date),
    };
  }
  if (!weekdayLike) {
    // A weekend day the State Council converted into a workday is still
    // off-peak under the literal rule, but the user is at their desk that day.
    // Reporting it as a plain "weekend" would be wrong in a way they can see,
    // so it gets its own reason and its own sentence.
    const isWeekend = utcWeekday === 0 || utcWeekday === 6;
    return {
      peak: false,
      reason: isWeekend && makeup !== null ? 'makeup-workday' : 'weekend',
      holiday: null,
      makeupWorkday: makeup,
      utcWeekday,
      inWindow,
      chinaDate: chinaDateKey(date),
    };
  }
  if (!inWindow) {
    return {
      peak: false,
      reason: 'off-hours',
      holiday: null,
      makeupWorkday: makeup,
      utcWeekday,
      inWindow,
      chinaDate: chinaDateKey(date),
    };
  }
  return {
    peak: true,
    reason: 'peak-window',
    holiday: null,
    makeupWorkday: makeup,
    utcWeekday,
    inWindow,
    chinaDate: chinaDateKey(date),
  };
}

/**
 * Whether an instant is billed at the peak rate.
 *
 * @param date - instant to test.
 * @param options - holiday overrides and makeup-workday policy.
 * @returns `true` during peak.
 */
export function isPeak(date, options) {
  return classify(date, options).peak;
}

/**
 * Find the instant the peak/off-peak verdict next flips.
 *
 * Every transition is hour-aligned (see the module note), so stepping whole
 * hours from the next boundary is exact. The search is bounded: an unbounded
 * loop here would hang the plugin's timer if the calendar data were ever
 * malformed.
 *
 * @param date - instant to search forward from.
 * @param options - holiday overrides and makeup-workday policy.
 * @returns the next transition, or `null` if none was found within the bound.
 */
export function nextTransition(date, options) {
  const from = classify(date, options).peak;
  const start = new Date(date.getTime());
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  for (let step = 0; step < MAX_SEARCH_HOURS; step += 1) {
    const probe = new Date(start.getTime() + step * 60 * 60 * 1000);
    if (classify(probe, options).peak !== from) return probe;
  }
  return null;
}

/**
 * Build the complete peak/off-peak snapshot the UI and the bridge both consume.
 *
 * Everything the client needs is a plain serializable value, so the Host stays
 * the single source of truth and no consumer re-implements the rule.
 *
 * @param date - instant to describe.
 * @param options - holiday overrides and makeup-workday policy.
 * @returns the snapshot, safe to `JSON.stringify`.
 */
export function peakStateAt(date, options) {
  const verdict = classify(date, options);
  const transition = nextTransition(date, options);
  return {
    peak: verdict.peak,
    /** Billing multiplier vs the off-peak baseline: 2 during peak, 1 otherwise. */
    multiplier: verdict.peak ? PEAK_MULTIPLIER : 1,
    reason: verdict.reason,
    holiday: verdict.holiday,
    makeupWorkday: verdict.makeupWorkday,
    inWindow: verdict.inWindow,
    utcWeekday: verdict.utcWeekday,
    chinaDate: verdict.chinaDate,
    checkedAt: date.toISOString(),
    dataCovers: holidayDataCovers(date),
    nextChangeAt: transition === null ? null : transition.toISOString(),
    nextChangeIsPeak: transition === null ? null : classify(transition, options).peak,
  };
}

/**
 * Render the peak windows in a caller's local time, for the settings page.
 *
 * A user reading "2x" wants to know when to come back, and "01:00-04:00 UTC" is
 * not an answer most people can act on.
 *
 * @param offsetMinutes - offset east of UTC in minutes (UTC+8 -> 480).
 * @returns window labels in local time, e.g. `['09:00-12:00', '14:00-18:00']`.
 */
export function localWindowLabels(offsetMinutes) {
  const shift = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const two = (value) => String(value).padStart(2, '0');
  return PEAK_WINDOWS_UTC.map(([start, end]) => {
    const shiftHour = (hour) => ((hour + shift / 60) % 24 + 24) % 24;
    return `${two(shiftHour(start))}:00-${two(shiftHour(end))}:00`;
  });
}

/**
 * A short, human explanation of the current verdict.
 *
 * Kept here rather than in the UI so the Host bridge, the in-window pet and the
 * desktop pet all phrase it identically.
 *
 * @param state - a {@link peakStateAt} result.
 * @param offsetMinutes - offset east of UTC in minutes.
 * @returns one Chinese sentence naming the cause.
 */
export function describeReason(state, offsetMinutes) {
  const windows = localWindowLabels(offsetMinutes).join('、');
  switch (state.reason) {
    case 'peak-window':
      return `身处高峰计费时段(本地 ${windows} 内),单价是低谷的 ${PEAK_MULTIPLIER} 倍`;
    case 'weekend':
      return '今天是周末,全天低谷价';
    case 'makeup-workday':
      return `今天是调休补班(${state.makeupWorkday ?? '补班'}),你在上班,但计费规则只认周一至周五,所以仍是低谷价`;
    case 'holiday':
      return `今天是法定节假日${state.holiday === null ? '' : `(${state.holiday})`},全天低谷价`;
    case 'off-hours':
      return `当前在高峰时段之外(本地高峰为 ${windows}),按低谷价计费`;
    default:
      return '计费时段未知';
  }
}
