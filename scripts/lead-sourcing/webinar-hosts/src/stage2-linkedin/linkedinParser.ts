const REGISTRATION_DOMAINS = [
  'zoom.us',
  'hopin.com',
  'lu.ma',
  'luma.com',
  'eventbrite.com',
  'hubspot.com',
  'gotowebinar.com',
  'bigmarker.com',
  'livestorm.co',
  'demio.com',
  'on24.com',
  'meetup.com',
  'crowdcast.io',
  'goldcast.io',
  'qualified.com',
  'hsforms.com',
  'splashthat.com',
  'airmeet.com',
  'webinarjam.com',
  'clickmeeting.com',
];

const SHORT_LINK_HOSTS = ['lnkd.in', 'bit.ly', 't.co'];

const LINKEDIN_PROFILE_PATH_RE =
  /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:in|company|showcase)\/[^"'\s<>?#]+/gi;

function registrationUrlPattern(): RegExp {
  const escaped = REGISTRATION_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|');
  return new RegExp(`https?://[^\\s"'<>]*?(?:${escaped})[^\\s"'<>]*`, 'gi');
}

function shortLinkPattern(): RegExp {
  const escaped = SHORT_LINK_HOSTS.map((d) => d.replace(/\./g, '\\.')).join('|');
  return new RegExp(`https?://(?:${escaped})/[a-zA-Z0-9_-]+`, 'gi');
}

const ENTITY_TOKEN_RE =
  /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|L\.L\.P\.|LLP|COMPANY|CO\.|HOLDINGS|VENTURES|TRUST|ASSOCIATES|GROUP|PARTNERS|PARTNERSHIP|PROPERTIES|INVESTMENTS|ENTERPRISES|FOUNDATION|GMBH)\b/i;

export type EntityType = 'company' | 'person' | 'unknown';
export type ExtractionStatus = 'ok' | 'blocked' | 'error';

export type ParsedLinkedInPost = {
  post_text: string;
  author_name: string;
  author_profile_url: string;
  entity_type: EntityType;
  registration_urls: string[];
  posted_at: string;
  extraction_status: ExtractionStatus;
  extraction_error: string;
};

export function normalizeLinkedInProfileUrl(url: string): string {
  if (!url.trim()) return '';
  let normalized = url.trim();
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized.replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.endsWith('linkedin.com')) {
      parsed.hostname = 'www.linkedin.com';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return normalized.split('?')[0]?.split('#')[0] ?? normalized;
  }
}

export function entityTypeFromProfileUrl(url: string): EntityType {
  if (!url) return 'unknown';
  if (/\/(?:company|showcase)\//i.test(url)) return 'company';
  if (/\/in\//i.test(url)) return 'person';
  return 'unknown';
}

export function classifyAuthorName(name: string): EntityType {
  const cleaned = cleanAuthorName(name);
  if (!cleaned) return 'unknown';
  if (ENTITY_TOKEN_RE.test(cleaned)) return 'company';
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length >= 2 && parts.length <= 5) return 'person';
  if (parts.length === 1) return 'company';
  return 'unknown';
}

export function resolveEntityType(profileUrl: string, authorName: string): EntityType {
  const fromUrl = entityTypeFromProfileUrl(profileUrl);
  if (fromUrl !== 'unknown') return fromUrl;
  return classifyAuthorName(authorName);
}

export function extractRegistrationUrls(text: string, links: string[] = []): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const cleaned = raw.trim().replace(/[),.]+$/g, '');
    if (cleaned) found.add(cleaned.split('?')[0] ?? cleaned);
  };

  for (const link of links) {
    if (
      REGISTRATION_DOMAINS.some((d) => link.includes(d)) ||
      SHORT_LINK_HOSTS.some((d) => link.includes(d))
    ) {
      add(link);
    }
  }
  for (const match of text.matchAll(registrationUrlPattern())) {
    add(match[0]);
  }
  for (const match of text.matchAll(shortLinkPattern())) {
    add(match[0]);
  }
  return [...found];
}

function metaContent(html: string, property: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const match = html.match(re);
  if (match?.[1]) return decodeHtmlEntities(match[1]);
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  return decodeHtmlEntities(re2.exec(html)?.[1] ?? '');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const re = /href=["'](https?:\/\/[^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    links.push(decodeHtmlEntities(match[1]!));
  }
  return links;
}

function parseJsonLdBlocks(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const re = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      blocks.push(JSON.parse(match[1]!) as Record<string, unknown>);
    } catch {
      // skip malformed blocks
    }
  }
  return blocks;
}

