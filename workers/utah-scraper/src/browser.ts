import type { Page } from 'playwright';

/** Strip leading checkmarks / whitespace from enriched CSV company fields */
export function cleanCompanyNameForSearch(name: string): string {
  return name.replace(/^[\s✅✓]+/u, '').trim();
}
import {
  compareToTesterRow,
  filterMemberPrincipals,
  parseEntityDetailHtml,
  parseSearchResultsHtml,
  pickBestSearchHit,
  type UtahEntityDetailParsed,
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

async function gotoSearchForm(page: Page): Promise<void> {
  await page.goto('https://businessregistration.utah.gov/', { waitUntil: 'domcontentloaded' });
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
    await detailReturn.first().click();
  } else if ((await resultsReturn.count()) > 0) {
    await resultsReturn.first().click();
  } else {
    await gotoSearchForm(page);
    return;
  }
  await page.waitForSelector('#BusinessSearch_Index_txtEntityName', { timeout: 60000 });
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
    if (opts.isFirst) {
      await gotoSearchForm(page);
    } else {
      await returnToSearch(page);
    }

    const searchQuery = companyName;
    await page.locator('#BusinessSearch_Index_rdContains').check();
    await page.locator('#BusinessSearch_Index_txtEntityName').fill(searchQuery);
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
    let picked = pickBestSearchHit(hits, searchQuery);

    if ((!('hit' in picked) || !picked.hit) && enrichCompany && enrichCompany !== companyName) {
      await returnToSearch(page);
      await page.locator('#BusinessSearch_Index_rdContains').check();
      await page.locator('#BusinessSearch_Index_txtEntityName').fill(enrichCompany);
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
      const html2 = await page.content();
      const hits2 = parseSearchResultsHtml(html2);
      picked = pickBestSearchHit(hits2, enrichCompany);
    }

    if ('ambiguous' in picked && picked.ambiguous) {
      return {
        ...base,
        searchQuery,
        entityNumber: '',
        entityName: '',
        memberNames: [],
        compareOutcome: 'skipped',
        compareReason: 'ambiguous_search',
        ambiguous: true,
        error: 'ambiguous_search',
      };
    }

    if (!('hit' in picked) || !picked.hit) {
      return {
        ...base,
        searchQuery,
        entityNumber: '',
        entityName: '',
        memberNames: [],
        compareOutcome: 'no_match',
        compareReason: 'no_search_hit',
        ambiguous: false,
        error: 'no_search_hit',
      };
    }

    const hit = picked.hit;
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
        ...base,
        searchQuery,
        entityNumber: hit.entityNumber,
        entityName: hit.entityName,
        memberNames: [],
        compareOutcome: 'skipped',
        compareReason: 'parse_detail_failed',
        ambiguous: false,
        error: 'parse_detail_failed',
        parsedDetail: null,
        detailHtml,
        hitStatus: hit.status,
      };
    }

    const members = filterMemberPrincipals(detail.principals).map((p) => p.name.trim());
    const cmp = compareToTesterRow(members, expectedPeople);

    return {
      ...base,
      searchQuery,
      entityNumber: detail.entityNumber || hit.entityNumber,
      entityName: detail.entityName || hit.entityName,
      memberNames: members,
      compareOutcome: cmp.outcome,
      compareReason: cmp.reason,
      ambiguous: false,
      parsedDetail: detail,
      detailHtml,
      hitStatus: hit.status,
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
