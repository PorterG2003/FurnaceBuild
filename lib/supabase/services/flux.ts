import { supabase } from '@/lib/supabase/client';
import type {
  FluxCampaignRow,
  FluxCampaignTemplateRow,
  FluxProspectRow,
  FluxProspectPageRow,
  FluxPageStatus,
  Block,
  ContentAsset,
  PageConfig,
  BrandProfile,
  FluxWebsiteIntelSnapshot,
  FluxEditorChatSubjectType,
  FluxAsyncJobRow,
  FluxServiceArea,
} from '@/lib/flux/types';
import { getDefaultFluxTemplatePayload, getEmptyFluxTemplatePayload } from '@/lib/flux/defaultCampaignTemplate';
import {
  emptyFluxCampaignChatState,
  normalizeFluxCampaignChatState,
  type FluxCampaignChatState,
} from '@/lib/flux/fluxCampaignChatState';
import {
  emptyFluxProspectPageChatState,
  normalizeFluxProspectPageChatState,
  type FluxProspectPageChatState,
} from '@/lib/flux/fluxProspectPageChatState';
import { parseFluxCampaignRowFromDb } from '@/lib/flux/campaignSeller';
import { brandingPolicyToJson, type FluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';
import { coercePageConfig } from '@/lib/flux/coercePageConfig';
import { syncFluxPageConfigLogo } from '@/lib/flux/syncFluxPageConfigLogo';

async function upsertFluxEditorChat(params: {
  accountId: string;
  subjectType: FluxEditorChatSubjectType;
  subjectId: string;
  state: unknown;
}): Promise<void> {
  const { error } = await supabase.from('flux_editor_chats' as any).upsert(
    {
      account_id: params.accountId,
      subject_type: params.subjectType,
      subject_id: params.subjectId,
      state: params.state as any,
    },
    { onConflict: 'subject_type,subject_id' },
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function getFluxCampaigns(accountId: string): Promise<FluxCampaignRow[]> {
  const { data, error } = await supabase
    .from('flux_campaigns')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => parseFluxCampaignRowFromDb(row as Record<string, unknown>));
}

export async function getFluxCampaignById(id: string): Promise<FluxCampaignRow | null> {
  const { data, error } = await supabase
    .from('flux_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? parseFluxCampaignRowFromDb(data as Record<string, unknown>) : null;
}

export async function createFluxCampaign(
  accountId: string,
  name: string,
  offerDescription?: string,
): Promise<FluxCampaignRow> {
  const { data, error } = await supabase
    .from('flux_campaigns')
    .insert({ account_id: accountId, name, offer_description: offerDescription ?? null })
    .select()
    .single();
  if (error) throw error;
  const campaign = parseFluxCampaignRowFromDb(data as Record<string, unknown>);
  await upsertFluxTemplate(campaign.id, getEmptyFluxTemplatePayload());
  return campaign;
}

/** Ensures `flux_campaign_templates` has a row (seeds defaults if missing). Generate requires this row. */
export async function ensureFluxTemplateExists(campaignId: string): Promise<FluxCampaignTemplateRow> {
  const existing = await getFluxTemplate(campaignId);
  if (existing) return existing;
  return upsertFluxTemplate(campaignId, getDefaultFluxTemplatePayload());
}

export type UpdateFluxCampaignInput = {
  name?: string;
  offer_description?: string | null;
  seller_display_name?: string | null;
  seller_tagline?: string | null;
  seller_website_url?: string | null;
  seller_brand_profile?: BrandProfile | null;
  seller_website_domain_key?: string | null;
  seller_foundry_company_id?: string | null;
  seller_website_intel_snapshot?: FluxWebsiteIntelSnapshot | null;
  seller_website_intel_auto_filled_at?: string | null;
  branding_policy?: FluxBrandingPolicy;
};

export async function updateFluxCampaign(
  id: string,
  updates: UpdateFluxCampaignInput,
): Promise<FluxCampaignRow> {
  const { branding_policy, ...rest } = updates;
  const payload: Record<string, unknown> = { ...rest };
  if (branding_policy) {
    payload.branding_policy = brandingPolicyToJson(branding_policy);
  }
  const { data, error } = await supabase
    .from('flux_campaigns')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return parseFluxCampaignRowFromDb(data as Record<string, unknown>);
}

export async function deleteFluxCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('flux_campaigns').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function getFluxTemplate(campaignId: string): Promise<FluxCampaignTemplateRow | null> {
  const { data, error } = await supabase
    .from('flux_campaign_templates')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as FluxCampaignTemplateRow & { chat_state?: unknown };
  const { data: chatRow, error: chatErr } = await supabase
    .from('flux_editor_chats' as any)
    .select('state')
    .eq('subject_type', 'campaign_template')
    .eq('subject_id', row.id)
    .maybeSingle();
  if (chatErr) throw chatErr;
  const legacy = row.chat_state;
  const chat_state = normalizeFluxCampaignChatState(
    chatRow != null ? (chatRow as { state: unknown }).state : legacy,
  );
  return {
    ...row,
    chat_state,
  };
}

export async function upsertFluxTemplate(
  campaignId: string,
  template: {
    blocks: Block[];
    content_assets: ContentAsset[];
    copy_slots: string[];
    constraints: string;
    chat_state?: FluxCampaignChatState | null;
  },
): Promise<FluxCampaignTemplateRow> {
  const payload: Record<string, unknown> = {
    campaign_id: campaignId,
    blocks: template.blocks as any,
    content_assets: template.content_assets as any,
    copy_slots: template.copy_slots,
    constraints: template.constraints,
  };
  if ('chat_state' in template) {
    payload.chat_state = (template.chat_state as any) ?? null;
  }
  const { error } = await supabase
    .from('flux_campaign_templates')
    .upsert(payload, { onConflict: 'campaign_id' })
    .select()
    .single();
  if (error) throw error;
  const merged = await getFluxTemplate(campaignId);
  if (!merged) throw new Error('Template missing after upsert');
  return merged;
}

export async function updateFluxTemplateChatState(
  campaignId: string,
  chatState: FluxCampaignChatState | null,
): Promise<FluxCampaignTemplateRow> {
  const campaign = await getFluxCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const { data: t, error } = await supabase
    .from('flux_campaign_templates')
    .select('id')
    .eq('campaign_id', campaignId)
    .single();
  if (error) throw error;
  const templateId = (t as { id: string }).id;
  await upsertFluxEditorChat({
    accountId: campaign.account_id,
    subjectType: 'campaign_template',
    subjectId: templateId,
    state: chatState ?? emptyFluxCampaignChatState(),
  });
  const next = await getFluxTemplate(campaignId);
  if (!next) throw new Error('Template not found after chat save');
  return next;
}

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export async function getFluxProspects(campaignId: string): Promise<FluxProspectRow[]> {
  const { data, error } = await supabase
    .from('flux_prospects')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FluxProspectRow[];
}

export async function getFluxProspectsByAccount(accountId: string): Promise<FluxProspectRow[]> {
  const { data, error } = await supabase
    .from('flux_prospects')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FluxProspectRow[];
}

export async function getFluxProspectById(id: string): Promise<FluxProspectRow | null> {
  const { data, error } = await supabase
    .from('flux_prospects')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as FluxProspectRow | null;
}

export async function createFluxProspect(prospect: {
  account_id: string;
  campaign_id: string;
  name: string;
  company: string;
  role?: string;
  url?: string;
  industry?: string;
  company_size?: string;
  email_notes?: string;
  brand_profile?: BrandProfile;
  foundry_company_id?: string | null;
  website_domain_key?: string | null;
  website_intel_snapshot?: FluxWebsiteIntelSnapshot | null;
  website_intel_auto_filled_at?: string | null;
  service_area?: FluxServiceArea | null;
}): Promise<FluxProspectRow> {
  const { data, error } = await supabase
    .from('flux_prospects')
    .insert({
      account_id: prospect.account_id,
      campaign_id: prospect.campaign_id,
      name: prospect.name,
      company: prospect.company,
      role: prospect.role ?? null,
      url: prospect.url ?? null,
      industry: prospect.industry ?? null,
      company_size: prospect.company_size ?? null,
      email_notes: prospect.email_notes ?? null,
      brand_profile: (prospect.brand_profile as any) ?? null,
      foundry_company_id: prospect.foundry_company_id ?? null,
      website_domain_key: prospect.website_domain_key ?? null,
      website_intel_snapshot: (prospect.website_intel_snapshot as any) ?? null,
      website_intel_auto_filled_at: prospect.website_intel_auto_filled_at ?? null,
      service_area: (prospect.service_area as any) ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectRow;
}

export type UpdateFluxProspectInput = {
  name?: string;
  company?: string;
  role?: string | null;
  url?: string | null;
  industry?: string | null;
  company_size?: string | null;
  email_notes?: string | null;
  brand_profile?: BrandProfile | null;
  service_area?: FluxServiceArea | null;
};

export async function updateFluxProspect(
  id: string,
  updates: UpdateFluxProspectInput,
): Promise<FluxProspectRow> {
  const row: Record<string, unknown> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.company !== undefined) row.company = updates.company;
  if (updates.role !== undefined) row.role = updates.role;
  if (updates.url !== undefined) row.url = updates.url;
  if (updates.industry !== undefined) row.industry = updates.industry;
  if (updates.company_size !== undefined) row.company_size = updates.company_size;
  if (updates.email_notes !== undefined) row.email_notes = updates.email_notes;
  if (updates.brand_profile !== undefined) {
    row.brand_profile = updates.brand_profile === null ? null : (updates.brand_profile as any);
  }
  if (updates.service_area !== undefined) {
    row.service_area = updates.service_area === null ? null : (updates.service_area as any);
  }
  const { data, error } = await supabase
    .from('flux_prospects')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectRow;
}

export async function deleteFluxProspect(id: string): Promise<void> {
  const { error } = await supabase.from('flux_prospects').delete().eq('id', id);
  if (error) throw error;
}

export async function getFluxAsyncJob(jobId: string): Promise<FluxAsyncJobRow | null> {
  const { data, error } = await supabase
    .from('flux_async_jobs' as any)
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data as FluxAsyncJobRow | null;
}

// ---------------------------------------------------------------------------
// Prospect pages
// ---------------------------------------------------------------------------

/** Slug lookup; visibility is enforced by RLS (anon: live only; account members: any status). */
export async function getFluxPageBySlug(slug: string): Promise<FluxProspectPageRow | null> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as FluxProspectPageRow | null;
}

export async function getFluxPagesByProspect(prospectId: string): Promise<FluxProspectPageRow[]> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FluxProspectPageRow[];
}

export async function getFluxPagesByCampaign(campaignId: string): Promise<FluxProspectPageRow[]> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FluxProspectPageRow[];
}

export async function getRecentFluxPages(accountId: string, limit = 10): Promise<FluxProspectPageRow[]> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .select('*')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FluxProspectPageRow[];
}

