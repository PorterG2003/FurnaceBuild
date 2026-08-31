import { hostnameOf } from './url.js';
import { sleep } from './retry.js';

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, Math.max(items.length, 1)));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );
  return results;
}

/** Bound in-flight fetches per host and keep a small gap between starts. */
export class HostGate {
  private inflight = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();
  private lastStart = new Map<string, number>();
  private startLock = new Map<string, Promise<unknown>>();

  constructor(
    private minIntervalMs: number,
    private maxConcurrent = 3,
  ) {}

  async run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const host = hostnameOf(url) || url;
    await this.acquire(host);
    try {
      await this.stagger(host);
      return await fn();
    } finally {
      this.release(host);
    }
  }

  private async acquire(host: string): Promise<void> {
    const max = Math.max(1, this.maxConcurrent);
    while ((this.inflight.get(host) ?? 0) >= max) {
      await new Promise<void>((resolve) => {
        const list = this.waiters.get(host) ?? [];
        list.push(resolve);
        this.waiters.set(host, list);
      });
    }
    this.inflight.set(host, (this.inflight.get(host) ?? 0) + 1);
  }

  private release(host: string): void {
    this.inflight.set(host, Math.max(0, (this.inflight.get(host) ?? 1) - 1));
    const next = this.waiters.get(host)?.shift();
    next?.();
  }

  private async stagger(host: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const prev = this.startLock.get(host) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.startLock.set(host, prev.then(() => held));
    await prev.catch(() => undefined);
    try {
      const wait = this.minIntervalMs - (Date.now() - (this.lastStart.get(host) ?? 0));
      if (wait > 0) await sleep(wait);
      this.lastStart.set(host, Date.now());
    } finally {
      release();
    }
  }
}