type JsonLdAuthor = { url: string; name: string };

function extractJsonLdAuthor(block: Record<string, unknown>): JsonLdAuthor {
  const author = block.author as { url?: string; name?: string } | undefined;
  if (author?.url) {
    return { url: String(author.url), name: String(author.name ?? '') };
  }
  const shared = block.sharedContent as { author?: { url?: string; name?: string } } | undefined;
  if (shared?.author?.url) {
    return { url: String(shared.author.url), name: String(shared.author.name ?? '') };
  }
  return { url: '', name: '' };
}

function extractJsonLdPostText(block: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof block.articleBody === 'string') parts.push(block.articleBody);
  if (typeof block.headline === 'string') parts.push(block.headline);
  const shared = block.sharedContent as { headline?: string } | undefined;
  if (shared?.headline) parts.push(shared.headline);
  return parts.join('\n\n').trim();
}

function extractJsonLdPostedAt(block: Record<string, unknown>): string {
  if (typeof block.datePublished === 'string') return block.datePublished;
  return '';
}

function extractLinkedInProfileUrls(html: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of html.matchAll(LINKEDIN_PROFILE_PATH_RE)) {
    const raw = match[0]!;
    const normalized = normalizeLinkedInProfileUrl(
      raw.startsWith('http') ? raw : `https://${raw.replace(/^\/+/, '')}`,
    );
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
}

function profileFromPostSlug(html: string, authorName: string): string {
  const canonical =
    html.match(/rel="canonical" href="([^"]+)"/i)?.[1] ?? metaContent(html, 'og:url');
  const match = canonical.match(/linkedin\.com\/posts\/([a-z0-9-]+)_/i);
  if (!match?.[1]) return '';
  const slug = match[1];
  const looksLikeCompany =
    ENTITY_TOKEN_RE.test(authorName) ||
    /'s post$/i.test(authorName) ||
    classifyAuthorName(authorName) === 'company';
  const segment = looksLikeCompany ? 'company' : 'in';
  return normalizeLinkedInProfileUrl(`https://www.linkedin.com/${segment}/${slug}`);
}

