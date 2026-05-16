import type { Block, PageConfig } from './types';
import {
  DEFAULT_FLUX_BLOCK_STYLE_PRESET,
  FLUX_BLOCK_STYLE_PRESETS,
  type FluxBlockStylePreset,
} from './fluxPresentationTokens';

/** Layout density tier derived from `theme.blockStylePreset`. */
export type FluxCopyBudgetTier = 'tight' | 'standard';

export type FluxCopyFieldBudget = {
  /** Human label for prompt tables (not necessarily JSON path). */
  label: string;
  targetChars: number;
  hardMaxChars: number;
};

const B = (targetChars: number, hardMaxChars: number): Pick<FluxCopyFieldBudget, 'targetChars' | 'hardMaxChars'> => ({
  targetChars,
  hardMaxChars,
});

/** `minimal` → tight; `classic`, `elevated`, `soft` → standard. */
export function getTierForPreset(preset: FluxBlockStylePreset | undefined): FluxCopyBudgetTier {
  const p = preset ?? DEFAULT_FLUX_BLOCK_STYLE_PRESET;
  if (p === 'minimal') return 'tight';
  return 'standard';
}

const HERO: Record<FluxCopyBudgetTier, FluxCopyFieldBudget[]> = {
  tight: [
    { label: 'hero.headline', ...B(42, 72) },
    { label: 'hero.subheadline', ...B(130, 260) },
    { label: 'hero.ctaText', ...B(22, 38) },
  ],
  standard: [
    { label: 'hero.headline', ...B(56, 88) },
    { label: 'hero.subheadline', ...B(160, 320) },
    { label: 'hero.ctaText', ...B(26, 42) },
  ],
};

const CTA: Record<FluxCopyBudgetTier, FluxCopyFieldBudget[]> = {
  tight: [
    { label: 'cta.headline', ...B(42, 72) },
    { label: 'cta.ctaText', ...B(22, 38) },
  ],
  standard: [
    { label: 'cta.headline', ...B(52, 88) },
    { label: 'cta.ctaText', ...B(26, 42) },
  ],
};

const BENEFITS: Record<FluxCopyBudgetTier, { heading: FluxCopyFieldBudget; itemTitle: FluxCopyFieldBudget; itemDescription: FluxCopyFieldBudget }> = {
  tight: {
    heading: { label: 'benefits.heading', ...B(34, 64) },
    itemTitle: { label: 'benefits.items[].title', ...B(40, 78) },
    itemDescription: { label: 'benefits.items[].description', ...B(100, 240) },
  },
  standard: {
    heading: { label: 'benefits.heading', ...B(38, 72) },
    itemTitle: { label: 'benefits.items[].title', ...B(44, 86) },
    itemDescription: { label: 'benefits.items[].description', ...B(120, 280) },
  },
};

const SOCIAL_PROOF: Record<FluxCopyBudgetTier, FluxCopyFieldBudget[]> = {
  tight: [{ label: 'social_proof.heading', ...B(34, 64) }],
  standard: [{ label: 'social_proof.heading', ...B(38, 72) }],
};

const TANNERS: Record<
  FluxCopyBudgetTier,
  { heading: FluxCopyFieldBudget; subheadline: FluxCopyFieldBudget; disclaimer: FluxCopyFieldBudget; ctaText: FluxCopyFieldBudget }
> = {
  tight: {
    heading: { label: 'tanners_tax_strategy.heading', ...B(52, 110) },
    subheadline: { label: 'tanners_tax_strategy.subheadline', ...B(110, 260) },
    disclaimer: { label: 'tanners_tax_strategy.disclaimer', ...B(900, 8000) },
    ctaText: { label: 'tanners_tax_strategy.ctaText', ...B(22, 38) },
  },
  standard: {
    heading: { label: 'tanners_tax_strategy.heading', ...B(58, 120) },
    subheadline: { label: 'tanners_tax_strategy.subheadline', ...B(130, 300) },
    disclaimer: { label: 'tanners_tax_strategy.disclaimer', ...B(1000, 9000) },
    ctaText: { label: 'tanners_tax_strategy.ctaText', ...B(26, 42) },
  },
};

const SMP: Record<
  FluxCopyBudgetTier,
  {
    inferred_vertical: FluxCopyFieldBudget;
    inferred_vertical_rationale: FluxCopyFieldBudget;
    positioning_summary: FluxCopyFieldBudget;
    platform_mix_note: FluxCopyFieldBudget;
    cta_ladder_item: FluxCopyFieldBudget;
    week_theme: FluxCopyFieldBudget;
    day_platform: FluxCopyFieldBudget;
    day_post_type: FluxCopyFieldBudget;
    day_hook: FluxCopyFieldBudget;
    day_cta: FluxCopyFieldBudget;
  }
