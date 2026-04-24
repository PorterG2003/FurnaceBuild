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
} from '@/lib/flux/types';
import { getDefaultFluxTemplatePayload, getEmptyFluxTemplatePayload } from '@/lib/flux/defaultCampaignTemplate';

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
  return (data ?? []) as FluxCampaignRow[];
}

export async function getFluxCampaignById(id: string): Promise<FluxCampaignRow | null> {
  const { data, error } = await supabase
    .from('flux_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as FluxCampaignRow | null;
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
  const campaign = data as FluxCampaignRow;
  await upsertFluxTemplate(campaign.id, getEmptyFluxTemplatePayload());
  return campaign;
}

/** Ensures `flux_campaign_templates` has a row (seeds defaults if missing). Generate requires this row. */
export async function ensureFluxTemplateExists(campaignId: string): Promise<FluxCampaignTemplateRow> {
  const existing = await getFluxTemplate(campaignId);
  if (existing) return existing;
  return upsertFluxTemplate(campaignId, getDefaultFluxTemplatePayload());
}

export async function updateFluxCampaign(
  id: string,
  updates: { name?: string; offer_description?: string | null },
): Promise<FluxCampaignRow> {
  const { data, error } = await supabase
    .from('flux_campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FluxCampaignRow;
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
  return data as FluxCampaignTemplateRow | null;
}

export async function upsertFluxTemplate(
  campaignId: string,
  template: {
    blocks: Block[];
    content_assets: ContentAsset[];
    copy_slots: string[];
    constraints: string;
  },
): Promise<FluxCampaignTemplateRow> {
  const { data, error } = await supabase
    .from('flux_campaign_templates')
    .upsert(
      {
        campaign_id: campaignId,
        blocks: template.blocks as any,
        content_assets: template.content_assets as any,
        copy_slots: template.copy_slots,
        constraints: template.constraints,
      },
      { onConflict: 'campaign_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as FluxCampaignTemplateRow;
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
  logo_path?: string;
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
      logo_path: prospect.logo_path ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as FluxProspectRow;
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

export async function checkSlugAvailable(slug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('flux_prospect_pages')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data == null;
}
