import type { Page } from 'playwright';
import {
  cleanCompanyNameForSearch,
  compareToTesterRow,
  filterMemberPrincipals,
  parseEntityDetailHtml,
  parseSearchResultsHtml,
  pickBestSearchHit,
  type PersistEntityOwnerInput,
  type UtahEntityDetailParsed,
  type UtahSearchHit,
} from '@furnace/registry-server';

export type CsvRow = Record<string, string>;

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
  /** Set when detail page parsed successfully (Foundry reconciliation) */
  parsedDetail?: UtahEntityDetailParsed | null;
  detailHtml?: string;
  hitStatus?: string;
};

export type UtahEntityLookupResult =
  | {
      status: 'ok';
      searchQuery: string;
      entityNumber: string;
      entityName: string;
      owners: PersistEntityOwnerInput[];
      parsedDetail: UtahEntityDetailParsed;
      detailHtml: string;
      hitStatus?: string;
    }
  | {
      status: 'no_hit' | 'ambiguous' | 'parse_failed' | 'exception';
      searchQuery: string;
      entityNumber: string;
      entityName: string;
      owners: PersistEntityOwnerInput[];
      errorMessage?: string;
      detailHtml?: string;
      hitStatus?: string;
    };

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForUserActionJitter(page: Page, minMs = 150, maxMs = 475): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function gotoSearchForm(page: Page): Promise<void> {
  await waitForUserActionJitter(page, 250, 700);
  await page.goto('https://businessregistration.utah.gov/', { waitUntil: 'domcontentloaded' });
  await waitForUserActionJitter(page);
  await page.getByRole('link', { name: /Search Business Entity Records/i }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForSelector('#BusinessSearch_Index_txtEntityName', { timeout: 60000 });
}

/**
 * From Business Information detail, return to search form.
 */
async function returnToSearch(page: Page): Promise<void> {
  const detailReturn = page.locator('#btnReturntoSearch, input[value="Return to Search"]');
  const resultsReturn = page.locator('#BusinessSearch_SearchResult_btnReturntoSearch, input[value="Return To Search"]');
  if ((await detailReturn.count()) > 0) {
    await waitForUserActionJitter(page);
    await detailReturn.first().click();
  } else if ((await resultsReturn.count()) > 0) {
    await waitForUserActionJitter(page);
    await resultsReturn.first().click();
  } else {
    await gotoSearchForm(page);
    return;
  }
  await page.waitForSelector('#BusinessSearch_Index_txtEntityName', { timeout: 60000 });
}

export async function ensureUtahSearchForm(page: Page, isFirst: boolean): Promise<void> {
  if (isFirst) {
    await gotoSearchForm(page);
    return;
  }
  await returnToSearch(page);
}

function ownersForUtahDetail(detail: UtahEntityDetailParsed): PersistEntityOwnerInput[] {
  return filterMemberPrincipals(detail.principals).map((p) => ({
    ownerName: p.name.trim(),
    titleRole: p.title.trim() || null,
  }));
}

async function runUtahSearch(page: Page, query: string): Promise<ReturnType<typeof pickBestSearchHit>> {
  await waitForUserActionJitter(page);
  await page.locator('#BusinessSearch_Index_rdContains').check();
  await waitForUserActionJitter(page);
  await page.locator('#BusinessSearch_Index_txtEntityName').fill(query);
  await waitForUserActionJitter(page);
  await page.locator('#btnSearch').click();

  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => {
      const tb = document.querySelector('#grid_businessList tbody');
      if (!tb) return false;
      const links = tb.querySelectorAll('a[onclick*="GetBusinessSearchResultById"]');
      return links.length > 0 && [...links].some((a) => (a.textContent?.trim().length ?? 0) > 2);
    },
    { timeout: 90000 },
  );

  const resultsHtml = await page.content();
  const hits = parseSearchResultsHtml(resultsHtml);
  return pickBestSearchHit(hits, query);
}

export async function openUtahSearchHit(page: Page, hit: UtahSearchHit): Promise<UtahEntityLookupResult> {
  await waitForUserActionJitter(page, 225, 650);
  await page.evaluate((businessId: string) => {
    const links = document.querySelectorAll<HTMLAnchorElement>('#grid_businessList tbody a[onclick]');
    for (const a of links) {
      if (a.getAttribute('onclick')?.includes(`GetBusinessSearchResultById`) && a.getAttribute('onclick')?.includes(businessId)) {
        a.click();
        return;
      }
    }
  }, hit.businessId);

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const detailHtml = await page.content();
  const detail = parseEntityDetailHtml(detailHtml);
  if (!detail) {
    return {
      status: 'parse_failed',
      searchQuery: '',
      entityNumber: hit.entityNumber,
      entityName: hit.entityName,
      owners: [],
      detailHtml,
      hitStatus: hit.status,
    };
  }

  return {
    status: 'ok',
    searchQuery: '',
    entityNumber: detail.entityNumber || hit.entityNumber,
    entityName: detail.entityName || hit.entityName,
    owners: ownersForUtahDetail(detail),
    parsedDetail: detail,
    detailHtml,
    hitStatus: hit.status,
  };
}

export async function scrapeUtahEntityByName(
  page: Page,
  params: { query: string; enrichQuery?: string; isFirst: boolean },
): Promise<UtahEntityLookupResult> {
  const searchQuery = cleanCompanyNameForSearch(params.query.trim());
  const enrichQuery = cleanCompanyNameForSearch((params.enrichQuery ?? '').trim());
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
    await ensureUtahSearchForm(page, params.isFirst);
    let picked = await runUtahSearch(page, searchQuery);

    if ((!('hit' in picked) || !picked.hit) && enrichQuery && enrichQuery !== searchQuery) {
      await returnToSearch(page);
      picked = await runUtahSearch(page, enrichQuery);
    }

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

    const opened = await openUtahSearchHit(page, picked.hit);
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

export async function scrapeUtahRow(page: Page, row: CsvRow, opts: { isFirst: boolean }): Promise<ScrapeRowResult> {
  const csvId = (row['Id'] ?? row['id'] ?? '').trim();
  const companyName = cleanCompanyNameForSearch((row['Company Name'] ?? '').trim());
  const enrichCompany = cleanCompanyNameForSearch((row['Enrich company'] ?? '').trim());
  const expectedPeople = (row['Name - People - Results'] ?? '').trim();

  const base: Omit<ScrapeRowResult, 'searchQuery' | 'entityNumber' | 'entityName' | 'memberNames' | 'compareOutcome' | 'compareReason' | 'ambiguous' | 'error'> = {
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
    const lookedUp = await scrapeUtahEntityByName(page, {
      query: companyName,
      enrichQuery: enrichCompany,
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
      throw new Error(lookedUp.errorMessage ?? 'utah_lookup_failed');
    }

    const members = lookedUp.owners.map((owner) => owner.ownerName.trim());
    const cmp = compareToTesterRow(members, expectedPeople);

    return {
      ...base,
      searchQuery: lookedUp.searchQuery,
      entityNumber: lookedUp.entityNumber,
      entityName: lookedUp.entityName,
      memberNames: members,
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
