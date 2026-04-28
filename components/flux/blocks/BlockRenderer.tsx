import React from 'react';
import type { Block, ContentAsset } from '@/lib/flux/types';
import { HeroBlock } from './HeroBlock';
import { SocialProofBlock } from './SocialProofBlock';
import { CaseStudyBlock } from './CaseStudyBlock';
import { BenefitsBlock } from './BenefitsBlock';
import { TestimonialBlock } from './TestimonialBlock';
import { CtaBlock } from './CtaBlock';
import { TannersTaxStrategyBlock } from './TannersTaxStrategyBlock';
import { SocialMediaPlanBlock } from './SocialMediaPlanBlock';
import { CompetitorAdAuditBlock } from './CompetitorAdAuditBlock';

interface BlockRendererProps {
  block: Block;
  assets: ContentAsset[];
}

export function BlockRenderer({ block, assets }: BlockRendererProps) {
  switch (block.type) {
    case 'hero':
      return <HeroBlock props={block.props} />;
    case 'social_proof':
      return <SocialProofBlock props={block.props} />;
    case 'case_study': {
      const asset = assets.find((a) => a.id === block.props.assetId);
      return (
        <CaseStudyBlock
          asset={asset}
          overrideTitle={block.props.overrideTitle}
          overrideMetric={block.props.overrideMetric}
        />
      );
    }
    case 'benefits':
      return <BenefitsBlock props={block.props} />;
    case 'testimonial': {
      const asset = assets.find((a) => a.id === block.props.assetId);
      return (
        <TestimonialBlock
          asset={asset}
          overrideQuote={block.props.overrideQuote}
          overrideAttribution={block.props.overrideAttribution}
        />
      );
    }
    case 'cta':
      return <CtaBlock props={block.props} />;
    case 'tanners_tax_strategy':
      return <TannersTaxStrategyBlock props={block.props} />;
    case 'social_media_plan':
      return <SocialMediaPlanBlock props={block.props} />;
    case 'competitor_ad_audit':
      return <CompetitorAdAuditBlock props={block.props} />;
    default:
      return null;
  }
}
