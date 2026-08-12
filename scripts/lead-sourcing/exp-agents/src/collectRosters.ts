import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import {
  closeExpBrowser,
  launchExpBrowser,
  sleepWithJitter,
  type LaunchOptions,
} from './browser.ts';
import { loadJson, saveJson } from './checkpoint.ts';
import {
  agentsPhpUrl,
  classifyHostKind,
  looksLikeChallengeHtml,
  normalizeHost,
  parseRosterJson,
  rosterEndpoint,
  updateHostStatus,
} from './rosterHosts.ts';
import { normalizeRosterAgent } from './rosterMatch.ts';
import type {
  CapturedRoster,
  HostCaptureCheckpoint,
  RosterAgent,
  RosterHost,
  RosterHostManifest,
} from './rosterTypes.ts';

export type CollectOptions = {
  runDir: string;
  hosts: RosterHost[];
  rateMs: number;
  resume: boolean;
  headed: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  maxHosts?: number | null;
};

function captureDir(runDir: string): string {
  return join(runDir, 'roster_captures');
}

function capturePath(runDir: string, host: string): string {
  const hostname = new URL(normalizeHost(host)).hostname.replace(/\./g, '_');
  return join(captureDir(runDir), `${hostname}.json`);
}

function checkpointPath(runDir: string): string {
  return join(runDir, 'roster_capture_checkpoint.json');
}

function emptyCheckpoint(): HostCaptureCheckpoint {
  return {
    done: false,
    completedHosts: [],
    failedHosts: [],
    updatedAt: new Date().toISOString(),
  };
}

export function isChallengeResponse(status: number, body: string): boolean {
  if (status === 403 || status === 503) {
    if (looksLikeChallengeHtml(body) || body.trim().startsWith('<')) return true;
  }
  return looksLikeChallengeHtml(body);
}