function extractFeedActorProfileUrls(html: string): string[] {
  const urls: string[] = [];
  const re =
    /href=["']((?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:in|company|showcase)\/[^"'?#]+)(?:\?[^"']*public_post_feed-actor[^"']*)?["']/gi;
  for (const match of html.matchAll(re)) {
    urls.push(normalizeLinkedInProfileUrl(match[1]!));
  }
  return urls;
}

function pickAuthorProfileUrl(
  html: string,
  jsonLdBlocks: Record<string, unknown>[],
  authorName: string,
): string {
  for (const block of jsonLdBlocks) {
    const { url } = extractJsonLdAuthor(block);
    if (url) return normalizeLinkedInProfileUrl(url);
  }

  const seeAlso = metaContent(html, 'og:see_also');
  if (seeAlso) return normalizeLinkedInProfileUrl(seeAlso);

  const slugProfile = profileFromPostSlug(html, authorName);
  const feedActorProfiles = extractFeedActorProfileUrls(html);
  if (feedActorProfiles[0]) return feedActorProfiles[0];
  if (slugProfile) return slugProfile;

  const profiles = extractLinkedInProfileUrls(html);
  const companies = profiles.filter((u) => /\/(?:company|showcase)\//i.test(u));
  const people = profiles.filter((u) => /\/in\//i.test(u));
  const looksLikeCompany =
    ENTITY_TOKEN_RE.test(authorName) ||
    /'s post$/i.test(authorName) ||
    classifyAuthorName(authorName) === 'company';

  if (looksLikeCompany && companies[0]) return companies[0];
  if (people[0]) return people[0];
  return companies[0] || '';
}

function cleanAuthorName(name: string): string {
  return name
    .replace(/'s post$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLoginWall(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('authwall') ||
    lower.includes('join linkedin') ||
    lower.includes('sign in to linkedin') ||
    (lower.includes('login') && lower.includes('linkedin') && html.length < 50_000)
  );
}

function parseTitleAndAuthor(title: string): { authorName: string; postText: string } {
  if (title.includes(' on LinkedIn: ')) {
    const [name, ...rest] = title.split(' on LinkedIn: ');
    return { authorName: cleanAuthorName(name.trim()), postText: rest.join(' on LinkedIn: ').trim() };
  }
  if (title.includes(' | ')) {
    const parts = title.split(' | ');
    if (parts.length >= 2) {
      return {
        authorName: cleanAuthorName(parts[parts.length - 1]!.trim()),
        postText: parts.slice(0, -1).join(' | ').trim(),
      };
    }
  }
  if (title.includes(': ')) {
    const idx = title.indexOf(': ');
    return {
      authorName: cleanAuthorName(title.slice(0, idx).trim()),
      postText: title.slice(idx + 2).trim(),
    };
  }
  return { authorName: cleanAuthorName(title.trim()), postText: '' };
}

function isUselessTitle(title: string): boolean {
  const lower = title.trim().toLowerCase();
  return !lower || lower === 'linkedin' || lower.includes('sign in');
}

export function parseLinkedInPostHtml(html: string): ParsedLinkedInPost {
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const jsonLdText = jsonLdBlocks.map((b) => JSON.stringify(b)).join('\n');
  const jsonLdPostText = jsonLdBlocks.map(extractJsonLdPostText).filter(Boolean).join('\n\n');
  const jsonLdPostedAt = jsonLdBlocks.map(extractJsonLdPostedAt).find(Boolean) ?? '';

  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  const { authorName: titleAuthor, postText: titlePostText } = parseTitleAndAuthor(title);

  let authorName = titleAuthor;
  for (const block of jsonLdBlocks) {
    const { name } = extractJsonLdAuthor(block);
    if (name && (isUselessTitle(authorName) || /'s post$/i.test(authorName))) {
      authorName = cleanAuthorName(name);
      break;
    }
  }

  const postText = [description.trim(), jsonLdPostText, titlePostText].filter(Boolean).join('\n\n');
  const authorProfile = pickAuthorProfileUrl(html, jsonLdBlocks, authorName);
  const links = extractLinks(html);
  const registration_urls = extractRegistrationUrls(
    `${postText}\n${jsonLdText}\n${html}`,
    links,
  );
  const entity_type = resolveEntityType(authorProfile, authorName);
  const posted_at = jsonLdPostedAt || metaContent(html, 'article:published_time');
  const hasContent =
    Boolean(postText.trim()) || (Boolean(authorName.trim()) && !isUselessTitle(authorName));

  if (hasContent) {
    return {
      post_text: postText.slice(0, 8000),
      author_name: authorName,
      author_profile_url: authorProfile,
      entity_type,
      registration_urls,
      posted_at,
      extraction_status: 'ok',
      extraction_error: isLoginWall(html) ? 'login_wall_meta_only' : '',
    };
  }

  if (isLoginWall(html)) {
    return {
      post_text: '',
      author_name: '',
      author_profile_url: '',
      entity_type: 'unknown',
      registration_urls: [],
      posted_at: '',
      extraction_status: 'blocked',
      extraction_error: 'login_wall',
    };
  }

  return {
    post_text: postText.slice(0, 8000),
    author_name: authorName,
    author_profile_url: authorProfile,
    entity_type,
    registration_urls,
    posted_at,
    extraction_status: 'error',
    extraction_error: 'missing_content',
  };
}

export function truncatePostText(text: string, max = 8000): string {
  return text.length > max ? text.slice(0, max) : text;
}

export type ParsedLinkedInProfile = {
  employer_name: string;
  employer_linkedin_url: string;
};

export function linkedInProfileFixtureKey(url: string): string {
  const match = url.match(/\/in\/([^/?#]+)/i);
  return match?.[1] ? `profile-${match[1]}` : 'profile-default';
}

export function parseLinkedInProfileHtml(html: string): ParsedLinkedInProfile {
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  let employer_name = '';

  const withoutLinkedIn = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const dashParts = withoutLinkedIn.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (dashParts.length >= 3) {
    employer_name = dashParts[dashParts.length - 1]!;
  }

  for (const block of parseJsonLdBlocks(html)) {
    const worksFor = block.worksFor as { name?: string; url?: string } | undefined;
    if (worksFor?.name) {
      employer_name = worksFor.name;
      if (worksFor.url) {
        return {
          employer_name: cleanAuthorName(employer_name),
          employer_linkedin_url: normalizeLinkedInProfileUrl(String(worksFor.url)),
        };
      }
    }
  }

  const companies = extractLinkedInProfileUrls(html).filter((u) => /\/(?:company|showcase)\//i.test(u));
  return {
    employer_name: cleanAuthorName(employer_name),
    employer_linkedin_url: companies[0] ?? '',
  };
}
