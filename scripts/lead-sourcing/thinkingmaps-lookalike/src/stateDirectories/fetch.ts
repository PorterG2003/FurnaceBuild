import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { DEFAULT_USER_AGENT } from '../lib/http.js';
import { dataDir, fixturesDir } from '../lib/env.js';
import { STATE_DIRECTORY_STATES, type StateDirectoryState } from './types.js';

export type FetchedStateFile = {
  state: StateDirectoryState;
  path: string;
  fromCache: boolean;
};

const CA_TXT = 'https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt';
const CO_XLSX = 'https://cedar.cde.state.co.us/edulibdir/School Addresses-en.xlsx';
const IL_XLSX = 'https://www.isbe.net/Documents/2025-26-Directory-Ed-Entities.xlsx';
const TX_URL = 'https://tealprod.tea.state.tx.us/Tea.AskTed.Web/Forms/DownloadFile2.aspx';
const FL_URL = 'https://eds.fldoe.org/EDS/MasterSchoolID/Downloads/SelectDistrict.cfm?type=2';
const GA_CSV = 'https://app3.doe.k12.ga.us/ows-bin/owa/main_pack_school_addr.main_print_addr_csv';
const HI_HTML = 'https://iportal.k12.hi.us/phonedirectory/schoollist';
const KY_URL = 'https://openhouse.education.ky.gov/Principals';
const NV_XLSX =
  'https://webapp-strapi-paas-prod-nde-001.azurewebsites.net/uploads/school_directory_9b69a05740.xlsx';
const UT_JSON = 'https://cactus.schools.utah.gov/api/legacy/schools';
const VA_HTML = 'https://www.va-doeapp.com/PublicSchoolsByDivisions.aspx?w=true';
const ID_REPORT = 'https://apps.sde.idaho.gov/IDCI/Reports/ViewReport.aspx?id=14';
const TN_DIR = 'https://tnschooldirectory.tnedu.gov/';
const OR_ZIP = 'https://www.ode.state.or.us/ftp/incoming/inst_db_extract_XL8.zip';
const AL_SITES = 'https://eddir.alsde.edu/SiteInfo/PublicPrivateReligiousSites';

export const STATE_SOURCE_URL: Record<StateDirectoryState, string> = {
  CA: CA_TXT,
  CO: CO_XLSX,
  IL: IL_XLSX,
  TX: TX_URL,
  FL: FL_URL,
  GA: GA_CSV,
  HI: HI_HTML,
  KY: KY_URL,
  NV: NV_XLSX,
  UT: UT_JSON,
  VA: VA_HTML,
  ID: ID_REPORT,
  TN: TN_DIR,
  OR: OR_ZIP,
  AL: AL_SITES,
};

export function stateDirectoryRoot(fixtures = false): string {
  return fixtures ? join(fixturesDir, 'state-directories') : join(dataDir, 'state-directories');
}

function cachedPath(root: string, state: StateDirectoryState, filename: string): string {
  return join(root, state, filename);
}

function firstExisting(root: string, state: StateDirectoryState, names: string[]): string | null {
  for (const name of names) {
    const path = cachedPath(root, state, name);
    if (existsSync(path) && readFileSync(path).length > 40) return path;
  }
  return null;
}

function extractXlsxFromZip(zipPath: string, destPath: string): void {
  mkdirSync(dirname(destPath), { recursive: true });
  const script = [
    'import zipfile, pathlib, sys',
    'z = zipfile.ZipFile(sys.argv[1])',
    "name = next(n for n in z.namelist() if n.lower().endswith(('.xlsx', '.xls')))",
    'pathlib.Path(sys.argv[2]).write_bytes(z.read(name))',
  ].join('\n');
  execFileSync('python3', ['-c', script, zipPath, destPath], { stdio: 'pipe' });
  if (!existsSync(destPath) || readFileSync(destPath).length < 40) {
    throw new Error(`Failed to extract xlsx from ${zipPath}`);
  }
}

