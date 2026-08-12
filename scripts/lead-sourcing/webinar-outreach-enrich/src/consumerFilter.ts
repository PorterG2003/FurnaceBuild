/**
 * Heuristic: consumer / info-product webinars we should not chase for B2B outreach.
 * Broader than the scrape-time CONSUMER_RE (concert/festival) — applied to dark leftovers.
 */

const CONSUMER_COPY_RE =
  /\b(?:parents of|for parents|as a (?:mother|father|parent)|parenting|prospective famil(?:y|ies)|students?,?\s+parents|your (?:son|daughter|kids?|child(?!\s*-?\s*led))|TK-12|homeowners?|become a homeowner|first[- ]time (?:home )?buyer|renters?|dream college|college admissions?|college essay|Common App|FAFSA|high school counselor|side hustle|make money online|work from home|dropship(?:ping)?|passive income|crypto(?:currency)?|forex|weight loss|dating|manifest(?:ation)?|law of attraction|psychic medium|purpose after \d+|bone loss|autistic and developmentally delayed|big (?:ass )?dogs?|pet(?:s)? aren't|chili run|superfans?|glioblastoma|\bGBM\b|portuguese(?:\s+language)?|learn(?:ing)? (?:a )?language|living trust.{0,40}\b(?:me|you|your)\b|pray harder|girlfriends? said|personal (?:finance|growth|development|brand)|find your purpose|financial freedom|your 401k|overpaying thousands.{0,20}taxes without realizing|your health issues|brain fog|stubborn weight|for retirees?|retirees?:|retirement tax|Social Security|Medicare(?: specialist)?|turning 65|foster care|set kids up|secure your family|stop in-laws|aspiring entrepreneur|license your product)\b/i;

const CONSUMER_ADVERTISER_RE =
  /\b(?:parenting|psychic|medium|yoga|quilt museum|education trust|beauty|happy aussie|drone boss|piano guy|real john|marisa peer|john edward|debi robinson|alexdoesparenting|pomp beauty|portuguese with)\b/i;

const INFO_PRODUCT_RE =
  /\b(?:make money online|work from home|dropship(?:ping)?|passive income|crypto(?:currency)?|forex|binary options|mlm|network marketing|my (?:course|coaching)|best selling author summit|client-attraction machine|24\/7 client|start and run a drone business|fly drones for profit)\b/i;

/** Clear B2B / professional keep signals — override consumer false positives. */
const B2B_KEEP_RE =
  /\b(?:for (?:dentists?|clinicians?|practitioners?|advisors?|IARs?|CFPs?|NPs?|PNPs?|therapists?|marketers?|founders?|CEOs?|agencies|dietitians?|SLPs?|OTs?|educators?)|CE credits?|continuing education|B2B|SaaS|demand gen|RMM|PSA|cybersecurity|enterprise|clinical education|medical professionals?|private practice (?:owners?|summit)|marketing hub for|ICF-accredited|district (?:math )?leaders?|math coordinators?|lawn care owners?)\b/i;

export type ConsumerFilterResult = {
  is_consumer: boolean;
  reasons: string[];
};

export function classifyConsumerTargeted(input: {
  company_name?: string;
  ad_copy?: string;
  ad_headline?: string;
}): ConsumerFilterResult {
  const name = input.company_name || '';
  const copy = `${input.ad_headline || ''}\n${input.ad_copy || ''}\n${name}`;
  const reasons: string[] = [];

  if (B2B_KEEP_RE.test(copy)) {
    return { is_consumer: false, reasons: ['b2b_keep_signal'] };
  }
  if (CONSUMER_ADVERTISER_RE.test(name)) reasons.push('consumer_advertiser');
  if (CONSUMER_COPY_RE.test(copy)) reasons.push('consumer_copy');
  if (INFO_PRODUCT_RE.test(copy)) reasons.push('info_product');

  return { is_consumer: reasons.length > 0, reasons };
}
