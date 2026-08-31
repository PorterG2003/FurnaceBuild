import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import { packageRoot } from '../lib/env.js';
import { writeHtmlCache } from '../lib/http.js';

export const NBCC_ACEP_URL = 'https://www.nbcc.org/search/acepdirectory';
export const NBCC_ALL_ACEPS_URL = 'https://www.nbcc.org/resources/searchdirectories/acep/all';

export type NbccDumpRow = {
  provider_name: string;
  website: string;
  home_study_only: boolean;
  former: boolean;
  source: string;
};

export type NbccBrowserDump = {
  html: string;
  jsonText: string;
  rows: NbccDumpRow[];
  tactic: string;
  irisFound: boolean;
  screenshotPath?: string;
};

const US_STATES = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'Puerto Rico',
  'Guam',
  'Virgin Islands',
];

const EXTRACT_ROWS = `(() => {
  const nav = /^(home|search|login|contact|about|privacy|all aceps|filter|menu|acep name|acep number|select state|connection interrupted|more info|approved continuing education providers)$/i;
  const rows = [];
  const seen = new Set();
  const push = (name, website, blob, source) => {
    const provider_name = String(name || '').replace(/\\s+/g, ' ').trim();
    if (provider_name.length < 3 || nav.test(provider_name)) return;
    if (/^more info$/i.test(provider_name)) return;
    const key = provider_name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const text = String(blob || '').toLowerCase();
    const live = /live|real time|person/.test(text);
    const home = /home[\\s-]*study/.test(text);
    rows.push({
      provider_name,
      website: String(website || '').trim(),
      home_study_only: home && !live,
      former: /\\bformer\\b|inactive|not currently/.test(text),
      source,
    });
  };
  const tables = document.querySelectorAll('#acep-search-results table, .mud-table table, table');
  for (const table of tables) {
    for (const tr of table.querySelectorAll('tbody tr, .mud-table-body .mud-table-row')) {
      const cells = [...tr.querySelectorAll('td, .mud-table-cell')].map((td) => td.innerText.trim());
      if (cells.length < 2) continue;
      if (/^(acep|name|org|provider|website|state|delivery)/i.test(cells[0] || '')) continue;
      const href = tr.querySelector('a[href^="http"]')?.getAttribute('href') || '';
      const locationIdx = cells.findIndex((c) => /,[\\s]*[A-Z]{2}\\s*$/.test(c));
      const name =
        locationIdx > 0
          ? cells[locationIdx - 1]
          : cells.find((c) => c.length > 2 && !/^https?:/i.test(c) && !/^[A-Z]{2}$/.test(c) && !/^more info$/i.test(c)) ||
            cells[1] ||
            cells[0];
      const website = href || cells.find((c) => /https?:|www\\./i.test(c)) || '';
      const labels = [...tr.querySelectorAll('[aria-label], title, text')].map((el) => el.getAttribute('aria-label') || el.textContent || '').join(' ');
      push(name, website, cells.join(' | ') + ' ' + (tr.innerText || '') + ' ' + labels, 'table');
    }
  }
  return rows;
})()`;

function looksLikeAcepJson(text: string): boolean {
  if (text.length < 80 || text.length > 8_000_000) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false;
  return /providerName|provider_name|"data"\s*:\s*\[/i.test(trimmed) && /acep|provider/i.test(trimmed);
}

export function dumpRowsFromAcepJson(text: string, source: string): NbccDumpRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(data)
    ? data
    : Array.isArray(rec.data)
      ? rec.data
      : Array.isArray(rec.rows)
        ? rec.rows
        : [];
  const rows: NbccDumpRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = String(row.providerName ?? row.provider_name ?? row.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 3) continue;
    const live = row.liveTrainingProvider ?? row.live_training_provider;
    const home = row.isHomeStudy ?? row.is_home_study ?? row.home_study_only;
    const active = row.active;
    rows.push({
      provider_name: name,
      website: String(row.website ?? row.url ?? '').trim(),
      home_study_only: Boolean(home) && live !== true && live !== 'true',
      former: active === false || active === 'false' || Boolean(row.former),
      source,
    });
  }
  return rows;
}

function mergeRows(into: NbccDumpRow[], extra: NbccDumpRow[]): void {
  const seen = new Set(into.map((r) => r.provider_name.toLowerCase()));
  for (const row of extra) {
    const key = row.provider_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(row);
  }
}

function irisIn(rows: NbccDumpRow[]): boolean {
  return rows.some((r) => /iris training collective/i.test(r.provider_name));
}

function keptCount(rows: NbccDumpRow[]): number {
  return rows.filter((r) => !r.home_study_only && !r.former).length;
}

async function dismissCookies(page: Page): Promise<void> {
  for (const sel of [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler',
  ]) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.click({ timeout: 2500 });
      return;
    } catch {
      // banner already gone
    }
  }
}

