import { hostnameOf, toWebsite } from './lib/url.js';
import { padLeaid } from './schoolNames.js';

type SiteLike = {
  leaid: string;
  website: string;
  host: string;
  confidence: string;
  score: number;
  evidence: string;
  source: string;
  needs_review: boolean;
  review_reason: string;
};

export type WebsiteOverride = {
  website: string;
  reason: string;
};

/** Hand-curated district homepages when Serper/email seeds land on a school, newsroom, or IT host. */
export const WEBSITE_OVERRIDES: Record<string, WebsiteOverride> = {
  '0622710': { website: 'https://www.lausd.org/', reason: 'LAUSD district homepage, not its.lausd.org' },
  '3200060': { website: 'https://www.ccsd.net/', reason: 'Clark County NV, not newsroom.ccsd.net' },
  '2101200': { website: 'https://www.clark.kyschools.us/', reason: 'Clark County KY, not Nevada CCSD newsroom' },
  '0404970': { website: 'https://www.mpsaz.org/', reason: 'Mesa Unified, not a school subdomain' },
  '0408800': { website: 'https://www.tusd1.org/', reason: 'Tucson Unified, not a school subdomain' },
  '1201440': { website: 'https://www.ocps.net/', reason: 'Orange County FL (OCPS), not Volusia Port Orange' },
  '0802490': { website: 'https://www.bvsd.org/', reason: 'Boulder Valley, not cam.bvsd.org' },
  '0803540': { website: 'https://www.eagleschools.net/', reason: 'Eagle County, not technology.eagleschools.net' },
  '0631320': { website: 'https://www.pusd.org/', reason: 'Pomona Unified, not proudtobe.pusd.org' },
  '4819560': { website: 'https://www.forneyisd.net/', reason: 'Forney ISD, not edu.forneyisd.net' },
  '1300120': { website: 'https://www.atlantapublicschools.us/', reason: 'Atlanta Public Schools current homepage' },
  '2101860': { website: 'https://www.fcps.net/', reason: 'Fayette County KY (Lexington)' },
  '0602160': { website: 'https://www.alsd.org/', reason: 'Alta Loma Elementary SD, not an LAUSD school site' },
};

const DEPT_LABEL =
  /^(newsroom|its|it|cam|technology|tech|proudtobe|intranet|mail|webmail|staff|edu|portal|sso|adfs|helpdesk)$/i;

export function isNonDistrictHomepage(host: string, emailDomain = ''): boolean {
  const h = hostnameOf(host) || host.replace(/^www\./i, '').toLowerCase();
  if (!h) return false;
  const first = h.split('.')[0] ?? '';
  if (DEPT_LABEL.test(first)) return true;
  const emailHost = hostnameOf(emailDomain) || emailDomain.replace(/^www\./i, '').toLowerCase();
  if (emailHost && h !== emailHost && h.endsWith(`.${emailHost}`)) return true;
  return false;
}

export function overrideForLeaid(leaid: string): WebsiteOverride | null {
  return WEBSITE_OVERRIDES[padLeaid(leaid)] ?? null;
}

export function applyWebsiteOverrides<T extends SiteLike>(sites: T[]): T[] {
  return sites.map((site) => {
    const override = overrideForLeaid(site.leaid);
    if (!override) return site;
    const website = toWebsite(override.website);
    const host = hostnameOf(website);
    if (!host) return site;
    return {
      ...site,
      website,
      host,
      confidence: 'high',
      score: 1,
      evidence: `override:${override.reason}`,
      source: 'override',
      needs_review: false,
      review_reason: '',
    };
  });
}
