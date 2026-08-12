import type { Page, Response } from 'playwright';
import { dismissCookies, humanizePage } from './browser.ts';
import {
  COUNTRY_URLS,
  GRAPHQL_URL,
  PAGE_SIZE,
  RECAPTCHA_SITE_KEY,
  type CountryCode,
  type SearchAgent,
} from './types.ts';

export type RecaptchaAction =
  | 'NAME_SUGGESTIONS'
  | 'AGENT_SEARCH'
  | 'FEATURED_AGENTS'
  | 'VIEW_AGENT';

function gqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function searchPageUrl(country: CountryCode, name: string, pageNumber: number): string {
  const base = COUNTRY_URLS[country].split('?')[0];
  const params = new URLSearchParams();
  if (country === 'US') params.set('country', 'US');
  if (country === 'CA' && COUNTRY_URLS.CA.includes('exprealty.com')) {
    params.set('country', 'CA');
  }
  params.set('name', name);
  if (pageNumber > 1) params.set('page', String(pageNumber));
  return `${base}?${params.toString()}`;
}

async function executeRecaptcha(page: Page, action: RecaptchaAction): Promise<string> {
  await humanizePage(page);
  const token = await Promise.race([
    page.evaluate(
      async ({ siteKey, action }) => {
        const g = (
          window as unknown as {
            grecaptcha?: {
              enterprise?: {
                ready: (cb: () => void) => void;
                execute: (key: string, opts: { action: string }) => Promise<string>;
              };
            };
          }
        ).grecaptcha?.enterprise;
        if (!g) throw new Error('grecaptcha.enterprise not available');
        await new Promise<void>((resolve) => g.ready(() => resolve()));
        const t = await g.execute(siteKey, { action });
        if (typeof t !== 'string' || t.length < 20) throw new Error('invalid recaptcha token');
        return t;
      },
      { siteKey: RECAPTCHA_SITE_KEY, action },
    ),
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error(`recaptcha timeout for ${action}`)), 20000);
    }),
  ]);
  return token;
}

async function postGraphqlViaPage<T>(
  page: Page,
  query: string,
  timeoutMs = 20000,
): Promise<T> {
  const result = await page.evaluate(
    async ({ url, query, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          data?: unknown;
          errors?: Array<{ message: string }>;
        };
        return { status: res.status, json };
      } finally {
        clearTimeout(timer);
      }
    },
    { url: GRAPHQL_URL, query, timeoutMs },
  );
  if (result.json.errors?.length) {
    throw new Error(result.json.errors.map((e) => e.message).join('; '));
  }
  if (result.status >= 400) {
    throw new Error(`GraphQL HTTP ${result.status}`);
  }
  if (result.json.data == null) {
    throw new Error('graphql empty data');
  }
  return result.json.data as T;
}

async function postGraphql<T>(
  page: Page,
  query: string,
  timeoutMs?: number,
): Promise<T> {
  return postGraphqlViaPage<T>(page, query, timeoutMs);
}

/**
 * Harvest nameSuggestions for a prefix.
 * Prefer typing in the Name field so the *site* runs grecaptcha.enterprise.execute
 * (best captcha score). Fall back to our own execute + GraphQL.
 */
export async function harvestNameSuggestions(
  page: Page,
  term: string,
  country: CountryCode,
): Promise<string[]> {
  try {
    return await fetchNameSuggestionsViaUi(page, term);
  } catch (uiError) {
    console.warn(
      `[graphql] UI suggestions failed for "${term}"; trying direct token: ${
        uiError instanceof Error ? uiError.message.split('\n')[0] : String(uiError)
      }`,
    );
    return fetchNameSuggestionsGraphql(page, term, country);
  }
}

async function fetchNameSuggestionsViaUi(page: Page, term: string): Promise<string[]> {
  const box = page.locator('input[placeholder="Name"]').first();
  await box.waitFor({ state: 'visible', timeout: 15000 });
  await humanizePage(page);

  const wait = page.waitForResponse(
    (res: Response) => {
      if (!res.url().includes('agentdir-api.expproptech.com/graphql')) return false;
      if (res.request().method() !== 'POST') return false;
      const post = res.request().postData() ?? '';
      if (!post.includes('nameSuggestions')) return false;
      return (
        post.includes(`term: \\"${gqlEscape(term)}\\"`) ||
        post.includes(`term: "${gqlEscape(term)}"`)
      );
    },
    { timeout: 25000 },
  );

  await box.click({ timeout: 5000 });
  await box.fill('');
  await box.pressSequentially(term, { delay: 45 + Math.floor(Math.random() * 40) });

  try {
    const res = await wait;
    const json = (await res.json()) as {
      data?: { nameSuggestions?: string[] | null };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '));
    }
    await box.fill('');
    return (json.data?.nameSuggestions ?? []).filter(isPlausibleAgentName);
  } catch (error) {
    await box.fill('').catch(() => {});
    throw error;
  }
}

/** Drop obvious QA / placeholder suggestion strings. */
function isPlausibleAgentName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 80) return false;
  if (!/[A-Za-z]/.test(n)) return false;
  if (/\b(smoke\s*test|test\s*agent|dummy|asdf|xxx+|sample user|demo user)\b/i.test(n)) {
    return false;
  }
  if (/\d{5,}/.test(n)) return false;
  return true;
}

