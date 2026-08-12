import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import {
  closeExpBrowser,
  launchExpBrowser,
  openCountryPage,
  sleepWithJitter,
} from './browser.ts';
import {
  GRAPHQL_URL,
  RECAPTCHA_SITE_KEY,
  type CountryCode,
  type SearchAgent,
} from './types.ts';

type ProbeResult = {
  label: string;
  ok: boolean;
  count?: number;
  returned?: number;
  firstId?: string;
  error?: string;
  elapsedMs: number;
};

type SearchProbe = {
  label: string;
  country?: CountryCode;
  nameMode?: 'empty' | 'omitted';
  location?: string;
  size?: number;
  from?: number;
  sort?: string;
};

const PACKAGE_ROOT = join(import.meta.dirname, '..');
const FOLLOWUP = process.argv.includes('--followup');
const OUTPUT_PATH = join(
  PACKAGE_ROOT,
  'output',
  FOLLOWUP ? 'probe-followup-results.json' : 'probe-results.json',
);
const AGENT_FIELDS = `
  id
  firstName
  lastName
  city
  state
  email
`;

function escapeGraphql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function executeRecaptcha(page: Page): Promise<string> {
  return page.evaluate(
    async ({ siteKey }) => {
      const enterprise = (
        window as unknown as {
          grecaptcha?: {
            enterprise?: {
              ready: (callback: () => void) => void;
              execute: (key: string, options: { action: string }) => Promise<string>;
            };
          };
        }
      ).grecaptcha?.enterprise;
      if (!enterprise) throw new Error('grecaptcha.enterprise unavailable');
      await new Promise<void>((resolve) => enterprise.ready(resolve));
      return enterprise.execute(siteKey, { action: 'AGENT_SEARCH' });
    },
    { siteKey: RECAPTCHA_SITE_KEY },
  );
}

async function postGraphql<T>(page: Page, query: string): Promise<T> {
  const response = await page.evaluate(
    async ({ url, queryText }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      try {
        const result = await fetch(url, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ query: queryText }),
          signal: controller.signal,
        });
        return {
          status: result.status,
          body: (await result.json()) as {
            data?: unknown;
            errors?: Array<{ message: string }>;
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    { url: GRAPHQL_URL, queryText: query },
  );

  if (response.body.errors?.length) {
    throw new Error(response.body.errors.map((error) => error.message).join('; '));
  }
  if (response.status >= 400 || response.body.data == null) {
    throw new Error(`GraphQL HTTP ${response.status}: empty data`);
  }
  return response.body.data as T;
}

async function inspectSchema(page: Page): Promise<unknown> {
  const query = `
    query ProbeSchema {
      __schema {
        queryType {
          fields {
            name
            args {
              name
              type {
                kind
                name
                ofType {
                  kind
                  name
                  ofType { kind name }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await postGraphql<{
    __schema: {
      queryType: {
        fields: Array<{
          name: string;
          args: Array<{ name: string; type: unknown }>;
        }>;
      };
    };
  }>(page, query);
  return data.__schema.queryType.fields.find((field) => field.name === 'search') ?? null;
}

function buildSearchQuery(probe: SearchProbe, token: string): string {
  const country = probe.country ?? 'US';
  const size = probe.size ?? 12;
  const from = probe.from ?? 0;
  const sort = probe.sort ?? 'random';
  const nameArgument = probe.nameMode === 'omitted' ? '' : 'name: "",';
  const locationArgument = probe.location
    ? `location: "${escapeGraphql(probe.location)}",`
    : '';
  return `
    query ProbeSearch {
      search(
        ${nameArgument}
        ${locationArgument}
        country: "${country}",
        sort: { name: "${escapeGraphql(sort)}" },
        pagination: { size: ${size}, from: ${from} },
        searchType: AGENT,
        agentType: RESIDENTIAL,
        recaptchaToken: "${escapeGraphql(token)}",
        filters: { isMilnet: false }
      ) {
        count
        agents { ${AGENT_FIELDS} }
      }
    }
  `;
}

function looksPoisoned(agents: SearchAgent[]): boolean {
  if (!agents.length) return false;
  const suspicious = agents.filter((agent) => {
    const email = agent.email ?? '';
    const city = agent.city ?? '';
    return /[^\u0000-\u007f]/.test(email) || (city.length > 20 && !/\s/.test(city));
  });
  return suspicious.length >= Math.ceil(agents.length / 2);
}

async function runSearchProbe(page: Page, probe: SearchProbe): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const token = await executeRecaptcha(page);
    const data = await postGraphql<{
      search?: { count: number; agents: SearchAgent[] };
    }>(page, buildSearchQuery(probe, token));
    const payload = data.search ?? { count: 0, agents: [] };
    if (looksPoisoned(payload.agents)) throw new Error('honeypot/poison payload');
    return {
      label: probe.label,
      ok: true,
      count: payload.count,
      returned: payload.agents.length,
      firstId: payload.agents[0]?.id,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      label: probe.label,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  }
}

async function main(): Promise<void> {
  const session = await launchExpBrowser({ headed: true });
  const results: ProbeResult[] = [];
  let schema: unknown = null;

  try {
    await openCountryPage(session.page, 'US');
    try {
      schema = await inspectSchema(session.page);
      console.log(`[probe] schema=${JSON.stringify(schema)}`);
    } catch (error) {
      console.warn(`[probe] introspection failed: ${String(error)}`);
    }

    const probes: SearchProbe[] = FOLLOWUP
      ? [
          { label: 'omitted-size-50', nameMode: 'omitted', size: 50 },
          { label: 'omitted-size-100', nameMode: 'omitted', size: 100 },
          { label: 'omitted-size-250', nameMode: 'omitted', size: 250 },
          { label: 'omitted-from-9900-size-100', nameMode: 'omitted', size: 100, from: 9900 },
          { label: 'omitted-sort-lastName', nameMode: 'omitted', sort: 'lastName' },
          { label: 'ca-omitted-size-100', country: 'CA', nameMode: 'omitted', size: 100 },
          { label: 'location-TX-size-100', nameMode: 'omitted', location: 'TX', size: 100 },
          {
            label: 'location-Austin-TX-size-100',
            nameMode: 'omitted',
            location: 'Austin, TX',
            size: 100,
          },
        ]
      : [
          { label: 'baseline-empty-size-12', size: 12 },
          { label: 'empty-size-50', size: 50 },
          { label: 'empty-size-100', size: 100 },
          { label: 'empty-size-250', size: 250 },
          { label: 'empty-from-1000', size: 12, from: 1000 },
          { label: 'empty-from-9900', size: 12, from: 9900 },
          { label: 'empty-from-10100', size: 12, from: 10100 },
          { label: 'omitted-name-size-12', nameMode: 'omitted', size: 12 },
          { label: 'sort-name', sort: 'name' },
          { label: 'sort-lastName', sort: 'lastName' },
          { label: 'sort-id', sort: 'id' },
          { label: 'sort-asc', sort: 'asc' },
          { label: 'ca-empty-size-100', country: 'CA', size: 100 },
        ];

    for (const probe of probes) {
      const result = await runSearchProbe(session.page, probe);
      results.push(result);
      console.log(
        `[probe] ${result.label} ok=${result.ok} count=${result.count ?? '-'} returned=${result.returned ?? '-'} error=${result.error ?? '-'}`,
      );
      await sleepWithJitter(2_500);
    }
  } finally {
    const report = {
      generatedAt: new Date().toISOString(),
      graphqlUrl: GRAPHQL_URL,
      schema,
      results,
    };
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[probe] report=${OUTPUT_PATH}`);
    await closeExpBrowser(session);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