async function downloadGet(url: string, destPath: string, timeoutMs = 90_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: '*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 40) throw new Error(`Empty download from ${url}`);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, buf);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadViaBrowser(options: {
  url: string;
  destPath: string;
  timeoutMs?: number;
  interact: (page: import('playwright').Page) => Promise<void>;
}): Promise<void> {
  const { chromium } = await import('playwright');
  const timeoutMs = options.timeoutMs ?? 90_000;
  const launchOptions = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  };
  const browser = await chromium
    .launch({ ...launchOptions, channel: 'chrome' })
    .catch(() => chromium.launch(launchOptions));
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: 'en-US',
    userAgent: DEFAULT_USER_AGENT,
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const body = ((await page.textContent('body').catch(() => '')) ?? '').slice(0, 400);
    if ((response?.status() ?? 0) >= 400 || /service is unavailable/i.test(body)) {
      throw new Error(`Browser fetch failed (${response?.status() ?? 0}) for ${options.url}: ${body.trim() || 'empty page'}`);
    }
    const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
    await options.interact(page);
    const download = await downloadPromise;
    mkdirSync(dirname(options.destPath), { recursive: true });
    await download.saveAs(options.destPath);
    if (!existsSync(options.destPath) || readFileSync(options.destPath).length < 40) {
      throw new Error(`Download from ${options.url} was empty`);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function fetchCa(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'CA', 'pubschls.txt');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'CA', path, fromCache: true };
  }
  await downloadGet(CA_TXT, path);
  return { state: 'CA', path, fromCache: false };
}

async function fetchCo(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'CO', 'schools.xlsx');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'CO', path, fromCache: true };
  }
  await downloadGet(CO_XLSX, path);
  return { state: 'CO', path, fromCache: false };
}

async function fetchIl(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'IL', 'dir_ed_entities.xlsx');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'IL', path, fromCache: true };
  }
  await downloadGet(IL_XLSX, path);
  return { state: 'IL', path, fromCache: false };
}

async function fetchTx(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh ? firstExisting(root, 'TX', ['personnel.csv', 'personnel.xlsx']) : null;
  if (existing) return { state: 'TX', path: existing, fromCache: true };
  const dest = cachedPath(root, 'TX', 'personnel.csv');
  await downloadViaBrowser({
    url: TX_URL,
    destPath: dest,
    interact: async (page) => {
      const prin = page.locator('#chkPrin');
      if ((await prin.count()) === 0) throw new Error('AskTED principal checkbox #chkPrin not found');
      await prin.check();
      await page.locator('#btnDownloadFile').click();
    },
  });
  return { state: 'TX', path: dest, fromCache: false };
}

async function fetchFl(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh
    ? firstExisting(root, 'FL', ['msid.xlsx', 'msid.xls', 'msid.csv', 'msid.txt'])
    : null;
  if (existing) return { state: 'FL', path: existing, fromCache: true };
  const tmp = cachedPath(root, 'FL', 'msid.download');
  await downloadViaBrowser({
    url: FL_URL,
    destPath: tmp,
    interact: async (page) => {
      const submit = page.locator('input[type=submit], button[type=submit], input[value="Submit"]').first();
      if ((await submit.count()) === 0) throw new Error('FL MSID submit button not found');
      await submit.click();
    },
  });
  const buf = readFileSync(tmp);
  const looksZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const dest = cachedPath(root, 'FL', looksZip ? 'msid.xlsx' : 'msid.csv');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return { state: 'FL', path: dest, fromCache: false };
}

async function fetchGa(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'GA', 'schools.csv');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'GA', path, fromCache: true };
  }
  await downloadGet(GA_CSV, path);
  return { state: 'GA', path, fromCache: false };
}

async function fetchHi(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'HI', 'schoollist.html');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'HI', path, fromCache: true };
  }
  await downloadGet(HI_HTML, path, 120_000);
  return { state: 'HI', path, fromCache: false };
}

async function fetchKy(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'KY', 'principals.csv');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'KY', path, fromCache: true };
  }
  await downloadViaBrowser({
    url: KY_URL,
    destPath: path,
    interact: async (page) => {
      const btn = page.locator('#downloadCSVButton');
      if ((await btn.count()) === 0) throw new Error('KY Export to CSV button #downloadCSVButton not found');
      await btn.click();
    },
  });
  return { state: 'KY', path, fromCache: false };
}

async function fetchNv(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh ? firstExisting(root, 'NV', ['directory.xlsx', 'directory.csv']) : null;
  if (existing) return { state: 'NV', path: existing, fromCache: true };
  const path = cachedPath(root, 'NV', 'directory.xlsx');
  await downloadGet(NV_XLSX, path);
  return { state: 'NV', path, fromCache: false };
}

async function fetchUt(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'UT', 'schools.json');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'UT', path, fromCache: true };
  }
  await downloadGet(UT_JSON, path);
  return { state: 'UT', path, fromCache: false };
}

async function fetchVa(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const path = cachedPath(root, 'VA', 'schools.html');
  if (!refresh && existsSync(path) && readFileSync(path).length > 40) {
    return { state: 'VA', path, fromCache: true };
  }
  await downloadGet(VA_HTML, path);
  return { state: 'VA', path, fromCache: false };
}

