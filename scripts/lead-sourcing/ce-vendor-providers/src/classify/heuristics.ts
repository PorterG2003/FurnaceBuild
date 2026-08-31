import type { AudienceRelationship, EntityClass } from '../lib/types.js';
import { htmlToText, pageHeadline } from '../lib/html.js';
import { hostnameOf, isCePlatformHost } from '../lib/url.js';

const INSTITUTION_IN_NAME =
  /\b(hospital|health system|medical center|university|college|school of|department of|county of|state of|ministry of|va medical|clinic|federal home loan bank|home loan bank)\b/i;
/** Page copy only — not “University Partnerships” in a CPE nav. */
const INSTITUTION_IN_TEXT = /\b(hospital|health system|medical center|va medical)\b/i;

/** Org-type language in the company name — not “Foundations & Endowments” in a services nav. */
const SOCIETY_IN_NAME =
  /\b(society of|association of|academy of|college of|board of|foundation|society|association|alliance|institute|chapter|forums?|conference board)\b/i;
/** Strong enough to beat product/demo copy. Omits `foundation` (Foundation Software). */
const SOCIETY_NAME_WINS =
  /\b(society of|association of|academy of|college of|board of|society|association|alliance|institute|chapter|forums?|conference board)\b/i;
const SOCIETY_IN_TEXT = /\b(society of|association of|academy of|membership (association|society)|professional association|trade association)\b/i;
const TRAINING_IN_NAME = /\b(training|consulting|education|seminar|cpe)\b/i;

const EDUCATION_NAME =
  /\b(continuing education|education services|professional education|institute for (ce|cme|cpe|learning)|learning institute|cme outfitters|medscape|my cme|webinar company|tax training|advanced seminar|conferences?(?: and| &) seminars?|cpe4u|self-study|exam (?:prep|review)|training and consulting|training)\b/i;
const EDUCATION_NAME_TOKEN = /cpe/i;
/** “American Academy of …” is a society; “Fast Forward Academy” / CPAacademy is a shop. */
const ACADEMY_OF = /\bacademy of\b/i;
const EDUCATION_ORG_TOKEN = /\b(learnings?|webinars?|seminars?)\b/i;

const EDUCATION_CATALOG =
  /\b(browse (our )?courses|course catalog|on-demand library|credit types|earn (your )?(ce|cme|cpe)|tuition|all courses|study materials|shopping cart|cpe webinars?|upcoming webinars|certification platform|career tracks|qualifying education|finance courses|live (virtual )?conferences?)\b/i;

const EDUCATION_HOST = /cpe|training|campus|workshop|seminar|academy/i;

const WEAK_COMMERCIAL =
  /\b(pricing|plans|buy now|products?|platform|software)\b/i;

/** Product/service that is not the course catalog itself. */
const NON_EDU_PRODUCT =
  /\b(request (a )?demo|book a demo|start (a )?free trial|request (a )?quote|accounting software|tax software|practice management|find a (dealer|specifier|rep|distributor)|for (architects|agents|advisors|clinicians|therapists)|financial planners?|wealth (planning|management)|investment management|cpa firm|accounting firm)\b/i;

const PROFESSIONAL_FIRM_NAME =
  /\b(llp|l\.l\.p|accountants?\s*\+|advisors?,?\s*(llc|llp|inc|group|p\.?c\.?|pc))\b|p\.c\.?/i;

const ARCAT_EDUCATION_NAME = /\b(academy|green\s*ce|ron\s*blank|aec\s*daily|ce\s*strong)\b/i;

const PARTNER_MOTIVE =
  /\b(specifier|specification|lunch and learn|lunch-and-learn|for agents|appointed agent|channel partner|find a dealer|become a (partner|distributor)|referral partner|implement(?:ation|er)? partner)\b/i;
const CUSTOMER_MOTIVE =
  /\b(request (a )?demo|free trial|sign up|get started|pricing|subscribe|for therapists|for clinicians|for accountants|for cpas|buy|product tour)\b/i;

const GRANT_PROGRAM =
  /\b(independent medical education|ime grant|educational grant (application|request|portal)|grant request|grant portal|rfp calendar|request for (proposal|application)|apply for (an? )?(educational )?grant)\b/i;

/** Hero/title/meta: the company sells a non-education product. */
const PRODUCT_HEADLINE =
  /\b(software|plugin|payroll|quickbooks|automation|workforce management|practice management software|estate planning|actuarial services?|medical (device|solutions)|accounting system|curtain wall|building products?|find a (specifier|dealer))\b/i;

