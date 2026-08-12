import type { RosterHost, RosterHostManifest, RosterHostStatus } from './rosterTypes.ts';

/** MLS / regional prefixes observed or commonly used on eXp PHP sites. */
export const KNOWN_REGIONAL_PREFIXES: Array<{
  prefix: string;
  jurisdictions: string[];
}> = [
  // Pilot states — primary
  { prefix: 'ca', jurisdictions: ['CA'] },
  { prefix: 'nca', jurisdictions: ['CA'] },
  { prefix: 'sca', jurisdictions: ['CA'] },
  { prefix: 'bbv', jurisdictions: ['CA'] },
  // Los Angeles regional (not Louisiana — state code LA is not used as a host seed)
  { prefix: 'la', jurisdictions: ['CA'] },
  { prefix: 'sba', jurisdictions: ['CA'] },
  { prefix: 'sandiego', jurisdictions: ['CA'] },
  { prefix: 'tca', jurisdictions: ['FL'] },
  { prefix: 'abor', jurisdictions: ['TX'] },
  { prefix: 'ntreis', jurisdictions: ['TX'] },
  { prefix: 'il', jurisdictions: ['IL'] },
  { prefix: 'wa', jurisdictions: ['WA'] },
  { prefix: 'sea', jurisdictions: ['WA'] },
  { prefix: 'mfr', jurisdictions: ['FL'] },
  { prefix: 'sfl', jurisdictions: ['FL'] },
  { prefix: 'mia', jurisdictions: ['FL'] },
  { prefix: 'fl', jurisdictions: ['FL'] },
  { prefix: 'tpa', jurisdictions: ['FL'] },
  { prefix: 'nef', jurisdictions: ['FL'] },
  { prefix: 'ntx', jurisdictions: ['TX'] },
  { prefix: 'har', jurisdictions: ['TX'] },
  { prefix: 'stx', jurisdictions: ['TX'] },
  { prefix: 'atx', jurisdictions: ['TX'] },
  { prefix: 'sa', jurisdictions: ['TX'] },
  { prefix: 'elp', jurisdictions: ['TX'] },
  { prefix: 'sat', jurisdictions: ['TX'] },
  { prefix: 'tx', jurisdictions: ['TX'] },
  { prefix: 'or', jurisdictions: ['OR'] },
  { prefix: 'portland', jurisdictions: ['OR'] },
  // Other US regions for national scale
  { prefix: 'col', jurisdictions: ['CO'] },
  { prefix: 'co', jurisdictions: ['CO'] },
  { prefix: 'az', jurisdictions: ['AZ'] },
  { prefix: 'nv', jurisdictions: ['NV'] },
  { prefix: 'or', jurisdictions: ['OR'] },
  { prefix: 'pdx', jurisdictions: ['OR'] },
  { prefix: 'ga', jurisdictions: ['GA'] },
  { prefix: 'nc', jurisdictions: ['NC'] },
  { prefix: 'wnc', jurisdictions: ['NC'] },
  { prefix: 'sc', jurisdictions: ['SC'] },
  { prefix: 'va', jurisdictions: ['VA'] },
  { prefix: 'vab', jurisdictions: ['VA'] },
  { prefix: 'lva', jurisdictions: ['VA'] },
  { prefix: 'md', jurisdictions: ['MD'] },
  { prefix: 'pa', jurisdictions: ['PA'] },
  { prefix: 'nj', jurisdictions: ['NJ'] },
  { prefix: 'ny', jurisdictions: ['NY'] },
  { prefix: 'ct', jurisdictions: ['CT'] },
  { prefix: 'ma', jurisdictions: ['MA'] },
  { prefix: 'mi', jurisdictions: ['MI'] },
  { prefix: 'oh', jurisdictions: ['OH'] },
  { prefix: 'in', jurisdictions: ['IN'] },
  { prefix: 'mn', jurisdictions: ['MN'] },
  { prefix: 'wi', jurisdictions: ['WI'] },
  { prefix: 'mo', jurisdictions: ['MO'] },
  { prefix: 'tn', jurisdictions: ['TN'] },
  { prefix: 'al', jurisdictions: ['AL'] },
  { prefix: 'ok', jurisdictions: ['OK'] },
  { prefix: 'ks', jurisdictions: ['KS'] },
  { prefix: 'ar', jurisdictions: ['AR'] },
  { prefix: 'ms', jurisdictions: ['MS'] },
  { prefix: 'ky', jurisdictions: ['KY'] },
  { prefix: 'ia', jurisdictions: ['IA'] },
  { prefix: 'ne', jurisdictions: ['NE'] },
  { prefix: 'sd', jurisdictions: ['SD'] },
  { prefix: 'nd', jurisdictions: ['ND'] },
  { prefix: 'mt', jurisdictions: ['MT'] },
  { prefix: 'id', jurisdictions: ['ID'] },
  { prefix: 'ut', jurisdictions: ['UT'] },
  { prefix: 'nm', jurisdictions: ['NM'] },
  { prefix: 'wy', jurisdictions: ['WY'] },
  { prefix: 'hi', jurisdictions: ['HI'] },
  { prefix: 'ak', jurisdictions: ['AK'] },
  { prefix: 'dc', jurisdictions: ['DC'] },
  { prefix: 'de', jurisdictions: ['DE'] },
  { prefix: 'ri', jurisdictions: ['RI'] },
  { prefix: 'vt', jurisdictions: ['VT'] },
  { prefix: 'nh', jurisdictions: ['NH'] },
  { prefix: 'me', jurisdictions: ['ME'] },
  { prefix: 'wv', jurisdictions: ['WV'] },
  // Canada
  { prefix: 'on', jurisdictions: ['ON'] },
  { prefix: 'bc', jurisdictions: ['BC'] },
  { prefix: 'ab', jurisdictions: ['AB'] },
  { prefix: 'qc', jurisdictions: ['QC'] },
  { prefix: 'mb', jurisdictions: ['MB'] },
  { prefix: 'sk', jurisdictions: ['SK'] },
  { prefix: 'ns', jurisdictions: ['NS'] },
  { prefix: 'nb', jurisdictions: ['NB'] },
];

