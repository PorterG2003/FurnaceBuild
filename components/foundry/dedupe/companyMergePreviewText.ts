import type {
  CompanyEntityMatchRow,
  CompanyLocationRow,
  CompanySourceLinkRow,
} from '@/lib/foundry/registry-types';

const MAX_LINES = 8;

function shortId(id: string, len = 8): string {
  const t = id.trim();
  if (t.length <= len) return t;
  return `${t.slice(0, len)}…`;
}

function joinWithCap(lines: string[]): string {
  if (lines.length === 0) return 'None';
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  let body = shown.join('\n');
  if (more > 0) body += `\n+${more} more`;
  return body;
}

/** Multiline cell text for current source→company links. */
export function formatSourceLinksPreview(links: CompanySourceLinkRow[]): string {
  const lines = links.map(
    (l) => `${l.link_status} · ${shortId(l.source_business_record_id)}`,
  );
  return joinWithCap(lines);
}

/** Multiline cell text for current entity matches. */
export function formatEntityMatchesPreview(matches: CompanyEntityMatchRow[]): string {
  const lines = matches.map(
    (m) =>
      `${m.registry_state || '—'} ${m.match_status} · entity ${shortId(m.state_entity_id)}`,
  );
  return joinWithCap(lines);
}

function formatOneLocation(loc: CompanyLocationRow): string {
  const parts: string[] = [];
  if (loc.is_primary) parts.push('[primary]');
  const citySt = [loc.city, loc.state_region].filter(Boolean).join(', ');
  if (citySt) parts.push(citySt);
  const line = (loc.line1 ?? '').trim();
  if (line) parts.push(line.length > 48 ? `${line.slice(0, 48)}…` : line);
  return parts.length > 0 ? parts.join(' · ') : '(no address lines)';
}

/** Multiline cell text for company locations. */
export function formatLocationsPreview(locations: CompanyLocationRow[]): string {
  const lines = locations.map(formatOneLocation);
  return joinWithCap(lines);
}

export const MERGE_HINT_SOURCE_LINKS =
  'Links on duplicate companies are repointed to the survivor. If the same source row already links to the survivor, one link is kept (linked wins over non-linked).';

export const MERGE_HINT_ENTITY_MATCHES =
  'Matches are repointed to the survivor. Duplicates and promoted conflicts with the same state are rejected per server rules.';

export const MERGE_HINT_LOCATIONS =
  'Locations from duplicates are copied when not loosely duplicate of an existing survivor address; copied rows are non-primary.';
