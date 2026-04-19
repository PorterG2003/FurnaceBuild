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
export type CampaignFlowVersion = Database['public']['Tables']['campaign_flow_versions']['Row'];

export type Lead = Database['public']['Tables']['leads']['Row'];
export type LeadInsert = Database['public']['Tables']['leads']['Insert'];
export type LeadUpdate = Database['public']['Tables']['leads']['Update'];

// lead_states removed - replaced by enrollments
// export type LeadState = Database['public']['Tables']['lead_states']['Row'];
// export type LeadStateInsert = Database['public']['Tables']['lead_states']['Insert'];
// export type LeadStateUpdate = Database['public']['Tables']['lead_states']['Update'];

export type User = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];

export type UserAccessFlag = Database['public']['Tables']['user_access_flags']['Row'];
export type UserAccessFlagInsert = Database['public']['Tables']['user_access_flags']['Insert'];

export type Invitation = Database['public']['Tables']['invitations']['Row'];
export type InvitationInsert = Database['public']['Tables']['invitations']['Insert'];
export type InvitationUpdate = Database['public']['Tables']['invitations']['Update'];

export type Mailbox = Database['public']['Tables']['mailboxes']['Row'];
export type MailboxInsert = Database['public']['Tables']['mailboxes']['Insert'];
export type MailboxUpdate = Database['public']['Tables']['mailboxes']['Update'];

export type EmailThread = Database['public']['Tables']['email_threads']['Row'];
export type EmailThreadInsert = Database['public']['Tables']['email_threads']['Insert'];
export type EmailThreadUpdate = Database['public']['Tables']['email_threads']['Update'];

export type EmailMessage = Database['public']['Tables']['email_messages']['Row'];
export type EmailMessageInsert = Database['public']['Tables']['email_messages']['Insert'];
export type EmailMessageUpdate = Database['public']['Tables']['email_messages']['Update'];

export type BlockListEntry = Database['public']['Tables']['block_list']['Row'];
export type BlockListEntryInsert = Database['public']['Tables']['block_list']['Insert'];
export type BlockListEntryUpdate = Database['public']['Tables']['block_list']['Update'];

export type SmartleadMigrationRun = Database['public']['Tables']['smartlead_migration_runs']['Row'];
export type SmartleadMigrationRunInsert = Database['public']['Tables']['smartlead_migration_runs']['Insert'];
export type SmartleadMigrationRunUpdate = Database['public']['Tables']['smartlead_migration_runs']['Update'];

export type SmartleadMigrationCampaign = Database['public']['Tables']['smartlead_migration_campaigns']['Row'];
export type SmartleadMigrationCampaignInsert = Database['public']['Tables']['smartlead_migration_campaigns']['Insert'];
export type SmartleadMigrationCampaignUpdate = Database['public']['Tables']['smartlead_migration_campaigns']['Update'];

export type SmartleadMigrationEvent = Database['public']['Tables']['smartlead_migration_events']['Row'];
export type SmartleadMigrationEventInsert = Database['public']['Tables']['smartlead_migration_events']['Insert'];
export type SmartleadMigrationEventUpdate = Database['public']['Tables']['smartlead_migration_events']['Update'];
