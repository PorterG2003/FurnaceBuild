import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignSchedule } from './schedule.js';

export declare function calculateNextMailboxSendTime(
  campaignId: string,
  mailboxId: string,
  currentTime: Date,
  campaignSchedule: CampaignSchedule | null,
  supabase: SupabaseClient,
): Promise<Date>;
