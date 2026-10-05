/**
 * Chinese public holiday data used by the peak/off-peak calculator.
 *
 * WHY THIS FILE EXISTS
 * DeepSeek's official pricing page defines peak hours as
 * "01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, **excluding
 * Chinese public holidays**". A weekday check alone is therefore not enough:
 * a Tuesday inside National Day week is off-peak, and the whole point of the
 * feature is telling the user truthfully which side of the 2x line they are on.
 *
 * DATA PROVENANCE
 * Taken from the State Council's annual holiday arrangement (国务院办公厅关于
 * 2026 年部分节假日安排的通知) as published by the timor.tech holiday API, which
 * mirrors that notice. Dates are Chinese civil dates (UTC+8), which is also the
 * calendar DeepSeek's own notice uses.
 *
 * THIS DATA EXPIRES. The State Council publishes next year's arrangement in
 * roughly November. The end-of-year dates below are therefore a real, dated
 * dependency rather than a constant. `HOLIDAY_DATA_THROUGH` states the last
 * year covered; the settings page surfaces it, and `config.holidays` lets the
 * user override or extend the table without editing this file.
 *
 * MAKEUP WORKDAYS (调休补班) are recorded separately and are NOT treated as peak
 * by default. The official rule says "Monday through Friday", and every makeup
 * workday is a weekend day moved to a workday, so the literal reading keeps them
 * off-peak. `isPeak` exposes `treatMakeupWorkdaysAsWeekday` for the opposite
 * reading; it defaults to false, matching the literal text.
 *
 * @module dsh-balance-pet/shared/holidays
 */

/** Last calendar year fully covered by {@link HOLIDAYS}. */
export const HOLIDAY_DATA_THROUGH = 2026;

/** Human-readable provenance, surfaced in the settings page. */
export const HOLIDAY_DATA_SOURCE =
  '国务院办公厅节假日安排(timor.tech holiday API 镜像),覆盖到 ' +
  String(HOLIDAY_DATA_THROUGH) +
  ' 年';

/**
 * Statutory days off, keyed by Chinese civil date (`YYYY-MM-DD`).
 * A date present here is a holiday for the whole day: off-peak in full.
 */
export const HOLIDAYS = Object.freeze({
  // ---- 2025 ----
  '2025-01-01': '元旦',
  '2025-01-28': '除夕',
  '2025-01-29': '初一',
  '2025-01-30': '初二',
  '2025-01-31': '初三',
  '2025-02-01': '初四',
  '2025-02-02': '初五',
  '2025-02-03': '初六',
  '2025-02-04': '初七',
  '2025-04-04': '清明节',
  '2025-04-05': '清明节',
  '2025-04-06': '清明节',
  '2025-05-01': '劳动节',
  '2025-05-02': '劳动节',
  '2025-05-03': '劳动节',
  '2025-05-04': '劳动节',
  '2025-05-05': '劳动节',
  '2025-05-31': '端午节',
  '2025-06-01': '端午节',
  '2025-06-02': '端午节',
  '2025-10-01': '国庆节',
  '2025-10-02': '国庆节',
  '2025-10-03': '国庆节',
  '2025-10-04': '国庆节',
  '2025-10-05': '国庆节',
  '2025-10-06': '中秋节',
  '2025-10-07': '国庆节',
  '2025-10-08': '国庆节',

  // ---- 2026 ----
  '2026-01-01': '元旦',
  '2026-01-02': '元旦',
  '2026-01-03': '元旦',
  '2026-02-15': '春节',
  '2026-02-16': '除夕',
  '2026-02-17': '初一',
  '2026-02-18': '初二',
  '2026-02-19': '初三',
  '2026-02-20': '初四',
  '2026-02-21': '初五',
  '2026-02-22': '初六',
  '2026-02-23': '初七',
  '2026-04-04': '清明节',
  '2026-04-05': '清明节',
  '2026-04-06': '清明节',
  '2026-05-01': '劳动节',
  '2026-05-02': '劳动节',
  '2026-05-03': '劳动节',
  '2026-05-04': '劳动节',
  '2026-05-05': '劳动节',
  '2026-06-19': '端午节',
  '2026-06-20': '端午节',
  '2026-06-21': '端午节',
  '2026-09-25': '中秋节',
  '2026-09-26': '中秋节',
  '2026-09-27': '中秋节',
  '2026-10-01': '国庆节',
  '2026-10-02': '国庆节',
  '2026-10-03': '国庆节',
  '2026-10-04': '国庆节',
  '2026-10-05': '国庆节',
  '2026-10-06': '国庆节',
  '2026-10-07': '国庆节',
});

/**
 * Makeup workdays (调休补班): weekend days the State Council converts into
 * working days. Recorded for transparency and for the opt-in reading in
 * {@link isPeak}; NOT peak by default.
 */
export const MAKEUP_WORKDAYS = Object.freeze({
  // ---- 2025 ----
  '2025-01-26': '春节前补班',
  '2025-02-08': '春节后补班',
  '2025-04-27': '劳动节前补班',
  '2025-09-28': '国庆节前补班',
  '2025-10-11': '国庆节后补班',

  // ---- 2026 ----
  '2026-01-04': '元旦后补班',
  '2026-02-14': '春节前补班',
  '2026-02-28': '春节后补班',
  '2026-05-09': '劳动节后补班',
  '2026-09-20': '中秋节前补班',
  '2026-10-10': '国庆节后补班',
});

/**
 * Format a `Date` as a Chinese civil date key.
 *
 * Chinese civil time is UTC+8 with no daylight saving, so a fixed offset is
 * exact rather than an approximation. This matters because DeepSeek's holiday
 * exclusion follows the Chinese calendar while the peak windows are stated in
 * UTC, and the two must not drift apart near midnight.
 *
 * @param date - instant to convert.
 * @returns `YYYY-MM-DD` in UTC+8.
 */
export function chinaDateKey(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

/**
 * Look up a date's holiday name.
 *
 * @param date - instant to test.
 * @param extra - user-supplied overrides, merged over the built-in table.
 *   A `null` or empty-string value removes a built-in entry, so a user in
 *   another jurisdiction can cancel dates that do not apply to them.
 * @returns the holiday's name, or `null`.
 */
export function holidayNameAt(date, extra) {
  const key = chinaDateKey(date);
  if (extra !== undefined && Object.prototype.hasOwnProperty.call(extra, key)) {
    const override = extra[key];
    return override === null || override === '' ? null : String(override);
  }
  return Object.prototype.hasOwnProperty.call(HOLIDAYS, key) ? HOLIDAYS[key] : null;
}

/**
 * Look up a date's makeup-workday name.
 *
 * @param date - instant to test.
 * @param extra - user-supplied overrides, same semantics as {@link holidayNameAt}.
 * @returns the makeup workday's name, or `null`.
 */
export function makeupWorkdayNameAt(date, extra) {
  const key = chinaDateKey(date);
  if (extra !== undefined && Object.prototype.hasOwnProperty.call(extra, key)) {
    const override = extra[key];
    return override === null || override === '' ? null : String(override);
  }
  return Object.prototype.hasOwnProperty.call(MAKEUP_WORKDAYS, key)
    ? MAKEUP_WORKDAYS[key]
    : null;
}

/** Whether the built-in table covers the year of the given instant. */
export function holidayDataCovers(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.getUTCFullYear() <= HOLIDAY_DATA_THROUGH;
}
