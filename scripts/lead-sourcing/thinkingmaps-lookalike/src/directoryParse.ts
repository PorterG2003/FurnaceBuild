import { decodeEntities, htmlToText } from './lib/html.js';
import { splitName } from './quickenrich.js';
import { classifySchoolRole, roleIsEligible } from './schoolRoles.js';
import { canonicalSchoolName, jaccard, schoolTokenSet } from './schoolNames.js';
import type { ListedSchool } from './types.js';

const NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/;

export const FREE_MAIL = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'live.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
]);

export type ParsedStaff = {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  school_hint: string;
  source_url: string;
};

export function directoryLinkScore(href: string, text: string): number {
  const hay = `${href} ${text}`.toLowerCase();
  if (
    /facebook|twitter|instagram|youtube|linkedin|mailto:|privacy|login|board[-_ /]|agenda|election|calendar|newsroom|policy/.test(
      hay,
    )
  ) {
    return 0;
  }
  let score = 0;
  if (/staff[-_ ]?directory|faculty[-_ /]?staff|our[-_ ]staff|school[-_ ]directory/.test(hay)) score += 6;
  if (/\/directory\/?(\?|$)/i.test(href) || /\bdistrict directory\b/.test(hay)) score += 5;
  if (/\/faculty\/?(\?|$)/i.test(href) || /\bfaculty directory\b/.test(hay)) score += 5;
  if (/\bdirectory\b/.test(hay)) score += 3;
  if (/\bstaff\b/.test(hay)) score += 2;
  if (/administration|principal|faculty/.test(hay)) score += 2;
  if (/\bschools\b/.test(hay)) score += 1;
  return score;
}

export function isFreeMail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return FREE_MAIL.has(domain);
}

function titleFromText(text: string): string {
  const patterns = [
    /\bassistant principal\b/i,
    /\bvice principal\b/i,
    /\bassociate principal\b/i,
    /\binstructional coach\b/i,
    /\bcurriculum coordinator\b/i,
    /\bdirector of curriculum\b/i,
    /\bdirector of instruction\b/i,
    /\bprincipal\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0] && roleIsEligible(classifySchoolRole(match[0]))) return match[0];
  }
  return '';
}

const BAD_NAME = /\b(staff|directory|home|welcome|contact|district|school|elementary|middle|high)\b/i;

function nameFromText(text: string, email: string, linkText = ''): { first_name: string; last_name: string } {
  const link = htmlToText(linkText);
  if (link && !link.includes('@') && !BAD_NAME.test(link) && NAME_RE.test(link)) {
    return splitName(link);
  }
  const local = email.split('@')[0] ?? '';
  const withoutEmail = text.replace(email, ' ').replace(/mailto:/gi, ' ');
  for (const match of withoutEmail.matchAll(new RegExp(NAME_RE, 'g'))) {
    const candidate = match[1] ?? '';
    if (BAD_NAME.test(candidate)) continue;
    return splitName(candidate);
  }
  if (local.includes('.')) {
    const [first, ...rest] = local.split('.');
    if (first && rest.length) {
      return {
        first_name: first.replace(/\d+/g, ''),
        last_name: rest.join(' ').replace(/\d+/g, ''),
      };
    }
  }
  return { first_name: '', last_name: '' };
}

export function decodeFinalsiteEmail(reversedDomain: string, reversedLocal: string): string {
  const flip = (value: string) => [...value].reverse().join('');
  return `${flip(reversedLocal)}@${flip(reversedDomain)}`.toLowerCase();
}