export async function fetchNameSuggestionsGraphql(
  page: Page,
  term: string,
  country: CountryCode,
): Promise<string[]> {
  const token = await executeRecaptcha(page, 'NAME_SUGGESTIONS');
  const query = `
    query {
      nameSuggestions(
        term: "${gqlEscape(term)}",
        country: "${country}",
        agentType: RESIDENTIAL,
        recaptchaToken: "${token}",
        filters: { isMilnet: false }
      )
    }
  `;
  const data = await postGraphql<{ nameSuggestions: string[] | null }>(page, query);
  return (data.nameSuggestions ?? []).filter(isPlausibleAgentName);
}

export function looksLikeHoneypot(agents: SearchAgent[]): boolean {
  if (!agents.length) return false;
  let poison = 0;
  for (const a of agents) {
    const email = a.email ?? '';
    if (/[^\u0000-\u007f]/.test(email)) poison += 1;
    if ((a.city ?? '').length > 20 && !/\s/.test(a.city ?? '')) poison += 1;
  }
  return poison >= Math.ceil(agents.length / 2);
}

/**
 * Enumerate a state/province slice. The API honors size=100 and deterministic
 * lastName sorting when location is present; broad country searches ignore
 * the requested size and are capped by Elasticsearch's 10k result window.
 */
export async function searchAgentsByLocation(
  page: Page,
  options: {
    location: string;
    country: CountryCode;
    from: number;
    size: number;
  },
): Promise<{ count: number; agents: SearchAgent[] }> {
  const token = await executeRecaptcha(page, 'AGENT_SEARCH');
  const query = `
    query {
      search(
        location: "${gqlEscape(options.location)}",
        country: "${options.country}",
        sort: { name: "lastName" },
        pagination: { size: ${options.size}, from: ${options.from} },
        searchType: AGENT,
        agentType: RESIDENTIAL,
        recaptchaToken: "${token}",
        filters: { isMilnet: false }
      ) {
        count
        agents {
          id
          firstName
          lastName
          city
          state
          photo
          email
          phoneNumber
          bio
        }
      }
    }
  `;
  const data = await postGraphql<{ search: { count: number; agents: SearchAgent[] } | null }>(
    page,
    query,
    options.size > 500 ? 60000 : 20000,
  );
  const payload = data.search ?? { count: 0, agents: [] };
  if (looksLikeHoneypot(payload.agents)) {
    throw new Error(
      `honeypot/poison location payload for "${options.location}" (${options.country})`,
    );
  }
  return payload;
}

/**
 * Search agents by full name.
 * US: in-page GraphQL (fast, observed clean).
 * CA: real URL navigation (evaluate search was honeypotted on CA).
 */
export async function searchAgentsByName(
  page: Page,
  options: {
    name: string;
    country: CountryCode;
    pageNumber: number;
  },
): Promise<{ count: number; agents: SearchAgent[] }> {
  const payload =
    options.country === 'CA'
      ? await searchAgentsByNameViaUi(page, options)
      : await searchAgentsByNameGraphql(page, options);

  if (payload && looksLikeHoneypot(payload.agents)) {
    if (options.country === 'US') {
      const viaUi = await searchAgentsByNameViaUi(page, options);
      if (looksLikeHoneypot(viaUi.agents)) {
        throw new Error(
          `honeypot/poison search payload for "${options.name}" (${options.country}); refusing to write`,
        );
      }
      return viaUi;
    }
    throw new Error(
      `honeypot/poison search payload for "${options.name}" (${options.country}); refusing to write`,
    );
  }

  return payload ?? { count: 0, agents: [] };
}

async function searchAgentsByNameViaUi(
  page: Page,
  options: {
    name: string;
    country: CountryCode;
    pageNumber: number;
  },
): Promise<{ count: number; agents: SearchAgent[] }> {
  const url = searchPageUrl(options.country, options.name, options.pageNumber);

  const searchWait = page.waitForResponse(
    async (res: Response) => {
      if (!res.url().includes('agentdir-api.expproptech.com/graphql')) return false;
      if (res.request().method() !== 'POST') return false;
      const post = res.request().postData() ?? '';
      return post.includes('search(') && post.includes('pagination');
    },
    { timeout: 45000 },
  );

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissCookies(page);
  await humanizePage(page);

  try {
    const res = await searchWait;
    const json = (await res.json()) as {
      data?: { search?: { count: number; agents: SearchAgent[] } };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '));
    }
    await page.waitForTimeout(250);
    return json.data?.search ?? { count: 0, agents: [] };
  } catch {
    return searchAgentsByNameGraphql(page, options);
  }
}

async function searchAgentsByNameGraphql(
  page: Page,
  options: {
    name: string;
    country: CountryCode;
    pageNumber: number;
  },
): Promise<{ count: number; agents: SearchAgent[] }> {
  const token = await executeRecaptcha(page, 'AGENT_SEARCH');
  const from = (options.pageNumber - 1) * PAGE_SIZE;
  const query = `
    query {
      search(
        name: "${gqlEscape(options.name)}",
        country: "${options.country}",
        sort: { name: "random"},
        pagination: { size: ${PAGE_SIZE}, from: ${from} },
        searchType: AGENT,
        agentType : RESIDENTIAL,
        recaptchaToken: "${token}"
        filters: { isMilnet: false }
      ) {
        count
        agents {
          id
          firstName
          lastName
          city
          state
          photo
          email
          phoneNumber
          bio
        }
      }
    }
  `;
  const data = await postGraphql<{ search: { count: number; agents: SearchAgent[] } }>(
    page,
    query,
  );
  return data.search ?? { count: 0, agents: [] };
}
