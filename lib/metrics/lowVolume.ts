/** Minimum denominator before a rate is shown as a percentage. */
export const MIN_RATE_DENOMINATOR = 100;

export function formatRate(
  numerator: number,
  denominator: number,
  minDenominator: number = MIN_RATE_DENOMINATOR,
): string {
  if (denominator < minDenominator) {
    return `${numerator} / ${denominator}`;
  }
  if (denominator <= 0) return '—';
  const pct = (numerator / denominator) * 100;
  return `${Math.round(pct * 10) / 10}%`;
}

export function hasReliableRate(
  denominator: number,
  minDenominator: number = MIN_RATE_DENOMINATOR,
): boolean {
  return denominator >= minDenominator;
}

export function yieldPerThousand(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000 * 10) / 10;
}

/** How many `total` units per one outcome (e.g. emails per interested). */
export function countPerOutcome(total: number, outcomes: number): number | null {
  if (outcomes <= 0) return null;
  return Math.round((total / outcomes) * 10) / 10;
}

export function formatCountPerOutcome(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}
