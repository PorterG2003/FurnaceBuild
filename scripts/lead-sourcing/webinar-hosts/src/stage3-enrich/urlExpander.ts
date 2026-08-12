import { sleepWithJitter } from '../lib/retry.js';

export const SHORT_LINK_HOSTS = ['lnkd.in', 'bit.ly', 't.co'];

export type ShortlinkCache = Record<string, string>;

function isShortLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SHORT_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function expandUrl(
  url: string,
  cache: ShortlinkCache,
  options: { useFixtures?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  if (cache[trimmed]) return cache[trimmed];

  if (options.useFixtures || !isShortLink(trimmed)) {
    cache[trimmed] = trimmed;
    return trimmed;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(trimmed, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
    });
    const finalUrl = response.url || trimmed;
    cache[trimmed] = finalUrl;
    return finalUrl;
  } catch {
    try {
      const response = await fetchImpl(trimmed, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8_000),
      });
      const finalUrl = response.url || trimmed;
      cache[trimmed] = finalUrl;
      return finalUrl;
    } catch {
      cache[trimmed] = trimmed;
      return trimmed;
    }
  }
}

export async function expandRegistrationUrls(
  urls: string[],
  cache: ShortlinkCache,
  options: { useFixtures?: boolean; fetchImpl?: typeof fetch; rateMs?: number } = {},
): Promise<{ expanded: string[]; cache: ShortlinkCache }> {
  const rateMs = options.rateMs ?? 200;
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    if (i > 0 && !options.useFixtures && rateMs > 0) {
      await sleepWithJitter(rateMs, 50);
    }
    const resolved = await expandUrl(url, cache, options);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      expanded.push(resolved);
    }
  }

  return { expanded, cache };
}