async function fetchRosterViaPage(
  page: Page,
  host: string,
): Promise<{ status: number; body: string; agents: RosterAgent[] }> {
  const agentsUrl = agentsPhpUrl(host);
  await page.goto(agentsUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(800 + Math.floor(Math.random() * 700));

  const endpoint = rosterEndpoint(host, '');
  const result = await page.evaluate(async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json,text/plain,*/*' },
        credentials: 'include',
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }, endpoint);

  if (isChallengeResponse(result.status, result.body)) {
    throw new Error(`challenge response from ${host} (HTTP ${result.status})`);
  }

  const parsed = parseRosterJson(result.body);
  if (!parsed) {
    throw new Error(
      `non-JSON roster payload from ${host} (HTTP ${result.status}, ${result.body.slice(0, 120)})`,
    );
  }

  const agents = parsed
    .map((row) => normalizeRosterAgent(row as Record<string, unknown>))
    .filter((row): row is RosterAgent => row != null);

  return { status: result.status, body: result.body, agents };
}

export async function collectRosters(
  options: CollectOptions,
): Promise<{
  captures: CapturedRoster[];
  manifestUpdates: RosterHost[];
  checkpoint: HostCaptureCheckpoint;
}> {
  mkdirSync(captureDir(options.runDir), { recursive: true });
  const checkpoint =
    options.resume && loadJson<HostCaptureCheckpoint>(checkpointPath(options.runDir))
      ? loadJson<HostCaptureCheckpoint>(checkpointPath(options.runDir))!
      : emptyCheckpoint();
  const completed = new Set(checkpoint.completedHosts.map(normalizeHost));
  const captures: CapturedRoster[] = [];
  const manifestUpdates: RosterHost[] = [];

  const pending = options.hosts.filter((host) => !completed.has(normalizeHost(host.host)));
  const limited =
    options.maxHosts != null ? pending.slice(0, options.maxHosts) : pending;

  if (!limited.length) {
    checkpoint.done = true;
    checkpoint.updatedAt = new Date().toISOString();
    saveJson(checkpointPath(options.runDir), checkpoint);
    for (const host of options.hosts) {
      const path = capturePath(options.runDir, host.host);
      if (existsSync(path)) {
        const existing = loadJson<CapturedRoster>(path);
        if (existing) captures.push(existing);
      }
    }
    return { captures, manifestUpdates, checkpoint };
  }

  const launch: LaunchOptions = {
    headed: options.headed,
    cdpUrl: options.cdpUrl,
    userDataDir: options.userDataDir,
  };
  const session = await launchExpBrowser(launch);

  try {
    for (const host of limited) {
      const normalized = normalizeHost(host.host);
      console.log(`[roster-collect] capturing ${normalized}`);
      try {
        const { agents } = await fetchRosterViaPage(session.page, normalized);
        const capturedAt = new Date().toISOString();
        const capture: CapturedRoster = {
          host: normalized,
          capturedAt,
          count: agents.length,
          agents,
        };
        saveJson(capturePath(options.runDir, normalized), capture);
        // Also keep a compact sidecar without huge descriptions for debugging size.
        writeFileSync(
          join(captureDir(options.runDir), `${new URL(normalized).hostname.replace(/\./g, '_')}.meta.json`),
          `${JSON.stringify(
            {
              host: normalized,
              capturedAt,
              count: agents.length,
              withTitle: agents.filter((a) => a.title.trim()).length,
              withPositions: agents.filter((a) => a.position_types.length).length,
            },
            null,
            2,
          )}\n`,
        );
        captures.push(capture);
        completed.add(normalized);
        checkpoint.completedHosts = [...completed];
        checkpoint.failedHosts = checkpoint.failedHosts.filter(
          (row) => normalizeHost(row.host) !== normalized,
        );
        checkpoint.updatedAt = capturedAt;
        saveJson(checkpointPath(options.runDir), checkpoint);

        manifestUpdates.push(
          updateHostStatus(host, {
            status: agents.length ? 'healthy' : 'empty',
            rosterCount: agents.length,
            agentsPhpOk: true,
            kind: classifyHostKind(agents.length, host.prefix),
            lastCapturedAt: capturedAt,
            error: null,
          }),
        );
        console.log(`[roster-collect] ${normalized} agents=${agents.length}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /challenge/i.test(message) ? 'challenge' : 'error';
        console.warn(`[roster-collect] ${normalized} failed: ${message.split('\n')[0]}`);
        checkpoint.failedHosts = [
          ...checkpoint.failedHosts.filter((row) => normalizeHost(row.host) !== normalized),
          { host: normalized, error: message.split('\n')[0] },
        ];
        checkpoint.updatedAt = new Date().toISOString();
        saveJson(checkpointPath(options.runDir), checkpoint);
        manifestUpdates.push(
          updateHostStatus(host, {
            status,
            agentsPhpOk: false,
            error: message.split('\n')[0],
          }),
        );
      }
      await sleepWithJitter(options.rateMs);
    }
  } finally {
    await closeExpBrowser(session);
  }

  // Reload previously completed captures when resuming.
  for (const host of options.hosts) {
    const path = capturePath(options.runDir, host.host);
    if (!captures.some((capture) => normalizeHost(capture.host) === normalizeHost(host.host))) {
      if (existsSync(path)) {
        const existing = loadJson<CapturedRoster>(path);
        if (existing) captures.push(existing);
      }
    }
  }

  checkpoint.done = options.hosts.every((host) =>
    completed.has(normalizeHost(host.host)),
  );
  checkpoint.updatedAt = new Date().toISOString();
  saveJson(checkpointPath(options.runDir), checkpoint);
  return { captures, manifestUpdates, checkpoint };
}

export function loadAllCaptures(runDir: string): CapturedRoster[] {
  const dir = captureDir(runDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.meta.json'))
    .map((name) => loadJson<CapturedRoster>(join(dir, name)))
    .filter((row): row is CapturedRoster => Boolean(row?.host && Array.isArray(row.agents)));
}

export function applyManifestUpdates(
  manifest: RosterHostManifest,
  updates: RosterHost[],
): RosterHostManifest {
  const byHost = new Map(manifest.hosts.map((host) => [normalizeHost(host.host), host]));
  for (const update of updates) {
    byHost.set(normalizeHost(update.host), update);
  }
  return {
    ...manifest,
    updatedAt: new Date().toISOString(),
    hosts: [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host)),
  };
}