const STATE_PREFIXES = [
  'al',
  'ak',
  'az',
  'ar',
  'ca',
  'co',
  'ct',
  'de',
  'fl',
  'ga',
  'hi',
  'id',
  'il',
  'in',
  'ia',
  'ks',
  'ky',
  'la',
  'me',
  'md',
  'ma',
  'mi',
  'mn',
  'ms',
  'mo',
  'mt',
  'ne',
  'nv',
  'nh',
  'nj',
  'nm',
  'ny',
  'nc',
  'nd',
  'oh',
  'ok',
  'or',
  'pa',
  'ri',
  'sc',
  'sd',
  'tn',
  'tx',
  'ut',
  'vt',
  'va',
  'wa',
  'wv',
  'wi',
  'wy',
  'dc',
] as const;

export function normalizeHost(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = '';
  url.search = '';
  url.pathname = '';
  // Prefer bare host without trailing slash; keep www if present in seed.
  return `${url.protocol}//${url.host}`.replace(/\/$/, '');
}

export function hostPrefix(host: string): string {
  const hostname = new URL(normalizeHost(host)).hostname.toLowerCase();
  const withoutWww = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  const label = withoutWww.replace(/\.exprealty\.com$/i, '');
  return label;
}

export function guessJurisdictions(prefix: string): string[] {
  const known = KNOWN_REGIONAL_PREFIXES.find((entry) => entry.prefix === prefix.toLowerCase());
  if (known) return [...known.jurisdictions];
  const upper = prefix.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return [upper];
  return [];
}

export function emptyHost(prefix: string, jurisdictions: string[] = []): RosterHost {
  return {
    host: `https://${prefix}.exprealty.com`,
    prefix,
    jurisdictions: jurisdictions.length ? jurisdictions : guessJurisdictions(prefix),
    kind: 'unknown',
    status: 'pending',
    rosterCount: null,
    agentsPhpOk: false,
    lastProbedAt: null,
    lastCapturedAt: null,
    error: null,
    source: 'seed',
  };
}

/** Prefixes historically served only (or primarily) under www. */
const WWW_REQUIRED_PREFIXES = new Set(['har', 'mfr', 'col', 'sea', 'sca']);

