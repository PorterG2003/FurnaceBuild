export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
}

export function buildRateLimitHeaders(values: RateLimitHeaders): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(values.limit),
    'X-RateLimit-Remaining': String(Math.max(0, values.remaining)),
    'X-RateLimit-Reset': String(values.resetEpochSeconds),
  };
}
