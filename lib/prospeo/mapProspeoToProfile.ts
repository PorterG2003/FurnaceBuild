import type { ApolloPhoneNumber } from '../apollo/apolloClient';
import type { ApolloProfileSuggestion } from '../apollo/mapApolloToProfile';
import type { ProspeoCompany, ProspeoEnrichResponse, ProspeoPerson } from './prospeoClient';

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function composeName(person: ProspeoPerson): string | null {
  const direct = clean(person.full_name);
  if (direct) return direct;
  const composed = [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(' ');
  return composed || null;
}

function pickWebsite(company: ProspeoCompany | null | undefined): string | null {
  if (!company) return null;
  const website = clean(company.website);
  if (website) return website;
  const domain = clean(company.domain);
  return domain ? `https://${domain}` : null;
}

/** Revealed mobile only — obfuscated / unrevealed values are ignored. */
export function pickRevealedMobile(person: ProspeoPerson | null | undefined): string | null {
  const mobile = person?.mobile;
  if (!mobile || mobile.revealed !== true) return null;
  return (
    clean(mobile.mobile) ??
    clean(mobile.mobile_international) ??
    clean(mobile.mobile_national)
  );
}

export interface ProspeoMappedEnrichment {
  suggestion: ApolloProfileSuggestion;
  phoneNumbers: ApolloPhoneNumber[];
}

/** Map a Prospeo enrich response into the shared enrichment suggestion shape. */
export function mapProspeoToProfile(response: ProspeoEnrichResponse): ProspeoMappedEnrichment {
  const person = response.person ?? {};
  const company = response.company ?? null;
  const mobile = pickRevealedMobile(person);
  const phoneNumbers: ApolloPhoneNumber[] = mobile
    ? [{ sanitized_number: mobile, raw_number: mobile }]
    : [];

  return {
    suggestion: {
      name: composeName(person),
      first_name: clean(person.first_name),
      last_name: clean(person.last_name),
      phone_number: null,
      mobile_phone_number: mobile,
      linkedin_url: clean(person.linkedin_url),
      company_name: clean(company?.name),
      website: pickWebsite(company),
      company_linkedin_url: clean(company?.linkedin_url),
      title: clean(person.current_job_title),
    },
    phoneNumbers,
  };
}
