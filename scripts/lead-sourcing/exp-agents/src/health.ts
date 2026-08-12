import type { Page } from 'playwright';
import { sleepWithJitter } from './browser.ts';
import { searchAgentsByLocation } from './graphql.ts';
import type { CountryCode } from './types.ts';

const DEFAULT_BACKOFFS_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000] as const;

export class HealthRecycleError extends Error {
  constructor(
    message: string,
    readonly cycle: number,
  ) {
    super(message);
    this.name = 'HealthRecycleError';
  }
}

export class AdaptiveHealthGate {
  private failureCycle = 0;
  private probeCalls = 0;

  constructor(private readonly backoffsMs: readonly number[] = DEFAULT_BACKOFFS_MS) {}

  get stats(): { failureCycle: number; probeCalls: number } {
    return { failureCycle: this.failureCycle, probeCalls: this.probeCalls };
  }

  recordDataSuccess(): void {
    if (this.failureCycle > 0) {
      console.log(`[health] full data page passed; reset cycle=${this.failureCycle}`);
    }
    this.failureCycle = 0;
  }

  async assertHealthy(page: Page): Promise<void> {
    this.probeCalls += 1;
    try {
      const result = await searchAgentsByLocation(page, {
        country: 'US',
        location: 'Austin, TX',
        from: 0,
        size: 100,
      });
      if (result.count <= 0 || result.agents.length !== 100 || result.agents[0]?.state !== 'TX') {
        throw new Error(
          `known-good probe was not healthy: count=${result.count} agents=${result.agents.length}`,
        );
      }
      if (this.failureCycle > 0) {
        console.log(
          `[health] known-good full-page probe passed; cycle=${this.failureCycle} stays armed until target data succeeds`,
        );
      }
    } catch (error) {
      await this.trip(error instanceof Error ? error : new Error(String(error)), {
        country: 'US',
        location: 'Austin, TX',
        from: 0,
        probe: true,
      });
    }
  }

  async trip(
    error: Error,
    context: {
      country: CountryCode;
      location: string;
      from: number;
      probe?: boolean;
    },
  ): Promise<never> {
    this.failureCycle += 1;
    const index = Math.min(this.failureCycle - 1, this.backoffsMs.length - 1);
    const delayMs = this.backoffsMs[index] ?? DEFAULT_BACKOFFS_MS.at(-1)!;
    console.warn(
      `[health] unhealthy ${context.country}/${context.location} from=${context.from} probe=${context.probe ?? false}: ${error.message.split('\n')[0]}`,
    );
    console.warn(
      `[health] quiet backoff ${Math.round(delayMs / 60_000)}m cycle=${this.failureCycle}; browser will recycle`,
    );
    await sleepWithJitter(delayMs);
    throw new HealthRecycleError(
      `Browser closed: health-gate recycle after cycle=${this.failureCycle}`,
      this.failureCycle,
    );
  }
}