export function seedHosts(options?: {
  jurisdictions?: string[];
  includeWww?: boolean;
}): RosterHost[] {
  const wanted = options?.jurisdictions?.map((j) => j.toUpperCase()) ?? null;
  const includeWww = options?.includeWww ?? true;
  const byHost = new Map<string, RosterHost>();

  const seedEntries = [
    ...KNOWN_REGIONAL_PREFIXES,
    ...STATE_PREFIXES.map((prefix) => ({
      prefix,
      jurisdictions: [prefix.toUpperCase()],
    })),
  ];

  for (const entry of seedEntries) {
    if (wanted && !entry.jurisdictions.some((j) => wanted.includes(j.toUpperCase()))) {
      continue;
    }
    const variants = [`https://${entry.prefix}.exprealty.com`];
    if (includeWww && WWW_REQUIRED_PREFIXES.has(entry.prefix)) {
      variants.push(`https://www.${entry.prefix}.exprealty.com`);
    }
    for (const host of variants) {
      const normalized = normalizeHost(host);
      if (byHost.has(normalized)) {
        const existing = byHost.get(normalized)!;
        for (const jurisdiction of entry.jurisdictions) {
          if (!existing.jurisdictions.includes(jurisdiction)) {
            existing.jurisdictions.push(jurisdiction);
          }
        }
        continue;
      }
      byHost.set(normalized, {
        ...emptyHost(entry.prefix, entry.jurisdictions),
        host: normalized,
        source: 'seed',
      });
    }
  }

  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
}

export function rosterEndpoint(host: string, search = ''): string {
  const base = normalizeHost(host);
  const params = new URLSearchParams({
    search,
    action: 'search_agents',
    object_class: 'RosterAgent',
    include: 'designations,languages,position_types',
  });
  return `${base}/ajax/agent-roster.php?${params.toString()}`;
}

export function agentsPhpUrl(host: string): string {
  return `${normalizeHost(host)}/agents.php`;
}

export function looksLikeChallengeHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('cf-browser-verification') ||
    lower.includes('just a moment') ||
    lower.includes('performing security verification') ||
    lower.includes('attention required') ||
    lower.includes('challenge-platform') ||
    (lower.includes('<html') && !lower.includes('agentid') && lower.includes('cloudflare'))
  );
}

export function parseRosterJson(body: string): unknown[] | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { result?: { value?: unknown } }).result?.value)
    ) {
      return (parsed as { result: { value: unknown[] } }).result.value;
    }
    return null;
  } catch {
    return null;
  }
}

export function classifyHostKind(rosterCount: number, prefix: string): RosterHost['kind'] {
  if (rosterCount >= 40) return 'regional';
  if (rosterCount <= 5 && !/^[a-z]{2}$/i.test(prefix) && prefix.length > 3) {
    return 'personal';
  }
  if (rosterCount > 0) return 'unknown';
  return 'unknown';
}

export function mergeHostManifest(
  existing: RosterHostManifest | null,
  hosts: RosterHost[],
): RosterHostManifest {
  const byHost = new Map<string, RosterHost>();
  for (const host of existing?.hosts ?? []) {
    byHost.set(normalizeHost(host.host), { ...host, host: normalizeHost(host.host) });
  }
  for (const host of hosts) {
    const key = normalizeHost(host.host);
    const prior = byHost.get(key);
    byHost.set(key, prior ? { ...prior, ...host, host: key } : { ...host, host: key });
  }
  const now = new Date().toISOString();
  return {
    generatedAt: existing?.generatedAt ?? now,
    updatedAt: now,
    hosts: [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host)),
  };
}

export function updateHostStatus(
  host: RosterHost,
  patch: Partial<RosterHost> & { status: RosterHostStatus },
): RosterHost {
  return {
    ...host,
    ...patch,
    lastProbedAt: patch.lastProbedAt ?? new Date().toISOString(),
  };
}

export function hostsForJurisdictions(
  manifest: RosterHostManifest,
  jurisdictions: string[],
): RosterHost[] {
  const wanted = new Set(jurisdictions.map((j) => j.toUpperCase()));
  return manifest.hosts.filter((host) =>
    host.jurisdictions.some((jurisdiction) => wanted.has(jurisdiction.toUpperCase())),
  );
}
