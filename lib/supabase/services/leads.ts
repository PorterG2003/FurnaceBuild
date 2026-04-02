import { supabase } from '../client';
import type { Lead, LeadInsert, LeadUpdate } from '../types';

/**
 * Lead service for database operations.
 * For getLeadDisplayName and generateGlobalLeadId use @/lib/leads.
 */

export interface LeadFilters {
  campaignId?: string;
  bucketId?: string;
  status?: Lead['status'];
  /** Max number of leads to return (for pagination/preview). */
  limit?: number;
  /** Offset for pagination (use with limit). */
  offset?: number;
  /** Search by email or name (ilike). */
  search?: string;
  /** Filter to leads where any of these fields is null or empty. Prefix custom fields with "custom." */
  missingFields?: string[];
}

export interface CampaignLeadTableRow {
  id: string;
  email: string;
  name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  phone_number?: string | null;
  source?: string | null;
  custom_lead_data?: Record<string, unknown> | null;
  status?: Lead['status'] | null;
  enrollment_state: 'active' | 'completed' | 'stopped' | 'paused' | null;
  enrollment_current_node_id: string | null;
  enrollment_stopped_reason: 'replied' | 'bounced' | 'unsubscribed' | 'error' | null;
  enrollment_stopped_error_message: string | null;
  created_at: string;
}

export interface CampaignLeadTableQuery {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface CampaignLeadTableResult {
  rows: CampaignLeadTableRow[];
  totalCount: number;
}

/**
 * Get all leads with optional filters
 */
export async function getLeads(filters?: LeadFilters): Promise<Lead[]> {
  let query = supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false }) as any;

  if (filters?.campaignId) {
    query = query.eq('campaign_id', filters.campaignId);
  }

  if (filters?.bucketId) {
    query = query.eq('bucket_id', filters.bucketId);
  }

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const searchTerm = filters?.search?.trim();
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    query = query.or(`email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`);
  }

  if (filters?.missingFields?.length) {
    const conditions: string[] = [];
    for (const field of filters.missingFields) {
      if (field.startsWith('custom.')) {
        const jsonKey = field.slice(7);
        conditions.push(`custom_lead_data->>${jsonKey}.is.null`);
        conditions.push(`custom_lead_data->>${jsonKey}.eq.`);
      } else {
        conditions.push(`${field}.is.null`);
        conditions.push(`${field}.eq.`);
      }
    }
    query = query.or(conditions.join(','));
  }

  if (typeof filters?.offset === 'number') {
    const limit = filters.limit ?? 50;
    query = query.range(filters.offset, filters.offset + limit - 1);
  } else if (typeof filters?.limit === 'number') {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  return data || [];
}

