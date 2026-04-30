import { z } from 'zod';
import { contentAssetSchema } from '../schemas';
import { FLUX_BLOCK_STYLE_PRESETS } from '../fluxPresentationTokens';

const fluxPageThemeSchema = z.enum(['prospect', 'seller', 'merge']);
const fluxBrandFieldSourceSchema = z.enum(['prospect', 'seller', 'merge']);

export const fluxBrandingPolicySchema = z.object({
  v: z.literal(1),
  pageTheme: fluxPageThemeSchema,
  logoFrom: fluxBrandFieldSourceSchema.optional(),
  colorsFrom: fluxBrandFieldSourceSchema.optional(),
  fontFrom: fluxBrandFieldSourceSchema.optional(),
  blockStyleFrom: fluxBrandFieldSourceSchema.optional(),
});

export const blockTypeSchema = z.enum([
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
  'tanners_tax_strategy',
  'social_media_plan',
  'competitor_ad_audit',
]);

/**
 * Union fragment for LLM system prompts (e.g. `"hero"|"social_proof"`).
 * Stays aligned with {@link blockTypeSchema} — use this in `fluxEditorChat` instead of hand-maintaining lists.
 */
export const FLUX_EDITOR_CHAT_BLOCK_ADD_TYPE_ALTS = blockTypeSchema.options
  .map((t) => `"${t}"`)
  .join('|');

/** Remote + chat-validated editor operations (subset of internal reducer actions). */
export const fluxEditorOperationSchema = z.discriminatedUnion('type', [
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
      blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
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
      blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
    }),
  }),
  z.object({
    type: z.literal('branding.setPolicy'),
    policy: fluxBrandingPolicySchema,
  }),
]);

export type FluxEditorOperation = z.infer<typeof fluxEditorOperationSchema>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Models sometimes emit `operations` entries as bare strings or stringified JSON objects.
 * Strip junk; parse `"{...}"` when it decodes to a plain object.
 */
export function coerceFluxEditorOperationsArray(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    if (isPlainRecord(item)) {
      out.push(item);
      continue;
    }
    if (typeof item === 'string') {
      const t = item.trim();
      if (t.startsWith('{') && t.endsWith('}')) {
        try {
          const parsed = JSON.parse(t) as unknown;
          if (isPlainRecord(parsed)) {
            out.push(parsed);
          }
        } catch {
          /* drop */
        }
      }
    }
  }
  return out;
}

function normalizeFluxEditorChatLlmPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...o };
  if ('operations' in o) {
    next.operations = coerceFluxEditorOperationsArray(o.operations);
  }
  const am = o.assistantMessage;
  if (typeof am !== 'string') {
    if (typeof am === 'number' || typeof am === 'boolean') {
      next.assistantMessage = String(am);
    } else if (am == null) {
      next.assistantMessage = '';
    } else {
      next.assistantMessage = '';
    }
  }
  if (o.summary !== undefined) {
    if (!Array.isArray(o.summary)) {
      next.summary = undefined;
    } else {
      next.summary = o.summary.map((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
    }
  }
  if (o.requiresAiPreview !== undefined && typeof o.requiresAiPreview !== 'boolean') {
    next.requiresAiPreview = undefined;
  }
  return next;
}

export const fluxEditorChatResponseSchema = z.preprocess(
  normalizeFluxEditorChatLlmPayload,
  z.object({
    assistantMessage: z.string(),
    operations: z.array(fluxEditorOperationSchema),
    summary: z.array(z.string()).optional(),
    requiresAiPreview: z.boolean().optional(),
  }),
);

export type FluxEditorChatResponse = z.infer<typeof fluxEditorChatResponseSchema>;

export function parseFluxEditorOperations(
  raw: unknown,
): { ok: true; operations: FluxEditorOperation[] } | { ok: false; error: string } {
  const arr = z.array(fluxEditorOperationSchema).safeParse(coerceFluxEditorOperationsArray(raw));
  if (!arr.success) {
    return { ok: false, error: arr.error.message };
  }
  return { ok: true, operations: arr.data };
}
