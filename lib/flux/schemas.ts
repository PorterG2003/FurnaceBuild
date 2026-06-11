import { z } from 'zod';
import { FLUX_BLOCK_STYLE_PRESETS } from './fluxPresentationTokens';
import { QUIZ_AND_BOOK_QUESTION_TYPES } from './fluxQuizAndBook';

const fluxImageFitSchema = z.enum(['cover', 'contain']);

// ---------------------------------------------------------------------------
// Block prop schemas
// ---------------------------------------------------------------------------

const heroBlockPropsSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  ctaText: z.string(),
  ctaUrl: z.string(),
  heroImageUrl: z.string().optional(),
  imageFit: fluxImageFitSchema.optional(),
  heroPanelImageUrl: z.string().optional(),
  heroPanelLabel: z.string().optional(),
  heroPanelBody: z.string().optional(),
});

const socialProofBlockPropsSchema = z.object({
  heading: z.string(),
  logos: z.array(z.object({
    name: z.string(),
    imageUrl: z.string().optional(),
  })),
  imageFit: fluxImageFitSchema.optional(),
});

const caseStudyBlockPropsSchema = z.object({
  assetId: z.string(),
  overrideTitle: z.string().optional(),
  overrideMetric: z.string().optional(),
  overrideImageUrl: z.string().optional(),
  imageFit: fluxImageFitSchema.optional(),
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

const competitorAdExamplePropsSchema = z.object({
  headline: z.string(),
  body: z.string(),
  sourceUrl: z.string(),
  imageUrl: z.string().optional(),
});

const fluxCuratedDomainSeedSchema = z.object({
  domain: z.string(),
  name: z.string().optional(),
});

const competitorAdAuditRowPropsSchema = z.object({
  name: z.string(),
  mapImageUrl: z.string(),
  adsSummary: z.string(),
  examples: z.array(competitorAdExamplePropsSchema),
});

const competitorAdAuditBlockPropsSchema = z.object({
  heading: z.string(),
  discoveryMode: z.enum(['local_places', 'curated_domains']).optional(),
  curatedDomains: z.array(fluxCuratedDomainSeedSchema).optional(),
  status: z.enum(['pending', 'running', 'ready', 'error']),
  errorMessage: z.string().optional(),
  lastAuditDomainReport: z
    .string()
    .optional()
    .describe('Legacy; omitted on new audits. Full domain scan: flux_async_jobs.result for competitor_ad_audit.'),
  lastAuditAt: z.string().optional(),
  mapImageFit: fluxImageFitSchema.optional(),
  exampleImageFit: fluxImageFitSchema.optional(),
  advertiserLinkLabel: z.string().optional(),
  competitors: z.array(competitorAdAuditRowPropsSchema),
});

const quizAndBookQuestionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const quizAndBookQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(QUIZ_AND_BOOK_QUESTION_TYPES),
  prompt: z.string(),
  helperText: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(quizAndBookQuestionOptionSchema).optional(),
});

const quizAndBookBlockPropsSchema = z.object({
  heading: z.string(),
  subheading: z.string(),
  questions: z.array(quizAndBookQuestionSchema),
  summaryHeading: z.string(),
  summaryBody: z.string(),
  calendlyUrl: z.string(),
  destinationEmail: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Block schemas (discriminated union)
// ---------------------------------------------------------------------------

export const fluxBlockAppearanceSchema = z
  .object({
    sectionBackgroundColor: z.string().optional(),
    surfaceColor: z.string().optional(),
    panelSurfaceColor: z.string().optional(),
    textColor: z.string().optional(),
    headingColor: z.string().optional(),
    mutedTextColor: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    onPrimaryColor: z.string().optional(),
    borderColor: z.string().optional(),
    errorColor: z.string().optional(),
  })
  .partial();

export const fluxPageHeaderAppearanceSchema = z
  .object({
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
  })
  .partial();

const blockBase = {
  id: z.string(),
  order: z.number(),
  scrollTag: z.string().max(120).optional(),
  appearance: fluxBlockAppearanceSchema.optional(),
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

const competitorAdAuditBlockSchema = z.object({
  ...blockBase,
  type: z.literal('competitor_ad_audit'),
  props: competitorAdAuditBlockPropsSchema,
});

const quizAndBookBlockSchema = z.object({
  ...blockBase,
  type: z.literal('quiz_and_book'),
  props: quizAndBookBlockPropsSchema,
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
  competitorAdAuditBlockSchema,
  quizAndBookBlockSchema,
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
  surfaceColor: z.string().optional(),
  onPrimaryColor: z.string().optional(),
  onSurfaceColor: z.string().optional(),
  mutedTextColor: z.string().optional(),
  borderColor: z.string().optional(),
  strongBorderColor: z.string().optional(),
  errorColor: z.string().optional(),
  shadowColor: z.string().optional(),
  logoUrl: z.string().optional(),
  header: fluxPageHeaderAppearanceSchema.optional(),
  blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
  allowLongCopy: z.boolean().optional(),
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
  metrics: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  attribution: z.string().optional(),
  imageUrl: z.string().optional(),
});