export async function createFluxPage(page: {
  prospect_id: string;
  campaign_id: string;
  account_id: string;
  slug: string;
  page_config?: PageConfig;
  status?: FluxPageStatus;
}): Promise<FluxProspectPageRow> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .insert({
      prospect_id: page.prospect_id,
      campaign_id: page.campaign_id,
      account_id: page.account_id,
      slug: page.slug,
      page_config: (page.page_config as any) ?? {},
      status: page.status ?? 'draft',
    })
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectPageRow;
}

export async function updateFluxPageConfig(
  pageId: string,
  pageConfig: PageConfig,
): Promise<FluxProspectPageRow> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .update({ page_config: pageConfig as any })
    .eq('id', pageId)
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectPageRow;
}

export async function updateFluxPageStatus(
  pageId: string,
  status: FluxPageStatus,
): Promise<FluxProspectPageRow> {
  const updates: Record<string, any> = { status };
  if (status === 'live') updates.published_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .update(updates)
    .eq('id', pageId)
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectPageRow;
}

/** Slug is free if unused, or only used by `excludePageId` (same page keeping its slug). */
export async function checkSlugAvailable(slug: string, excludePageId?: string): Promise<boolean> {
  const trimmed = slug.trim();
  if (!trimmed) return false;
  const { data, error } = await supabase.from('flux_prospect_pages').select('id').eq('slug', trimmed);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return true;
  if (excludePageId && rows.length === 1 && rows[0].id === excludePageId) return true;
  return false;
}