async function circuitOk(page: Page): Promise<boolean> {
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 8000);
  if (/connection interrupted/i.test(body) || /application may no longer respond/i.test(body)) {
    return false;
  }
  const table = page.locator('#acep-search-results table, .mud-table table, table tbody tr');
  const all = page.getByRole('button', { name: /all aceps/i });
  const link = page.getByRole('link', { name: /all aceps/i });
  return (await table.count()) > 0 || (await all.count()) > 0 || (await link.count()) > 0;
}

async function recoverCircuit(page: Page, url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await circuitOk(page)) return true;
    console.error(`[nbcc-browser] Connection Interrupted; reload ${attempt + 1}/3`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500 + attempt * 2000);
    await dismissCookies(page);
  }
  if (await circuitOk(page)) return true;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dismissCookies(page);
  return circuitOk(page);
}

async function extractDomRows(page: Page, source: string): Promise<NbccDumpRow[]> {
  const raw = (await page.evaluate(EXTRACT_ROWS).catch(() => [])) as NbccDumpRow[];
  return (raw ?? []).map((row) => ({ ...row, source: row.source || source }));
}

async function pagerTotal(page: Page): Promise<number> {
  const text = (await page.locator('.mud-table-pagination-caption').allInnerTexts().catch(() => []))
    .join(' ')
    .replace(/,/g, '');
  const match = text.match(/of\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function setLargestPageSize(page: Page): Promise<void> {
  const combo = page.locator('.mud-table-pagination').getByRole('combobox').first();
  if ((await combo.count()) === 0) return;
  await combo.click({ timeout: 8000 });
  const options = page.getByRole('option');
  const n = await options.count();
  if (n === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }
  await options.nth(n - 1).click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}

async function paginateTable(page: Page, into: NbccDumpRow[]): Promise<void> {
  await setLargestPageSize(page);
  const total = await pagerTotal(page);
  let pages = 0;
  const maxPages = total > 0 ? Math.min(250, Math.ceil(total / 5) + 2) : 200;
  while (pages < maxPages) {
    mergeRows(into, await extractDomRows(page, 'all-aceps'));
    pages += 1;
    const next = page.getByRole('button', { name: /next page/i }).first();
    if ((await next.count()) === 0) break;
    if (await next.isDisabled()) break;
    const before = (await page.locator('.mud-table-pagination-caption').first().innerText().catch(() => '')).trim();
    await next.click({ timeout: 8000 });
    await page.waitForTimeout(700);
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const after = (await page.locator('.mud-table-pagination-caption').first().innerText().catch(() => '')).trim();
      if (after && after !== before) break;
      await page.waitForTimeout(250);
    }
    if (pages % 10 === 0) {
      console.error(`[nbcc-browser] paginated ${pages} pages, ${into.length} names (site total ${total})`);
    }
  }
  console.error(`[nbcc-browser] pagination done pages=${pages} names=${into.length} site_total=${total}`);
}

async function searchIrisOnTable(page: Page): Promise<NbccDumpRow[]> {
  const box = page.locator('#acep-search-results input, .mud-table input[type="text"], .mud-input-slot').first();
  if ((await box.count()) === 0) return [];
  await box.fill('Iris');
  await page.waitForTimeout(2500);
  return extractDomRows(page, 'iris-search');
}

async function searchState(page: Page, state: string): Promise<NbccDumpRow[]> {
  const combo = page.getByRole('combobox', { name: /select state/i }).first();
  if ((await combo.count()) === 0) return [];
  await combo.click({ timeout: 8000 });
  await page.keyboard.type(state, { delay: 30 });
  const option = page.getByRole('option', { name: new RegExp(`^${state}$`, 'i') }).first();
  if ((await option.count()) === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    return [];
  }
  const jsonWait = page
    .waitForResponse(
      (res) => /json|javascript/i.test(res.headers()['content-type'] ?? '') && /acep|provider/i.test(res.url()),
      { timeout: 15000 },
    )
    .catch(() => null);
  await option.click({ timeout: 8000 });
  const searches = page.getByRole('button', { name: /^search$/i });
  const n = await searches.count();
  await searches.nth(Math.max(0, n - 1)).click({ timeout: 8000 });
  const jsonRes = await jsonWait;
  await page.waitForTimeout(1500);
  const fromJson = jsonRes ? dumpRowsFromAcepJson(await jsonRes.text().catch(() => ''), `state:${state}`) : [];
  if (fromJson.length > 0) return fromJson;
  return extractDomRows(page, `state:${state}`);
}

async function launchContext(headless: boolean): Promise<BrowserContext> {
  const userDataDir = join(packageRoot, 'output', '.chrome-nbcc');
  mkdirSync(userDataDir, { recursive: true });
  const common = {
    headless,
    viewport: { width: 1440, height: 1000 } as const,
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  };
  try {
    return await chromium.launchPersistentContext(userDataDir, { ...common, channel: 'chrome' });
  } catch {
    return await chromium.launchPersistentContext(userDataDir, common);
  }
}

export async function dumpNbccAceps(options: {
  runDir: string;
  startUrl?: string;
  headless?: boolean;
}): Promise<NbccBrowserDump> {
  const startUrl = options.startUrl ?? NBCC_ACEP_URL;
  const headless = Boolean(options.headless);
  mkdirSync(options.runDir, { recursive: true });
  const jsonBodies: { url: string; text: string }[] = [];
  const rows: NbccDumpRow[] = [];
  let tactic = 'none';
  let html = '';
  let screenshotPath: string | undefined;

  const context = await launchContext(headless);
  const page = context.pages()[0] ?? (await context.newPage());
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const tap = async (res: Response) => {
    try {
      const ct = res.headers()['content-type'] ?? '';
      if (!/json|javascript|text/i.test(ct) && !/acep|provider|search/i.test(res.url())) return;
      const text = await res.text();
      if (looksLikeAcepJson(text)) jsonBodies.push({ url: res.url(), text });
    } catch {
      // ignore closed responses
    }
  };
  page.on('response', tap);

  try {
    await page.goto(NBCC_ALL_ACEPS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await dismissCookies(page);
    let up = await recoverCircuit(page, NBCC_ALL_ACEPS_URL);
    if (!up) {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await dismissCookies(page);
      up = await recoverCircuit(page, startUrl);
    }
    if (!up) {
      screenshotPath = join(options.runDir, 'nbcc-screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      html = await page.content();
      tactic = 'circuit-dead';
    } else {
      for (const tapRow of jsonBodies) {
        mergeRows(rows, dumpRowsFromAcepJson(tapRow.text, 'xhr-json'));
      }
      if (keptCount(rows) >= 200) tactic = 'xhr-json';

      if (keptCount(rows) < 200) {
        try {
          if (!/\/acep\/all/i.test(page.url())) {
            await page.goto(NBCC_ALL_ACEPS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(2500);
            await dismissCookies(page);
            await recoverCircuit(page, NBCC_ALL_ACEPS_URL);
          }
          await paginateTable(page, rows);
          html = await page.content();
          if (keptCount(rows) >= 50) tactic = 'all-aceps';
        } catch (error) {
          console.error(`[nbcc-browser] All ACEPs failed: ${error instanceof Error ? error.message : error}`);
        }
      }

      const irisRows = await searchIrisOnTable(page).catch(() => [] as NbccDumpRow[]);
      mergeRows(rows, irisRows);
      if (irisIn(rows) && tactic === 'none') tactic = 'iris-search';

      if (keptCount(rows) < 200) {
        tactic = tactic === 'all-aceps' ? 'all-aceps+states' : 'states';
        for (const state of US_STATES) {
          try {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await dismissCookies(page);
            await recoverCircuit(page, startUrl);
            const found = await searchState(page, state);
            mergeRows(rows, found);
            console.error(`[nbcc-browser] ${state}: +${found.length} (total ${rows.length})`);
          } catch (error) {
            console.error(`[nbcc-browser] ${state} failed: ${error instanceof Error ? error.message : error}`);
          }
        }
        html = html || (await page.content());
      }
    }

    for (const tapRow of jsonBodies) {
      mergeRows(rows, dumpRowsFromAcepJson(tapRow.text, 'xhr-json'));
    }
    if (jsonBodies.length > 0 && tactic === 'none') tactic = 'xhr-json';

    const mergedApi = rows.map((r) => ({
      provider_name: r.provider_name,
      website: r.website,
      home_study_only: r.home_study_only,
      former: r.former,
    }));
    const jsonText =
      jsonBodies.find((b) => dumpRowsFromAcepJson(b.text, 'x').length >= 200)?.text ??
      JSON.stringify(mergedApi, null, 2);
    if (!html) html = await page.content();
    if (keptCount(rows) < 50) {
      screenshotPath = screenshotPath ?? join(options.runDir, 'nbcc-screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }

    writeFileSync(join(options.runDir, 'nbcc-acep.html'), html, 'utf8');
    writeFileSync(join(options.runDir, 'nbcc-acep.json'), jsonText, 'utf8');
    writeFileSync(
      join(options.runDir, 'nbcc-acep-taps.json'),
      JSON.stringify(
        jsonBodies.map((b) => ({ url: b.url, bytes: b.text.length, rows: dumpRowsFromAcepJson(b.text, 'x').length })),
        null,
        2,
      ),
      'utf8',
    );
    writeHtmlCache(join(options.runDir, 'html-cache'), startUrl, jsonText || html);

    const kept = rows.filter((r) => !r.home_study_only && !r.former);
    const irisFound = irisIn(kept) || irisIn(rows);
    console.error(
      `[nbcc-browser] tactic=${tactic} raw=${rows.length} kept=${kept.length} iris=${irisFound} json_taps=${jsonBodies.length}`,
    );

    return { html, jsonText, rows: kept, tactic, irisFound, screenshotPath };
  } finally {
    await context.close().catch(() => {});
  }
}
