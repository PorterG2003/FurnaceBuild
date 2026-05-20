import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  formatZodIssuesForRepair,
  normalizeFluxLlmPageConfigBeforeZod,
  pageConfigSchema,
} from '../../../lib/flux/fluxGeneratePageConfigSchema';
import { coercePageConfig } from '../../../lib/flux/coercePageConfig';
import { mergeGeneratedPageConfigWithTemplate } from '../../../lib/flux/mergeGeneratedPageConfig';
import {
  formatMergedFluxSemanticIssuesForRepair,
  getMergedFluxPageConfigSemanticIssues,
} from '../../../lib/flux/validateMergedFluxPageConfig';
import { computeTheme } from '../../../lib/flux/computeTheme';
import { mergeBrandProfileWithWebsiteIntel } from '../../../lib/flux/mergeBrandProfileWithWebsiteIntel';
import { resolveFluxPageBrandInputs } from '../../../lib/flux/resolveFluxPageBrandInputs';
import { normalizeFluxBrandingPolicy } from '../../../lib/flux/fluxBrandingPolicy';
import { formatFluxCopyBudgetsForPrompt } from '../../../lib/flux/fluxCopyBudgets';
import {
  openRouterChatWithModelFallbacks,
  type OpenRouterResponseFormat,
} from '../../../lib/flux/openRouterChat';
import { extractJsonObjectFromLlmText } from '../../../lib/flux/extractJsonObjectFromLlmText';

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
// Prompt builder
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a conversion landing page personalizer. You receive a campaign template (blocks with base copy), prospect context (the page recipient), and optional Seller context (the organization running the campaign). Your job:
- Never confuse Seller with Prospect: all personalized copy speaks to the Prospect; use Seller only for voice, credibility, and offer framing when Seller context is provided.
- Rewrite the copy_slots to speak directly to this prospect (when copy_slots is empty, still fill every visible marketing string in block props from prospect context—no blank or placeholder copy)
- Prefer **tight** marketing copy: short sentences, one idea per line where possible, and headlines that would fit a mobile hero without long wraps. Follow the Copy length section's **Target** values as your default; do not pad or elaborate to fill space.
- Select the most relevant content_assets for case study / testimonial blocks: props.assetId must be an exact "id" from content_assets of matching type when such assets exist; if there are none of that type, set assetId to "" (empty block)
- Return a complete PageConfig JSON
- Pick theme.blockStylePreset from exactly one of: "classic", "minimal", "elevated", "soft". These are full layout systems, not just colors: classic = centered marketing sections, minimal = editorial/enterprise layouts, elevated = modern SaaS split panels and feature cards, soft = approachable conversational panels.

Do NOT add, remove, or reorder blocks. Work strictly within the template structure.
Every block from the template MUST appear in your output with the same id, type, and order.

For tanners_tax_strategy blocks only: if you set props.defaultQualificationMode, it MUST be exactly one of: "passive", "reps", or "str" (never "active" or other labels—use "reps" for real-estate-professional-style qualification).

For social_media_plan blocks: keep props.weeks as a calendar (each week has theme + days with platform, post_type, hook, optional cta). Set inferred_vertical and inferred_vertical_rationale from real prospect signals (no invented proof). Keep cta_ladder as an ordered escalation and platform_mix_note as one concrete sentence on channel mix.

For quiz_and_book blocks: preserve the quiz structure from the template. Keep every question id, question.type, question order, option id, calendlyUrl, and destinationEmail aligned with the template. You may rewrite only visible copy such as heading, subheading, question.prompt, question.helperText, question.placeholder, option labels, summaryHeading, and summaryBody.`;

function buildUserPrompt(
  template: { blocks: unknown[]; content_assets: unknown[]; copy_slots: string[]; constraints: string },
  prospect: {
    name: string;
    company: string;
    role?: string;
    industry?: string;
    company_size?: string;
    email_notes?: string;
    url?: string;
    website_intel?: WebsiteIntelPromptShape | null;
  },
  theme: ReturnType<typeof computeTheme>,
  sellerSection?: string,
) {
  const copySlotSection = template.copy_slots.length
    ? `Fields you MUST personalize (copy_slots): ${template.copy_slots.join(', ')}`
    : `There is no copy_slots list: still rewrite every user-visible string in each block's props using the prospect context. Do not leave empty strings for hero/CTA headlines, subheadlines, CTA labels, benefit titles/descriptions, or other body copy—replace template placeholders with real copy.`;
  const websiteIntelSection = prospect.website_intel
    ? `Website intelligence (evidence-backed; do not invent facts beyond this):
${JSON.stringify(
  {
    normalized_domain_key: prospect.website_intel.normalized_domain_key ?? null,
    final_url: prospect.website_intel.final_url ?? null,
    business_summary: prospect.website_intel.extracted_profile?.business_summary ?? null,
    brand_name: prospect.website_intel.extracted_profile?.brand_name ?? null,
    services: prospect.website_intel.extracted_profile?.services ?? [],
    audience_segments: prospect.website_intel.extracted_profile?.audience_segments ?? [],
    industries_served: prospect.website_intel.extracted_profile?.industries_served ?? [],
    locations_served: prospect.website_intel.extracted_profile?.locations_served ?? [],
    tone: prospect.website_intel.extracted_profile?.tone ?? null,
    confidence: prospect.website_intel.extracted_profile?.confidence ?? 'low',
    evidence_urls: prospect.website_intel.extracted_profile?.evidence_urls ?? [],
    hero_image_candidates: prospect.website_intel.hero_image_candidates ?? [],
  },
  null,
  2,
)}`
    : 'Website intelligence: (none)';
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