export async function getCampaignLeadTablePage(
  campaignId: string,
  query?: CampaignLeadTableQuery,
): Promise<CampaignLeadTableResult> {
  const supportedSortColumns = new Set([
    'email',
    'name',
    'first_name',
    'last_name',
    'company_name',
    'website',
    'linkedin_url',
    'company_linkedin_url',
    'phone_number',
    'source',
    'status',
    'created_at',
  ]);
  const sortBy = supportedSortColumns.has(query?.sortBy ?? '') ? query?.sortBy! : 'created_at';
  const ascending = query?.sortDirection === 'asc';
  const limit = query?.limit ?? 20;
  const offset = query?.offset ?? 0;
  const searchTerm = query?.search?.trim();

  let leadsQuery = supabase
    .from('leads')
    .select(
      'id, email, name, first_name, last_name, company_name, website, linkedin_url, company_linkedin_url, phone_number, source, custom_lead_data, status, created_at',
      { count: 'exact' },
    )
    .eq('campaign_id', campaignId);

  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    leadsQuery = leadsQuery.or(
      `email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},company_name.ilike.${pattern},phone_number.ilike.${pattern},website.ilike.${pattern},linkedin_url.ilike.${pattern}`,
    );
  }

  const { data, error, count } = await leadsQuery
    .order(sortBy, { ascending, nullsFirst: !ascending })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const leadRows = (data ?? []) as Array<
    Pick<
      CampaignLeadTableRow,
      | 'id'
      | 'email'
      | 'name'
      | 'first_name'
      | 'last_name'
      | 'company_name'
      | 'website'
      | 'linkedin_url'
      | 'company_linkedin_url'
      | 'phone_number'
      | 'source'
      | 'custom_lead_data'
      | 'status'
      | 'created_at'
    >
  >;
  const leadIds = leadRows.map((lead) => lead.id);
  const enrollmentByLeadId = new Map<
    string,
    {
      state: CampaignLeadTableRow['enrollment_state'];
      current_node_id: string | null;
      stopped_reason: CampaignLeadTableRow['enrollment_stopped_reason'];
      stopped_error_message: string | null;
    }
  >();

  if (leadIds.length > 0) {
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('enrollments')
      .select('lead_id, state, current_node_id, stopped_reason, stopped_error_message')
      .eq('campaign_id', campaignId)
      .in('lead_id', leadIds);
    if (enrollmentsError) {
      throw new Error(`Failed to fetch enrollments: ${enrollmentsError.message}`);
    }
    for (const enrollment of enrollments ?? []) {
      enrollmentByLeadId.set(enrollment.lead_id, {
        state: enrollment.state as CampaignLeadTableRow['enrollment_state'],
        current_node_id: enrollment.current_node_id,
        stopped_reason: enrollment.stopped_reason as CampaignLeadTableRow['enrollment_stopped_reason'],
        stopped_error_message: enrollment.stopped_error_message,
      });
    }
  }

  return {
    rows: leadRows.map((lead) => {
      const enrollment = enrollmentByLeadId.get(lead.id);
      return {
        ...lead,
        enrollment_state: enrollment?.state ?? null,
        enrollment_current_node_id: enrollment?.current_node_id ?? null,
        enrollment_stopped_reason: enrollment?.stopped_reason ?? null,
        enrollment_stopped_error_message: enrollment?.stopped_error_message ?? null,
      };
    }),
    totalCount: count ?? 0,
  };
}

export interface LeadCountFilters {
  campaignId?: string;
  bucketId?: string;
  /** Count only leads where any of these fields is null or empty. Prefix custom fields with "custom." */
  missingFields?: string[];
}

/**
 * Get total lead count with optional filters (count-only query, no row limit).
 */
export async function getLeadCount(filters?: LeadCountFilters): Promise<number> {
  let query = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true }) as any;

  if (filters?.campaignId) {
    query = query.eq('campaign_id', filters.campaignId);
  }

  if (filters?.bucketId) {
    query = query.eq('bucket_id', filters.bucketId);
  }

  if (filters?.missingFields?.length) {
    const conditions: string[] = [];
    for (const field of filters.missingFields) {
      if (field.startsWith('custom.')) {
        const jsonKey = field.slice(7);
        conditions.push(`custom_lead_data->>${jsonKey}.is.null`);
        conditions.push(`custom_lead_data->>${jsonKey}.eq.`);
      } else {
        conditions.push(`${field}.is.null`);
        conditions.push(`${field}.eq.`);
      }
    }
    query = query.or(conditions.join(','));
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch lead count: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Get a single lead by ID
 */
export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch lead: ${error.message}`);
  }

  return data;
}

/**
 * Get leads by IDs (batch). Returns empty array if ids is empty.
 */
export async function getLeadsByIds(ids: string[]): Promise<Lead[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Create a new lead
 */
export async function createLead(lead: LeadInsert): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      ...lead,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create lead: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create lead: No data returned');
  }

  return data;
}

/**
 * Create multiple leads (bulk insert)
 */
export async function createLeads(leads: LeadInsert[]): Promise<Lead[]> {
  if (leads.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const leadsWithTimestamps = leads.map(lead => ({
    ...lead,
    created_at: now,
    updated_at: now,
  }));

  const { data, error } = await supabase
    .from('leads')
    .insert(leadsWithTimestamps)
    .select();

  if (error) {
    throw new Error(`Failed to create leads: ${error.message}`);
  }

  return data || [];
}

/**
 * Update a lead
 */
export async function updateLead(id: string, updates: LeadUpdate): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update lead: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update lead: No data returned');
  }

  return data;
}

/**
 * Delete a lead (soft delete - sets status to 'removed')
 */
export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete lead: ${error.message}`);
  }
}

/**
 * Hard delete a lead (permanent removal)
 */
export async function hardDeleteLead(id: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete lead: ${error.message}`);
  }
}

