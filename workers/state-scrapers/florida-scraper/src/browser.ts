import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import {
  cleanCompanyNameForSearch,
  compareToTesterRow,
  filterFloridaOwnerPeople,
  type PersistEntityOwnerInput,
  parseFloridaEntityDetailHtml,
  parseFloridaSearchResultsHtml,
  pickBestFloridaSearchHit,
  type FloridaEntityDetailParsed,
  type FloridaSearchHit,
} from '@furnace/registry-server';

export type CsvRow = Record<string, string>;

const SUNBIZ_ORIGIN = 'https://search.sunbiz.org';
const BYNAME_PATH = '/Inquiry/CorporationSearch/ByName';

function logSunbiz(event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: 'florida-browser', event, at: new Date().toISOString(), ...data }));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForUserActionJitter(page: Page, minMs = 150, maxMs = 475): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

export type ScrapeRowResult = {
  csvId: string;
  companyName: string;
  searchQuery: string;
  entityNumber: string;
  entityName: string;
  memberNames: string[];
  compareOutcome: string;
  compareReason: string;
  ambiguous: boolean;
  error?: string;
  parsedDetail?: FloridaEntityDetailParsed | null;
  detailHtml?: string;
  hitStatus?: string;
};

export type FloridaEntityLookupResult =
  | {
      status: 'ok';
      searchQuery: string;
      entityNumber: string;
      entityName: string;
      owners: PersistEntityOwnerInput[];
      parsedDetail: FloridaEntityDetailParsed;
      detailHtml: string;
      hitStatus?: string;
    }
  | {
      status: 'no_hit' | 'ambiguous' | 'parse_failed' | 'exception';
      searchQuery: string;
      entityNumber: string;
      entityName: string;
      owners: PersistEntityOwnerInput[];
      detailHtml?: string;
      hitStatus?: string;
      errorMessage?: string;
    };

/**
 * Sunbiz is more reliable with headed Chrome in ECS; always launch with Chrome channel.
 */