function parseFinalsiteStaff(html: string, sourceUrl: string): ParsedStaff[] {
  const people: ParsedStaff[] = [];
  const seen = new Set<string>();
  const insertRe =
    /FS\.util\.insertEmail\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = insertRe.exec(html))) {
    const email = decodeFinalsiteEmail(match[1] ?? '', match[2] ?? '');
    if (!email.includes('@') || isFreeMail(email) || seen.has(email)) continue;
    const window = html.slice(Math.max(0, (match.index ?? 0) - 3000), match.index);
    const nameHtml = [...window.matchAll(/<[^>]*fsFullName[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)].at(-1)?.[1] ?? '';
    const titleHtml = [...window.matchAll(/<[^>]*fsTitles[^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] ?? '';
    const locHtml = [...window.matchAll(/<[^>]*fsLocations[^>]*>([\s\S]*?)<\/div>/gi)].at(-1)?.[1] ?? '';
    const title = htmlToText(titleHtml).replace(/^titles:\s*/i, '');
    if (!roleIsEligible(classifySchoolRole(title))) continue;
    const name = splitName(htmlToText(nameHtml));
    if (!name.first_name && !name.last_name) continue;
    seen.add(email);
    people.push({
      ...name,
      title,
      email,
      school_hint: htmlToText(locHtml).replace(/^locations:\s*/i, ''),
      source_url: sourceUrl,
    });
  }
  return people;
}

export function parseStaffDirectory(html: string, sourceUrl: string): ParsedStaff[] {
  const decoded = decodeEntities(html);
  const people: ParsedStaff[] = [];
  const seen = new Set<string>();
  const blocks = decoded.split(/<\/(?:p|li|tr|div|h[1-4])>/i);

  let lastHeading = '';
  for (const rawBlock of blocks) {
    const headingMatch = [...rawBlock.matchAll(/<h([1-4])[^>]*>([\s\S]*?)$/gi)].at(-1);
    if (headingMatch?.[2]) lastHeading = htmlToText(headingMatch[2]);
    const mailtoRe = /<a\b[^>]*href=["']mailto:([^"'>\s?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = mailtoRe.exec(rawBlock))) {
      const email = decodeURIComponent(match[1] ?? '')
        .trim()
        .toLowerCase()
        .replace(/[>,;]+$/, '');
      if (!email.includes('@') || isFreeMail(email) || seen.has(email)) continue;
      const blockText = htmlToText(rawBlock);
      const title = titleFromText(blockText);
      if (!title) continue;
      const name = nameFromText(blockText, email, match[2] ?? '');
      if (!name.first_name && !name.last_name) continue;
      seen.add(email);
      people.push({
        ...name,
        title,
        email,
        school_hint: lastHeading,
        source_url: sourceUrl,
      });
    }
  }
  for (const row of parseFinalsiteStaff(decoded, sourceUrl)) {
    if (seen.has(row.email)) continue;
    seen.add(row.email);
    people.push(row);
  }
  return people;
}

function pathSchoolHint(pageUrl: string): string {
  try {
    return decodeURIComponent(new URL(pageUrl).pathname).replace(/[-_/]+/g, ' ').trim();
  } catch {
    return '';
  }
}

function scoreSchoolHint(hay: string, schools: ListedSchool[]): ListedSchool | null {
  const scored = schools
    .map((school) => ({
      school,
      score: Math.max(
        jaccard(schoolTokenSet(hay, school.state), schoolTokenSet(school.school_name, school.state)),
        canonicalSchoolName(hay, school.state) === canonicalSchoolName(school.school_name, school.state) ? 1 : 0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 0.55) return null;
  if (second && best.score - second.score < 0.08 && best.score < 0.95) return null;
  return best.school;
}

export function matchSchoolHint(hint: string, schools: ListedSchool[], pageUrl = ''): ListedSchool | null {
  const heading = hint.trim();
  if (heading) {
    const hit = scoreSchoolHint(heading, schools);
    if (hit) return hit;
  }
  const fromPath = pathSchoolHint(pageUrl);
  if (fromPath) {
    const hit = scoreSchoolHint(fromPath, schools);
    if (hit) return hit;
  }
  return schools.length === 1 ? schools[0]! : null;
}

export function commonDirectoryPaths(origin: string): string[] {
  const base = origin.replace(/\/$/, '');
  return [
    `${base}/staff-directory`,
    `${base}/staff`,
    `${base}/directory`,
    `${base}/faculty`,
    `${base}/our-staff`,
    `${base}/schools`,
  ];
}
