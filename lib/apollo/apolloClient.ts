/**
 * Minimal server-side Apollo.io client for on-demand person enrichment.
 *
 * Used by the `apolloEnrich` Lambda only — the API key must never reach the
 * browser. Endpoint: POST https://api.apollo.io/v1/people/match (auth via
 * `X-Api-Key`). Includes 429/5xx retry with exponential backoff.
 */

const APOLLO_BASE_URL = 'https://api.apollo.io/v1';

export interface ApolloOrganization {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number;
}

export interface ApolloPhoneNumber {
  raw_number?: string;
  sanitized_number?: string;
}

export interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  phone_numbers?: ApolloPhoneNumber[];
  organization?: ApolloOrganization;
}

export class ApolloError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApolloError';
    this.status = status;
  }
}

export interface EnrichPersonInput {
  email?: string | null;
  linkedinUrl?: string | null;
  /** Request async mobile phone reveal (requires webhookUrl). */
  revealPhoneNumber?: boolean;
  webhookUrl?: string | null;
}

export interface ApolloClientOptions {
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

async function apolloPost<T>(
  path: string,
  body: Record<string, unknown>,
  options: ApolloClientOptions,
): Promise<T> {
  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY is required');
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  return withRetry(
    async () => {
      const response = await fetchImpl(`${APOLLO_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new ApolloError(`Apollo request failed: ${response.status}`, response.status);
      }

      return (await response.json()) as T;
    },
    { maxAttempts: options.maxAttempts, baseDelayMs: options.baseDelayMs },
  );
}

/**
 * Look up a single person in Apollo by email (preferred) or LinkedIn URL.
 * Returns the matched person or null when Apollo has no match.
 */
export async function enrichPerson(
  input: EnrichPersonInput,
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const email = input.email?.trim();
  const linkedinUrl = input.linkedinUrl?.trim();

  if (!email && !linkedinUrl) {
    throw new Error('enrichPerson requires an email or linkedinUrl');
  }

  const body: Record<string, unknown> = {
    reveal_personal_emails: true,
  };
  if (email) body.email = email;
  if (linkedinUrl) body.linkedin_url = linkedinUrl;
  if (input.revealPhoneNumber) {
    body.reveal_phone_number = true;
    const webhookUrl = input.webhookUrl?.trim();
    if (!webhookUrl) {
      throw new Error('enrichPerson requires webhookUrl when revealPhoneNumber is true');
    }
    body.webhook_url = webhookUrl;
  }

  const response = await apolloPost<{ person?: ApolloPerson | null }>(
    '/people/match',
    body,
    options,
  );
  return response.person ?? null;
}
