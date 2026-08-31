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
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

/** Serialize live fetches per host and keep a gap between them. */
export class HostGate {
  private chain = new Map<string, Promise<unknown>>();

  constructor(private minIntervalMs: number) {}

  async run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const host = hostnameOf(url) || url;
    const prev = this.chain.get(host) ?? Promise.resolve();
    const task = prev.catch(() => undefined).then(async () => {
      const value = await fn();
      if (this.minIntervalMs > 0) await sleep(this.minIntervalMs);
      return value;
    });
    this.chain.set(
      host,
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    return task;
  }
}