> = {
  tight: {
    inferred_vertical: { label: 'social_media_plan.inferred_vertical', ...B(40, 84) },
    inferred_vertical_rationale: { label: 'social_media_plan.inferred_vertical_rationale', ...B(160, 360) },
    positioning_summary: { label: 'social_media_plan.positioning_summary', ...B(260, 520) },
    platform_mix_note: { label: 'social_media_plan.platform_mix_note', ...B(120, 260) },
    cta_ladder_item: { label: 'social_media_plan.cta_ladder[]', ...B(52, 120) },
    week_theme: { label: 'social_media_plan.weeks[].theme', ...B(44, 96) },
    day_platform: { label: 'social_media_plan.weeks[].days[].platform', ...B(18, 36) },
    day_post_type: { label: 'social_media_plan.weeks[].days[].post_type', ...B(24, 48) },
    day_hook: { label: 'social_media_plan.weeks[].days[].hook', ...B(72, 160) },
    day_cta: { label: 'social_media_plan.weeks[].days[].cta', ...B(48, 110) },
  },
  standard: {
    inferred_vertical: { label: 'social_media_plan.inferred_vertical', ...B(48, 96) },
    inferred_vertical_rationale: { label: 'social_media_plan.inferred_vertical_rationale', ...B(200, 420) },
    positioning_summary: { label: 'social_media_plan.positioning_summary', ...B(280, 560) },
    platform_mix_note: { label: 'social_media_plan.platform_mix_note', ...B(140, 300) },
    cta_ladder_item: { label: 'social_media_plan.cta_ladder[]', ...B(60, 130) },
    week_theme: { label: 'social_media_plan.weeks[].theme', ...B(48, 104) },
    day_platform: { label: 'social_media_plan.weeks[].days[].platform', ...B(20, 40) },
    day_post_type: { label: 'social_media_plan.weeks[].days[].post_type', ...B(28, 52) },
    day_hook: { label: 'social_media_plan.weeks[].days[].hook', ...B(88, 200) },
    day_cta: { label: 'social_media_plan.weeks[].days[].cta', ...B(52, 120) },
  },
};

const COMPETITOR: Record<FluxCopyBudgetTier, { heading: FluxCopyFieldBudget }> = {
  tight: { heading: { label: 'competitor_ad_audit.heading', ...B(36, 72) } },
  standard: { heading: { label: 'competitor_ad_audit.heading', ...B(44, 88) } },
};

const QUIZ_AND_BOOK: Record<
  FluxCopyBudgetTier,
  {
    heading: FluxCopyFieldBudget;
    subheading: FluxCopyFieldBudget;
    question_prompt: FluxCopyFieldBudget;
    question_helperText: FluxCopyFieldBudget;
    option_label: FluxCopyFieldBudget;
    summaryHeading: FluxCopyFieldBudget;
    summaryBody: FluxCopyFieldBudget;
  }
> = {
  tight: {
    heading: { label: 'quiz_and_book.heading', ...B(48, 96) },
    subheading: { label: 'quiz_and_book.subheading', ...B(120, 240) },
    question_prompt: { label: 'quiz_and_book.questions[].prompt', ...B(68, 140) },
    question_helperText: { label: 'quiz_and_book.questions[].helperText', ...B(90, 220) },
    option_label: { label: 'quiz_and_book.questions[].options[].label', ...B(36, 88) },
    summaryHeading: { label: 'quiz_and_book.summaryHeading', ...B(24, 52) },
    summaryBody: { label: 'quiz_and_book.summaryBody', ...B(110, 240) },
  },
  standard: {
    heading: { label: 'quiz_and_book.heading', ...B(56, 110) },
    subheading: { label: 'quiz_and_book.subheading', ...B(140, 280) },
    question_prompt: { label: 'quiz_and_book.questions[].prompt', ...B(76, 156) },
    question_helperText: { label: 'quiz_and_book.questions[].helperText', ...B(110, 250) },
    option_label: { label: 'quiz_and_book.questions[].options[].label', ...B(42, 96) },
    summaryHeading: { label: 'quiz_and_book.summaryHeading', ...B(28, 56) },
    summaryBody: { label: 'quiz_and_book.summaryBody', ...B(130, 280) },
  },
};

function pushLengthViolation(
  out: string[],
  block: Block,
  displayPath: string,
  len: number,
  rule: FluxCopyFieldBudget,
  tier: FluxCopyBudgetTier,
): void {
  if (len <= rule.hardMaxChars) return;
  out.push(
    `Block ${block.id} (${block.type}): ${displayPath} length ${len} exceeds hard max ${rule.hardMaxChars} (target ${rule.targetChars}, tier ${tier})`,
  );
}

/**
 * Copy length violations for `fluxGenerate` repair loop only when `length > hardMaxChars`.
 * Strings between target and hard pass.
 */
