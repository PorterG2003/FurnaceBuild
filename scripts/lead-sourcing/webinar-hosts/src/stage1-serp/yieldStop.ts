export type YieldStopConfig = {
  zero_new_pages: number;
  low_yield_threshold: number;
  low_yield_streak: number;
};

export type YieldStopAction = 'continue' | 'stop_zero' | 'stop_low_yield';

export function defaultYieldStopConfig(): YieldStopConfig {
  return {
    zero_new_pages: 1,
    low_yield_threshold: 1,
    low_yield_streak: 2,
  };
}

export function resolveYieldStopConfig(partial?: Partial<YieldStopConfig>): YieldStopConfig {
  return { ...defaultYieldStopConfig(), ...partial };
}

export class YieldStopTracker {
  private zeroStreak = 0;
  private lowYieldStreak = 0;

  constructor(private readonly config: YieldStopConfig) {}

  reset(): void {
    this.zeroStreak = 0;
    this.lowYieldStreak = 0;
  }

  recordPage(newUrlCount: number): YieldStopAction {
    if (newUrlCount === 0) {
      this.zeroStreak++;
      if (this.zeroStreak >= this.config.zero_new_pages) {
        return 'stop_zero';
      }
    } else {
      this.zeroStreak = 0;
    }

    if (this.config.low_yield_threshold > 0 && newUrlCount <= this.config.low_yield_threshold) {
      this.lowYieldStreak++;
      if (this.lowYieldStreak >= this.config.low_yield_streak) {
        return 'stop_low_yield';
      }
    } else {
      this.lowYieldStreak = 0;
    }

    return 'continue';
  }
}

export function countNewUrls(urls: Iterable<string>, seenUrls: Set<string>): number {
  let count = 0;
  for (const url of urls) {
    if (!seenUrls.has(url)) count++;
  }
  return count;
}