async function fetchId(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh ? firstExisting(root, 'ID', ['contacts.csv', 'contacts.xlsx']) : null;
  if (existing) return { state: 'ID', path: existing, fromCache: true };
  const dest = cachedPath(root, 'ID', 'contacts.csv');
  await downloadViaBrowser({
    url: ID_REPORT,
    destPath: dest,
    timeoutMs: 120_000,
    interact: async (page) => {
      await page.waitForSelector('text=Last Name', { timeout: 90_000 });
      const exportBtn = page.locator('#rptViewer_ctl06_ctl04_ctl00');
      if ((await exportBtn.count()) > 0) await exportBtn.click();
      else await page.getByText('Export', { exact: true }).first().click();
      await page.getByText('CSV (comma delimited)').click();
    },
  });
  return { state: 'ID', path: dest, fromCache: false };
}

async function fetchTn(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh
    ? firstExisting(root, 'TN', ['directory.xlsx', 'directory.csv', 'schools.xlsx'])
    : null;
  if (existing) return { state: 'TN', path: existing, fromCache: true };
  const dest = cachedPath(root, 'TN', 'directory.xlsx');
  await downloadViaBrowser({
    url: TN_DIR,
    destPath: dest,
    timeoutMs: 180_000,
    interact: async (page) => {
      const btn = page.locator('#download-btn');
      if ((await btn.count()) === 0) throw new Error('TN Download Directory button #download-btn not found');
      await btn.click();
    },
  });
  return { state: 'TN', path: dest, fromCache: false };
}

async function fetchOr(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh ? firstExisting(root, 'OR', ['institutions.xlsx', 'schools.xlsx']) : null;
  if (existing) return { state: 'OR', path: existing, fromCache: true };
  const zipPath = cachedPath(root, 'OR', 'institutions.zip');
  const dest = cachedPath(root, 'OR', 'institutions.xlsx');
  await downloadGet(OR_ZIP, zipPath, 120_000);
  extractXlsxFromZip(zipPath, dest);
  return { state: 'OR', path: dest, fromCache: false };
}

async function fetchAl(root: string, refresh: boolean): Promise<FetchedStateFile> {
  const existing = !refresh ? firstExisting(root, 'AL', ['sites.csv', 'sites.xlsx']) : null;
  if (existing) return { state: 'AL', path: existing, fromCache: true };
  const dest = cachedPath(root, 'AL', 'sites.csv');
  await downloadViaBrowser({
    url: AL_SITES,
    destPath: dest,
    timeoutMs: 120_000,
    interact: async (page) => {
      const btn = page.getByText('Export CSV', { exact: true }).first();
      if ((await btn.count()) === 0) throw new Error('AL Export CSV button not found');
      await btn.click();
    },
  });
  return { state: 'AL', path: dest, fromCache: false };
}

const FETCHERS: Record<StateDirectoryState, (root: string, refresh: boolean) => Promise<FetchedStateFile>> = {
  CA: fetchCa,
  CO: fetchCo,
  IL: fetchIl,
  TX: fetchTx,
  FL: fetchFl,
  GA: fetchGa,
  HI: fetchHi,
  KY: fetchKy,
  NV: fetchNv,
  UT: fetchUt,
  VA: fetchVa,
  ID: fetchId,
  TN: fetchTn,
  OR: fetchOr,
  AL: fetchAl,
};

const FIXTURE_NAMES = [
  'pubschls.txt',
  'schools.xlsx',
  'dir_ed_entities.xlsx',
  'personnel.csv',
  'msid.xlsx',
  'msid.csv',
  'msid.txt',
  'schools.csv',
  'schools.json',
  'schools.html',
  'principals.csv',
  'schoollist.html',
  'directory.csv',
  'directory.xlsx',
  'contacts.csv',
  'institutions.xlsx',
  'sites.csv',
];

export async function fetchStateFiles(options: {
  fixtures?: boolean;
  refresh?: boolean;
  states?: StateDirectoryState[];
}): Promise<FetchedStateFile[]> {
  const fixtures = Boolean(options.fixtures);
  const refresh = Boolean(options.refresh) && !fixtures;
  const root = stateDirectoryRoot(fixtures);
  const states = options.states ?? [...STATE_DIRECTORY_STATES];
  const out: FetchedStateFile[] = [];
  for (const state of states) {
    if (fixtures) {
      const found = firstExisting(root, state, FIXTURE_NAMES);
      if (!found) throw new Error(`Fixture missing for ${state} under ${root}/${state}`);
      out.push({ state, path: found, fromCache: true });
      continue;
    }
    out.push(await FETCHERS[state](root, refresh));
  }
  return out;
}

export function readFetchedBuffer(file: FetchedStateFile): Buffer {
  return readFileSync(file.path);
}

export function extensionOf(path: string): string {
  return extname(path).toLowerCase();
}
