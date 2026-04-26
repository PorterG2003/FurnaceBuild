import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  formatZodIssuesForRepair,
  normalizeFluxLlmPageConfigBeforeZod,
  pageConfigSchema,
} from '../../../lib/flux/fluxGeneratePageConfigSchema';
import { mergeGeneratedPageConfigWithTemplate } from '../../../lib/flux/mergeGeneratedPageConfig';
import {
  formatMergedFluxSemanticIssuesForRepair,
  getMergedFluxPageConfigSemanticIssues,
} from '../../../lib/flux/validateMergedFluxPageConfig';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

type OpenRouterResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };

/** Best-effort string for logs / client from OpenRouter `error` + `metadata` (see openrouter.ai errors docs). */
function formatOpenRouterErrorDetails(body: Record<string, unknown>): string {
  const errField = body.error;
  if (typeof errField === 'string' && errField.trim()) return errField.trim();
  if (errField && typeof errField === 'object') {
    const e = errField as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
    if (e.code !== undefined && e.code !== null && String(e.code).length > 0) {
      parts.push(`code=${String(e.code)}`);
    }
    const meta = e.metadata;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const m = meta as Record<string, unknown>;
      if (typeof m.provider_name === 'string' && m.provider_name.trim()) {
        parts.push(`provider=${m.provider_name.trim()}`);
      }
      if (m.raw !== undefined && m.raw !== null) {
        let rawStr: string;
        if (typeof m.raw === 'string') rawStr = m.raw;
        else {
          try {
            rawStr = JSON.stringify(m.raw);
          } catch {
            rawStr = String(m.raw);
          }
        }
        if (rawStr.length > 600) rawStr = `${rawStr.slice(0, 600)}…`;
        if (rawStr.trim()) parts.push(`upstream=${rawStr}`);
      }
    }
    if (parts.length > 0) return parts.join(' | ');
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return '';
}

async function openRouterChatCompletion(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  referer?: string;
  title?: string;
  responseFormat?: OpenRouterResponseFormat;
}): Promise<
  { ok: true; text: string } | { ok: false; details: string; httpStatus?: number }
> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (params.referer) headers['HTTP-Referer'] = params.referer;
  if (params.title) headers['X-OpenRouter-Title'] = params.title;

  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    max_tokens: 4096,
  };
  if (params.responseFormat) requestBody.response_format = params.responseFormat;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, details: msg };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const choices = body.choices as
    | Array<{
        message?: { content?: string | null };
        finish_reason?: string;
        native_finish_reason?: string;
      }>
    | undefined;
  const choice0 = choices?.[0];
  const text = choice0?.message?.content;
  const hasStringContent = typeof text === 'string' && text.trim().length > 0;
  const topDetails = formatOpenRouterErrorDetails(body);
  const finishReason = choice0?.finish_reason;

  if (!res.ok) {
    const msg = topDetails || `HTTP ${res.status}`;
    return { ok: false, details: msg, httpStatus: res.status };
  }

  // HTTP 200 — OpenRouter may still return `error` or choices with finish_reason "error" (non-stream completions).
  if (body.error && !hasStringContent) {
    return {
      ok: false,
      details: topDetails || 'OpenRouter returned an error with no completion text',
      httpStatus: res.status,
    };
  }
  if (finishReason === 'error') {
    const native = choice0?.native_finish_reason;
    const base = topDetails || 'Model finished with error';
    const msg = native ? `${base} (native_finish_reason=${native})` : base;
    return { ok: false, details: msg, httpStatus: res.status };
  }
  if (!hasStringContent) {
    return {
      ok: false,
      details:
        topDetails || 'OpenRouter response missing choices[0].message.content (empty or null)',
      httpStatus: res.status,
    };
  }
  return { ok: true, text: text as string };
}

/**
 * Tried after the configured primary model, in order, when routing is unavailable or the
 * upstream is temporarily overloaded (OpenRouter / provider quirks differ by account).
 * Mix of Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek.
 */
const OPENROUTER_MODEL_FALLBACKS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet-20240620',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-small-3.1-24b-instruct-2503',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
];