/** Hero/title/meta: the offering is a course catalog or training house. */
const EDUCATION_HEADLINE =
  /\b(training courses?|cpe training|expert cpe|energy training|live seminars?|course catalog|self-study courses?|online cpe|cpe courses?( for)?|view courses in the store|browse the store|all products courses|mastery university|88 self-study|join hundreds of your colleagues|owners trained|continuing education|ce courses?|ce credits?|online ce|ceu courses?|getting ceus|training for therapists|emdr training)\b/i;

/** Hero/title/meta: membership community, not a product company. */
const MEMBERSHIP_HEADLINE =
  /\b(member-led community|membership benefits|join (our|the) community|join \/ renew|community for .{0,60}(owners|advisors|funders|professionals)|source for .{0,40}(education|networking))\b/i;

export type ClassifyInput = {
  provider_name: string;
  homepage_text: string;
  homepage_title?: string;
  homepage_headline?: string;
  source_directory?: string;
  page_url?: string;
};

export type ClassifyResult = {
  entity_class: EntityClass;
  company_sells_what: string;
  class_reason: string;
  audience_relationship: AudienceRelationship;
  has_formal_grant_program: boolean;
};

export function classifyProvider(input: ClassifyInput): ClassifyResult {
  const name = input.provider_name;
  const host = hostnameOf(input.page_url ?? '');
  const platformPage = isCePlatformHost(host) && input.source_directory !== 'ce_platform';
  const text = platformPage ? '' : `${input.homepage_title ?? ''} ${input.homepage_text}`.slice(0, 20000);
  const headline = (input.homepage_headline || `${input.homepage_title ?? ''} ${text.slice(0, 1200)}`).slice(0, 2500);
  const blob = `${name} ${text}`;

  const hasGrant = GRANT_PROGRAM.test(blob);
  const nonEduProduct = NON_EDU_PRODUCT.test(text);
  const partner = PARTNER_MOTIVE.test(blob);
  const customer = CUSTOMER_MOTIVE.test(blob);
  const educationNamed = isEducationCompanyName(name);
  const institution =
    INSTITUTION_IN_NAME.test(name) || (!educationNamed && INSTITUTION_IN_TEXT.test(text.slice(0, 1500)));
  const societyNamed =
    !educationNamed && !TRAINING_IN_NAME.test(name) && SOCIETY_NAME_WINS.test(name);
  const society =
    societyNamed ||
    (!educationNamed &&
      !TRAINING_IN_NAME.test(name) &&
      (SOCIETY_IN_NAME.test(name) || SOCIETY_IN_TEXT.test(text.slice(0, 1500))));
  const educationCatalog = EDUCATION_CATALOG.test(text) || EDUCATION_HOST.test(host);
  const educationShop = educationNamed || (educationCatalog && !nonEduProduct);
  const productHeadline = PRODUCT_HEADLINE.test(headline);
  const educationHeadline = !productHeadline && EDUCATION_HEADLINE.test(headline);
  const membershipHeadline = !productHeadline && !educationNamed && MEMBERSHIP_HEADLINE.test(headline);
  const professionalFirm = PROFESSIONAL_FIRM_NAME.test(name) || isCpaFirmName(name);
  const weakCommercial = WEAK_COMMERCIAL.test(text);

  const manufacturerListReason =
    input.source_directory === 'arcat'
      ? 'ARCAT CES manufacturer list'
      : input.source_directory === 'greence'
        ? 'GreenCE manufacturer sponsor list'
        : input.source_directory === 'ronblank'
          ? 'Ron Blank manufacturer sponsor list'
          : input.source_directory === 'aecdaily'
            ? 'AEC Daily manufacturer sponsor list'
            : input.source_directory === 'cestrong'
              ? 'CE Strong manufacturer partner list'
              : input.source_directory === 'bnp'
                ? 'BNP CE Center manufacturer sponsor list'
                : null;
  if (
    manufacturerListReason &&
    !INSTITUTION_IN_NAME.test(name) &&
    !ARCAT_EDUCATION_NAME.test(name)
  ) {
    return {
      entity_class: 'commercial_vendor',
      company_sells_what: inferSellsWhat(`${name} ${text}`, name) || 'building products',
      class_reason: manufacturerListReason,
      audience_relationship: 'partner',
      has_formal_grant_program: hasGrant,
    };
  }

  let entity_class: EntityClass = 'unknown';
  let class_reason = 'no strong homepage signals';

  if (institution && !educationNamed) {
    entity_class = 'institution';
    class_reason = 'hospital/university/government name or copy';
  } else if (societyNamed) {
    entity_class = 'society';
    class_reason = 'membership society / association name';
  } else if (membershipHeadline) {
    entity_class = 'society';
    class_reason = 'membership community in title/headline';
  } else if (educationShop || educationHeadline) {
    entity_class = 'education_company';
    class_reason = educationHeadline
      ? 'training catalog in title/headline'
      : 'education catalog without a non-education product';
  } else if (society && !nonEduProduct) {
    entity_class = 'society';
    class_reason = 'membership society / association name';
  } else if (nonEduProduct || partner || professionalFirm) {
    entity_class = 'commercial_vendor';
    class_reason = partner
      ? 'product/channel/specifier commercial signals'
      : professionalFirm && !nonEduProduct
        ? 'professional firm name'
        : 'product/demo commercial signals';
  } else if (weakCommercial) {
    entity_class = 'commercial_vendor';
    class_reason = 'product/demo commercial signals';
  }

  let audience_relationship: AudienceRelationship = 'unknown';
  if (partner && !customer) audience_relationship = 'partner';
  else if (customer && !partner) audience_relationship = 'customer';
  else if (partner && customer) audience_relationship = partnerFirst(name, text);

  return {
    entity_class,
    company_sells_what: inferSellsWhat(text, name),
    class_reason,
    audience_relationship,
    has_formal_grant_program: hasGrant,
  };
}

