import type { Block, BlockType, ContentAsset } from '@/lib/flux/types';
import {
  DEFAULT_TANNERS_TAX_STRATEGY_DISCLAIMER,
  DEFAULT_TANNERS_TAX_STRATEGY_HEADING,
} from '@/lib/flux/tannersTaxStrategyDefaults';
import { createDefaultQuizAndBookProps } from '@/lib/flux/fluxQuizAndBook';

const DEFAULT_ORDER: BlockType[] = [
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
];

/** Shared default block factory for new campaigns and editor/chat add-block actions. */
export function makeFluxDefaultBlock(type: BlockType, order: number): Block {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  switch (type) {
    case 'hero':
      return {
        id,
        type,
        order,
        props: { headline: '', subheadline: '', ctaText: 'Get Started', ctaUrl: '' },
      };
    case 'social_proof':
      return { id, type, order, props: { heading: 'Trusted by', logos: [] } };
    case 'case_study':
      return { id, type, order, props: { assetId: '' } };
    case 'benefits':
      return {
        id,
        type,
        order,
        props: { heading: 'Benefits', items: [{ title: '', description: '' }] },
      };
    case 'testimonial':
      return { id, type, order, props: { assetId: '' } };
    case 'cta':
      return { id, type, order, props: { headline: '', ctaText: 'Book a Call', ctaUrl: '' } };
    case 'tanners_tax_strategy':
      return {
        id,
        type,
        order,
        props: {
          heading: DEFAULT_TANNERS_TAX_STRATEGY_HEADING,
          subheadline:
            'Illustrative deductions and tax impact at your marginal rate (residential rental 27.5-year depreciation; optional cost seg scenarios).',
          disclaimer: DEFAULT_TANNERS_TAX_STRATEGY_DISCLAIMER,
          defaultPurchasePrice: 500_000,
          defaultLandValue: 150_000,
          defaultMarginalTaxPercent: 37,
          defaultQualificationMode: 'passive',
        },
      };
    case 'competitor_ad_audit':
      return {
        id,
        type,
        order,
        props: {
          heading: 'Competitor ad audit',
          status: 'pending',
          competitors: [],
        },
      };
    case 'social_media_plan':
      return {
        id,
        type,
        order,
        props: {
          inferred_vertical: 'your vertical',
          inferred_vertical_rationale:
            'Replace with one honest sentence tied to what you actually know about this lead (site, notes, industry).',
          positioning_summary:
            'Replace with a short paragraph: tone, topics to lean into, and what to avoid for this vertical on social.',
          weeks: [
            {
              theme: 'Week 1 theme (e.g. proof + pain)',
              days: [
                { platform: 'IG', post_type: 'Reel', hook: 'Day 1 hook — specific, not generic.' },
                { platform: 'TikTok', post_type: 'Short video', hook: 'Day 2 hook — pattern interrupt.' },
                { platform: 'IG + FB', post_type: 'Carousel', hook: 'Day 3 hook — teach one clear thing.', cta: 'Save' },
              ],
            },
            {
              theme: 'Week 2 theme (e.g. objection handling)',
              days: [
                { platform: 'IG', post_type: 'Story', hook: 'Day 1 — poll or question sticker.' },
                { platform: 'FB', post_type: 'Static', hook: 'Day 2 — myth vs reality.' },
                { platform: 'IG', post_type: 'Reel', hook: 'Day 3 — before/after or mini case.', cta: 'DM “PLAN”' },
              ],
            },
          ],
          cta_ladder: ['Follow for daily tips', 'DM a keyword for the asset', 'Book a consult'],
          platform_mix_note:
            'Replace with one line on why IG / TikTok / FB weighting fits this vertical and offer (e.g. discovery vs trust vs retargeting).',
        },
      };
    case 'quiz_and_book':
      return {
        id,
        type,
        order,
        props: createDefaultQuizAndBookProps(),
      };
  }
}

/** Empty template for newly created campaigns (user builds from scratch). */
export function getEmptyFluxTemplatePayload(): {
  blocks: Block[];
  content_assets: ContentAsset[];
  copy_slots: string[];
  constraints: string;
} {
  return {
    blocks: [],
    content_assets: [],
    copy_slots: [],
    constraints: '',
  };
}

/** Default template used when a campaign has no `flux_campaign_templates` row yet. */
export function getDefaultFluxTemplatePayload(): {
  blocks: Block[];
  content_assets: ContentAsset[];
  copy_slots: string[];
  constraints: string;
} {
  return {
    blocks: DEFAULT_ORDER.map((type, i) => makeFluxDefaultBlock(type, i)),
    content_assets: [],
    copy_slots: ['headline', 'subheadline', 'ctaText'],
    constraints: '',
  };
}
