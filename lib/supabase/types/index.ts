/**
 * Central export for all database types
 * Import from here to keep imports clean
 */

export type { Database } from './database';

// Export commonly used types
export type Campaign = Database['public']['Tables']['campaigns']['Row'];
export type CampaignInsert = Database['public']['Tables']['campaigns']['Insert'];
export type CampaignUpdate = Database['public']['Tables']['campaigns']['Update'];