export async function updateFluxPageSlug(pageId: string, slug: string): Promise<FluxProspectPageRow> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .update({ slug: slug.trim() })
    .eq('id', pageId)
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectPageRow;
}

export async function syncFluxPageLogosForCampaign(
  campaign: FluxCampaignRow,
  prospects: FluxProspectRow[],
): Promise<number> {
  const pages = await getFluxPagesByCampaign(campaign.id);
  const prospectById = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const updates = pages.flatMap((page) => {
    const pageConfig = coercePageConfig(page.page_config);
    const prospect = prospectById.get(page.prospect_id);
    if (!pageConfig || !prospect) return [];

    const synced = syncFluxPageConfigLogo(pageConfig, {
      prospectBrand: prospect.brand_profile,
      prospectWebsiteIntel: prospect.website_intel_snapshot,
      sellerBrand: campaign.seller_brand_profile,
      sellerWebsiteIntel: campaign.seller_website_intel_snapshot,
      brandingPolicy: campaign.branding_policy,
    });
    const currentLogoUrl = pageConfig.theme.logoUrl?.trim() || undefined;
    const nextLogoUrl = synced.theme.logoUrl?.trim() || undefined;
    if (currentLogoUrl === nextLogoUrl) return [];
    return [{ pageId: page.id, pageConfig: synced }];
  });

  await Promise.all(
    updates.map(async ({ pageId, pageConfig }) => {
      const { error } = await supabase
        .from('flux_prospect_pages')
        .update({ page_config: pageConfig as any })
        .eq('id', pageId);
      if (error) throw error;
    }),
  );

  return updates.length;
}

// ---------------------------------------------------------------------------
// Editor chats (flux_editor_chats)
// ---------------------------------------------------------------------------

export async function getFluxProspectPageEditorChat(
  prospectPageId: string,
): Promise<FluxProspectPageChatState> {
  const { data, error } = await supabase
    .from('flux_editor_chats' as any)
    .select('state')
    .eq('subject_type', 'prospect_page')
    .eq('subject_id', prospectPageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return emptyFluxProspectPageChatState();
  return normalizeFluxProspectPageChatState((data as { state: unknown }).state);
}

export async function updateFluxProspectPageEditorChat(
  accountId: string,
  prospectPageId: string,
  chatState: FluxProspectPageChatState,
): Promise<void> {
  await upsertFluxEditorChat({
    accountId,
    subjectType: 'prospect_page',
    subjectId: prospectPageId,
    state: chatState,
  });
}