function shouldTryNextOpenRouterModel(r: { ok: false; details: string; httpStatus?: number }): boolean {
  const d = r.details;
  if (/no endpoints found/i.test(d)) return true;
  if (r.httpStatus === 429) return true;
  if (r.httpStatus === 503) return true;
  if (r.httpStatus === 500 || r.httpStatus === 502 || r.httpStatus === 504) return true;
  if (/rate limit|too many requests|overload|capacity|temporarily unavailable|try again/i.test(d)) {
    return true;
  }
  if (
    /provider returned|bad gateway|gateway timeout|server error|model is down|invalid response from provider|upstream=/i.test(
      d,
    )
  ) {
    return true;
  }
  return false;
}

async function openRouterChatWithModelFallbacks(
  base: Omit<Parameters<typeof openRouterChatCompletion>[0], 'model'> & { model: string },
): Promise<
  { ok: true; text: string; modelUsed: string } | { ok: false; details: string; modelTried: string }
> {
  const primary = base.model;
  const candidates = [primary, ...OPENROUTER_MODEL_FALLBACKS.filter((m) => m !== primary)];
  let lastDetails = '';
  let lastTried = primary;
  for (const model of candidates) {
    lastTried = model;
    let r = await openRouterChatCompletion({ ...base, model });
    if (
      !r.ok &&
      base.responseFormat &&
      (r.httpStatus === 400 || r.httpStatus === 422) &&
      /json|schema|response_format|structured|invalid|unsupported|not support/i.test(r.details)
    ) {
      r = await openRouterChatCompletion({ ...base, model, responseFormat: undefined });
    }
    if (r.ok) return { ok: true, text: r.text, modelUsed: model };
    lastDetails = r.details;
    if (!shouldTryNextOpenRouterModel(r)) {
      return { ok: false, details: r.details, modelTried: model };
    }
  }
  return { ok: false, details: lastDetails, modelTried: lastTried };
}

let pageConfigJsonSchemaMemo: Record<string, unknown> | null = null;

/** Stops TS2589: `zodToJsonSchema` generics still recurse into the schema type unless the fn is widened. */
const zodToJsonSchemaLoose = zodToJsonSchema as (
  schema: unknown,
  options?: { $refStrategy?: string; target?: string },
) => Record<string, unknown>;

function getPageConfigJsonSchemaRecord(): Record<string, unknown> {
  if (!pageConfigJsonSchemaMemo) {
    pageConfigJsonSchemaMemo = zodToJsonSchemaLoose(pageConfigSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    });
  }
  return pageConfigJsonSchemaMemo;
}

/** Always request strict PageConfig JSON from OpenRouter; unsupported models retry without `response_format` in `openRouterChatWithModelFallbacks`. */
function getFluxGenerateOpenRouterResponseFormat(): OpenRouterResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'FluxPageConfig',
      strict: true,
      schema: getPageConfigJsonSchemaRecord(),
    },
  };
}

// ---------------------------------------------------------------------------
// Theme computation (mirrored from lib/flux/computeTheme)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(r: number, g: number, b: number) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function tint(hex: string, factor: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#f5f5f5';
  return rgbToHex(rgb.r + (255 - rgb.r) * factor, rgb.g + (255 - rgb.g) * factor, rgb.b + (255 - rgb.b) * factor);
}

function computeTheme(brand: { primaryColor?: string; accentColor?: string; fontFamily?: string; logoUrl?: string }) {
  const primary =
    typeof brand.primaryColor === 'string' && brand.primaryColor.length > 0 ? brand.primaryColor : '#4f46e5';
  const accentRaw = typeof brand.accentColor === 'string' && brand.accentColor.length > 0 ? brand.accentColor : primary;
  const accent = accentRaw;
  const bg = tint(primary, 0.92);
  const bgRgb = hexToRgb(bg);
  const bgLum = bgRgb ? relativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b) : 0.9;
  const textColor = bgLum > 0.5 ? '#1a1a1a' : '#f5f5f5';
  const fontFamily =
    typeof brand.fontFamily === 'string' && brand.fontFamily.length > 0 ? brand.fontFamily : 'Inter';
  const logoUrl = typeof brand.logoUrl === 'string' && brand.logoUrl.length > 0 ? brand.logoUrl : undefined;
  return { primaryColor: primary, accentColor: accent, backgroundColor: bg, textColor, fontFamily, logoUrl };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a conversion landing page personalizer. You receive a campaign template (blocks with base copy) and prospect context. Your job:
- Rewrite the copy_slots to speak directly to this prospect (when copy_slots is empty, still fill every visible marketing string in block props from prospect context—no blank or placeholder copy)
- Select the most relevant content_assets for case study / testimonial blocks: props.assetId must be an exact "id" from content_assets of matching type when such assets exist; if there are none of that type, set assetId to "" (empty block)
- Return a complete PageConfig JSON

Do NOT add, remove, or reorder blocks. Work strictly within the template structure.
Every block from the template MUST appear in your output with the same id, type, and order.

For tanners_tax_strategy blocks only: if you set props.defaultQualificationMode, it MUST be exactly one of: "passive", "reps", or "str" (never "active" or other labels—use "reps" for real-estate-professional-style qualification).

For social_media_plan blocks: keep props.weeks as a calendar (each week has theme + days with platform, post_type, hook, optional cta). Set inferred_vertical and inferred_vertical_rationale from real prospect signals (no invented proof). Keep cta_ladder as an ordered escalation and platform_mix_note as one concrete sentence on channel mix.`;

function buildUserPrompt(
  template: { blocks: unknown[]; content_assets: unknown[]; copy_slots: string[]; constraints: string },
  prospect: { name: string; company: string; role?: string; industry?: string; company_size?: string; email_notes?: string; url?: string },
  theme: ReturnType<typeof computeTheme>,
) {
  const copySlotSection = template.copy_slots.length
    ? `Fields you MUST personalize (copy_slots): ${template.copy_slots.join(', ')}`
    : `There is no copy_slots list: still rewrite every user-visible string in each block's props using the prospect context. Do not leave empty strings for hero/CTA headlines, subheadlines, CTA labels, benefit titles/descriptions, or other body copy—replace template placeholders with real copy.`;
  return `Rules from the campaign creator:
${template.constraints || '(none)'}

Template blocks (JSON):
${JSON.stringify(template.blocks, null, 2)}

Available content assets (JSON):
${JSON.stringify(template.content_assets, null, 2)}

${copySlotSection}

Case study / testimonial assetId rules:
- For each case_study block: if any content asset has "type": "case_study", set props.assetId to exactly one of those assets' "id" (non-empty). If there are zero case_study assets, set props.assetId to "".
- For each testimonial block: same using "type": "testimonial".

Prospect: ${prospect.name}, ${prospect.role || 'unknown role'} at ${prospect.company}
Industry: ${prospect.industry || 'unknown'} | Size: ${prospect.company_size || 'unknown'}
Their words from email thread: "${prospect.email_notes || '(no notes)'}"
Company URL: ${prospect.url || '(none)'}

Theme to use:
${JSON.stringify(theme, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "theme": { "primaryColor": string, "accentColor": string, "backgroundColor": string, "textColor": string, "fontFamily": string, "logoUrl"?: string },
  "prospectName": string,
  "companyName": string,
  "blocks": [ { "id": string, "type": string, "order": number, "props": { ... } }, ... ]
}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const FLUX_FLAG_KEY = 'flux';

function normalizeTemplateRow(row: Record<string, unknown>) {
  const blocks = Array.isArray(row.blocks) ? row.blocks : [];
  const content_assets = Array.isArray(row.content_assets) ? row.content_assets : [];
  const rawSlots = row.copy_slots;
  const copy_slots = Array.isArray(rawSlots)
    ? (rawSlots as string[]).filter((s) => typeof s === 'string')
    : typeof rawSlots === 'string'
      ? [rawSlots]
      : [];
  const constraints = typeof row.constraints === 'string' ? row.constraints : '';
  return { ...row, blocks, content_assets, copy_slots, constraints };
}

function parseBrandProfile(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function brandFieldsForTheme(raw: unknown): {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  logoUrl?: string;
} {
  const o = parseBrandProfile(raw);
  return {
    primaryColor: typeof o.primaryColor === 'string' ? o.primaryColor : undefined,
    accentColor: typeof o.accentColor === 'string' ? o.accentColor : undefined,
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : undefined,
    logoUrl: typeof o.logoUrl === 'string' ? o.logoUrl : undefined,
  };
}

type NormalizedTemplate = ReturnType<typeof normalizeTemplateRow>;

/** Prospect fields used for LLM prompt + theme (inline preview or DB row). */
type ProspectPromptShape = {
  name: string;
  company: string;
  role: string | null;
  industry: string | null;
  company_size: string | null;
  email_notes: string | null;
  url: string | null;
  brand_profile: unknown;
};

async function assertUserCanAccessCampaign(
  db: SupabaseClient,
  userId: string,
  campaignId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data: campaign, error } = await db
    .from('flux_campaigns')
    .select('id, account_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Database error loading campaign', details: error.message },
    };
  }
  if (!campaign) {
    return { ok: false, status: 404, body: { error: 'Campaign not found', code: 'NO_CAMPAIGN' } };
  }
  const accountId = campaign.account_id as string;
  const { data: membership } = await db
    .from('account_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!membership) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Forbidden', code: 'CAMPAIGN_ACCESS_DENIED' },
    };
  }
  return { ok: true };
}

function extractJsonObjectFromLlmText(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

async function runLlmPageConfig(params: {
  template: NormalizedTemplate;
  prospect: ProspectPromptShape;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterReferer?: string;
  openRouterTitle?: string;
}): Promise<
  | { ok: true; pageConfig: z.infer<typeof pageConfigSchema>; modelUsed: string }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const theme = computeTheme(brandFieldsForTheme(params.prospect.brand_profile));
  const prospectForPrompt: Parameters<typeof buildUserPrompt>[1] = {
    name: params.prospect.name,
    company: params.prospect.company,
    role: params.prospect.role ?? undefined,
    industry: params.prospect.industry ?? undefined,
    company_size: params.prospect.company_size ?? undefined,
    email_notes: params.prospect.email_notes ?? undefined,
    url: params.prospect.url ?? undefined,
  };
  const templateForPrompt = {
    blocks: params.template.blocks as unknown[],
    content_assets: params.template.content_assets as unknown[],
    copy_slots: params.template.copy_slots as string[],
    constraints: typeof params.template.constraints === 'string' ? params.template.constraints : '',
  };
  const baseUser = buildUserPrompt(templateForPrompt, prospectForPrompt, theme);
  const maxAttempts = 3;
  let lastIssue = '';
  let modelUsed = params.openRouterModel;
  const responseFormat = getFluxGenerateOpenRouterResponseFormat();

  if (!Array.isArray(params.template.blocks) || params.template.blocks.length === 0) {
    return {
      ok: true,
      pageConfig: {
        theme,
        prospectName: params.prospect.name,
        companyName: params.prospect.company,
        blocks: [],
      },
      modelUsed: params.openRouterModel,
    };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const repairHint =
      attempt > 0 && lastIssue
        ? `\n\nValidation errors to fix (from your previous reply):\n${lastIssue}\n\nReturn ONLY valid JSON matching the schema, with the same block ids, types, and order as the template.`
        : '';
    const user = attempt === 0 ? baseUser : `${baseUser}${repairHint}`;

    const r = await openRouterChatWithModelFallbacks({
      apiKey: params.openRouterApiKey,
      model: params.openRouterModel,
      system: SYSTEM_PROMPT,
      user,
      referer: params.openRouterReferer,
      title: params.openRouterTitle,
      responseFormat,
    });
    if (!r.ok) {
      return {
        ok: false,
        status: 502,
        body: {
          error: 'LLM request failed',
          details: r.details,
          code: 'LLM_UPSTREAM_ERROR',
          model: r.modelTried,
        },
      };
    }
    modelUsed = r.modelUsed;
    const jsonStr = extractJsonObjectFromLlmText(r.text);
    if (!jsonStr) {
      lastIssue = 'No JSON object in model response';
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e: unknown) {
      lastIssue = e instanceof Error ? e.message : 'JSON parse error';
      continue;
    }
    parsed = normalizeFluxLlmPageConfigBeforeZod(parsed);
    const zr = pageConfigSchema.safeParse(parsed);
    if (!zr.success) {
      lastIssue = formatZodIssuesForRepair(zr.error);
      continue;
    }
    const merged = mergeGeneratedPageConfigWithTemplate({
      templateBlocks: params.template.blocks as unknown[],
      llmPageConfig: zr.data,
      serverTheme: theme,
      prospectName: params.prospect.name,
      companyName: params.prospect.company,
    });
    const semanticIssues = getMergedFluxPageConfigSemanticIssues(merged, params.template.content_assets);
    if (semanticIssues.length > 0) {
      lastIssue = formatMergedFluxSemanticIssuesForRepair(semanticIssues);
      continue;
    }
    return { ok: true, pageConfig: merged, modelUsed };
  }

  return {
    ok: false,
    status: 422,
    body: {
      error: 'Page config validation failed',
      details: lastIssue,
      code: 'INVALID_PAGE_CONFIG',
      model: modelUsed,
    },
  };
}

export const handler = async (event: any) => {
  try {
    return await handleRequest(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fluxGenerate] unhandled', err);
    return response(500, { error: 'Internal error', details: message, code: 'UNHANDLED' });
  }
};

async function handleRequest(event: any) {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  const openRouterModel = process.env.FLUX_OPENROUTER_MODEL ?? 'anthropic/claude-opus-4.7';
  const openRouterReferer = process.env.FLUX_OPENROUTER_HTTP_REFERER?.trim();
  const openRouterTitle = process.env.FLUX_OPENROUTER_TITLE?.trim();

  if (!supabaseUrl || !supabaseSecretKey || !openRouterApiKey) {
    return response(500, { error: 'Missing environment configuration' });
  }

  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // Auth: validate Bearer token
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return response(401, { error: 'Missing authorization token' });
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseSecretKey);
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return response(401, { error: 'Invalid token' });
  }

  // Check flux access flag
  const { data: flagRow } = await supabaseAuth
    .from('user_access_flags')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('flag_key', FLUX_FLAG_KEY)
    .maybeSingle();
  if (!flagRow) {
    return response(403, { error: 'Flux access denied' });
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(typeof event.body === 'string' ? event.body : JSON.stringify(event.body));
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }
  if (!rawBody || typeof rawBody !== 'object') {
    return response(400, { error: 'Invalid JSON body' });
  }
  const body = rawBody as Record<string, unknown>;

  const db = createClient(supabaseUrl, supabaseSecretKey);

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
  if (!campaignId) {
    return response(400, { error: 'Missing campaignId' });
  }

  const access = await assertUserCanAccessCampaign(db, user.id, campaignId);
  if (!access.ok) {
    return response(access.status, access.body);
  }

  const prospectId = typeof body.prospectId === 'string' ? body.prospectId.trim() : '';
  const hasInlineProspect =
    body.prospect != null && typeof body.prospect === 'object' && !Array.isArray(body.prospect);
  const previewRejected =
    body.preview === false ||
    body.preview === 'false' ||
    body.preview === 0 ||
    body.preview === '0';
  const previewExplicit =
    body.preview === true ||
    body.preview === 'true' ||
    body.preview === 1 ||
    body.preview === '1';
  /** DB generate uses prospectId; preview uses inline prospect. Accept shape + loose `preview` so older proxies / clients still route correctly. */
  const isPreview =
    !previewRejected &&
    hasInlineProspect &&
    !prospectId &&
    (previewExplicit || body.preview == null);

  if (isPreview) {
    const prospectRaw = body.prospect as Record<string, unknown>;
    if (!prospectRaw || typeof prospectRaw !== 'object') {
      return response(400, { error: 'Missing prospect for preview', code: 'PREVIEW_NO_PROSPECT' });
    }
    const pr = prospectRaw;
    const name = typeof pr.name === 'string' ? pr.name.trim() : '';
    const company = typeof pr.company === 'string' ? pr.company.trim() : '';
    if (!name || !company) {
      return response(400, { error: 'Preview prospect requires name and company', code: 'PREVIEW_INVALID' });
    }

    const prospectInline: ProspectPromptShape = {
      name,
      company,
      role: typeof pr.role === 'string' ? pr.role : null,
      industry: typeof pr.industry === 'string' ? pr.industry : null,
      company_size: typeof pr.company_size === 'string' ? pr.company_size : null,
      email_notes: typeof pr.email_notes === 'string' ? pr.email_notes : null,
      url: typeof pr.url === 'string' ? pr.url : null,
      brand_profile: pr.brand_profile,
    };

    const { data: templateRaw, error: templateErr } = await db
      .from('flux_campaign_templates')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    if (templateErr) {
      return response(500, { error: 'Database error loading campaign template', details: templateErr.message });
    }
    if (!templateRaw) {
      return response(404, {
        error:
          'No campaign template row for this campaign_id. The app should call ensureFluxTemplateExists before generate.',
        code: 'NO_CAMPAIGN_TEMPLATE',
      });
    }

    let template = normalizeTemplateRow(templateRaw as Record<string, unknown>);
    const tplOverride = body.template;
    if (tplOverride && typeof tplOverride === 'object') {
      const o = tplOverride as Record<string, unknown>;
      template = normalizeTemplateRow({
        ...template,
        ...(Array.isArray(o.blocks) ? { blocks: o.blocks } : {}),
        ...(Array.isArray(o.content_assets) ? { content_assets: o.content_assets } : {}),
        ...(o.copy_slots != null ? { copy_slots: o.copy_slots } : {}),
        ...(typeof o.constraints === 'string' ? { constraints: o.constraints } : {}),
      } as Record<string, unknown>);
    }

    const llm = await runLlmPageConfig({
      template,
      prospect: prospectInline,
      openRouterApiKey,
      openRouterModel,
      openRouterReferer: openRouterReferer || undefined,
      openRouterTitle: openRouterTitle || undefined,
    });
    if (!llm.ok) {
      return response(llm.status, llm.body);
    }
    return response(200, {
      preview: true,
      pageConfig: llm.pageConfig,
      model: llm.modelUsed,
    });
  }

  if (!prospectId) {
    return response(400, {
      error: 'Missing prospectId',
      details:
        'Send { prospectId, campaignId } to persist a page, or { campaignId, prospect: { name, company, ... } } for preview (optional template override).',
      code: 'MISSING_PROSPECT_ID',
    });
  }

  const { data: templateRaw, error: templateErr } = await db
    .from('flux_campaign_templates')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (templateErr) {
    return response(500, { error: 'Database error loading campaign template', details: templateErr.message });
  }
  if (!templateRaw) {
    return response(404, {
      error:
        'No campaign template row for this campaign_id. The app should call ensureFluxTemplateExists before generate.',
      code: 'NO_CAMPAIGN_TEMPLATE',
    });
  }

  const template = normalizeTemplateRow(templateRaw as Record<string, unknown>);

  const { data: prospect, error: prospectErr } = await db
    .from('flux_prospects')
    .select('*')
    .eq('id', prospectId)
    .maybeSingle();
  if (prospectErr) {
    return response(500, { error: 'Database error loading prospect', details: prospectErr.message });
  }
  if (!prospect) {
    return response(404, { error: 'Prospect not found', code: 'NO_PROSPECT' });
  }

  if (prospect.campaign_id !== campaignId) {
    return response(400, { error: 'prospectId does not belong to campaignId', code: 'MISMATCH' });
  }

  const llm = await runLlmPageConfig({
    template,
    prospect: prospect as ProspectPromptShape,
    openRouterApiKey,
    openRouterModel,
    openRouterReferer: openRouterReferer || undefined,
    openRouterTitle: openRouterTitle || undefined,
  });
  if (!llm.ok) {
    return response(llm.status, llm.body);
  }
  const pageConfig = llm.pageConfig;

  const { data: existingPage } = await db
    .from('flux_prospect_pages')
    .select('id')
    .eq('prospect_id', prospectId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (existingPage) {
    const { data: updated, error: updateErr } = await db
      .from('flux_prospect_pages')
      .update({ page_config: pageConfig })
      .eq('id', existingPage.id)
      .select('id, slug, status')
      .single();
    if (updateErr) return response(500, { error: updateErr.message });
    return response(200, { pageId: updated.id, slug: updated.slug, status: updated.status });
  }

  return response(404, {
    error: 'No prospect page row for this prospect and campaign. Create a flux_prospect_pages row (slug) before calling generate.',
    code: 'NO_PROSPECT_PAGE',
  });
}

function response(statusCode: number, body: any) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}
