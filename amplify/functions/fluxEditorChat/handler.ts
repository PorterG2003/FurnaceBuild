import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  fluxEditorChatResponseSchema,
  FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS,
} from '../../../lib/flux/editor/schemas';
import { openRouterChatWithModelFallbacks } from '../../../lib/flux/openRouterChat';
import { extractJsonObjectFromLlmText } from '../../../lib/flux/extractJsonObjectFromLlmText';

const FLUX_FLAG_KEY = 'flux';

const SYSTEM_PROMPT = `You are a Flux campaign editor assistant. The user is designing a reverse lead magnet inside a reusable page template. Your job is not only to edit blocks: you must help the user think through the campaign methodology before the page is treated as ready.

Rules:
- Return ONLY valid JSON (no markdown fences) with this exact shape:
  {"assistantMessage": string, "operations": array, "summary"?: string[], "requiresAiPreview"?: boolean}
- The response must be strict JSON: every property name must use double quotes, every string must use double quotes, there must be no trailing commas, and there must be no commentary outside the single JSON object.
- "operations" is an ordered list of small edits. Each item MUST be a JSON object with a "type" field (never a bare string, number, or null in this array). Shape per item:
  - {"type":"campaign.setName","value":string}
  - {"type":"campaign.setOfferDescription","value":string}
  - {"type":"block.add","blockType":${FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS},"index"?:number}
  - {"type":"block.remove","blockId":string}
  - {"type":"block.updateProps","blockId":string,"props":object} — merge props into the existing block; use only keys valid for that block type
  - {"type":"block.setScrollTag","blockId":string,"scrollTag":string|null} — set or clear the public section anchor for deep links / in-page CTAs (#fragment); null clears
  - {"type":"block.reorder","blockIds":string[]} — full permutation of existing ids
- Block type **competitor_ad_audit**: section that compares competitors using Google Ads Transparency. It supports \`discoveryMode: "local_places" | "curated_domains"\`. In the **template**, it is valid to edit \`props.heading\`, \`props.discoveryMode\`, \`props.curatedDomains\`, \`props.mapImageFit\`, and \`props.exampleImageFit\`. Use \`local_places\` for nearby-map discovery; use \`curated_domains\` for keyword-driven or national competitors and supply 3-12 real domains (optionally with \`name\`). Do not invent domains unless the user explicitly asks you to suggest or add them. Competitor rows, map images, and example creatives are still filled **per prospect** when someone runs **Run competitor audit** on the prospect page (requires a saved **service area** on that prospect; prospects may also override the curated domain list). Do not invent published competitors, map URLs, or transparency links. Do not set props.lastAuditDomainReport (legacy / internal); per-domain audit lines are stored on the job result, not in the published block.
  - Block type **quiz_and_book**: configurable multi-step quiz that ends in a summary screen and an inline Calendly step. Use block.add with blockType "quiz_and_book" when the user wants a questionnaire / quiz / qualifier / book-a-call flow. In block.updateProps, edit only top-level props and replace the full props.questions array when changing step order or question structure. Keep stable question ids for existing questions, keep question.type accurate, keep destinationEmail as an email or omit it, and keep calendlyUrl as a real http(s) URL. Do not invent hidden scoring or branching logic unless the user explicitly asks for it.
  - Block type **hero**: optional \`imageFit\` controls whether the hero image fills (\`cover\`) or fits (\`contain\`) within its frame.
  - Block type **social_proof**: optional \`imageFit\` controls whether logo images fill (\`cover\`) or fit (\`contain\`) within their frames.
  - Block type **case_study**: props.assetId must reference a case_study content asset when assets exist. Optional overrideTitle, overrideMetric, overrideImageUrl, and \`imageFit\` (block-level image URL and fit control for layouts that render an image).
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
- If a high-quality result requires a block capability that Flux does not currently have (see allowed blockType values on block.add), do NOT invent a new block type and do NOT fake it with weak generic blocks. Instead return "operations": [] and use assistantMessage with this exact prefix:
  Needs new block:
  Then explain:
  - the proposed block name
  - what the block should do
  - the inputs it needs
  - the output it should render
  - why the current block library is insufficient
  - that the user can come back after the block is built and continue this same chat thread
  (If the user wants competitor Google Ads comparison + maps, use block.add with blockType "competitor_ad_audit" — that capability exists; do not use "Needs new block" for that.)

Copy / rewrite rules:
- Only suggest new marketing copy via block.updateProps on text fields that appear in the current copy_slots list (or obvious template text like headlines if copy_slots is empty and the user asked for copy).
- Do not invent block ids; use ids from the provided template blocks.
- Do not invent facts, customer logos, or metrics. If the user wants proof but none exists, use constraints or assets that honestly frame the limitation.
- If the user asks for broad personalization preview, set requiresAiPreview true when you change blocks, assets, copy_slots, constraints, or non-brand preview prospect fields (they will need "Rerender with AI" in the app).

If the user message is conversational with no edits, it is valid to return "operations": [].`;

