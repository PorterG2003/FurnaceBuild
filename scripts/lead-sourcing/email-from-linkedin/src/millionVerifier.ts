export type MillionVerifierResult = {
  email: string;
  result: string;
  quality?: string;
  free?: boolean;
  role?: boolean;
  error?: string;
};

export type MillionVerifierOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  useFixtures?: boolean;
  fixtureResults?: Record<string, MillionVerifierResult>;
};

/**
 * MillionVerifier real-time single email API.
 * GET https://api.millionverifier.com/api/v3/?api=KEY&email=...
 */
export async function verifyEmailWithMillionVerifier(
  email: string,
  options: MillionVerifierOptions = {},
): Promise<MillionVerifierResult> {
  if (options.useFixtures) {
    const fixture = options.fixtureResults?.[email.toLowerCase()];
    if (fixture) return fixture;
    return { email, result: 'invalid', quality: 'bad' };
  }

  const apiKey = options.apiKey ?? process.env.MILLION_VERIFIER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MILLION_VERIFIER_API_KEY is required when USE_FIXTURES is not enabled');
  }

  const url = new URL('https://api.millionverifier.com/api/v3/');
  url.searchParams.set('api', apiKey);
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', '10');

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`MillionVerifier request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    email: String(data.email ?? email),
    result: String(data.result ?? 'error'),
    quality: data.quality != null ? String(data.quality) : undefined,
    free: typeof data.free === 'boolean' ? data.free : undefined,
    role: typeof data.role === 'boolean' ? data.role : undefined,
    error: data.error != null ? String(data.error) : undefined,
  };
}
