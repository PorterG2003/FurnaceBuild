import { getAccessToken } from '@/lib/services/auth-token';
import { getFluxGenerateUrl } from './fluxGenerateUrl';
import type { FluxPreviewProspectInput, FluxPreviewTemplateInput, FluxSellerProfileInput, PageConfig } from './types';
import type { FluxBrandingPolicy } from './fluxBrandingPolicy';
import { coercePageConfig } from './coercePageConfig';

export type FluxGenerateResult =
  | { ok: true; pageId: string; slug: string; status: string }
  | { ok: false; message: string };

/**
 * POST to fluxGenerate Lambda with the current user's Supabase access token.
 */
export async function callFluxGenerate(params: {
  prospectId: string;
  campaignId: string;
}): Promise<FluxGenerateResult> {
  const url = getFluxGenerateUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Flux generate URL is not configured. Run `npx ampx sandbox` (or deploy the backend), then ensure the repo root `amplify_outputs.json` includes `custom.fluxGenerateUrl`. You can also set `EXPO_PUBLIC_FLUX_GENERATE_URL` in `.env.local` to the Function URL from the AWS console.',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in to generate a page.' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prospectId: params.prospectId, campaignId: params.campaignId }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    details?: string;
    code?: string;
    model?: string;
    pageId?: string;
    slug?: string;
    status?: string;
  };

  if (!res.ok) {
    const detail = [data.error, data.details].filter(Boolean).join(': ');
    const suffix =
      data.model && data.code === 'LLM_UPSTREAM_ERROR' ? ` (model: ${data.model})` : '';
    return {
      ok: false,
      message:
        detail || `Request failed (${res.status} ${res.statusText})${suffix}`,
    };
  }

  if (!data.pageId || !data.slug) {
    return {
      ok: false,
      message: 'Unexpected response from generate service (missing pageId or slug).',
    };
  }

  return {
    ok: true,
    pageId: data.pageId,
    slug: data.slug,
    status: data.status ?? 'draft',
  };
}

export type FluxPreviewGenerateResult =
  | { ok: true; pageConfig: PageConfig; model?: string }
  | { ok: false; message: string };

/**
 * POST preview mode: returns `pageConfig` without persisting to `flux_prospect_pages`.
 */
export async function callFluxPreviewGenerate(params: {
  campaignId: string;
  prospect: FluxPreviewProspectInput;
  template: FluxPreviewTemplateInput;
  seller_profile?: FluxSellerProfileInput;
  branding_policy?: FluxBrandingPolicy;
}): Promise<FluxPreviewGenerateResult> {
  const url = getFluxGenerateUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Flux generate URL is not configured. Run `npx ampx sandbox` (or deploy the backend), then ensure the repo root `amplify_outputs.json` includes `custom.fluxGenerateUrl`. You can also set `EXPO_PUBLIC_FLUX_GENERATE_URL` in `.env.local` to the Function URL from the AWS console.',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in to generate a preview.' };
  }

  const body = {
    campaignId: params.campaignId,
    preview: true,
    prospect: {
      name: params.prospect.name,
      company: params.prospect.company,
      role: params.prospect.role ?? null,
      url: params.prospect.url ?? null,
      industry: params.prospect.industry ?? null,
      company_size: params.prospect.company_size ?? null,
      email_notes: params.prospect.email_notes ?? null,
      brand_profile: params.prospect.brand_profile,
      website_intel: params.prospect.website_intel ?? null,
    },
    template: {
      blocks: params.template.blocks,
      content_assets: params.template.content_assets,
      copy_slots: params.template.copy_slots,
      constraints: params.template.constraints,
    },
    ...(params.seller_profile ? { seller_profile: params.seller_profile } : {}),
    ...(params.branding_policy ? { branding_policy: params.branding_policy } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    details?: string;
    code?: string;
    model?: string;
    preview?: boolean;
    pageConfig?: unknown;
  };

  if (!res.ok) {
    const detail = [data.error, data.details].filter(Boolean).join(': ');
    const suffix =
      data.model && data.code === 'LLM_UPSTREAM_ERROR' ? ` (model: ${data.model})` : '';
    return {
      ok: false,
      message: detail || `Request failed (${res.status} ${res.statusText})${suffix}`,
    };
  }

  if (!data.preview || data.pageConfig == null) {
    return {
      ok: false,
      message: 'Unexpected response from preview generate (missing pageConfig).',
    };
  }

  const pageConfig = coercePageConfig(data.pageConfig);
  if (!pageConfig) {
    return { ok: false, message: 'Preview returned an empty or invalid page config.' };
  }

  return { ok: true, pageConfig, model: data.model };
}
