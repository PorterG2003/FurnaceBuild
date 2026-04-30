import type { FluxBlockStylePreset } from './fluxPresentationTokens';
import type { FluxBrandingPolicy } from './fluxBrandingPolicy';
import type { FluxCampaignChatState } from './fluxCampaignChatState';

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
  | 'social_media_plan'
  | 'competitor_ad_audit';

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
  heroImageUrl?: string;
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

export type CompetitorAdAuditStatus = 'pending' | 'running' | 'ready' | 'error';

export interface CompetitorAdExampleProps {
  headline: string;
  body: string;
  sourceUrl: string;
  imageUrl?: string;
}

export interface CompetitorAdAuditRowProps {
  name: string;
  mapImageUrl: string;
  adsSummary: string;
  examples: CompetitorAdExampleProps[];
}

export interface CompetitorAdAuditBlockProps {
  heading: string;
  status: CompetitorAdAuditStatus;
  errorMessage?: string;
  /**
   * Legacy field from older audits; no longer written or shown. Per-domain scan details live on
   * `flux_async_jobs.result` for the competitor_ad_audit job. Re-run the audit to refresh ad copy.
   */
  lastAuditDomainReport?: string;
  lastAuditAt?: string;
  competitors: CompetitorAdAuditRowProps[];
}

export interface CompetitorAdAuditBlock extends BlockBase {
  type: 'competitor_ad_audit';
  props: CompetitorAdAuditBlockProps;
}

export type Block =
  | HeroBlock
  | SocialProofBlock
  | CaseStudyBlock
  | BenefitsBlock
  | TestimonialBlock
  | CtaBlock
  | TannersTaxStrategyBlock
  | SocialMediaPlanBlock
  | CompetitorAdAuditBlock;

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
  blockStylePreset?: FluxBlockStylePreset;
}

export interface ThemeConfig {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  logoUrl?: string;
  blockStylePreset?: FluxBlockStylePreset;
}

export interface FluxWebsiteIntelSnapshot {
  normalized_domain_key: string;
  hit: boolean;
  crawled_at?: string;
  stale?: boolean;
  company_id?: string;
  site_assets?: {
    logo_candidates: string[];
    theme_color: string | null;
    brand_color_candidates: string[];
    organization_names: string[];
    social_profiles: string[];
    contact_counts: {
      phones: number;
      emails: number;
      addresses: number;
    };
  };
  extracted_profile?: {
    business_summary: string | null;
    brand_name: string | null;
    audience_segments: string[];
    services: string[];
    industries_served: string[];
    locations_served: string[];
    tone: string | null;
    confidence: 'low' | 'medium' | 'high';
    evidence_urls: string[];
  };
  hero_image_candidates?: string[];
  final_url?: string | null;
  verification_band?: 'usable' | 'uncertain' | 'not_usable' | null;
  industry_guess?: string | null;
}

/** Campaign seller (runner) — camelCase for editor / API payloads. */
export interface FluxSellerProfileInput {
  displayName: string;
  tagline: string;
  websiteUrl: string;
  brand_profile: BrandProfile | null;
  website_intel: FluxWebsiteIntelSnapshot | null;
  /** Registry / scrape — persisted on `flux_campaigns`. */
  websiteDomainKey?: string | null;
  foundryCompanyId?: string | null;
  websiteIntelAutoFilledAt?: string | null;
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

export interface FluxCampaignRow {
  id: string;
  account_id: string;
  name: string;
  offer_description: string | null;
  seller_display_name: string | null;
  seller_tagline: string | null;
  seller_website_url: string | null;
  seller_brand_profile: BrandProfile | null;
  seller_website_domain_key: string | null;
  seller_foundry_company_id: string | null;
  seller_website_intel_snapshot: FluxWebsiteIntelSnapshot | null;
  seller_website_intel_auto_filled_at: string | null;
  branding_policy: FluxBrandingPolicy;
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

/** Google Places–derived center for competitor audit (see `service_area` column). */
export interface FluxServiceArea {
  placeId: string;
  displayName?: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
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
  foundry_company_id: string | null;
  website_domain_key: string | null;
  website_intel_snapshot: FluxWebsiteIntelSnapshot | null;
  website_intel_auto_filled_at: string | null;
  service_area: FluxServiceArea | null;
  created_at: string;
}

export type FluxAsyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Row in `flux_async_jobs` (main Supabase). */
export interface FluxAsyncJobRow {
  id: string;
  account_id: string;
  job_type: string;
  subject_type: string;
  subject_id: string;
  payload: { block_id?: string; audit_config_version?: string } & Record<string, unknown>;
  status: FluxAsyncJobStatus;
  error_message: string | null;
  external_execution_arn: string | null;
  result: unknown;
  idempotency_key: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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
  website_intel?: FluxWebsiteIntelSnapshot | null;
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

/** Row in `flux_editor_chats` — one thread per template or prospect page. */
export type FluxEditorChatSubjectType = 'campaign_template' | 'prospect_page';

export interface FluxEditorChatRow {
  id: string;
  account_id: string;
  subject_type: FluxEditorChatSubjectType;
  subject_id: string;
  state: unknown;
  created_at: string;
  updated_at: string;
}
