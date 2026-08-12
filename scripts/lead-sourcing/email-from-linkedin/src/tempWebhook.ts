export type TempWebhookInbox = {
  token: string;
  url: string;
};

/**
 * Create a temporary public HTTPS inbox via webhook.site (no account required).
 * Apollo docs explicitly recommend webhook.site for waterfall callbacks.
 */
export async function createTempWebhookInbox(
  fetchImpl: typeof fetch = fetch,
): Promise<TempWebhookInbox> {
  const response = await fetchImpl('https://webhook.site/token', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to create webhook.site token: ${response.status}`);
  }
  const data = (await response.json()) as { uuid?: string };
  if (!data.uuid) throw new Error('webhook.site token response missing uuid');
  return {
    token: data.uuid,
    url: `https://webhook.site/${data.uuid}`,
  };
}

type WebhookSiteRequest = {
  uuid?: string;
  content?: string;
  created_at?: string;
};

/**
 * Poll webhook.site until a request body contains the given request_id, or timeout.
 * Also tries Apollo's poll endpoint (string request_id — IDs exceed JS safe integers).
 */
export async function waitForWebhookSitePayload(options: {
  token: string;
  requestId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  apolloApiKey?: string;
}): Promise<Record<string, unknown> | null> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = Date.now();
  const needle = String(options.requestId);

  while (Date.now() - started < timeoutMs) {
    // Prefer Apollo poll when available (no credit cost)
    if (options.apolloApiKey) {
      for (const base of ['https://api.apollo.io/api/v1', 'https://api.apollo.io/v1']) {
        const pollRes = await fetchImpl(`${base}/webhook_result/${needle}`, {
          headers: { 'X-Api-Key': options.apolloApiKey, Accept: 'application/json' },
        });
        if (pollRes.ok) {
          const pollJson = (await pollRes.json()) as {
            webhook_status?: string;
            webhook_result?: Record<string, unknown>;
          };
          if (pollJson.webhook_status === 'success' && pollJson.webhook_result) {
            return pollJson.webhook_result;
          }
          if (pollJson.webhook_status === 'failed') {
            return pollJson.webhook_result ?? { status: 'failed' };
          }
        }
      }
    }

    const url = new URL(`https://webhook.site/token/${options.token}/requests`);
    url.searchParams.set('sorting', 'newest');
    url.searchParams.set('per_page', '100');
    const response = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = (await response.json()) as { data?: WebhookSiteRequest[] };
      for (const entry of data.data ?? []) {
        const content = entry.content ?? '';
        if (!content.includes(needle)) continue;
        try {
          return JSON.parse(content) as Record<string, unknown>;
        } catch {
          return { raw: content };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}
