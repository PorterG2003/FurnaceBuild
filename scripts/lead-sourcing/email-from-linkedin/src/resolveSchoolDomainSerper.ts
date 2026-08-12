import {
  serperSearch,
  type SerperSearchOptions,
} from '../../webinar-hosts/src/stage1-serp/serperClient.js';
import type { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { hostnameFromUrl, isLikelySchoolDomain } from './schoolDomainQuality.js';

export type SerperDomainOptions = {
  useFixtures?: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
};

/**
 * Resolve a school/district website domain via Serper organic results.
 * Fixture mode returns a canned .k12.us-style domain derived from the org name.
 */
export async function resolveDomainViaSerper(
  organizationName: string,
  options: SerperDomainOptions = {},
): Promise<string | null> {
  const trimmed = organizationName.trim();
  if (!trimmed) return null;

  if (options.useFixtures) {
    // Deterministic fixture: slug + k12.us so quality check passes
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24);
    if (!slug) return null;
    return `${slug}.k12.us`;
  }

  const query = `"${trimmed}" official school district website`;
  const searchOpts: SerperSearchOptions = {
    query,
    page: 1,
    timeFilter: '',
    apiKey: options.apiKey,
    useFixtures: false,
    fetchImpl: options.fetchImpl,
    counter: options.counter,
  };

  try {
    const response = await serperSearch(searchOpts);
    for (const item of response.organic ?? []) {
      const link = item.link?.trim();
      if (!link) continue;
      // Skip social / directory noise
      if (/linkedin\.com|facebook\.com|yelp\.com|wikipedia\.org/i.test(link)) continue;
      const host = hostnameFromUrl(link);
      if (isLikelySchoolDomain(host, trimmed)) {
        return host;
      }
    }
  } catch {
    return null;
  }

  return null;
}
