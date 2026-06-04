export function isFreeRetainer(cents: number | null | undefined): boolean {
  return Number.isFinite(cents) && cents === 0;
}
