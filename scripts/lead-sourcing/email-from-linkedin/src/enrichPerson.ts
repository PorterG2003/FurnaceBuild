import {
  enrichPeopleByIds,
  enrichPersonByLinkedIn,
  enrichPersonByName,
  matchPersonByLinkedIn,
  type ApolloClientOptions,
  type ApolloPerson,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { isLinkedInMemberIdUrl, parseHeadlineHints, parseReactorName } from './nameParse.js';
import type { EnrichMatchMethod, EnrichedUniqueRow, ScrapeRow } from './types.js';

function hasEmail(person: ApolloPerson | null | undefined): boolean {
  return Boolean(person?.email?.includes('@'));
}

/** Discard Apollo stubs that only have an id (common for /in/ACo… matches). */
export function isUsablePersonMatch(person: ApolloPerson | null | undefined): boolean {
  if (!person?.id) return false;
  if (hasEmail(person)) return true;
  return Boolean(
    person.first_name?.trim() ||
      person.last_name?.trim() ||
      person.title?.trim() ||
      person.organization?.name?.trim() ||
      person.linkedin_url?.trim(),
  );
}

async function revealEmail(
  person: ApolloPerson,
  options: ApolloClientOptions,
): Promise<ApolloPerson> {
  if (hasEmail(person) || !person.id) return person;
  const enriched = await enrichPeopleByIds(
    [person.id],
    options,
    person.organization?.id,
  );
  return enriched[0] ?? person;
}

function personToFields(person: ApolloPerson | null): Pick<
  EnrichedUniqueRow,
  'email' | 'first_name' | 'last_name' | 'title' | 'company_name' | 'company_domain' | 'apollo_person_id'
> {
  return {
    email: person?.email?.includes('@') ? person.email : '',
    first_name: person?.first_name ?? '',
    last_name: person?.last_name ?? '',
    title: person?.title ?? '',
    company_name: person?.organization?.name ?? '',
    company_domain: person?.organization?.primary_domain ?? '',
    apollo_person_id: person?.id ?? '',
  };
}

function statusFor(person: ApolloPerson | null): EnrichedUniqueRow['enrichment_status'] {
  if (!isUsablePersonMatch(person)) return 'not_found';
  if (hasEmail(person)) return 'email_found';
  return 'matched_no_email';
}

async function matchByName(
  input: ScrapeRow,
  options: ApolloClientOptions,
): Promise<ApolloPerson | null> {
  const parsed = parseReactorName(input.reactor_name);
  const hints = parseHeadlineHints(input.reactor_headline);
  if (!parsed.firstName || !parsed.lastName) return null;
  return enrichPersonByName(
    {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      organizationName: hints.organizationName || undefined,
      title: hints.title || undefined,
    },
    options,
  );
}

export type EnrichPersonResult = {
  row: EnrichedUniqueRow;
};

/**
 * Member-ID LinkedIn URLs often return empty Apollo stubs — prefer name+headline match.
 * Vanity URLs: LinkedIn match first, then name fallback. Then bulk_match email reveal if needed.
 */
export async function enrichReactorProfile(
  input: ScrapeRow,
  linkedinUrl: string,
  options: ApolloClientOptions,
): Promise<EnrichPersonResult> {
  let matchMethod: EnrichMatchMethod = 'none';
  let person: ApolloPerson | null = null;

  const parsed = parseReactorName(input.reactor_name);
  const hints = parseHeadlineHints(input.reactor_headline);

  const base: EnrichedUniqueRow = {
    linkedin_url: linkedinUrl,
    reactor_name: input.reactor_name,
    reactor_headline: input.reactor_headline,
    k12_role: input.k12_role,
    source: input.source,
    email: '',
    first_name: parsed.firstName,
    last_name: parsed.lastName,
    title: hints.title,
    company_name: '',
    company_domain: '',
    apollo_person_id: '',
    enrichment_status: 'not_found',
    match_method: 'none',
    error: '',
  };

  try {
    const memberIdUrl = isLinkedInMemberIdUrl(linkedinUrl);

    if (memberIdUrl) {
      // Name-first: ACo URL matches are usually empty stubs.
      person = await matchByName(input, options);
      if (isUsablePersonMatch(person)) {
        matchMethod = 'name';
      } else {
        person = await enrichPersonByLinkedIn(linkedinUrl, options);
        if (isUsablePersonMatch(person)) matchMethod = 'linkedin_url';
        else person = null;
      }
    } else {
      if (linkedinUrl) {
        person = await matchPersonByLinkedIn(linkedinUrl, options);
        if (isUsablePersonMatch(person)) matchMethod = 'linkedin_url';
        else person = null;
      }
      if (!isUsablePersonMatch(person)) {
        person = await matchByName(input, options);
        if (isUsablePersonMatch(person)) matchMethod = 'name';
        else person = null;
      }
    }

    if (person?.id && !hasEmail(person)) {
      person = await revealEmail(person, options);
    }

    const fields = personToFields(isUsablePersonMatch(person) ? person : null);
    return {
      row: {
        ...base,
        ...fields,
        first_name: fields.first_name || parsed.firstName,
        last_name: fields.last_name || parsed.lastName,
        title: fields.title || hints.title,
        enrichment_status: statusFor(person),
        match_method: matchMethod,
        error: '',
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      row: {
        ...base,
        enrichment_status: 'error',
        match_method: matchMethod,
        error,
      },
    };
  }
}
