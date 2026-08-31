import { collapseWhitespace } from '../lib/html.js';

const COI_HEADING =
  /\b(relevant financial relationships?|faculty disclosure|planner disclosure|speaker disclosure|financial relationship|conflict of interest|disclosure of (financial )?relationships)\b/i;

const COI_SENTENCE =
  /\b(dr\.|md,|consultant for|honoraria|speaker(?:s)? bureau|advisory board|research (?:funding|support) from)\b/i;

export function isFacultyCoiContext(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 400);
  const around = text.slice(windowStart, matchIndex + 200);
  if (COI_HEADING.test(around) || COI_SENTENCE.test(around)) return true;
  const prefix = text.slice(0, matchIndex);
  const lastHeading = Math.max(
    prefix.lastIndexOf('faculty disclosure'),
    prefix.lastIndexOf('financial relationship'),
    prefix.lastIndexOf('conflict of interest'),
  );
  if (lastHeading >= 0 && matchIndex - lastHeading < 1200) return true;
  return false;
}

const HOST_RE = new RegExp(
  String.raw`(?:hosted|brought to you|sponsored|presented|in partnership)\s+by\s+(?:the\s+)?(?<host>.+?)(?=\.\s|\.$|\n|;|\s+this\s+activity|\s+click|$)`,
  'i',
);

export type HostExtract = {
  host: string;
  snippet: string;
  coiRejected: boolean;
};

export function extractHost(text: string): HostExtract | null {
  const normalized = collapseWhitespace(text);
  const match = HOST_RE.exec(normalized);
  if (!match?.groups?.host) return null;
  if (isFacultyCoiContext(normalized, match.index)) {
    return { host: '', snippet: match[0].slice(0, 280), coiRejected: true };
  }
  const host = match.groups.host.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!host || host.length < 2) return null;
  return { host, snippet: match[0].slice(0, 280), coiRejected: false };
}

export const GRANT_RE = new RegExp(
  String.raw`supported\s+(?:in\s+part\s+)?by\s+(?:an?\s+)?(?:independent\s+|unrestricted\s+|educational\s+){0,3}grants?\s+from\s+(?<sponsors>.+?)(?=\.\s|\.$|\n|;|\s+This\s+activity|\s+Click|$)`,
  'is',
);

export const GRANT_VARIANT_RE = new RegExp(
  String.raw`(?:this activity (?:is |was )?supported by|commercial support (?:provided|received)?\s+(?:by|from)|support from an ineligible company)\s+(?:an?\s+)?(?<sponsors>.+?)(?=\.\s|\.$|\n|;|$)`,
  'is',
);

export type GrantExtract = {
  sponsorsRaw: string;
  snippet: string;
  coiRejected: boolean;
};

export function extractGrant(text: string): GrantExtract | null {
  const normalized = collapseWhitespace(text);
  const match = GRANT_RE.exec(normalized) ?? GRANT_VARIANT_RE.exec(normalized);
  if (!match?.groups?.sponsors) return null;
  if (isFacultyCoiContext(normalized, match.index)) {
    return { sponsorsRaw: '', snippet: match[0].slice(0, 280), coiRejected: true };
  }
  const sponsorsRaw = match.groups.sponsors.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!sponsorsRaw) return null;
  return { sponsorsRaw, snippet: match[0].slice(0, 280), coiRejected: false };
}

const SUFFIX_REJOIN = /^(and company|& co\.?|inc\.?|llc\.?|ltd\.?|plc\.?|gmbh)$/i;
const GUARD_NAMES = [
  'eli lilly and company',
  'johnson & johnson',
  'johnson and johnson',
  'bristol myers squibb',
];

export function splitSponsorString(raw: string): { names: string[]; needs_review: boolean } {
  const trimmed = raw.replace(/\.$/, '').trim();
  if (!trimmed) return { names: [], needs_review: true };

  const placeholders: string[] = [];
  let working = trimmed;
  for (const guard of GUARD_NAMES) {
    const re = new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    working = working.replace(re, (match) => {
      const token = `__GUARD${placeholders.length}__`;
      placeholders.push(match);
      return token;
    });
  }

  const parts = working
    .split(/\s*(?:,|&| and )\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const names: string[] = [];
  for (const part of parts) {
    const restored = part
      .replace(/__GUARD(\d+)__/g, (_, i) => placeholders[Number(i)] ?? '')
      .replace(/^and\s+/i, '')
      .trim();
    if (SUFFIX_REJOIN.test(restored) && names.length > 0) {
      names[names.length - 1] = `${names[names.length - 1]} ${restored}`;
    } else {
      names.push(restored);
    }
  }

  const needs_review = names.some((n) => n.length < 3 || /^(the|of|from)$/i.test(n));
  return { names, needs_review };
}

export function normalizeSponsorKey(name: string, merges: Record<string, string>): string {
  let key = name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|a\/s|nv|sa|ag|holdings|pharmaceuticals|pharma)\b/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (merges[key]) return merges[key].toLowerCase();
  return key;
}
