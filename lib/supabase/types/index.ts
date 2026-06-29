/**
 * Central export for all database types
 * Import from here to keep imports clean
 */

import { Database } from './database';

export type Account = Database['public']['Tables']['accounts']['Row'];
export type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
export type AccountUpdate = Database['public']['Tables']['accounts']['Update'];
export type AccountBilling = Database['public']['Tables']['account_billing']['Row'];
export type AccountBillingInsert = Database['public']['Tables']['account_billing']['Insert'];
export type AccountBillingUpdate = Database['public']['Tables']['account_billing']['Update'];

export type AccountUser = Database['public']['Tables']['account_users']['Row'];
export type AccountUserInsert = Database['public']['Tables']['account_users']['Insert'];
export type AccountUserUpdate = Database['public']['Tables']['account_users']['Update'];
export type AccountApiKey = Database['public']['Tables']['account_api_keys']['Row'];
export type AccountApiKeyInsert = Database['public']['Tables']['account_api_keys']['Insert'];
export type AccountApiKeyUpdate = Database['public']['Tables']['account_api_keys']['Update'];
export type ApiIdempotencyKey = Database['public']['Tables']['api_idempotency_keys']['Row'];
export type ApiRateLimitBucket = Database['public']['Tables']['api_rate_limit_buckets']['Row'];
export type ApiImportJob = Database['public']['Tables']['api_import_jobs']['Row'];

// Export commonly used types
export type Campaign = Database['public']['Tables']['campaigns']['Row'];
export type CampaignInsert = Database['public']['Tables']['campaigns']['Insert'];
export type CampaignUpdate = Database['public']['Tables']['campaigns']['Update'];
export type CampaignFlowVersion = Database['public']['Tables']['campaign_flow_versions']['Row'];

export type Lead = Database['public']['Tables']['leads']['Row'];
export type LeadInsert = Database['public']['Tables']['leads']['Insert'];
export type LeadUpdate = Database['public']['Tables']['leads']['Update'];
export type LeadReplacement = Database['public']['Tables']['lead_replacements']['Row'];
export type LeadReplacementInsert = Database['public']['Tables']['lead_replacements']['Insert'];
export type LeadReplacementUpdate = Database['public']['Tables']['lead_replacements']['Update'];
export type LeadReplacementStatus = Database['public']['Enums']['lead_replacement_status_enum'];
export type ReplacementReason = Database['public']['Enums']['replacement_reason_enum'];

// lead_states removed - replaced by enrollments
// export type LeadState = Database['public']['Tables']['lead_states']['Row'];
// export type LeadStateInsert = Database['public']['Tables']['lead_states']['Insert'];
// export type LeadStateUpdate = Database['public']['Tables']['lead_states']['Update'];

export type User = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];

export type UserAccessFlag = Database['public']['Tables']['user_access_flags']['Row'];
export type UserAccessFlagInsert = Database['public']['Tables']['user_access_flags']['Insert'];

export type UserOnboardingState = Database['public']['Tables']['user_onboarding_state']['Row'];
export type UserOnboardingStateInsert = Database['public']['Tables']['user_onboarding_state']['Insert'];
export type UserOnboardingStateUpdate = Database['public']['Tables']['user_onboarding_state']['Update'];

export type Invitation = Database['public']['Tables']['invitations']['Row'];
export type InvitationInsert = Database['public']['Tables']['invitations']['Insert'];
export type InvitationUpdate = Database['public']['Tables']['invitations']['Update'];
export type PlatformInvitation = Database['public']['Tables']['platform_invitations']['Row'];
export type PlatformInvitationInsert = Database['public']['Tables']['platform_invitations']['Insert'];
export type PlatformInvitationUpdate = Database['public']['Tables']['platform_invitations']['Update'];
export type PlatformInvitationRevision = Database['public']['Tables']['platform_invitation_revisions']['Row'];
export type PlatformInvitationRevisionInsert = Database['public']['Tables']['platform_invitation_revisions']['Insert'];
export type PlatformInvitationRevisionUpdate = Database['public']['Tables']['platform_invitation_revisions']['Update'];
export type PlatformTermsVersion = Database['public']['Tables']['platform_terms_versions']['Row'];
export type PlatformTermsVersionInsert = Database['public']['Tables']['platform_terms_versions']['Insert'];
export type BillingAdjustment = Database['public']['Tables']['billing_adjustments']['Row'];
export type BillingAdjustmentInsert = Database['public']['Tables']['billing_adjustments']['Insert'];
export type BillingAdjustmentUpdate = Database['public']['Tables']['billing_adjustments']['Update'];

