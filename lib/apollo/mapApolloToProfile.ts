import type { ApolloPerson } from './apolloClient';

/**
 * Normalized enrichment values proposed for a lead profile. `title` is kept
 * separate because `leads` has no first-class title column — it is stored under
 * `custom_lead_data.title` when applied.
 */
export interface ApolloProfileSuggestion {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  website: string | null;
  company_linkedin_url: string | null;
  title: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function pickPhone(person: ApolloPerson): string | null {
  const numbers = person.phone_numbers ?? [];
  for (const entry of numbers) {
    const candidate = clean(entry.sanitized_number) ?? clean(entry.raw_number);
    if (candidate) return candidate;
  }
  return null;
}

/** Pick the best phone from Apollo webhook phone_numbers array. */
export function pickPhoneFromNumbers(
  numbers: Array<{ raw_number?: string; sanitized_number?: string }> | null | undefined,
): string | null {
  for (const entry of numbers ?? []) {
    const candidate = clean(entry.sanitized_number) ?? clean(entry.raw_number);
    if (candidate) return candidate;
  }
  return null;
}

function pickWebsite(person: ApolloPerson): string | null {
  const org = person.organization;
  if (!org) return null;
  const website = clean(org.website_url);
  if (website) return website;
  const domain = clean(org.primary_domain);
  return domain ? `https://${domain}` : null;
}

function composeName(person: ApolloPerson): string | null {
  const direct = clean(person.name);
  if (direct) return direct;
  const composed = [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(' ');
  return composed || null;
}

/** Map an Apollo person into normalized lead profile suggestions. */
export function mapApolloToProfile(person: ApolloPerson): ApolloProfileSuggestion {
  return {
    name: composeName(person),
    first_name: clean(person.first_name),
    last_name: clean(person.last_name),
    phone_number: pickPhone(person),
    linkedin_url: clean(person.linkedin_url),
    company_name: clean(person.organization?.name),
    website: pickWebsite(person),
    company_linkedin_url: clean(person.organization?.linkedin_url),
    title: clean(person.title),
  };
}
