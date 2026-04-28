import { getAccessToken } from '@/lib/services/auth-token';
import { getFluxCompetitorAuditStartUrl } from '@/lib/flux/fluxCompetitorAuditStartUrl';

export type FluxCompetitorAuditStartResult =
  | { ok: true; jobId: string; executionArn?: string | null }
  | { ok: false; message: string; status?: number };

export async function callFluxCompetitorAuditStart(params: {
  pageId: string;
  blockId: string;
}): Promise<FluxCompetitorAuditStartResult> {
  const url = getFluxCompetitorAuditStartUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Competitor audit URL is not configured. Deploy the Amplify backend so amplify_outputs.json includes custom.fluxCompetitorAuditStartUrl, or set EXPO_PUBLIC_FLUX_COMPETITOR_AUDIT_START_URL.',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in.' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pageId: params.pageId, blockId: params.blockId }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const detail = [data.error, data.details].filter(Boolean).join(': ');
    return {
      ok: false,
      message: detail || `Request failed (${res.status})`,
      status: res.status,
    };
  }

  if (data.ok === true && typeof data.jobId === 'string') {
    return {
      ok: true,
      jobId: data.jobId,
      executionArn: typeof data.executionArn === 'string' ? data.executionArn : null,
    };
  }

  return {
    ok: false,
    message: typeof data.error === 'string' ? data.error : 'Unexpected response',
    status: res.status,
  };
}
