const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/';
const MV_DELAY_MS = 200;

export type MvResult = 'ok' | 'catch_all' | 'invalid' | 'unknown' | 'disposable' | string;

export type MillionVerifierOptions = {
  apiKey: string;
  mock?: boolean;
};

export class MillionVerifier {
  private readonly cache = new Map<string, MvResult>();
  private readonly apiKey: string;
  private readonly mock: boolean;
  private lastCallAt = 0;

  constructor(options: MillionVerifierOptions) {
    this.apiKey = options.apiKey;
    this.mock = options.mock ?? false;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  async getResult(email: string): Promise<MvResult> {
    const normalized = email.trim().toLowerCase();
    const cached = this.cache.get(normalized);
    if (cached != null) {
      return cached;
    }

    const result = this.mock ? 'ok' : await this.fetchResult(normalized);
    this.cache.set(normalized, result);
    return result;
  }

  async verify(email: string): Promise<boolean> {
    const result = await this.getResult(email);
    return result === 'ok' || result === 'catch_all';
  }

  loadCache(entries: Record<string, MvResult>): void {
    for (const [email, result] of Object.entries(entries)) {
      this.cache.set(email.trim().toLowerCase(), result);
    }
  }

  exportCache(): Record<string, MvResult> {
    return Object.fromEntries(this.cache.entries());
  }

  private async fetchResult(email: string): Promise<MvResult> {
    await this.rateLimit();

    const url = new URL(MV_ENDPOINT);
    url.searchParams.set('api', this.apiKey);
    url.searchParams.set('email', email);
    url.searchParams.set('timeout', '10');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Million Verifier HTTP ${response.status} for ${email}`);
    }

    const body = (await response.json()) as { result?: MvResult };
    return body.result ?? 'unknown';
  }

  private async rateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < MV_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, MV_DELAY_MS - elapsed));
    }
    this.lastCallAt = Date.now();
  }
}
