export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sleepWithJitter(baseMs: number, jitterMs = 400): Promise<void> {
  const jitter = Math.floor(Math.random() * jitterMs);
  await sleep(baseMs + jitter);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; shouldRetry?: (error: unknown) => boolean } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const shouldRetry =
    options.shouldRetry ??
    ((error: unknown) => {
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        return status === 429 || status >= 500;
      }
      return true;
    });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

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

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header?.trim()) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

export class RequestGate {
  private lastCallAt = 0;
  private spacingChain: Promise<void> = Promise.resolve();
  private cooldownUntil = 0;
  private cooldownMs = 5000;

  constructor(
    private readonly minSpacingMs = 120,
    private readonly maxAttempts = 6,
  ) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const cool = this.cooldownUntil - Date.now();
      if (cool > 0) await sleep(cool);
      await this.waitForSpacing();
      try {
        const result = await fn();
        this.cooldownMs = 5000;
        return result;
      } catch (error) {
        lastError = error;
        const status =
          error && typeof error === 'object' && 'status' in error
            ? Number((error as { status: number }).status)
            : null;
        const retryable = status === 429 || (status != null && status >= 500);
        if (!retryable || attempt >= this.maxAttempts) throw error;
        if (status === 429) {
          const retryAfter =
            error && typeof error === 'object' && 'retryAfterMs' in error
              ? Number((error as { retryAfterMs: number | null }).retryAfterMs)
              : null;
          this.cooldownMs = Math.min(Math.max(retryAfter || this.cooldownMs * 2, 5000), 120_000);
          this.cooldownUntil = Date.now() + this.cooldownMs;
          await sleep(this.cooldownMs);
        } else {
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
        }
      }
    }
    throw lastError;
  }

  private waitForSpacing(): Promise<void> {
    const run = async () => {
      const elapsed = Date.now() - this.lastCallAt;
      if (elapsed < this.minSpacingMs) await sleep(this.minSpacingMs - elapsed);
      this.lastCallAt = Date.now();
    };
    const queued = this.spacingChain.then(run, run);
    this.spacingChain = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}
