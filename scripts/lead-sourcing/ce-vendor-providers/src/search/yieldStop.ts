export const SERP_RESULTS_PER_PAGE = 10;

export function isLastSerpPage(organicResultCount: number): boolean {
  return organicResultCount === 0 || organicResultCount < SERP_RESULTS_PER_PAGE;
}

export type YieldStopConfig = {
  zero_new_pages: number;
  low_yield_threshold: number;
  low_yield_streak: number;
};

export type YieldStopAction = 'continue' | 'stop_zero' | 'stop_low_yield';

export class YieldStopTracker {
  private zeroStreak = 0;
  private lowYieldStreak = 0;

  constructor(private readonly config: YieldStopConfig) {}

  recordPage(newUrlCount: number): YieldStopAction {
    if (newUrlCount === 0) {
      this.zeroStreak++;
      if (this.zeroStreak >= this.config.zero_new_pages) return 'stop_zero';
    } else {
      this.zeroStreak = 0;
    }
    if (this.config.low_yield_threshold > 0 && newUrlCount <= this.config.low_yield_threshold) {
      this.lowYieldStreak++;
      if (this.lowYieldStreak >= this.config.low_yield_streak) return 'stop_low_yield';
    } else {
      this.lowYieldStreak = 0;
    }
    return 'continue';
  }
}
