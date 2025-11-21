/**
 * Central export for all database types
 * Import from here to keep imports clean
 */

import { Database } from './database';

export type Account = Database['public']['Tables']['accounts']['Row'];
export type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
export type AccountUpdate = Database['public']['Tables']['accounts']['Update'];

export type AccountUser = Database['public']['Tables']['account_users']['Row'];
export type AccountUserInsert = Database['public']['Tables']['account_users']['Insert'];
export type AccountUserUpdate = Database['public']['Tables']['account_users']['Update'];

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

export type User = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];

export type Invitation = Database['public']['Tables']['invitations']['Row'];
export type InvitationInsert = Database['public']['Tables']['invitations']['Insert'];
export type InvitationUpdate = Database['public']['Tables']['invitations']['Update'];

export type Mailbox = Database['public']['Tables']['mailboxes']['Row'];
export type MailboxInsert = Database['public']['Tables']['mailboxes']['Insert'];
export type MailboxUpdate = Database['public']['Tables']['mailboxes']['Update'];


