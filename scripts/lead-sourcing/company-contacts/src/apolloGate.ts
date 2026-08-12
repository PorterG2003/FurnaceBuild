/**
 * Shared request gate: min spacing between HTTP calls, retries, and global
 * cooldown on 429 (blocks all workers).
 */

export class HttpStatusError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function getErrorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: number }).status);
    if (Number.isFinite(status) && status > 0) return status;
  }
  if (error instanceof Error) {
    const match = error.message.match(/\b([45]\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function getRetryAfterMs(error: unknown): number | null {
  if (error && typeof error === 'object' && 'retryAfterMs' in error) {
    const value = Number((error as { retryAfterMs: number | null }).retryAfterMs);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header?.trim()) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return asInt * 1000;
  }
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    return Math.max(0, when - Date.now());
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RequestGateOptions = {
  /** Minimum ms between issued HTTP calls (shared across workers). */
  minSpacingMs?: number;
  maxAttempts?: number;
  label?: string;
};

export class RequestGate {
  private readonly minSpacingMs: number;
  private readonly maxAttempts: number;
  private readonly label: string;

  private lastCallAt = 0;
  private spacingChain: Promise<void> = Promise.resolve();
  private cooldownUntil = 0;
  private cooldownMs = 5000;

  constructor(options: RequestGateOptions = {}) {
    this.minSpacingMs = options.minSpacingMs ?? 90;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.label = options.label ?? 'gate';
  }

  /** Run an HTTP call with spacing, cooldown, and 429/5xx retries. */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.waitForCoolDown();
      await this.waitForSpacing();
      try {
        const result = await fn();
        this.cooldownMs = 5000;
        return result;
      } catch (error) {
        lastError = error;
        const status = getErrorStatus(error);
        const retryable = status === 429 || (status != null && status >= 500);
        if (!retryable || attempt >= this.maxAttempts) {
          throw error;
        }
        if (status === 429) {
          await this.onRateLimited(error, attempt);
        } else {
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
        }
      }
    }
    throw lastError;
  }

  private async waitForCoolDown(): Promise<void> {
    const waitMs = this.cooldownUntil - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  private waitForSpacing(): Promise<void> {
    const run = async () => {
      const elapsed = Date.now() - this.lastCallAt;
      if (elapsed < this.minSpacingMs) {
        await sleep(this.minSpacingMs - elapsed);
      }
      this.lastCallAt = Date.now();
    };
    const queued = this.spacingChain.then(run, run);
    this.spacingChain = queued.catch(() => undefined);
    return queued;
  }

  private async onRateLimited(error: unknown, attempt: number): Promise<void> {
    const retryAfter = getRetryAfterMs(error);
    const waitMs =
      retryAfter ?? Math.min(this.cooldownMs * 2 ** Math.min(attempt - 1, 3), 60_000);
    this.cooldownMs = Math.min(Math.max(this.cooldownMs * 1.5, 5000), 60_000);
    this.cooldownUntil = Date.now() + waitMs;
    console.error(`[${this.label}] 429 → global cooldown ${waitMs}ms (attempt ${attempt})`);
    await sleep(waitMs);
  }
}

export function resolveConcurrency(cliValue: number | null | undefined, fallback = 8): number {
  if (cliValue != null && Number.isFinite(cliValue) && cliValue > 0) {
    return Math.floor(cliValue);
  }
  const env = process.env.CONCURRENCY?.trim();
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return fallback;
}

/** Simple async mutex for checkpoint merges. */
export class Mutex {
  private chain: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.chain;
    this.chain = next;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