function formatFluxEditorChatValidationIssues(raw: string, maxLen = 700): string {
  return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
}

const PROSPECT_PAGE_ALLOWED_OPERATION_TYPES = new Set<string>([
  'block.updateProps',
  'block.setScrollTag',
  'block.reorder',
  'preview.patchBrand',
  'preview.patchProspect',
]);

const PROSPECT_PAGE_SYSTEM_PROMPT = `You are a Flux assistant editing ONE personalized prospect landing page (already generated). The JSON editor state includes page_config (theme, prospect-facing names, blocks) and content_assets from the campaign (read-only catalog for case study/testimonial picks). When present, seller_profile and branding_policy are read-only context for the campaign runner — do NOT return seller.patchProfile, seller.patchBrand, or branding.setPolicy operations (they are not allowed in this mode).

Rules:
- Return ONLY valid JSON (no markdown fences) with shape {"assistantMessage": string, "operations": array, "summary"?: string[], "requiresAiPreview"?: boolean}
- The response must be strict JSON: every property name must use double quotes, every string must use double quotes, there must be no trailing commas, and there must be no commentary outside the single JSON object.
- Allowed operations ONLY:
  - {"type":"block.updateProps","blockId":string,"props":object} — merge props into the existing block; use only keys valid for that block type; do not invent block ids
  - {"type":"block.setScrollTag","blockId":string,"scrollTag":string|null} — optional section anchor for in-page links; null clears; hero/cta URLs may use #fragment to scroll
  - {"type":"block.reorder","blockIds":string[]} — full permutation of existing block ids
  - {"type":"preview.patchBrand","patch":{primaryColor?,accentColor?,fontFamily?,logoUrl?,blockStylePreset?}}
  - {"type":"preview.patchProspect","patch":{name?,company?,...}} — prefer name/company for on-page personalization
- Do NOT use: campaign.*, template.*, asset.*, block.add, block.remove
- For **quiz_and_book** blocks in this mode, it is fine to adjust visible copy and configured questions via block.updateProps, but keep the flow linear and preserve existing question ids when rewriting prompts/options.
- Do not invent facts, logos, or metrics. Keep URLs honest (http/https or same-page anchors like #section when a matching scroll tag exists).
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

  const maxAttempts = 3;
  let lastIssue = '';
  let lastModel = openRouterModel;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const repairHint =
      attempt > 0 && lastIssue
        ? `\n\nYour previous reply was invalid. Fix these issues and return ONLY one strict JSON object:\n${lastIssue}\n\nRequirements reminder: every property name must be double-quoted, every string value must be double-quoted, and there can be no trailing commas.`
        : '';
    const r = await openRouterChatWithModelFallbacks({
      apiKey: openRouterApiKey,
      model: openRouterModel,
      system: systemPrompt,
      user: `${userPayload}${repairHint}`,
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
    lastModel = r.modelUsed;

    const jsonStr = extractJsonObjectFromLlmText(r.text);
    if (!jsonStr) {
      lastIssue = 'No JSON object found in the response.';
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e: unknown) {
      lastIssue = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }

    const zr = fluxEditorChatResponseSchema.safeParse(parsed);
    if (!zr.success) {
      lastIssue = formatFluxEditorChatValidationIssues(zr.error.message);
      continue;
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
      model: lastModel,
    });
  }

  return response(422, {
    error: 'Response validation failed',
    details: lastIssue || 'Unable to parse or validate model response',
    code: 'INVALID_RESPONSE',
    model: lastModel,
  });
}