export async function launchChromiumForSunbiz(): Promise<Browser> {
  const headful = true;
  const useChrome = true;
  return chromium.launch({
    headless: !headful,
    channel: useChrome ? 'chrome' : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/**
 * Opens By Name once using headed Chrome so we do not waste time on Cloudflare headless retries.
 */
export async function createSunbizSession(): Promise<{ browser: Browser; page: Page }> {
  logSunbiz('session-mode', { mode: 'headed-chrome-only' });
  logSunbiz('launch-start', { headless: false, channel: 'chrome' });
  const browser = await launchChromiumForSunbiz();
  logSunbiz('launch-done', { headless: false, channel: 'chrome' });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await openSunbizByNameSearch(page, 'headed-chrome');
  logSunbiz('session-ready', { mode: 'headed-chrome' });
  return { browser, page };
}

async function waitForSunbizSearchForm(
  page: Page,
  timeoutMs: number,
  context: string,
): Promise<void> {
  const start = Date.now();
  let lastProgressLog = start;
  logSunbiz('wait-search-form-start', { context, timeoutMs });
  while (Date.now() - start < timeoutMs) {
    const title = await page.title().catch(() => '');
    const cloudflare = /just a moment/i.test(title);
    const now = Date.now();
    if (now - lastProgressLog >= 15000) {
      logSunbiz('wait-search-form-tick', {
        context,
        elapsedMs: now - start,
        titleSnippet: title.slice(0, 120),
        cloudflareLikely: cloudflare,
      });
      lastProgressLog = now;
    }
    if (!cloudflare) {
      const loc = page.locator('#SearchTerm').first();
      if (await loc.isVisible().catch(() => false)) {
        logSunbiz('wait-search-form-done', { context, elapsedMs: now - start });
        return;
      }
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(
    'Sunbiz search form did not appear (Cloudflare or site issue). Try FLORIDA_HEADFUL=1 with Chrome installed.',
  );
}

export async function openSunbizByNameSearch(page: Page, context: string): Promise<void> {
  const url = `${SUNBIZ_ORIGIN}${BYNAME_PATH}`;
  logSunbiz('goto-start', { context, url });
  await waitForUserActionJitter(page, 250, 700);
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  logSunbiz('goto-domcontentloaded', { context });
  await waitForSunbizSearchForm(page, 120000, context);
}

async function ensureResultsOrForm(page: Page, isFirst: boolean): Promise<void> {
  if (isFirst) {
    await openSunbizByNameSearch(page, 'scrape-first-row');
    return;
  }

  const onDetail = (await page.locator('.searchResultDetail').count()) > 0;
  if (onDetail) {
    logSunbiz('ensure-return-to-list', {});
    await waitForUserActionJitter(page);
    await page.getByRole('link', { name: 'Return to List' }).first().click();
    await page.waitForSelector('#search-results table tbody tr', { timeout: 90000 });
    return;
  }

  const onResults = (await page.locator('#search-results table tbody tr').count()) > 0;
  if (!onResults) {
    await openSunbizByNameSearch(page, 'scrape-reopen-search');
  }
}

export async function ensureFloridaSearchReady(page: Page, isFirst: boolean): Promise<void> {
  await ensureResultsOrForm(page, isFirst);
}

function ownersForFloridaDetail(detail: FloridaEntityDetailParsed): PersistEntityOwnerInput[] {
  const structured = detail.people.filter((p) => p.source !== 'registered_agent');
  const rows = structured.map((p) => ({
    ownerName: p.name.trim() || 'Unknown',
    titleRole: p.title.trim() || null,
  }));
  if (rows.length > 0) return rows;
  return filterFloridaOwnerPeople(detail).map((name) => ({
    ownerName: name.trim() || 'Unknown',
    titleRole: null,
  }));
}

async function submitEntityNameSearch(page: Page, query: string): Promise<void> {
  logSunbiz('submit-search-start', { queryLen: query.length });
  // Sunbiz repeats #SearchTerm (invalid duplicate ids). Pick a form whose search field is actually visible
  // (ECS/Xvfb often differs from local Chrome on which duplicate wins with .first()).
  const forms = page.locator('form').filter({ has: page.locator('#SearchTerm') });
  const nForms = await forms.count();
  if (nForms === 0) {
    throw new Error('Sunbiz: no form containing #SearchTerm');
  }
  let chosen = forms.first();
  for (let i = 0; i < nForms; i++) {
    const f = forms.nth(i);
    const term = f.locator('#SearchTerm').first();
    if (await term.isVisible().catch(() => false)) {
      chosen = f;
      logSunbiz('submit-search-form-picked', { formIndex: i, formCount: nForms });
      break;
    }
  }
  const input = chosen.locator('#SearchTerm').first();
  await waitForUserActionJitter(page);
  await input.click();
  await waitForUserActionJitter(page);
  await input.fill(query);
  // Submit via Enter: the named submit input is often not "actionable" under Xvfb (overlay/duplicate DOM)
  // even when the text field is visible; Enter still posts the form.
  await waitForUserActionJitter(page);
  await input.press('Enter');
  logSunbiz('submit-search-submitted', { via: 'enter', waitingForResultsMs: 90000 });
  await page.waitForSelector('#search-results table tbody tr', { timeout: 90000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

export async function searchFloridaEntity(page: Page, query: string): Promise<ReturnType<typeof pickBestFloridaSearchHit>> {
  await submitEntityNameSearch(page, query);
  const resultsHtml = await page.content();
  const hits = parseFloridaSearchResultsHtml(resultsHtml);
  return pickBestFloridaSearchHit(hits, query);
}

export async function openFloridaSearchHit(page: Page, hit: FloridaSearchHit): Promise<FloridaEntityLookupResult> {
  const detailUrl = new URL(hit.detailHref, SUNBIZ_ORIGIN).toString();
  await waitForUserActionJitter(page, 225, 650);
  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('.searchResultDetail', { timeout: 60000 }).catch(() => {});

  const detailHtml = await page.content();
  const detail = parseFloridaEntityDetailHtml(detailHtml);
  if (!detail) {
    return {
      status: 'parse_failed',
      searchQuery: '',
      entityNumber: hit.documentNumber,
      entityName: hit.entityName,
      owners: [],
      detailHtml,
      hitStatus: hit.status,
    };
  }

  return {
    status: 'ok',
    searchQuery: '',
    entityNumber: detail.documentNumber || hit.documentNumber,
    entityName: detail.entityName || hit.entityName,
    owners: ownersForFloridaDetail(detail),
    parsedDetail: detail,
    detailHtml,
    hitStatus: hit.status,
  };
}

export async function scrapeFloridaEntityByName(
  page: Page,
  params: { query: string; isFirst: boolean },
): Promise<FloridaEntityLookupResult> {
  const searchQuery = cleanCompanyNameForSearch(params.query.trim());
  if (!searchQuery) {
    return {
      status: 'exception',
      searchQuery,
      entityNumber: '',
      entityName: '',
      owners: [],
      errorMessage: 'empty_company_name',
    };
  }

  try {
    await ensureFloridaSearchReady(page, params.isFirst);
    const picked = await searchFloridaEntity(page, searchQuery);

    if ('ambiguous' in picked && picked.ambiguous) {
      return {
        status: 'ambiguous',
        searchQuery,
        entityNumber: '',
        entityName: '',
        owners: [],
      };
    }

    if (!('hit' in picked) || !picked.hit) {
      return {
        status: 'no_hit',
        searchQuery,
        entityNumber: '',
        entityName: '',
        owners: [],
      };
    }

    const opened = await openFloridaSearchHit(page, picked.hit);
    return {
      ...opened,
      searchQuery,
    };
  } catch (e) {
    return {
      status: 'exception',
      searchQuery,
      entityNumber: '',
      entityName: '',
      owners: [],
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function scrapeFloridaRow(
  page: Page,
  row: CsvRow,
  opts: { isFirst: boolean },
): Promise<ScrapeRowResult> {
  const csvId = (row['Id'] ?? row['id'] ?? '').trim();
  const companyName = cleanCompanyNameForSearch((row['Company Name'] ?? '').trim());
  const expectedPeople = (row['Name - People - Results'] ?? '').trim();

  const base: Omit<
    ScrapeRowResult,
    | 'searchQuery'
    | 'entityNumber'
    | 'entityName'
    | 'memberNames'
    | 'compareOutcome'
    | 'compareReason'
    | 'ambiguous'
    | 'error'
  > = {
    csvId,
    companyName,
  };

  if (!companyName) {
    return {
      ...base,
      searchQuery: '',
      entityNumber: '',
      entityName: '',
      memberNames: [],
      compareOutcome: 'skipped',
      compareReason: 'empty_company_name',
      ambiguous: false,
      error: 'empty_company_name',
    };
  }

  try {
    const lookedUp = await scrapeFloridaEntityByName(page, {
      query: companyName,
      isFirst: opts.isFirst,
    });

    if (lookedUp.status === 'ambiguous') {
      return {
        ...base,
        searchQuery: lookedUp.searchQuery,
        entityNumber: '',
        entityName: '',
        memberNames: [],
        compareOutcome: 'skipped',
        compareReason: 'ambiguous_search',
        ambiguous: true,
        error: 'ambiguous_search',
      };
    }

    if (lookedUp.status === 'no_hit') {
      return {
        ...base,
        searchQuery: lookedUp.searchQuery,
        entityNumber: '',
        entityName: '',
        memberNames: [],
        compareOutcome: 'no_match',
        compareReason: 'no_search_hit',
        ambiguous: false,
        error: 'no_search_hit',
      };
    }

    if (lookedUp.status === 'parse_failed') {
      return {
        ...base,
        searchQuery: lookedUp.searchQuery,
        entityNumber: lookedUp.entityNumber,
        entityName: lookedUp.entityName,
        memberNames: [],
        compareOutcome: 'skipped',
        compareReason: 'parse_detail_failed',
        ambiguous: false,
        error: 'parse_detail_failed',
        parsedDetail: null,
        detailHtml: lookedUp.detailHtml ?? '',
        hitStatus: lookedUp.hitStatus,
      };
    }

    if (lookedUp.status !== 'ok') {
      throw new Error(lookedUp.errorMessage ?? 'florida_lookup_failed');
    }

    const owners = lookedUp.owners.map((owner) => owner.ownerName.trim());
    const cmp = compareToTesterRow(owners, expectedPeople);

    return {
      ...base,
      searchQuery: lookedUp.searchQuery,
      entityNumber: lookedUp.entityNumber,
      entityName: lookedUp.entityName,
      memberNames: owners,
      compareOutcome: cmp.outcome,
      compareReason: cmp.reason,
      ambiguous: false,
      parsedDetail: lookedUp.parsedDetail,
      detailHtml: lookedUp.detailHtml,
      hitStatus: lookedUp.hitStatus,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      searchQuery: companyName,
      entityNumber: '',
      entityName: '',
      memberNames: [],
      compareOutcome: 'skipped',
      compareReason: 'exception',
      ambiguous: false,
      error: msg,
    };
  }
}