export type Mailbox = Database['public']['Tables']['mailboxes']['Row'];
export type MailboxInsert = Database['public']['Tables']['mailboxes']['Insert'];
export type MailboxUpdate = Database['public']['Tables']['mailboxes']['Update'];
export type MailboxTag = Database['public']['Tables']['mailbox_tags']['Row'];
export type MailboxTagInsert = Database['public']['Tables']['mailbox_tags']['Insert'];
export type MailboxTagUpdate = Database['public']['Tables']['mailbox_tags']['Update'];
export type MailboxTagAssignment = Database['public']['Tables']['mailbox_tag_assignments']['Row'];

export type EmailThread = Database['public']['Tables']['email_threads']['Row'];
export type EmailThreadInsert = Database['public']['Tables']['email_threads']['Insert'];
export type EmailThreadUpdate = Database['public']['Tables']['email_threads']['Update'];

export type EmailMessage = Database['public']['Tables']['email_messages']['Row'];
export type EmailMessageInsert = Database['public']['Tables']['email_messages']['Insert'];
export type EmailMessageUpdate = Database['public']['Tables']['email_messages']['Update'];
export type InboxInteraction = Database['public']['Tables']['inbox_interactions']['Row'];
export type InboxInteractionInsert = Database['public']['Tables']['inbox_interactions']['Insert'];
export type InboxInteractionUpdate = Database['public']['Tables']['inbox_interactions']['Update'];

export type BlockListEntry = Database['public']['Tables']['block_list']['Row'];
export type BlockListEntryInsert = Database['public']['Tables']['block_list']['Insert'];
export type BlockListEntryUpdate = Database['public']['Tables']['block_list']['Update'];
export type WebhookEvent = Database['public']['Tables']['webhook_events']['Row'];
export type WebhookEventInsert = Database['public']['Tables']['webhook_events']['Insert'];
export type WebhookDelivery = Database['public']['Tables']['webhook_deliveries']['Row'];
export type WebhookDeliveryInsert = Database['public']['Tables']['webhook_deliveries']['Insert'];

export type SmartleadMigrationRun = Database['public']['Tables']['smartlead_migration_runs']['Row'];
export type SmartleadMigrationRunInsert = Database['public']['Tables']['smartlead_migration_runs']['Insert'];
export type SmartleadMigrationRunUpdate = Database['public']['Tables']['smartlead_migration_runs']['Update'];

export type SmartleadMigrationCampaign = Database['public']['Tables']['smartlead_migration_campaigns']['Row'];
export type SmartleadMigrationCampaignInsert = Database['public']['Tables']['smartlead_migration_campaigns']['Insert'];
export type SmartleadMigrationCampaignUpdate = Database['public']['Tables']['smartlead_migration_campaigns']['Update'];

export type SmartleadMigrationEvent = Database['public']['Tables']['smartlead_migration_events']['Row'];
export type SmartleadMigrationEventInsert = Database['public']['Tables']['smartlead_migration_events']['Insert'];
export type SmartleadMigrationEventUpdate = Database['public']['Tables']['smartlead_migration_events']['Update'];

// Flux (personalized prospect landing pages) — domain types in lib/flux/types.ts
export type {
  FluxCampaignRow,
  FluxCampaignTemplateRow,
  FluxProspectRow,
  FluxProspectPageRow,
} from '@/lib/flux/types';
