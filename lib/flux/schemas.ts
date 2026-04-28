import { z } from 'zod';
import { FLUX_BLOCK_STYLE_PRESETS } from './fluxPresentationTokens';

// ---------------------------------------------------------------------------
// Block prop schemas
// ---------------------------------------------------------------------------

const heroBlockPropsSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  ctaText: z.string(),
  ctaUrl: z.string(),
  heroImageUrl: z.string().optional(),
});

const socialProofBlockPropsSchema = z.object({
  heading: z.string(),
  logos: z.array(z.object({
    name: z.string(),
    imageUrl: z.string().optional(),
  })),
});

const caseStudyBlockPropsSchema = z.object({
  assetId: z.string(),
  overrideTitle: z.string().optional(),
  overrideMetric: z.string().optional(),
});

const benefitItemSchema = z.object({
  title: z.string(),
  description: z.string(),
});

const benefitsBlockPropsSchema = z.object({
  heading: z.string(),
  items: z.array(benefitItemSchema),
});

const testimonialBlockPropsSchema = z.object({
  assetId: z.string(),
  overrideQuote: z.string().optional(),
  overrideAttribution: z.string().optional(),
});

const ctaBlockPropsSchema = z.object({
  headline: z.string(),
  ctaText: z.string(),
  ctaUrl: z.string(),
});

const tannersTaxQualificationModeSchema = z.enum(['passive', 'reps', 'str']);

const tannersTaxStrategyBlockPropsSchema = z.object({
  heading: z.string(),
  subheadline: z.string().optional(),
  disclaimer: z.string(),
  ctaText: z.string().optional(),
  ctaUrl: z.string().optional(),
  defaultPurchasePrice: z.number().optional(),
  defaultLandValue: z.number().optional(),
  defaultMarginalTaxPercent: z.number().optional(),
  defaultQualificationMode: tannersTaxQualificationModeSchema.optional(),
});

const socialMediaPlanDaySchema = z.object({
  platform: z.string(),
  post_type: z.string(),
  hook: z.string(),
  cta: z.string().optional(),
});

const socialMediaPlanWeekSchema = z.object({
  theme: z.string(),
  days: z.array(socialMediaPlanDaySchema),
});

const socialMediaPlanBlockPropsSchema = z.object({
  inferred_vertical: z.string(),
  inferred_vertical_rationale: z.string(),
  positioning_summary: z.string(),
  weeks: z.array(socialMediaPlanWeekSchema),
  cta_ladder: z.array(z.string()),
  platform_mix_note: z.string(),
});

// ---------------------------------------------------------------------------
// Block schemas (discriminated union)
// ---------------------------------------------------------------------------

const blockBase = {
  id: z.string(),
  order: z.number(),
};

const heroBlockSchema = z.object({
  ...blockBase,
  type: z.literal('hero'),
  props: heroBlockPropsSchema,
});

const socialProofBlockSchema = z.object({
  ...blockBase,
  type: z.literal('social_proof'),
  props: socialProofBlockPropsSchema,
});

const caseStudyBlockSchema = z.object({
  ...blockBase,
  type: z.literal('case_study'),
  props: caseStudyBlockPropsSchema,
});

const benefitsBlockSchema = z.object({
  ...blockBase,
  type: z.literal('benefits'),
  props: benefitsBlockPropsSchema,
});

const testimonialBlockSchema = z.object({
  ...blockBase,
  type: z.literal('testimonial'),
  props: testimonialBlockPropsSchema,
});

const ctaBlockSchema = z.object({
  ...blockBase,
  type: z.literal('cta'),
  props: ctaBlockPropsSchema,
});

const tannersTaxStrategyBlockSchema = z.object({
  ...blockBase,
  type: z.literal('tanners_tax_strategy'),
  props: tannersTaxStrategyBlockPropsSchema,
});

const socialMediaPlanBlockSchema = z.object({
  ...blockBase,
  type: z.literal('social_media_plan'),
  props: socialMediaPlanBlockPropsSchema,
});

export const blockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  socialProofBlockSchema,
  caseStudyBlockSchema,
  benefitsBlockSchema,
  testimonialBlockSchema,
  ctaBlockSchema,
  tannersTaxStrategyBlockSchema,
  socialMediaPlanBlockSchema,
]);

// ---------------------------------------------------------------------------
// Theme + PageConfig
// ---------------------------------------------------------------------------

export const themeConfigSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  fontFamily: z.string(),
  logoUrl: z.string().optional(),
  blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
});

export const pageConfigSchema = z.object({
  theme: themeConfigSchema,
  prospectName: z.string(),
  companyName: z.string(),
  blocks: z.array(blockSchema),
});

// ---------------------------------------------------------------------------
// Brand profile
// ---------------------------------------------------------------------------

export const brandProfileSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string().optional(),
  fontFamily: z.string().optional(),
  logoUrl: z.string().optional(),
  blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
});

// ---------------------------------------------------------------------------
// Content asset
// ---------------------------------------------------------------------------

export const contentAssetSchema = z.object({
  id: z.string(),
  type: z.enum(['case_study', 'testimonial', 'stat']),
  title: z.string(),
  body: z.string(),
  metric: z.string().optional(),
  attribution: z.string().optional(),
  imageUrl: z.string().optional(),
});
