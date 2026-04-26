// ---------------------------------------------------------------------------
// Block types (discriminated union)
// ---------------------------------------------------------------------------

export type BlockType =
  | 'hero'
  | 'social_proof'
  | 'case_study'
  | 'benefits'
  | 'testimonial'
  | 'cta'
  | 'tanners_tax_strategy'
  | 'social_media_plan';

export interface BlockBase {
  id: string;
  type: BlockType;
  order: number;
}

export interface HeroBlockProps {
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaUrl: string;
}
export interface HeroBlock extends BlockBase {
  type: 'hero';
  props: HeroBlockProps;
}

export interface SocialProofBlockProps {
  heading: string;
  logos: { name: string; imageUrl?: string }[];
}
export interface SocialProofBlock extends BlockBase {
  type: 'social_proof';
  props: SocialProofBlockProps;
}

export interface CaseStudyBlockProps {
  assetId: string;
  overrideTitle?: string;
  overrideMetric?: string;
}
export interface CaseStudyBlock extends BlockBase {
  type: 'case_study';
  props: CaseStudyBlockProps;
}

export interface BenefitItem {
  title: string;
  description: string;
}
export interface BenefitsBlockProps {
  heading: string;
  items: BenefitItem[];
}
export interface BenefitsBlock extends BlockBase {
  type: 'benefits';
  props: BenefitsBlockProps;
}

export interface TestimonialBlockProps {
  assetId: string;
  overrideQuote?: string;
  overrideAttribution?: string;
}
export interface TestimonialBlock extends BlockBase {
  type: 'testimonial';
  props: TestimonialBlockProps;
}

export interface CtaBlockProps {
  headline: string;
  ctaText: string;
  ctaUrl: string;
}
export interface CtaBlock extends BlockBase {
  type: 'cta';
  props: CtaBlockProps;
}

/** Default framing for W-2 offset illustration (REPS / STR per leave-behind). */
export type TannersTaxQualificationMode = 'passive' | 'reps' | 'str';

export interface TannersTaxStrategyBlockProps {
  heading: string;
  subheadline?: string;
  disclaimer: string;
  ctaText?: string;
  ctaUrl?: string;
  defaultPurchasePrice?: number;
  defaultLandValue?: number;
  defaultMarginalTaxPercent?: number;
  defaultQualificationMode?: TannersTaxQualificationMode;
}

export interface TannersTaxStrategyBlock extends BlockBase {
  type: 'tanners_tax_strategy';
  props: TannersTaxStrategyBlockProps;
}

export interface SocialMediaPlanDay {
  /** e.g. IG, TikTok, FB, or a combo label like "IG + TikTok" */
  platform: string;
  post_type: string;
  hook: string;
  cta?: string;
}

export interface SocialMediaPlanWeek {
  theme: string;
  days: SocialMediaPlanDay[];
}

export interface SocialMediaPlanBlockProps {
  inferred_vertical: string;
  inferred_vertical_rationale: string;
  positioning_summary: string;
  weeks: SocialMediaPlanWeek[];
  cta_ladder: string[];
  platform_mix_note: string;
}

export interface SocialMediaPlanBlock extends BlockBase {
  type: 'social_media_plan';
  props: SocialMediaPlanBlockProps;
}

export type Block =
  | HeroBlock
  | SocialProofBlock
  | CaseStudyBlock
  | BenefitsBlock
  | TestimonialBlock
  | CtaBlock
  | TannersTaxStrategyBlock
  | SocialMediaPlanBlock;

// ---------------------------------------------------------------------------
// Content assets (referenced by blocks)
// ---------------------------------------------------------------------------

export type ContentAssetType = 'case_study' | 'testimonial' | 'stat';

export interface ContentAsset {
  id: string;
  type: ContentAssetType;
  title: string;
  body: string;
  metric?: string;
  attribution?: string;
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Brand / theme
// ---------------------------------------------------------------------------

export interface BrandProfile {
  primaryColor: string;
  accentColor?: string;
  fontFamily?: string;
  logoUrl?: string;
}

export interface ThemeConfig {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// Page config (stored as jsonb on flux_prospect_pages)
// ---------------------------------------------------------------------------

export interface PageConfig {
  theme: ThemeConfig;
  prospectName: string;
  companyName: string;
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

export type FluxPageStatus = 'draft' | 'live' | 'archived';

export interface FluxCampaignChatState {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    summary?: string[];
  }>;
  lastSummary: string[] | null;
  updatedAt: string | null;
}

export interface FluxCampaignRow {
  id: string;
  account_id: string;
  name: string;
  offer_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface FluxCampaignTemplateRow {
  id: string;
  campaign_id: string;
  blocks: Block[];
  content_assets: ContentAsset[];
  copy_slots: string[];
  constraints: string;
  chat_state: FluxCampaignChatState | null;
  created_at: string;
  updated_at: string;
}

export interface FluxProspectRow {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  company: string;
  role: string | null;
  url: string | null;
  industry: string | null;
  company_size: string | null;
  email_notes: string | null;
  brand_profile: BrandProfile | null;
  logo_path: string | null;
  created_at: string;
}

/** Inline prospect for campaign editor preview (POST `fluxGenerate` with `preview: true`). */
export interface FluxPreviewProspectInput {
  name: string;
  company: string;
  role?: string | null;
  url?: string | null;
  industry?: string | null;
  company_size?: string | null;
  email_notes?: string | null;
  brand_profile: BrandProfile | null;
}

/** Template snapshot sent with preview generate (matches campaign template row shape). */
export interface FluxPreviewTemplateInput {
  blocks: Block[];
  content_assets: ContentAsset[];
  copy_slots: string[];
  constraints: string;
}

export interface FluxProspectPageRow {
  id: string;
  prospect_id: string;
  campaign_id: string;
  account_id: string;
  slug: string;
  page_config: PageConfig;
  status: FluxPageStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}
