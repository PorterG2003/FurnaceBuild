import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function openRouterChatCompletion(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  referer?: string;
  title?: string;
}): Promise<
  { ok: true; text: string } | { ok: false; details: string; httpStatus?: number }
> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (params.referer) headers['HTTP-Referer'] = params.referer;
  if (params.title) headers['X-OpenRouter-Title'] = params.title;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
        max_tokens: 4096,
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, details: msg };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errField = body.error;
    let msg = `HTTP ${res.status}`;
    if (typeof errField === 'string') msg = errField;
    else if (errField && typeof errField === 'object' && 'message' in errField) {
      const m = (errField as { message?: string }).message;
      if (typeof m === 'string') msg = m;
    }
    if (typeof body.message === 'string' && body.message) msg = body.message;
    return { ok: false, details: msg, httpStatus: res.status };
  }

  const choices = body.choices as Array<{ message?: { content?: string | null } }> | undefined;
  const text = choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    return { ok: false, details: 'OpenRouter response missing choices[0].message.content', httpStatus: res.status };
  }
  return { ok: true, text };
}

const OPENROUTER_MODEL_FALLBACKS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.5-sonnet-20240620',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
];

function shouldTryNextOpenRouterModel(r: { ok: false; details: string; httpStatus?: number }): boolean {
  const d = r.details;
  if (/no endpoints found/i.test(d)) return true;
  if (r.httpStatus === 429) return true;
  if (r.httpStatus === 503) return true;
  if (/rate limit|too many requests|overload|capacity|temporarily unavailable|try again/i.test(d)) {
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
    const r = await openRouterChatCompletion({ ...base, model });
    if (r.ok) return { ok: true, text: r.text, modelUsed: model };
    lastDetails = r.details;
    if (!shouldTryNextOpenRouterModel(r)) {
      return { ok: false, details: r.details, modelTried: model };
    }
  }
  return { ok: false, details: lastDetails, modelTried: lastTried };
}

const contentAssetSchema = z.object({
  id: z.string(),
  type: z.enum(['case_study', 'testimonial', 'stat']),
  title: z.string(),
  body: z.string(),
  metric: z.string().optional(),
  attribution: z.string().optional(),
  imageUrl: z.string().optional(),
});

const blockTypeSchema = z.enum([
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
  'tanners_tax_strategy',
  'social_media_plan',
]);

const fluxBlockStylePresetSchema = z.enum(['classic', 'glass', 'minimal']);
const fluxPageThemeSchema = z.enum(['prospect', 'seller', 'merge']);
const fluxBrandFieldSourceSchema = z.enum(['prospect', 'seller', 'merge']);
const fluxBrandingPolicySchema = z.object({
  v: z.literal(1),
  pageTheme: fluxPageThemeSchema,
  logoFrom: fluxBrandFieldSourceSchema.optional(),
  colorsFrom: fluxBrandFieldSourceSchema.optional(),
  fontFrom: fluxBrandFieldSourceSchema.optional(),
  blockStyleFrom: fluxBrandFieldSourceSchema.optional(),
});

const fluxEditorOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('campaign.setName'), value: z.string() }),
  z.object({ type: z.literal('campaign.setOfferDescription'), value: z.string() }),
  z.object({
    type: z.literal('block.add'),
    blockType: blockTypeSchema,
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('block.remove'), blockId: z.string().min(1) }),
  z.object({
    type: z.literal('block.updateProps'),
    blockId: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('block.reorder'),
    blockIds: z.array(z.string().min(1)),
  }),
  z.object({ type: z.literal('asset.add'), asset: contentAssetSchema }),
  z.object({ type: z.literal('asset.remove'), assetId: z.string().min(1) }),
  z.object({
    type: z.literal('asset.update'),
    assetId: z.string().min(1),
    patch: z.object({
      type: z.enum(['case_study', 'testimonial', 'stat']).optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      metric: z.string().nullable().optional(),
      attribution: z.string().nullable().optional(),
      imageUrl: z.string().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal('template.setCopySlots'),
    value: z.array(z.string()),
  }),
  z.object({ type: z.literal('template.setConstraints'), value: z.string() }),
  z.object({
    type: z.literal('preview.patchProspect'),
    patch: z.object({
      name: z.string().optional(),
      company: z.string().optional(),
      role: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      company_size: z.string().nullable().optional(),
      email_notes: z.string().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal('preview.patchBrand'),
    patch: z.object({
      primaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      fontFamily: z.string().optional(),
      logoUrl: z.string().optional(),
      blockStylePreset: fluxBlockStylePresetSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('seller.patchProfile'),
    patch: z.object({
      displayName: z.string().optional(),
      tagline: z.string().optional(),
      websiteUrl: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('seller.patchBrand'),
    patch: z.object({
      primaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      fontFamily: z.string().optional(),
      logoUrl: z.string().optional(),
      blockStylePreset: fluxBlockStylePresetSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('branding.setPolicy'),
    policy: fluxBrandingPolicySchema,
  }),
]);

const fluxEditorChatResponseSchema = z.object({
  assistantMessage: z.string(),
  operations: z.array(fluxEditorOperationSchema),
  summary: z.array(z.string()).optional(),
  requiresAiPreview: z.boolean().optional(),
});

const FLUX_FLAG_KEY = 'flux';

const SYSTEM_PROMPT = `You are a Flux campaign editor assistant. The user is designing a reverse lead magnet inside a reusable page template. Your job is not only to edit blocks: you must help the user think through the campaign methodology before the page is treated as ready.

Rules:
- Return ONLY valid JSON (no markdown fences) with this exact shape:
  {"assistantMessage": string, "operations": array, "summary"?: string[], "requiresAiPreview"?: boolean}
- "operations" is an ordered list of small edits. Each item is a discriminated object with "type" and fields as follows:
  - {"type":"campaign.setName","value":string}
  - {"type":"campaign.setOfferDescription","value":string}
  - {"type":"block.add","blockType":"hero"|"social_proof"|"case_study"|"benefits"|"testimonial"|"cta"|"tanners_tax_strategy"|"social_media_plan","index"?:number}
  - {"type":"block.remove","blockId":string}
  - {"type":"block.updateProps","blockId":string,"props":object} — merge props into the existing block; use only keys valid for that block type
  - {"type":"block.reorder","blockIds":string[]} — full permutation of existing ids
  - {"type":"asset.add","asset":{id,type,title,body,...}}
  - {"type":"asset.remove","assetId":string}
  - {"type":"asset.update","assetId":string,"patch":{title?,body?,metric?,attribution?,imageUrl?,type?}}
  - {"type":"template.setCopySlots","value":string[]} — field names the personalization LLM may rewrite
  - {"type":"template.setConstraints","value":string}
  - {"type":"preview.patchProspect","patch":{...partial prospect fields...}} — sample recipient only (not the seller)
  - {"type":"preview.patchBrand","patch":{primaryColor?,accentColor?,fontFamily?,logoUrl?,blockStylePreset?}} — preview recipient page chrome for template preview
  - {"type":"seller.patchProfile","patch":{displayName?,tagline?,websiteUrl?}} — organization running the campaign
  - {"type":"seller.patchBrand","patch":{primaryColor?,accentColor?,fontFamily?,logoUrl?,blockStylePreset?}} — seller's brand tokens
  - {"type":"branding.setPolicy","policy":{"v":1,"pageTheme":"prospect"|"seller"|"merge","logoFrom"?,"colorsFrom"?,"fontFrom"?,"blockStyleFrom"?}} — which side wins when merging seller + preview recipient brands for the preview

Actors (never conflate):
- **Seller** = seller_profile in the JSON + seller intel — who runs the campaign and whose offer/credibility is on the line.
- **PreviewRecipient** = preview_prospect — fictional or stand-in company/person to preview personalization only.

Methodology you should help the user define:
- WHO_ITS_FOR: the ICP / role / situation
- INPUTS: what the page already knows from the lead (URL, company, notes, etc.)
- DELIVERABLE: the tangible thing the reader gets in under ~60 seconds
- HOOK: why this decision-maker says yes now
- WOW: what makes the page feel bespoke
- 60S_TEST: the one thing the reader should understand or be able to do after a short scroll
- HONESTY: what must not be invented and how to handle missing facts

Conversation behavior:
- If one or more of those dimensions is still unclear and the user is ideating, ask 1-2 targeted questions in assistantMessage and return "operations": [].
- Once the user has given enough signal, consolidate the methodology into template.setConstraints using the section labels above. Keep the constraints readable and specific.
- When helpful, also update campaign.setOfferDescription, template.setCopySlots, blocks, and assets so the template matches the methodology.
- Prefer a small number of thoughtful edits over a giant speculative rewrite.
- If a high-quality result requires a block capability that Flux does not currently have, do NOT invent a new block type and do NOT fake it with weak generic blocks. Instead return "operations": [] and use assistantMessage with this exact prefix:
  Needs new block:
  Then explain:
  - the proposed block name
  - what the block should do
  - the inputs it needs
  - the output it should render
  - why the current block library is insufficient
  - that the user can come back after the block is built and continue this same chat thread

Copy / rewrite rules:
- Only suggest new marketing copy via block.updateProps on text fields that appear in the current copy_slots list (or obvious template text like headlines if copy_slots is empty and the user asked for copy).
- Do not invent block ids; use ids from the provided template blocks.
- Do not invent facts, customer logos, or metrics. If the user wants proof but none exists, use constraints or assets that honestly frame the limitation.
- If the user asks for broad personalization preview, set requiresAiPreview true when you change blocks, assets, copy_slots, constraints, or non-brand preview prospect fields (they will need "Rerender with AI" in the app).

If the user message is conversational with no edits, it is valid to return "operations": [].`;

function extractJsonObjectFromLlmText(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

const PROSPECT_PAGE_ALLOWED_OPERATION_TYPES = new Set<string>([
  'block.updateProps',
  'block.reorder',
  'preview.patchBrand',
  'preview.patchProspect',
]);

const PROSPECT_PAGE_SYSTEM_PROMPT = `You are a Flux assistant editing ONE personalized prospect landing page (already generated). The JSON editor state includes page_config (theme, prospect-facing names, blocks) and content_assets from the campaign (read-only catalog for case study/testimonial picks). When present, seller_profile and branding_policy are read-only context for the campaign runner — do NOT return seller.patchProfile, seller.patchBrand, or branding.setPolicy operations (they are not allowed in this mode).

Rules:
- Return ONLY valid JSON (no markdown fences) with shape {"assistantMessage": string, "operations": array, "summary"?: string[], "requiresAiPreview"?: boolean}
- Allowed operations ONLY:
  - {"type":"block.updateProps","blockId":string,"props":object} — merge props into the existing block; use only keys valid for that block type; do not invent block ids
  - {"type":"block.reorder","blockIds":string[]} — full permutation of existing block ids
  - {"type":"preview.patchBrand","patch":{primaryColor?,accentColor?,fontFamily?,logoUrl?,blockStylePreset?}}
  - {"type":"preview.patchProspect","patch":{name?,company?,...}} — prefer name/company for on-page personalization
- Do NOT use: campaign.*, template.*, asset.*, block.add, block.remove
- Do not invent facts, logos, or metrics. Keep URLs honest (http/https).
- Prefer a small number of targeted edits. If the user is only conversing, return "operations": [].
- If a capability is missing from Flux blocks, return operations: [] and prefix assistantMessage with: Needs new block:`;

async function assertUserCanAccessProspectPage(
  db: SupabaseClient,
  userId: string,
  prospectPageId: string,
  expectedCampaignId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data: page, error } = await db
    .from('flux_prospect_pages')
    .select('id, account_id, campaign_id')
    .eq('id', prospectPageId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Database error loading prospect page', details: error.message },
    };
  }
  if (!page) {
    return { ok: false, status: 404, body: { error: 'Prospect page not found', code: 'NO_PROSPECT_PAGE' } };
  }
  if ((page as { campaign_id: string }).campaign_id !== expectedCampaignId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'prospectPageId does not match campaignId', code: 'CAMPAIGN_MISMATCH' },
    };
  }
  const accountId = (page as { account_id: string }).account_id;
  const { data: membership } = await db
    .from('account_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!membership) {
    return { ok: false, status: 403, body: { error: 'Forbidden', code: 'PROSPECT_PAGE_ACCESS_DENIED' } };
  }
  return { ok: true };
}

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

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: unknown) => {
  try {
    return await handleRequest(event as Record<string, unknown>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fluxEditorChat] unhandled', err);
    return response(500, { error: 'Internal error', details: message, code: 'UNHANDLED' });
  }
};

async function handleRequest(event: Record<string, unknown>) {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  const openRouterModel = process.env.FLUX_OPENROUTER_MODEL ?? 'anthropic/claude-opus-4.7';
  const openRouterReferer = process.env.FLUX_OPENROUTER_HTTP_REFERER?.trim();
  const openRouterTitle = process.env.FLUX_OPENROUTER_TITLE?.trim();

  if (!supabaseUrl || !supabaseSecretKey || !openRouterApiKey) {
    return response(500, { error: 'Missing environment configuration' });
  }

  const method = (event.requestContext as { http?: { method?: string } } | undefined)?.http?.method
    ?? (event as { httpMethod?: string }).httpMethod
    ?? 'POST';
  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  const headers = (event.headers ?? {}) as Record<string, string>;
  const authHeader = headers.authorization || headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return response(401, { error: 'Missing authorization token' });
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseSecretKey);
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return response(401, { error: 'Invalid token' });
  }

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
    const b = (event as { body?: string }).body;
    rawBody = JSON.parse(typeof b === 'string' ? b : JSON.stringify(b ?? {}));
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }
  if (!rawBody || typeof rawBody !== 'object') {
    return response(400, { error: 'Invalid JSON body' });
  }
  const body = rawBody as Record<string, unknown>;

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
  if (!campaignId) {
    return response(400, { error: 'Missing campaignId' });
  }

  const prospectPageIdRaw = body.prospectPageId;
  const prospectPageId =
    typeof prospectPageIdRaw === 'string' ? prospectPageIdRaw.trim() : '';

  const db = createClient(supabaseUrl, supabaseSecretKey);
  if (prospectPageId) {
    const pageAccess = await assertUserCanAccessProspectPage(db, user.id, prospectPageId, campaignId);
    if (!pageAccess.ok) {
      return response(pageAccess.status, pageAccess.body);
    }
  } else {
    const access = await assertUserCanAccessCampaign(db, user.id, campaignId);
    if (!access.ok) {
      return response(access.status, access.body);
    }
  }

  const messagesRaw = body.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return response(400, { error: 'Missing messages', code: 'NO_MESSAGES' });
  }

  const editor = body.editor;
  if (!editor || typeof editor !== 'object' || Array.isArray(editor)) {
    return response(400, { error: 'Missing editor snapshot', code: 'NO_EDITOR' });
  }

  const lastUser = [...messagesRaw].reverse().find((m) => {
    if (!m || typeof m !== 'object') return false;
    return (m as { role?: string }).role === 'user';
  });
  const lastUserContent =
    lastUser && typeof lastUser === 'object' && typeof (lastUser as { content?: string }).content === 'string'
      ? (lastUser as { content: string }).content
      : '';
  if (!lastUserContent.trim()) {
    return response(400, { error: 'Last user message required', code: 'NO_USER_TEXT' });
  }

  const transcript = messagesRaw
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const o = m as { role?: string; content?: string };
      return { role: o.role ?? 'user', content: typeof o.content === 'string' ? o.content : '' };
    })
    .slice(-12);

  const userPayload = `Current editor state (JSON):\n${JSON.stringify(editor, null, 2)}\n\nRecent messages (JSON):\n${JSON.stringify(transcript, null, 2)}\n\nRespond to the latest user request.`;

  const systemPrompt = prospectPageId ? PROSPECT_PAGE_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const r = await openRouterChatWithModelFallbacks({
    apiKey: openRouterApiKey,
    model: openRouterModel,
    system: systemPrompt,
    user: userPayload,
    referer: openRouterReferer || undefined,
    title: openRouterTitle || undefined,
  });

  if (!r.ok) {
    return response(502, {
      error: 'LLM request failed',
      details: r.details,
      code: 'LLM_UPSTREAM_ERROR',
      model: r.modelTried,
    });
  }

  const jsonStr = extractJsonObjectFromLlmText(r.text);
  if (!jsonStr) {
    return response(422, { error: 'No JSON in model response', code: 'NO_JSON' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: unknown) {
    return response(422, {
      error: 'JSON parse error',
      details: e instanceof Error ? e.message : String(e),
      code: 'JSON_PARSE',
    });
  }

  const zr = fluxEditorChatResponseSchema.safeParse(parsed);
  if (!zr.success) {
    return response(422, {
      error: 'Response validation failed',
      details: zr.error.message,
      code: 'INVALID_RESPONSE',
    });
  }

  let operations = zr.data.operations;
  if (prospectPageId) {
    operations = operations.filter((op) => PROSPECT_PAGE_ALLOWED_OPERATION_TYPES.has(op.type));
  }

  return response(200, {
    assistantMessage: zr.data.assistantMessage,
    operations,
    summary: zr.data.summary,
    requiresAiPreview: zr.data.requiresAiPreview,
    model: r.modelUsed,
  });
}
