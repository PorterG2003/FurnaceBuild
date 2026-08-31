import { extractTitle, htmlToText } from './lib/html.js';
import { mapWithConcurrency } from './lib/pool.js';
import { detectPlatform } from './platformDetect.js';
import { districtTokenSet, isJunkHost, type DistrictSite } from './resolveDistrictSites.js';
import { hostnameOf } from './lib/url.js';

const PROMOTE_CMS = new Set(['finalsite', 'apptegy', 'edlio', 'schoolwires', 'campussuite']);

export function homepageLooksLikeDistrict(options: {
  html: string;
  url: string;
  leaName: string;
  state: string;
}): { promote: boolean; reason: string } {
  const platform = detectPlatform(options.html, options.url);
  if (PROMOTE_CMS.has(platform)) return { promote: true, reason: `cms:${platform}` };
  const title = extractTitle(options.html);
  const h1 = htmlToText(options.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const hay = `${title} ${h1}`.toLowerCase();
  const distinctive = [...districtTokenSet(options.leaName, options.state)].filter((token) => token.length >= 4);
  const hit = distinctive.find((token) => hay.includes(token));
  if (hit) return { promote: true, reason: `title_token:${hit}` };
  return { promote: false, reason: '' };
}

export async function probeLowDistrictSites(options: {
  sites: DistrictSite[];
  fetchImpl?: typeof fetch;
  concurrency?: number;
}): Promise<{ sites: DistrictSite[]; promoted: DistrictSite[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = options.sites.filter(
    (site) =>
      (site.confidence === 'low' || site.confidence === 'none') &&
      site.website &&
      !isJunkHost(site.host),
  );
  const promoted: DistrictSite[] = [];
  const byLeaid = new Map(options.sites.map((site) => [site.leaid, site]));

  await mapWithConcurrency(candidates, options.concurrency ?? 6, async (site) => {
    try {
      const res = await fetchImpl(site.website, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FurnaceDirectory/1.0)' },
      });
      if (!res.ok) return;
      const html = await res.text();
      const finalUrl = res.url || site.website;
      const host = hostnameOf(finalUrl) || site.host;
      if (isJunkHost(host)) return;
      const look = homepageLooksLikeDistrict({
        html,
        url: finalUrl,
        leaName: site.lea_name,
        state: site.state,
      });
      if (!look.promote) return;
      const next: DistrictSite = {
        ...site,
        website: finalUrl.startsWith('http') ? finalUrl.split('?')[0]! : site.website,
        host,
        confidence: 'medium',
        score: Math.max(site.score, 0.45),
        evidence: `${site.evidence}|probe:${look.reason}`.replace(/^\|/, ''),
        source: site.source || 'homepage_probe',
        needs_review: false,
        review_reason: '',
      };
      byLeaid.set(site.leaid, next);
      promoted.push(next);
    } catch {
      // leave the site as-is
    }
  });

  return { sites: options.sites.map((site) => byLeaid.get(site.leaid) ?? site), promoted };
}