function isEducationCompanyName(name: string): boolean {
  if (ACADEMY_OF.test(name)) return false;
  if (EDUCATION_NAME.test(name)) return true;
  if (EDUCATION_NAME_TOKEN.test(name) && !/cpa/i.test(name)) return true;
  if (/academy/i.test(name)) return true;
  if (EDUCATION_ORG_TOKEN.test(name)) return true;
  if (/\beducation\b/i.test(name) && !/\bconsulting\b/i.test(name)) return true;
  if (/\bschools?\b/i.test(name) && !/\bschool of\b/i.test(name) && !INSTITUTION_IN_NAME.test(name)) {
    return true;
  }
  if (/\bpractice advisor\b/i.test(name)) return true;
  if (/\bcpa\s+to\s+cpa\b/i.test(name)) return true;
  if (/\badvisors?\s*(4|for|to)\s*advisors?\b|\badvisors?4advisors?\b/i.test(name)) return true;
  if (/\bgaap\b/i.test(name)) return true;
  return false;
}

/** AAFCPAs yes; CPA Practice Advisor / CPA to CPA are shops, not firms. */
function isCpaFirmName(name: string): boolean {
  if (!/cpa/i.test(name)) return false;
  if (isEducationCompanyName(name)) return false;
  if (/^cpa(\s+|-)?(practice|to|for|academy|review|exam|self)|cpaacademy/i.test(name)) return false;
  return true;
}

function partnerFirst(name: string, text: string): AudienceRelationship {
  if (/\b(architect|specifier|building product|agent|carrier|distributor)\b/i.test(`${name} ${text}`)) {
    return 'partner';
  }
  return 'customer';
}

function inferSellsWhat(text: string, name: string): string {
  const hay = `${name} ${text}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\bwindows?\b|curtain wall|building product|cladding|\bhvac\b|roofing/, 'building products'],
    [/counseling platform|matching platform|referral network/, 'therapist matching / behavioral health services'],
    [/quickbooks|accounting software|tax software|bookkeep/, 'accounting software'],
    [/\behr\b|\bemr\b|practice management/, 'clinical software'],
    [/\binsurance\b|carrier|annuity/, 'insurance'],
    [/ime grant|educational grant portal/, 'pharma / IME grants'],
    [/continuing education|course catalog|ce courses|cpe webinars?|finance courses/, 'continuing education'],
  ];
  for (const [re, label] of rules) {
    if (re.test(hay)) return label;
  }
  return '';
}

export function classifyFromHtml(
  providerName: string,
  html: string,
  title?: string,
  context?: { source_directory?: string; page_url?: string },
): ClassifyResult {
  return classifyProvider({
    provider_name: providerName,
    homepage_text: htmlToText(html),
    homepage_title: title,
    homepage_headline: pageHeadline(html, title),
    source_directory: context?.source_directory,
    page_url: context?.page_url,
  });
}