${websiteIntelSection}
${sellerSection ? `${sellerSection}\n` : ''}
Theme to use:
${JSON.stringify(theme, null, 2)}

${formatFluxCopyBudgetsForPrompt()}

Return ONLY valid JSON matching this schema:
{
  "theme": { "primaryColor": string, "accentColor": string, "backgroundColor": string, "textColor": string, "fontFamily": string, "logoUrl"?: string, "blockStylePreset"?: "classic" | "minimal" | "elevated" | "soft" },
  "prospectName": string,
  "companyName": string,
  "blocks": [ { "id": string, "type": string, "order": number, "props": { ... } }, ... ]
}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const FLUX_FLAG_KEY = 'flux';
const MAX_INLINE_WEBSITE_INTEL_BYTES = 12 * 1024;

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

type NormalizedTemplate = ReturnType<typeof normalizeTemplateRow>;

type WebsiteIntelPromptShape = {
  normalized_domain_key?: string | null;
  site_assets?: {
    logo_candidates?: string[];
    theme_color?: string | null;
    brand_color_candidates?: string[];
  } | null;
  extracted_profile?: {
    business_summary?: string | null;
    brand_name?: string | null;
    audience_segments?: string[];
    services?: string[];
    industries_served?: string[];
    locations_served?: string[];
    tone?: string | null;
    confidence?: 'low' | 'medium' | 'high';
    evidence_urls?: string[];
  } | null;
  hero_image_candidates?: string[];
  final_url?: string | null;
};

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
  website_intel?: WebsiteIntelPromptShape | null;
};

/** Campaign runner — DB row fields or preview body override. */
type CampaignSellerContext = {
  displayName: string;
  tagline: string;
  websiteUrl: string;
  sellerBrandProfile: unknown;
  sellerWebsiteIntel: unknown;
  brandingPolicy: unknown;
};

function buildSellerPromptSection(ctx: CampaignSellerContext | null | undefined): string | undefined {
  if (!ctx) return undefined;
  const intel = parseWebsiteIntelSnapshot(ctx.sellerWebsiteIntel);
  const websiteIntelSection = intel
    ? `Seller website intelligence (evidence-backed; do not invent facts beyond this):
${JSON.stringify(
  {
    normalized_domain_key: intel.normalized_domain_key ?? null,
    final_url: intel.final_url ?? null,
    business_summary: intel.extracted_profile?.business_summary ?? null,
    brand_name: intel.extracted_profile?.brand_name ?? null,
    services: intel.extracted_profile?.services ?? [],
    audience_segments: intel.extracted_profile?.audience_segments ?? [],
    industries_served: intel.extracted_profile?.industries_served ?? [],
    locations_served: intel.extracted_profile?.locations_served ?? [],
    tone: intel.extracted_profile?.tone ?? null,
    confidence: intel.extracted_profile?.confidence ?? 'low',
    evidence_urls: intel.extracted_profile?.evidence_urls ?? [],
    hero_image_candidates: intel.hero_image_candidates ?? [],
  },
  null,
  2,
)}`
    : 'Seller website intelligence: (none)';
  return `Seller (organization running this campaign — not the page recipient):
Display name: ${ctx.displayName || '(none)'}
Tagline: ${ctx.tagline || '(none)'}
Website: ${ctx.websiteUrl || '(none)'}
${websiteIntelSection}
Branding policy (controls merged page chrome): ${JSON.stringify(normalizeFluxBrandingPolicy(ctx.brandingPolicy), null, 2)}`;
}

