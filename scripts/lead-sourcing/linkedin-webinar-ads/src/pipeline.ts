import { createHash } from 'node:crypto';
import type { ScrapeConfig } from './config.js';
import type { AdvertiserRow, NormalizedAd, PersonEvidence, RawAd, ReviewDecision } from './types.js';

/** Live online event language — the only keep signal. */
const ONLINE_EVENT_RE =
  /\b(webinars?|virtual events?|virtual (?:summit|conference|session|workshop|briefing)|online (?:events?|workshops?|sessions?|masterclasses?|briefings?)|live webinars?|live[- ]streams?|livestreams?|streaming live|live[- ]streamed sessions?)\b/i;
/** Seat / registration language from Ad Library searches. */
const LIVE_SEAT_RE =
  /\b(live|reserve (?:your )?spot|save (?:your )?seat|limited seats?|spots? remaining|register(?:ing)?|join us live|upcoming live|sign up|rsvp|attend)\b/i;
const REPLAY_RE = /\b(on[- ]demand|replay|recording only|watch (?:the )?replay|previously recorded)\b/i;
const IN_PERSON_RE =
  /\b(in[- ]person|happy hour|lunch and learn|roadshow|on[- ]site|at our (?:office|hq|headquarters)|doors open|networking (?:mixer|reception|hour)|cocktail hour|join us in [A-Z][a-z]+(?:,\s*[A-Z]{2})?)\b/i;
const BOOK_CALL_RE =
  /\b(book a (?:call|demo|meeting)|schedule a (?:call|demo|meeting)|request a demo|talk to (?:a|our) (?:team|expert|specialist)|book time with)\b/i;
const CONTENT_PROMO_RE =
  /\b(article|blog(?:\s+post)?|newsletter|podcast|documentary|read (?:our|the|my) (?:latest|full|new)|watch (?:our )?(?:video|film))\b/i;
const CONSUMER_RE = /\b(concert|festival|gift card|tour is coming|tickets? for|travel to)\b/i;
const AGENCY_RE = /\b(agency|marketing services|lead generation agency)\b/i;
const PERSON_RE =
  /\b(?:[Hh]osted by|[Ww]ith|[Ff]eaturing|[Jj]oin)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)/;
const SHORT_LINK_DOMAINS = new Set(['lnkd.in', 'bit.ly', 't.co']);

function text(ad: RawAd): string {
  return [ad.primaryText, ad.headline, ad.landingUrl, ad.advertiserName].filter(Boolean).join(' ');
}

function copyText(ad: RawAd): string {
  return [ad.primaryText, ad.headline, ad.advertiserName].filter(Boolean).join(' ');
}

function normalizeName(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function domain(url: string | null): string {
  try {
    const host = new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '');
    const key = host.split('.').slice(-2).join('.');
    return SHORT_LINK_DOMAINS.has(key) ? '' : key;
  } catch {
    return '';
  }
}

export function extractPerson(textValue: string): PersonEvidence {
  const match = textValue.match(PERSON_RE);
  return match ? { name: match[1], evidence: match[0] } : null;
}

