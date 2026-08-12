import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRetry } from './retry.ts';
import { unwrapChirpValue } from './unwrap.ts';
import type { LabelMaps, PartnerDetail, SearchCard, SearchResponse } from './types.ts';

const STRING_FILTER = 'com.hubspot.marketplace.search.models.filters.StringFilterQuery';
const LONG_FILTER = 'com.hubspot.marketplace.search.models.filters.LongFilterQuery';

const GATEWAY_BASE =
  'https://app.hubspot.com/api/chirp-frontend-external/v1/gateway';
const APP_QS =
  'hs_static_app=marketplace-storefront-public-ui&hs_static_app_version=1.13008&clienttimeout=10000';

export type CallCounter = {
  search: number;
  detail: number;
  filterConfig: number;
};

export function createCallCounter(): CallCounter {
  return { search: 0, detail: 0, filterConfig: 0 };
}

export function totalCalls(counter: CallCounter): number {
  return counter.search + counter.detail + counter.filterConfig;
}

function fixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'fixtures');
}

function loadFixture<T>(name: string): T {
  const path = join(fixturesDir(), name);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export class HubSpotHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HubSpot HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function buildSearchFilter(accreditationId: number) {
  return {
    filterGroups: [
      {
        filtersByField: {
          PRODUCT_TYPE: [
            {
              values: ['SOLUTIONS_PARTNER_PROFILE'],
              clause: 'OR',
              negation: false,
              __typename: STRING_FILTER,
            },
          ],
          PROFILE_ACCREDITATIONS: [
            {
              values: [accreditationId],
              clause: 'OR',
              negation: false,
              __typename: LONG_FILTER,
            },
          ],
        },
        clause: 'AND',
        negation: false,
      },
    ],
    clause: 'AND',
    negation: false,
  };
}

export function buildSearchRequest(options: {
  accreditationId: number;
  offset: number;
  length: number;
  language?: string;
}) {
  return {
    queryType: 'SEARCH',
    search: '',
    language: options.language ?? 'en',
    filter: buildSearchFilter(options.accreditationId),
    sorts: [],
    offset: options.offset,
    length: options.length,
  };
}

async function chirpPost<T>(
  serviceMethod: string,
  body: unknown,
  counterKey: keyof CallCounter,
  counter: CallCounter,
): Promise<T> {
  counter[counterKey] += 1;
  const url = `${GATEWAY_BASE}/${serviceMethod}?${APP_QS}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://ecosystem.hubspot.com',
        Referer: 'https://ecosystem.hubspot.com/marketplace/explore/solutions-partners',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new HubSpotHttpError(res.status, json);
    }
    if (json.type === 'internalError' || json.type === 'rpcError') {
      const status = res.status >= 400 ? res.status : 500;
      throw new HubSpotHttpError(status, json, JSON.stringify(json.type));
    }
    return (json.data ?? json.result ?? json) as T;
  });
}

export type HubSpotClient = {
  searchPartners: (offset: number, length: number) => Promise<SearchResponse>;
  getListingDetails: (slug: string) => Promise<PartnerDetail>;
  getLabelMaps: () => Promise<LabelMaps>;
  counter: CallCounter;
};

export function createHubSpotClient(options: {
  accreditationId: number;
  fixtures?: boolean;
}): HubSpotClient {
  const counter = createCallCounter();
  const fixtures = Boolean(options.fixtures);

  return {
    counter,
    async searchPartners(offset: number, length: number): Promise<SearchResponse> {
      if (fixtures) {
        counter.search += 1;
        const fixture = loadFixture<{ total: number; cards: SearchCard[] }>('search-page.json');
        const cards = fixture.cards.slice(offset, offset + length);
        return { total: fixture.total, cards };
      }
      const data = await chirpPost<{ total?: number; cards?: SearchCard[] }>(
        'com.hubspot.marketplace.personalization.rpc.PersonalizationPublicRpc/search',
        buildSearchRequest({
          accreditationId: options.accreditationId,
          offset,
          length,
        }),
        'search',
        counter,
      );
      return {
        total: Number(data.total ?? 0),
        cards: Array.isArray(data.cards) ? data.cards : [],
      };
    },

    async getListingDetails(slug: string): Promise<PartnerDetail> {
      if (fixtures) {
        counter.detail += 1;
        const fixture = loadFixture<{ bySlug: Record<string, unknown> }>('details.json');
        const raw = fixture.bySlug[slug] ?? fixture.bySlug._default;
        if (!raw) throw new HubSpotHttpError(404, { message: `No fixture for slug ${slug}` });
        return unwrapChirpValue(raw) as PartnerDetail;
      }
      const data = await chirpPost<{ listing?: unknown }>(
        'com.hubspot.marketplace.listing.details.rpc.MarketplaceListingDetailsRpc/getListingDetailsV2',
        { slug, language: 'en' },
        'detail',
        counter,
      );
      return unwrapChirpValue(data.listing) as PartnerDetail;
    },

    async getLabelMaps(): Promise<LabelMaps> {
      if (fixtures) {
        counter.filterConfig += 1;
        return loadFixture<LabelMaps>('label-maps.json');
      }
      const data = await chirpPost<{ filterConfigs?: Record<string, FilterConfig> }>(
        'com.hubspot.marketplace.storefront.service.rpc.MarketplaceStorefrontPublicRpc/getSearchFilterConfig',
        { language: 'en', productTypes: ['SOLUTIONS_PARTNER_PROFILE'] },
        'filterConfig',
        counter,
      );
      return labelMapsFromFilterConfigs(data.filterConfigs ?? {});
    },
  };
}

type FilterOption = { value?: string | number; text?: string };
type FilterConfig = {
  options?: FilterOption[];
  optionGroups?: Array<{ options?: FilterOption[] }>;
};

function optionsToMap(config: FilterConfig | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!config) return out;
  const all = [...(config.options ?? [])];
  for (const group of config.optionGroups ?? []) {
    all.push(...(group.options ?? []));
  }
  for (const opt of all) {
    if (opt.value == null) continue;
    out[String(opt.value)] = String(opt.text ?? opt.value);
  }
  return out;
}

export function labelMapsFromFilterConfigs(
  filterConfigs: Record<string, FilterConfig>,
): LabelMaps {
  return {
    services: optionsToMap(filterConfigs.PROFILE_CATALOG_SERVICES),
    industries: optionsToMap(filterConfigs.PROFILE_INDUSTRIES),
    budgets: optionsToMap(filterConfigs.PROFILE_BUDGET),
    certifications: optionsToMap(filterConfigs.PROFILE_CERTIFICATIONS),
    accreditations: optionsToMap(filterConfigs.PROFILE_ACCREDITATIONS),
    tiers: optionsToMap(filterConfigs.PROFILE_SOLUTIONS_PARTNER_TIER),
  };
}