function campaignRowToSellerContext(row: Record<string, unknown>): CampaignSellerContext {
  return {
    displayName: typeof row.seller_display_name === 'string' ? row.seller_display_name : '',
    tagline: typeof row.seller_tagline === 'string' ? row.seller_tagline : '',
    websiteUrl: typeof row.seller_website_url === 'string' ? row.seller_website_url : '',
    sellerBrandProfile: row.seller_brand_profile ?? null,
    sellerWebsiteIntel: row.seller_website_intel_snapshot ?? null,
    brandingPolicy: row.branding_policy ?? null,
  };
}

function mergeSellerPreviewOverrides(
  base: CampaignSellerContext | null,
  bodySeller: unknown,
  bodyPolicy: unknown,
): CampaignSellerContext | null {
  const hadBase = base != null;
  const hadBodySeller = bodySeller != null && typeof bodySeller === 'object' && !Array.isArray(bodySeller);
  const hadBodyPolicy = bodyPolicy !== undefined && bodyPolicy !== null;
  if (!hadBase && !hadBodySeller && !hadBodyPolicy) return null;

  let ctx: CampaignSellerContext = base ?? {
    displayName: '',
    tagline: '',
    websiteUrl: '',
    sellerBrandProfile: null,
    sellerWebsiteIntel: null,
    brandingPolicy: null,
  };
  if (hadBodySeller) {
    const b = bodySeller as Record<string, unknown>;
    ctx = {
      displayName: typeof b.displayName === 'string' ? b.displayName : ctx.displayName,
      tagline: typeof b.tagline === 'string' ? b.tagline : ctx.tagline,
      websiteUrl: typeof b.websiteUrl === 'string' ? b.websiteUrl : ctx.websiteUrl,
      sellerBrandProfile: b.brand_profile !== undefined ? b.brand_profile : ctx.sellerBrandProfile,
      sellerWebsiteIntel: b.website_intel !== undefined ? b.website_intel : ctx.sellerWebsiteIntel,
      brandingPolicy: ctx.brandingPolicy,
    };
  }
  if (hadBodyPolicy) {
    ctx = { ...ctx, brandingPolicy: bodyPolicy };
  }
  return { ...ctx, brandingPolicy: normalizeFluxBrandingPolicy(ctx.brandingPolicy) as unknown };
}

function trimStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, limit);
}

function parseWebsiteIntelSnapshot(raw: unknown): WebsiteIntelPromptShape | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const extractedRaw =
    obj.extracted_profile && typeof obj.extracted_profile === 'object' && !Array.isArray(obj.extracted_profile)
      ? (obj.extracted_profile as Record<string, unknown>)
      : null;
  return {
    normalized_domain_key: typeof obj.normalized_domain_key === 'string' ? obj.normalized_domain_key : null,
    site_assets:
      obj.site_assets && typeof obj.site_assets === 'object' && !Array.isArray(obj.site_assets)
        ? {
            logo_candidates: trimStringArray((obj.site_assets as Record<string, unknown>).logo_candidates, 5),
            theme_color:
              typeof (obj.site_assets as Record<string, unknown>).theme_color === 'string'
                ? String((obj.site_assets as Record<string, unknown>).theme_color)
                : null,
            brand_color_candidates: trimStringArray(
              (obj.site_assets as Record<string, unknown>).brand_color_candidates,
              6,
            ),
          }
        : null,
    extracted_profile: extractedRaw
      ? {
          business_summary:
            typeof extractedRaw.business_summary === 'string' ? extractedRaw.business_summary : null,
          brand_name: typeof extractedRaw.brand_name === 'string' ? extractedRaw.brand_name : null,
          audience_segments: trimStringArray(extractedRaw.audience_segments, 6),
          services: trimStringArray(extractedRaw.services, 8),
          industries_served: trimStringArray(extractedRaw.industries_served, 6),
          locations_served: trimStringArray(extractedRaw.locations_served, 6),
          tone: typeof extractedRaw.tone === 'string' ? extractedRaw.tone : null,
          confidence:
            extractedRaw.confidence === 'low' ||
            extractedRaw.confidence === 'medium' ||
            extractedRaw.confidence === 'high'
              ? extractedRaw.confidence
              : 'low',
          evidence_urls: trimStringArray(extractedRaw.evidence_urls, 6),
        }
      : null,
    hero_image_candidates: trimStringArray(obj.hero_image_candidates, 5),
    final_url: typeof obj.final_url === 'string' ? obj.final_url : null,
  };
}