export function adDedupeKey(ad: RawAd): string {
  if (ad.adId) return `id:${ad.adId}`;
  const payload = [normalizeName(ad.advertiserName), ad.primaryText ?? '', ad.headline ?? '', ad.landingUrl ?? ''].join('|');
  return `fp:${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

export function advertiserKey(ad: RawAd): string {
  const linkedInSlug = ad.advertiserUrl?.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1];
  return linkedInSlug
    ? `li:${linkedInSlug.toLowerCase()}`
    : domain(ad.landingUrl)
      ? `domain:${domain(ad.landingUrl)}`
      : `name:${normalizeName(ad.advertiserName)}`;
}

export function normalizeAndFilter(rawAds: RawAd[], config: ScrapeConfig): NormalizedAd[] {
  const grouped = new Map<string, RawAd[]>();
  for (const ad of rawAds) {
    const key = adDedupeKey(ad);
    grouped.set(key, [...(grouped.get(key) ?? []), ad]);
  }
  return [...grouped.entries()].map(([dedupeKey, ads]) => {
    const ad = ads[0]!;
    const blob = text(ad);
    const copy = copyText(ad);
    const hasOnlineEvent = ONLINE_EVENT_RE.test(copy);
    const hasLiveSeat = LIVE_SEAT_RE.test(copy);
    const replayOrOnDemand = REPLAY_RE.test(copy);
    const inPerson = IN_PERSON_RE.test(copy);
    const bookCall = BOOK_CALL_RE.test(copy) && !hasOnlineEvent;
    const contentPromo = CONTENT_PROMO_RE.test(copy) && !hasOnlineEvent;
    const consumer = CONSUMER_RE.test(copy);
    const platformSelfPromotion = config.exclusionAdvertiserTerms.some((term) =>
      normalizeName(ad.advertiserName).includes(term),
    );
    const agencyPromotion = AGENCY_RE.test(ad.advertiserName ?? '') && !hasOnlineEvent;

    const liveSignals = [
      ...(hasOnlineEvent ? ['online_event'] : []),
      ...(hasLiveSeat ? ['live_seat_language'] : []),
      ...(ad.landingUrl ? ['landing_url'] : []),
    ];
    const exclusionReasons = [
      ...(replayOrOnDemand ? ['replay_or_on_demand'] : []),
      ...(inPerson ? ['in_person_event'] : []),
      ...(bookCall ? ['book_a_call'] : []),
      ...(contentPromo ? ['content_promo'] : []),
      ...(consumer ? ['consumer_event'] : []),
      ...(platformSelfPromotion ? ['webinar_platform_self_promotion'] : []),
      ...(agencyPromotion ? ['agency_promotion'] : []),
    ];

    // Keep only live online events. Everything else fails closed to excluded.
    // Review is reserved for rare "online event OR in-person both fire" conflicts.
    let disposition: NormalizedAd['disposition'];
    if (hasOnlineEvent && inPerson) {
      disposition = 'review';
      exclusionReasons.push('online_and_in_person_conflict');
    } else if (exclusionReasons.length > 0) {
      disposition = 'excluded';
    } else if (hasOnlineEvent) {
      disposition = 'qualified';
    } else {
      disposition = 'excluded';
      exclusionReasons.push('not_live_online_event');
    }

    return {
      ...ad,
      dedupeKey,
      advertiserKey: advertiserKey(ad),
      phrases: [...new Set(ads.map((item) => item.query.phrase))].sort(),
      person: extractPerson(blob),
      liveSignals,
      exclusionReasons,
      disposition,
    };
  });
}

export function applyReviewDecisions(ads: NormalizedAd[], decisions: ReviewDecision[]): NormalizedAd[] {
  const byKey = new Map(decisions.map((decision) => [decision.dedupeKey, decision]));
  return ads.map((ad) => {
    const decision = byKey.get(ad.dedupeKey);
    if (!decision) return ad;
    if (decision.decision === 'keep') {
      return { ...ad, disposition: 'qualified', exclusionReasons: ['human_keep'] };
    }
    if (decision.decision === 'exclude') {
      return { ...ad, disposition: 'excluded', exclusionReasons: ['human_exclude'] };
    }
    return { ...ad, disposition: 'review', exclusionReasons: ['human_review'] };
  });
}

function score(ad: NormalizedAd): number {
  return ad.liveSignals.length * 10 + (ad.landingUrl ? 3 : 0) + (ad.primaryText?.length ?? 0) / 1_000;
}

export function buildAdvertiserRows(ads: NormalizedAd[]): AdvertiserRow[] {
  const groups = new Map<string, NormalizedAd[]>();
  for (const ad of ads.filter((item) => item.disposition === 'qualified')) {
    groups.set(ad.advertiserKey, [...(groups.get(ad.advertiserKey) ?? []), ad]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const representative = [...group].sort((a, b) => score(b) - score(a))[0]!;
      return {
        advertiser_key: key,
        advertiser_name: representative.advertiserName ?? '',
        advertiser_url: representative.advertiserUrl ?? '',
        landing_domain: domain(representative.landingUrl),
        person_name: representative.person?.name ?? '',
        person_evidence: representative.person?.evidence ?? '',
        representative_ad_id: representative.adId ?? '',
        representative_copy: representative.primaryText ?? '',
        representative_headline: representative.headline ?? '',
        representative_landing_url: representative.landingUrl ?? '',
        active_from: representative.activeFrom ?? '',
        phrases: [...new Set(group.flatMap((ad) => ad.phrases))].sort().join('|'),
        qualifying_ad_count: String(group.length),
      };
    })
    .sort((a, b) => b.qualifying_ad_count.localeCompare(a.qualifying_ad_count));
}

export function toAdCsvRow(ad: NormalizedAd): Record<string, string> {
  return {
    platform: ad.platform,
    ad_id: ad.adId ?? '',
    advertiser_name: ad.advertiserName ?? '',
    advertiser_url: ad.advertiserUrl ?? '',
    payer_name: ad.payerName ?? '',
    primary_text: ad.primaryText ?? '',
    headline: ad.headline ?? '',
    landing_url: ad.landingUrl ?? '',
    active_from: ad.activeFrom ?? '',
    active_to: ad.activeTo ?? '',
    status: ad.status ?? '',
    phrases: ad.phrases.join('|'),
    person_name: ad.person?.name ?? '',
    person_evidence: ad.person?.evidence ?? '',
    live_signals: ad.liveSignals.join('|'),
    exclusion_reasons: ad.exclusionReasons.join('|'),
    disposition: ad.disposition,
    dedupe_key: ad.dedupeKey,
    advertiser_key: ad.advertiserKey,
    search_url: ad.query.searchUrl,
    collected_at: ad.query.collectedAt,
    extraction_confidence: ad.extraction.confidence,
  };
}
