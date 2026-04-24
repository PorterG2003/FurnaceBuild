import type { Block, BlockType, ContentAsset } from '@/lib/flux/types';
import {
  DEFAULT_TANNERS_TAX_STRATEGY_DISCLAIMER,
  DEFAULT_TANNERS_TAX_STRATEGY_HEADING,
} from '@/lib/flux/tannersTaxStrategyDefaults';

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
