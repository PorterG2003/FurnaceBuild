/** Integer percent for campaign list and variant-performance cells. */
export function campaignStatPct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}
