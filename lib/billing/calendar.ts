export const MST_OFFSET_HOURS = 7;
const MST_OFFSET_MS = MST_OFFSET_HOURS * 60 * 60 * 1000;

export function getMstDateParts(instant: Date) {
  const mstInstant = new Date(instant.getTime() - MST_OFFSET_MS);
  return {
    year: mstInstant.getUTCFullYear(),
    monthIndex: mstInstant.getUTCMonth(),
    day: mstInstant.getUTCDate(),
  };
}

export function mstMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, MST_OFFSET_HOURS, 0, 0, 0));
}

export function daysInMstMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0, MST_OFFSET_HOURS, 0, 0, 0)).getUTCDate();
}

export function getNextMonthlyAnchorDate(startedAt: Date): Date {
  const { year, monthIndex } = getMstDateParts(startedAt);
  return mstMidnight(year, monthIndex + 1, 1);
}

export function getElapsedMstBillingDays(effectiveAt: Date): number {
  const { day } = getMstDateParts(effectiveAt);
  return Math.max(day - 1, 0);
}

export function getCurrentMstMonthDayCount(effectiveAt: Date): number {
  const { year, monthIndex } = getMstDateParts(effectiveAt);
  return daysInMstMonth(year, monthIndex);
}
