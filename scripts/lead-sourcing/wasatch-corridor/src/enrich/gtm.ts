import {
  AE_TITLE_RE,
  GTM_HIRING_RE,
  OUTBOUND_CONFIRM_RE,
  OUTBOUND_MARKETER_TITLE_RE,
  SDR_TITLE_RE,
  SEQUENCER_NAME_RE,
  SEQUENCER_TECH_UIDS,
} from '../../config/sources.js';
import type { CompanyRecord } from '../types.js';

export function sequencerFromTech(uids: string[]): boolean {
  const set = new Set(uids.map((u) => u.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
  return SEQUENCER_TECH_UIDS.some((uid) => set.has(uid) || [...set].some((s) => s.includes(uid)));
}

export function sequencerFromText(text: string): boolean {
  return SEQUENCER_NAME_RE.test(text);
}

export type PersonHit = {
  title?: string;
  headline?: string;
  seniority?: string;
};

export type OutboundMarketerState = {
  detected: boolean;
  title_only: boolean;
};

export function detectOutboundMarketer(options: {
  people: PersonHit[];
  sequencerDetected: boolean;
  jobPostingsText: string;
}): OutboundMarketerState {
  const titleMatch = options.people.some((p) => OUTBOUND_MARKETER_TITLE_RE.test(`${p.title ?? ''} ${p.headline ?? ''}`));
  if (!titleMatch) return { detected: false, title_only: false };
  const confirming = options.people.some((p) =>
    OUTBOUND_CONFIRM_RE.test(`${p.title ?? ''} ${p.headline ?? ''}`),
  );
  const corroborating = options.sequencerDetected || confirming || OUTBOUND_CONFIRM_RE.test(options.jobPostingsText);
  if (corroborating) return { detected: true, title_only: false };
  return { detected: false, title_only: true };
}

export function countByTitle(people: PersonHit[], re: RegExp): number {
  return people.filter((p) => re.test(`${p.title ?? ''} ${p.headline ?? ''}`)).length;
}

export function namedDmDiscoverable(people: PersonHit[]): boolean {
  return people.some((p) =>
    /\b(owner|founder|ceo|cmo|cro|vp|vice president|director|head of)\b/i.test(`${p.title ?? ''} ${p.seniority ?? ''}`),
  );
}

export function applyGtmSignals(
  company: CompanyRecord,
  people: PersonHit[],
  extraText = '',
): OutboundMarketerState {
  const techSeq = sequencerFromTech(company.current_technologies);
  const textSeq = sequencerFromText(extraText);
  company.sequencer_detected = techSeq || textSeq;
  company.hiring_gtm = GTM_HIRING_RE.test(company.job_postings_json) || GTM_HIRING_RE.test(extraText);
  company.hiring_outbound_marketer = OUTBOUND_MARKETER_TITLE_RE.test(company.job_postings_json);
  const om = detectOutboundMarketer({
    people,
    sequencerDetected: company.sequencer_detected,
    jobPostingsText: `${company.job_postings_json} ${extraText}`,
  });
  company.outbound_marketer_detected = om.detected;
  company.outbound_marketer_title_only = om.title_only;
  company.sequencer_orphaned = company.sequencer_detected && !company.outbound_marketer_detected;
  company.sdr_headcount = countByTitle(people, SDR_TITLE_RE);
  company.ae_headcount = countByTitle(people, AE_TITLE_RE);
  company.sales_headcount = people.filter((p) => /\bsales\b/i.test(`${p.title ?? ''}`)).length;
  company.named_dm_discoverable = namedDmDiscoverable(people);
  company.webinar_role_detected =
    company.webinar_role_detected ||
    people.some((p) => /\b(webinar|event\s*marketing|events?\s*manager)\b/i.test(`${p.title ?? ''}`));
  return om;
}
