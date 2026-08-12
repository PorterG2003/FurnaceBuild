import type { ApolloClientOptions, ApolloPerson } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { waitForWebhookSitePayload, type TempWebhookInbox } from './tempWebhook.js';

export type WaterfallEnrichParams = {
  firstName: string;
  lastName: string;
  organizationName?: string;
  title?: string;
  domain?: string;
  linkedinUrl?: string;
};

export type WaterfallEnrichResult = {
  person: ApolloPerson | null;
  email: string;
  requestId: string;
  waterfallStatus: string;
  payload: Record<string, unknown> | null;
};

function extractRequestId(raw: string): string {
  const match = raw.match(/"request_id"\s*:\s*(-?\d+)/);
  return match?.[1] ?? '';
}

function extractEmailFromWaterfallPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const people = payload.people as Array<Record<string, unknown>> | undefined;
  const first = people?.[0];
  if (!first) return '';

  const emails = first.emails as Array<{ email?: string }> | undefined;
  const direct = emails?.find((e) => e.email?.includes('@'))?.email;
  if (direct) return direct;

  const waterfall = first.waterfall as
    | { emails?: Array<{ vendors?: Array<{ emails?: string[] }> }> }
    | undefined;
  for (const block of waterfall?.emails ?? []) {
    for (const vendor of block.vendors ?? []) {
      const hit = vendor.emails?.find((e) => e.includes('@'));
      if (hit) return hit;
    }
  }
  return '';
}

/**
 * Apollo people/match with run_waterfall_email + temporary webhook.
 * Uses string request_id (Apollo IDs exceed JS safe integers) and polls webhook.site.
 */
export async function enrichPersonWithWaterfallEmail(
  params: WaterfallEnrichParams,
  inbox: TempWebhookInbox,
  options: ApolloClientOptions = {},
): Promise<WaterfallEnrichResult> {
  if (options.useFixtures) {
    return {
      person: {
        id: 'fixture_waterfall',
        first_name: params.firstName,
        last_name: params.lastName,
        email: `${params.firstName.toLowerCase()}.${params.lastName.toLowerCase()}@example.com`,
      },
      email: `${params.firstName.toLowerCase()}.${params.lastName.toLowerCase()}@example.com`,
      requestId: 'fixture',
      waterfallStatus: 'accepted',
      payload: null,
    };
  }

  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY is required for waterfall enrichment');

  const fetchImpl = options.fetchImpl ?? fetch;
  const qs = new URLSearchParams({
    reveal_personal_emails: 'true',
    run_waterfall_email: 'true',
    webhook_url: inbox.url,
  });

  const body: Record<string, unknown> = {
    first_name: params.firstName,
    last_name: params.lastName,
  };
  if (params.organizationName) body.organization_name = params.organizationName;
  if (params.title) body.title = params.title;
  if (params.domain) body.domain = params.domain;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  options.counter?.increment('apollo_people_calls', 1);

  const response = await fetchImpl(`https://api.apollo.io/v1/people/match?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Apollo waterfall match failed: ${response.status} ${raw.slice(0, 200)}`);
  }

  let sync: {
    person?: ApolloPerson;
    waterfall?: { status?: string; message?: string };
  } = {};
  try {
    sync = JSON.parse(raw) as typeof sync;
  } catch {
    throw new Error('Apollo waterfall match returned invalid JSON');
  }

  const requestId = extractRequestId(raw);
  const waterfallStatus = sync.waterfall?.status ?? '';
  if (waterfallStatus === 'failed') {
    return {
      person: sync.person ?? null,
      email: sync.person?.email?.includes('@') ? sync.person.email : '',
      requestId,
      waterfallStatus,
      payload: null,
    };
  }

  if (!requestId) {
    return {
      person: sync.person ?? null,
      email: sync.person?.email?.includes('@') ? sync.person.email : '',
      requestId: '',
      waterfallStatus: waterfallStatus || 'missing_request_id',
      payload: null,
    };
  }

  const payload = await waitForWebhookSitePayload({
    token: inbox.token,
    requestId,
    timeoutMs: Number(process.env.APOLLO_WATERFALL_TIMEOUT_MS ?? 20_000),
    pollIntervalMs: 1_500,
    fetchImpl,
    apolloApiKey: apiKey,
  });

  const email =
    extractEmailFromWaterfallPayload(payload) ||
    (sync.person?.email?.includes('@') ? sync.person.email : '');

  const person: ApolloPerson | null = sync.person
    ? { ...sync.person, email: email || sync.person.email }
    : email
      ? {
          first_name: params.firstName,
          last_name: params.lastName,
          email,
        }
      : null;

  return {
    person,
    email,
    requestId,
    waterfallStatus: waterfallStatus || 'accepted',
    payload,
  };
}