function pickServerHeroImageUrl(websiteIntel: WebsiteIntelPromptShape | null): string | null {
  return websiteIntel?.hero_image_candidates?.[0] ?? null;
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

async function runLlmPageConfig(params: {
  template: NormalizedTemplate;
  prospect: ProspectPromptShape;
  campaignSeller?: CampaignSellerContext | null;
  existingPageConfig?: import('../../../lib/flux/types').PageConfig | null;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterReferer?: string;
  openRouterTitle?: string;
}): Promise<
  | { ok: true; pageConfig: z.infer<typeof pageConfigSchema>; modelUsed: string }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const websiteIntel = parseWebsiteIntelSnapshot(params.prospect.website_intel);
  const prospectMerged = mergeBrandProfileWithWebsiteIntel(
    params.prospect.brand_profile as any,
    websiteIntel as any,
  );
  const sellerCtx = params.campaignSeller;
  const sellerIntelParsed = sellerCtx ? parseWebsiteIntelSnapshot(sellerCtx.sellerWebsiteIntel) : null;
  const sellerMerged = sellerCtx
    ? mergeBrandProfileWithWebsiteIntel(sellerCtx.sellerBrandProfile as any, sellerIntelParsed as any)
    : null;
  const policy = sellerCtx ? normalizeFluxBrandingPolicy(sellerCtx.brandingPolicy) : null;
  const resolvedBrand =
    sellerCtx && sellerMerged && policy
      ? resolveFluxPageBrandInputs({ policy, prospectBrand: prospectMerged, sellerBrand: sellerMerged })
      : prospectMerged;
  const theme = computeTheme(resolvedBrand);
  const prospectForPrompt: Parameters<typeof buildUserPrompt>[1] = {
    name: params.prospect.name,
    company: params.prospect.company,
    role: params.prospect.role ?? undefined,
    industry: params.prospect.industry ?? undefined,
    company_size: params.prospect.company_size ?? undefined,
    email_notes: params.prospect.email_notes ?? undefined,
    url: params.prospect.url ?? undefined,
    website_intel: websiteIntel,
  };
  const templateForPrompt = {
    blocks: params.template.blocks as unknown[],
    content_assets: params.template.content_assets as unknown[],
    copy_slots: params.template.copy_slots as string[],
    constraints: typeof params.template.constraints === 'string' ? params.template.constraints : '',
  };
  const sellerSection = buildSellerPromptSection(params.campaignSeller ?? null);
  const baseUser = buildUserPrompt(templateForPrompt, prospectForPrompt, theme, sellerSection);
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
      serverHeroImageUrl: pickServerHeroImageUrl(websiteIntel),
      existingPageConfig: params.existingPageConfig ?? null,
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
      website_intel: null,
    };
    if (pr.website_intel != null) {
      const bytes = JSON.stringify(pr.website_intel).length;
      if (bytes > MAX_INLINE_WEBSITE_INTEL_BYTES) {
        return response(400, {
          error: 'Preview website_intel is too large',
          code: 'PREVIEW_WEBSITE_INTEL_TOO_LARGE',
        });
      }
      prospectInline.website_intel = parseWebsiteIntelSnapshot(pr.website_intel);
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

    const { data: campaignRow, error: campLoadErr } = await db
      .from('flux_campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle();
    if (campLoadErr) {
      return response(500, { error: 'Database error loading campaign', details: campLoadErr.message });
    }
    const campaignSeller = mergeSellerPreviewOverrides(
      campaignRow ? campaignRowToSellerContext(campaignRow as Record<string, unknown>) : null,
      body.seller_profile,
      body.branding_policy,
    );

    const llm = await runLlmPageConfig({
      template,
      prospect: prospectInline,
      campaignSeller,
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

  const { data: campaignRowForSeller, error: campaignRowErr } = await db
    .from('flux_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaignRowErr) {
    return response(500, { error: 'Database error loading campaign', details: campaignRowErr.message });
  }
  const campaignSellerPersisted = campaignRowForSeller
    ? campaignRowToSellerContext(campaignRowForSeller as Record<string, unknown>)
    : null;

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

  const { data: existingPageRow } = await db
    .from('flux_prospect_pages')
    .select('id, page_config')
    .eq('prospect_id', prospectId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  const existingPageConfig =
    existingPageRow?.page_config != null ? coercePageConfig(existingPageRow.page_config) : null;

  const llm = await runLlmPageConfig({
    template,
    prospect: {
      ...(prospect as ProspectPromptShape),
      website_intel: parseWebsiteIntelSnapshot((prospect as Record<string, unknown>).website_intel_snapshot),
    },
    campaignSeller: campaignSellerPersisted,
    existingPageConfig,
    openRouterApiKey,
    openRouterModel,
    openRouterReferer: openRouterReferer || undefined,
    openRouterTitle: openRouterTitle || undefined,
  });
  if (!llm.ok) {
    return response(llm.status, llm.body);
  }
  const pageConfig = llm.pageConfig;

  const existingPage = existingPageRow;

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