export function getFluxCopyBudgetViolations(merged: PageConfig): string[] {
  if (merged.theme.allowLongCopy) return [];
  const tier = getTierForPreset(merged.theme.blockStylePreset);
  const out: string[] = [];

  for (const block of merged.blocks) {
    switch (block.type) {
      case 'hero': {
        const r = HERO[tier];
        pushLengthViolation(out, block, 'props.headline', block.props.headline.length, r[0], tier);
        pushLengthViolation(out, block, 'props.subheadline', block.props.subheadline.length, r[1], tier);
        pushLengthViolation(out, block, 'props.ctaText', block.props.ctaText.length, r[2], tier);
        break;
      }
      case 'cta': {
        const r = CTA[tier];
        pushLengthViolation(out, block, 'props.headline', block.props.headline.length, r[0], tier);
        pushLengthViolation(out, block, 'props.ctaText', block.props.ctaText.length, r[1], tier);
        break;
      }
      case 'benefits': {
        const b = BENEFITS[tier];
        pushLengthViolation(out, block, 'props.heading', block.props.heading.length, b.heading, tier);
        for (let i = 0; i < block.props.items.length; i += 1) {
          const it = block.props.items[i];
          pushLengthViolation(out, block, `props.items[${i}].title`, it.title.length, b.itemTitle, tier);
          pushLengthViolation(out, block, `props.items[${i}].description`, it.description.length, b.itemDescription, tier);
        }
        break;
      }
      case 'social_proof': {
        const r = SOCIAL_PROOF[tier][0];
        pushLengthViolation(out, block, 'props.heading', block.props.heading.length, r, tier);
        break;
      }
      case 'tanners_tax_strategy': {
        const t = TANNERS[tier];
        pushLengthViolation(out, block, 'props.heading', block.props.heading.length, t.heading, tier);
        if (typeof block.props.subheadline === 'string') {
          pushLengthViolation(out, block, 'props.subheadline', block.props.subheadline.length, t.subheadline, tier);
        }
        pushLengthViolation(out, block, 'props.disclaimer', block.props.disclaimer.length, t.disclaimer, tier);
        if (typeof block.props.ctaText === 'string') {
          pushLengthViolation(out, block, 'props.ctaText', block.props.ctaText.length, t.ctaText, tier);
        }
        break;
      }
      case 'social_media_plan': {
        const s = SMP[tier];
        const p = block.props;
        pushLengthViolation(out, block, 'props.inferred_vertical', p.inferred_vertical.length, s.inferred_vertical, tier);
        pushLengthViolation(
          out,
          block,
          'props.inferred_vertical_rationale',
          p.inferred_vertical_rationale.length,
          s.inferred_vertical_rationale,
          tier,
        );
        pushLengthViolation(out, block, 'props.positioning_summary', p.positioning_summary.length, s.positioning_summary, tier);
        pushLengthViolation(out, block, 'props.platform_mix_note', p.platform_mix_note.length, s.platform_mix_note, tier);
        for (let i = 0; i < p.cta_ladder.length; i += 1) {
          const step = p.cta_ladder[i];
          if (typeof step === 'string') {
            pushLengthViolation(out, block, `props.cta_ladder[${i}]`, step.length, s.cta_ladder_item, tier);
          }
        }
        for (let wi = 0; wi < p.weeks.length; wi += 1) {
          const week = p.weeks[wi];
          pushLengthViolation(out, block, `props.weeks[${wi}].theme`, week.theme.length, s.week_theme, tier);
          for (let di = 0; di < week.days.length; di += 1) {
            const day = week.days[di];
            pushLengthViolation(out, block, `props.weeks[${wi}].days[${di}].platform`, day.platform.length, s.day_platform, tier);
            pushLengthViolation(out, block, `props.weeks[${wi}].days[${di}].post_type`, day.post_type.length, s.day_post_type, tier);
            pushLengthViolation(out, block, `props.weeks[${wi}].days[${di}].hook`, day.hook.length, s.day_hook, tier);
            if (typeof day.cta === 'string') {
              pushLengthViolation(out, block, `props.weeks[${wi}].days[${di}].cta`, day.cta.length, s.day_cta, tier);
            }
          }
        }
        break;
      }
      case 'competitor_ad_audit': {
        const c = COMPETITOR[tier];
        pushLengthViolation(out, block, 'props.heading', block.props.heading.length, c.heading, tier);
        break;
      }
      case 'quiz_and_book': {
        const q = QUIZ_AND_BOOK[tier];
        pushLengthViolation(out, block, 'props.heading', block.props.heading.length, q.heading, tier);
        pushLengthViolation(out, block, 'props.subheading', block.props.subheading.length, q.subheading, tier);
        pushLengthViolation(out, block, 'props.summaryHeading', block.props.summaryHeading.length, q.summaryHeading, tier);
        pushLengthViolation(out, block, 'props.summaryBody', block.props.summaryBody.length, q.summaryBody, tier);
        for (let i = 0; i < block.props.questions.length; i += 1) {
          const question = block.props.questions[i];
          pushLengthViolation(out, block, `props.questions[${i}].prompt`, question.prompt.length, q.question_prompt, tier);
          if (typeof question.helperText === 'string') {
            pushLengthViolation(
              out,
              block,
              `props.questions[${i}].helperText`,
              question.helperText.length,
              q.question_helperText,
              tier,
            );
          }
          for (let j = 0; j < (question.options?.length ?? 0); j += 1) {
            const option = question.options?.[j];
            if (!option) continue;
            pushLengthViolation(
              out,
              block,
              `props.questions[${i}].options[${j}].label`,
              option.label.length,
              q.option_label,
              tier,
            );
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

function markdownTableForRows(rows: FluxCopyFieldBudget[]): string {
  const lines = [
    `| Field | Target (aim here) | Hard max (do not exceed) |`,
    `|-------|-------------------|---------------------------|`,
    ...rows.map((r) => `| ${r.label} | ${r.targetChars} | ${r.hardMaxChars} |`),
  ];
  return lines.join('\n');
}

/** Preset → tier map + tier tables + fixed instructions for `fluxGenerate` user prompt. */
export function formatFluxCopyBudgetsForPrompt(): string {
  const presetList = FLUX_BLOCK_STYLE_PRESETS.join(', ');
  const tightRows: FluxCopyFieldBudget[] = [
    ...HERO.tight,
    ...CTA.tight,
    BENEFITS.tight.heading,
    BENEFITS.tight.itemTitle,
    BENEFITS.tight.itemDescription,
    ...SOCIAL_PROOF.tight,
    TANNERS.tight.heading,
    TANNERS.tight.subheadline,
    TANNERS.tight.disclaimer,
    TANNERS.tight.ctaText,
    ...Object.values(SMP.tight),
    ...Object.values(QUIZ_AND_BOOK.tight),
  ];
  const standardRows: FluxCopyFieldBudget[] = [
    ...HERO.standard,
    ...CTA.standard,
    BENEFITS.standard.heading,
    BENEFITS.standard.itemTitle,
    BENEFITS.standard.itemDescription,
    ...SOCIAL_PROOF.standard,
    TANNERS.standard.heading,
    TANNERS.standard.subheadline,
    TANNERS.standard.disclaimer,
    TANNERS.standard.ctaText,
    ...Object.values(SMP.standard),
    ...Object.values(QUIZ_AND_BOOK.standard),
  ];

  return `Copy length (layout density)

Default to **short, scannable** copy: treat the Target column as your normal output. Use Hard max only when the user prompt's legal/compliance/quote exception applies—do not "use all available space."

Preset → tier: presets ${presetList}. Use tier **tight** for blockStylePreset minimal. Use tier **standard** for classic, elevated, or soft.

### Tight tier
${markdownTableForRows(tightRows)}

### Standard tier
${markdownTableForRows(standardRows)}

Use the table row for the tier that matches theme.blockStylePreset in your output JSON.

Prefer staying at or below Target. You may exceed Target up to Hard max when required for legal accuracy, compliance, quoted evidence, or dense technical clarity—do not shorten truth.

If any string exceeds Hard max, your output will be rejected for revision—rewrite shorter while preserving meaning.`;
}

/** Dev/test: every pair must have hardMaxChars > targetChars. */
export function collectAllFluxCopyFieldBudgetsForInvariant(): FluxCopyFieldBudget[] {
  const out: FluxCopyFieldBudget[] = [];
  for (const tier of ['tight', 'standard'] as const) {
    out.push(...HERO[tier], ...CTA[tier], ...SOCIAL_PROOF[tier]);
    out.push(BENEFITS[tier].heading, BENEFITS[tier].itemTitle, BENEFITS[tier].itemDescription);
    out.push(TANNERS[tier].heading, TANNERS[tier].subheadline, TANNERS[tier].disclaimer, TANNERS[tier].ctaText);
    out.push(...Object.values(SMP[tier]));
    out.push(...Object.values(QUIZ_AND_BOOK[tier]));
  }
  return out;
}

export function assertFluxCopyBudgetHardExceedsTarget(): void {
  for (const r of collectAllFluxCopyFieldBudgetsForInvariant()) {
    if (r.hardMaxChars <= r.targetChars) {
      throw new Error(`fluxCopyBudgets invariant: ${r.label} hardMax ${r.hardMaxChars} must exceed target ${r.targetChars}`);
    }
  }
}

assertFluxCopyBudgetHardExceedsTarget();
