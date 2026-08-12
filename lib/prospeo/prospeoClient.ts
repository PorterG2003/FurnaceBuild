/**
 * Minimal server-side Prospeo client for on-demand person enrichment.
 *
 * Used by the `apolloEnrich` Lambda for Prospeo-first phone fill (and as a
 * full-profile fallback when Apollo has no match).
 * Endpoint: POST https://api.prospeo.io/enrich-person (auth via `X-KEY`).
 * Includes 429/5xx retry with exponential backoff.
 */

const PROSPEO_ENRICH_URL = 'https://api.prospeo.io/enrich-person';

export interface ProspeoMobile {
  status?: string;
  revealed?: boolean;
  mobile?: string | null;
  mobile_national?: string | null;
  mobile_international?: string | null;
  mobile_country?: string | null;
  mobile_country_code?: string | null;
}

export interface ProspeoEmail {
  status?: string;
  revealed?: boolean;
  email?: string | null;
}

export interface ProspeoPerson {
  person_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  linkedin_url?: string | null;
  current_job_title?: string | null;
  mobile?: ProspeoMobile | null;
  email?: ProspeoEmail | null;
}

export interface ProspeoCompany {
  name?: string | null;
  website?: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
}

export interface ProspeoEnrichResponse {
  error?: boolean;
  error_code?: string;
  free_enrichment?: boolean;
  person?: ProspeoPerson | null;
  company?: ProspeoCompany | null;
}

export class ProspeoError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ProspeoError';
    this.status = status;
    this.code = code;
  }
}

export interface EnrichProspeoPersonInput {
  email?: string | null;
  linkedinUrl?: string | null;
  personId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  companyLinkedinUrl?: string | null;
  enrichMobile?: boolean;
  onlyVerifiedMobile?: boolean;
  onlyVerifiedEmail?: boolean;
}

export interface ProspeoClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const shouldRetry = (error: unknown) => {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      return status === 429 || status >= 500;
    }
    return false;
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function hasMinimumMatchKeys(input: EnrichProspeoPersonInput): boolean {
  if (input.email?.trim()) return true;
  if (input.linkedinUrl?.trim()) return true;
  if (input.personId?.trim()) return true;
  const hasName =
    Boolean(input.fullName?.trim()) ||
    (Boolean(input.firstName?.trim()) && Boolean(input.lastName?.trim()));
  const hasCompany =
    Boolean(input.companyName?.trim()) ||
    Boolean(input.companyWebsite?.trim()) ||
    Boolean(input.companyLinkedinUrl?.trim());
  return hasName && hasCompany;
}

/**
 * Enrich a person via Prospeo.
 * Returns null on NO_MATCH. Throws ProspeoError for other failures.
 */
export async function enrichPerson(
  input: EnrichProspeoPersonInput,
  options: ProspeoClientOptions = {},
): Promise<ProspeoEnrichResponse | null> {
  if (!hasMinimumMatchKeys(input)) {
    throw new Error(
      'enrichPerson requires email, linkedinUrl, or name+company datapoints',
    );
  }

  const apiKey = options.apiKey ?? process.env.PROSPEO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('PROSPEO_API_KEY is required');
  }

  const data: Record<string, string> = {};
  if (input.email?.trim()) data.email = input.email.trim();
  if (input.linkedinUrl?.trim()) data.linkedin_url = input.linkedinUrl.trim();
  if (input.personId?.trim()) data.person_id = input.personId.trim();
  if (input.firstName?.trim()) data.first_name = input.firstName.trim();
  if (input.lastName?.trim()) data.last_name = input.lastName.trim();
  if (input.fullName?.trim()) data.full_name = input.fullName.trim();
  if (input.companyName?.trim()) data.company_name = input.companyName.trim();
  if (input.companyWebsite?.trim()) data.company_website = input.companyWebsite.trim();
  if (input.companyLinkedinUrl?.trim()) {
    data.company_linkedin_url = input.companyLinkedinUrl.trim();
  }

  const body: Record<string, unknown> = { data };
  if (input.enrichMobile === true) body.enrich_mobile = true;
  if (input.onlyVerifiedMobile === true) body.only_verified_mobile = true;
  if (input.onlyVerifiedEmail === true) body.only_verified_email = true;

  const fetchImpl = options.fetchImpl ?? fetch;

  return withRetry(
    async () => {
      const response = await fetchImpl(PROSPEO_ENRICH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KEY': apiKey,
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json().catch(() => ({}))) as ProspeoEnrichResponse & {
        error_code?: string;
        message?: string;
      };

      if (response.status === 429) {
        throw new ProspeoError('Prospeo rate limit exceeded', 429, 'RATE_LIMIT');
      }

      if (!response.ok || json.error === true) {
        const code = json.error_code ?? (response.ok ? 'UNKNOWN' : undefined);
        // Prospeo returns HTTP 400 + error_code NO_MATCH when nothing matched.
        if (code === 'NO_MATCH') {
          return null;
        }
        throw new ProspeoError(
          `Prospeo request failed: ${response.status}${code ? ` ${code}` : ''}`,
          response.status,
          code,
        );
      }

      if (!json.person) {
        return null;
      }

      return json;
    },
    { maxAttempts: options.maxAttempts, baseDelayMs: options.baseDelayMs },
  );
}
