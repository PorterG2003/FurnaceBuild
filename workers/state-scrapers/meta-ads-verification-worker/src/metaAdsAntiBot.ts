import type { MetaAdLibraryLookupResult } from './metaAdLibraryLookup.js';

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(minMs: number, maxMs: number): number {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function sleepRandom(minMs: number, maxMs: number): Promise<void> {
  const waitMs = randomInt(minMs, maxMs);
  await sleep(waitMs);
  return undefined;
}

export function pickSessionRotationInterval(baseEvery: number, jitter = 5): number {
  return Math.max(5, baseEvery + randomInt(-jitter, jitter));
}

export function pickSlowMoMs(minMs: number, maxMs: number): number {
  return randomInt(minMs, maxMs);
}

type SearchAttempt = {
  result_card_count?: number;
  reason?: string | null;
};

export function isEmptyNoResult(result: MetaAdLibraryLookupResult): boolean {
  if (result.result !== 'no') return false;
  const attempts = (result.signals.search_attempts ?? []) as SearchAttempt[];
  if (attempts.length === 0) return true;
  return attempts.every(
    (attempt) => (attempt.result_card_count ?? 0) === 0 && attempt.reason === 'no_results',
  );
}

export function shouldRetryEmptyNoResult(
  result: MetaAdLibraryLookupResult,
  attempt: number,
  maxRetries: number,
): boolean {
  return attempt < maxRetries && isEmptyNoResult(result);
}
