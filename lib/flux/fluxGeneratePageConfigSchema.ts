import { z } from 'zod';
import { FLUX_BLOCK_STYLE_PRESETS } from './fluxPresentationTokens';
import { QUIZ_AND_BOOK_QUESTION_TYPES } from './fluxQuizAndBook';

/**
 * Zod schemas for Flux `fluxGenerate` PageConfig output (shared with Lambda via relative import).
 * Keep in sync with block props in {@link ./types}.
 */

const blockBase = { id: z.string(), order: z.number(), scrollTag: z.string().max(120).optional() };

const TANNERS_QUALIFICATION_MODES = ['passive', 'reps', 'str'] as const;

/** Map common LLM mistakes / synonyms to a valid mode before Zod parse (strict JSON schema unchanged). */
export function normalizeTannersQualificationModeLiteral(
  raw: string,
): (typeof TANNERS_QUALIFICATION_MODES)[number] | undefined {
  const v = raw.trim().toLowerCase().replace(/-/g, '_');
  if (v === 'passive') return 'passive';
  if (v === 'reps' || v === 'active' || v === 'material' || v === 'real_estate_professional') return 'reps';
  if (v === 'str' || v === 'short_term' || v === 'shortterm') return 'str';
  return undefined;
}

/**
 * Shallow-fix known LLM drift in parsed JSON so `pageConfigSchema.safeParse` succeeds.
 * Mutates only cloned block props for `tanners_tax_strategy`.
 */
export function normalizeFluxLlmPageConfigBeforeZod(input: unknown): unknown {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return input;
  const root = input as Record<string, unknown>;
  const blocks = root.blocks;
  if (!Array.isArray(blocks)) return input;

  let changed = false;
  const nextBlocks = blocks.map((block) => {
    if (block == null || typeof block !== 'object' || Array.isArray(block)) return block;
    const b = block as Record<string, unknown>;
    if (b.type === 'competitor_ad_audit') {
      const props = b.props;
      if (props == null || typeof props !== 'object' || Array.isArray(props)) return block;
      const p = props as Record<string, unknown>;
      const heading = typeof p.heading === 'string' ? p.heading : '';
      changed = true;
      return {
        ...b,
        props: {
          heading,
          status: 'pending',
          competitors: [],
        },
      };
    }
    if (b.type !== 'tanners_tax_strategy') return block;
    const props = b.props;
    if (props == null || typeof props !== 'object' || Array.isArray(props)) return block;
    const p = props as Record<string, unknown>;
    const mode = p.defaultQualificationMode;
    if (typeof mode !== 'string') return block;
    if ((TANNERS_QUALIFICATION_MODES as readonly string[]).includes(mode)) return block;
    const mapped = normalizeTannersQualificationModeLiteral(mode);
    if (mapped !== undefined) {
      changed = true;
      return { ...b, props: { ...p, defaultQualificationMode: mapped } };
    }
    changed = true;
    const { defaultQualificationMode: _omit, ...rest } = p;
    return { ...b, props: rest };
  });

  if (!changed) return input;
  return { ...root, blocks: nextBlocks };
}

export const blockSchema = z.discriminatedUnion('type', [
  z.object({
    ...blockBase,
    type: z.literal('hero'),
    props: z.object({
      headline: z.string(),
      subheadline: z.string(),
      ctaText: z.string(),
      ctaUrl: z.string(),
      heroImageUrl: z.string().optional(),
      heroPanelImageUrl: z.string().optional(),
      heroPanelLabel: z.string().optional(),
      heroPanelBody: z.string().optional(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('social_proof'),
    props: z.object({
      heading: z.string(),
      logos: z.array(z.object({ name: z.string(), imageUrl: z.string().optional() })),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('case_study'),
    props: z.object({
      assetId: z.string(),
      overrideTitle: z.string().optional(),
      overrideMetric: z.string().optional(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('benefits'),
    props: z.object({
      heading: z.string(),
      items: z.array(z.object({ title: z.string(), description: z.string() })),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('testimonial'),
    props: z.object({
      assetId: z.string(),
      overrideQuote: z.string().optional(),
      overrideAttribution: z.string().optional(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('cta'),
    props: z.object({
      headline: z.string(),
      ctaText: z.string(),
      ctaUrl: z.string(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('tanners_tax_strategy'),
    props: z.object({
      heading: z.string(),
      subheadline: z.string().optional(),
      disclaimer: z.string(),
      ctaText: z.string().optional(),
      ctaUrl: z.string().optional(),
      defaultPurchasePrice: z.number().optional(),
      defaultLandValue: z.number().optional(),
      defaultMarginalTaxPercent: z.number().optional(),
      defaultQualificationMode: z.enum(TANNERS_QUALIFICATION_MODES).optional(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('social_media_plan'),
    props: z.object({
      inferred_vertical: z.string(),
      inferred_vertical_rationale: z.string(),
      positioning_summary: z.string(),
      weeks: z.array(
        z.object({
          theme: z.string(),
          days: z.array(
            z.object({
              platform: z.string(),
              post_type: z.string(),
              hook: z.string(),
              cta: z.string().optional(),
            }),
          ),
        }),
      ),
      cta_ladder: z.array(z.string()),
      platform_mix_note: z.string(),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('competitor_ad_audit'),
    props: z.object({
      heading: z.string(),
      status: z.enum(['pending', 'running', 'ready', 'error']),
      errorMessage: z.string().optional(),
      lastAuditDomainReport: z
        .string()
        .optional()
        .describe(
          'Legacy only; not shown to recipients. Do not set manually. Per-domain Transparency outcomes are on the async job result.',
        ),
      lastAuditAt: z.string().optional(),
      competitors: z.array(
        z.object({
          name: z.string(),
          mapImageUrl: z.string(),
          adsSummary: z.string(),
          examples: z.array(
            z.object({
              headline: z.string(),
              body: z.string(),
              sourceUrl: z.string(),
              imageUrl: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  }),
  z.object({
    ...blockBase,
    type: z.literal('quiz_and_book'),
    props: z.object({
      heading: z.string(),
      subheading: z.string(),
      questions: z.array(
        z.object({
          id: z.string(),
          type: z.enum(QUIZ_AND_BOOK_QUESTION_TYPES),
          prompt: z.string(),
          helperText: z.string().optional(),
          placeholder: z.string().optional(),
          required: z.boolean().optional(),
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
              }),
            )
            .optional(),
        }),
      ),
      summaryHeading: z.string(),
      summaryBody: z.string(),
      calendlyUrl: z.string(),
      destinationEmail: z.string().optional(),
    }),
  }),
]);

export const themeConfigSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  fontFamily: z.string(),
  logoUrl: z.string().optional(),
  blockStylePreset: z.enum(FLUX_BLOCK_STYLE_PRESETS).optional(),
  allowLongCopy: z.boolean().optional(),
});

export const pageConfigSchema = z.object({
  theme: themeConfigSchema,
  prospectName: z.string(),
  companyName: z.string(),
  blocks: z.array(blockSchema),
});

export type FluxGeneratePageConfigParsed = z.infer<typeof pageConfigSchema>;

/** Short Zod error summary for LLM repair prompts (avoid huge payloads). */
export function formatZodIssuesForRepair(err: z.ZodError, maxLen = 800): string {
  const parts = err.issues.slice(0, 14).map((i) => {
    const p = i.path.length ? i.path.map(String).join('.') : '(root)';
    return `${p}: ${i.message}`;
  });
  const s = parts.join('; ');
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}
