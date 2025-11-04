/**
 * Central export for all database types
 * Import from here to keep imports clean
 */

import { Database } from './database';

// Export commonly used types
export type Campaign = Database['public']['Tables']['campaigns']['Row'];
export type CampaignInsert = Database['public']['Tables']['campaigns']['Insert'];
export type CampaignUpdate = Database['public']['Tables']['campaigns']['Update'];

export type Lead = Database['public']['Tables']['leads']['Row'];
export type LeadInsert = Database['public']['Tables']['leads']['Insert'];
export type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export type LeadState = Database['public']['Tables']['lead_states']['Row'];
export type LeadStateInsert = Database['public']['Tables']['lead_states']['Insert'];
export type LeadStateUpdate = Database['public']['Tables']['lead_states']['Update'];


