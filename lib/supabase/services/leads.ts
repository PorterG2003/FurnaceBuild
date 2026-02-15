import { supabase } from '../client';
import type { Lead, LeadInsert, LeadUpdate } from '../types';

/**
 * Lead service for database operations
 * Handles all CRUD operations for leads
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
}

/**
 * Generate global lead ID from email (SHA-256 hash)
 * This matches the database function generate_global_lead_id
 */
export async function generateGlobalLeadId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  
  // Use Web Crypto API for SHA-256 hashing (web only)
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(email.toLowerCase().trim());
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    } catch (error) {
      console.error('Failed to generate global lead ID:', error);
      return null;
    }
  }
  
  // Fallback: return null and let database handle it
  return null;
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

/** Display name for a lead: name, or first + last, or email */
export function getLeadDisplayName(lead: Lead | null): string {
  if (!lead) return '';
  if (lead.name && lead.name.trim()) return lead.name.trim();
  const firstLast = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  if (firstLast) return firstLast;
  if (lead.email && lead.email.trim()) return lead.email.trim();
  return '';
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

