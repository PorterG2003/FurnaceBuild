import { z } from 'zod';
import { contentAssetSchema } from '@/lib/flux/schemas';
import { FLUX_BLOCK_STYLE_PRESETS } from '@/lib/flux/fluxPresentationTokens';

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
]);

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

export const fluxEditorChatResponseSchema = z.object({
  assistantMessage: z.string(),
  operations: z.array(fluxEditorOperationSchema),
  summary: z.array(z.string()).optional(),
  requiresAiPreview: z.boolean().optional(),
});

export type FluxEditorChatResponse = z.infer<typeof fluxEditorChatResponseSchema>;

export function parseFluxEditorOperations(
  raw: unknown,
): { ok: true; operations: FluxEditorOperation[] } | { ok: false; error: string } {
  const arr = z.array(fluxEditorOperationSchema).safeParse(raw);
  if (!arr.success) {
    return { ok: false, error: arr.error.message };
  }
  return { ok: true, operations: arr.data };
}
