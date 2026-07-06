import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveCampaignStatsFromSent,
  type DerivedCampaignStats,
} from './demoHubSeed';

type DbClient = SupabaseClient;

export type SeedThreadStatsParams = {
  campaignId: string;
  leadId: string;
  enrollmentId: string;
  messageJobId: string;
  sentAt: string;
  replyAt?: string;
  isPositive?: boolean;
  source?: string;
};

const DEFAULT_SOURCE = 'seed:demo-hub';

export async function upsertCampaignStatsTotals(
  supabase: DbClient,
  params: {
    campaignId: string;
    accountId: string;
    stats: Pick<DerivedCampaignStats, 'sent' | 'replied' | 'positive'>;
  },
): Promise<void> {
  const timestamp = new Date().toISOString();
  const { error } = await supabase.from('campaign_stats').upsert(
    {
      campaign_id: params.campaignId,
      account_id: params.accountId,
      sent_count: params.stats.sent,
      replied_count: params.stats.replied,
      positive_reply_count: params.stats.positive,
      bounce_count: 0,
      last_bounce_at: null,
      updated_at: timestamp,
    } as any,
    { onConflict: 'campaign_id' },
  );
  if (error) {
    throw new Error(`seedCampaignStats: campaign_stats upsert failed: ${error.message}`);
  }
}

export async function applyDerivedCampaignStats(
  supabase: DbClient,
  params: {
    campaignId: string;
    accountId: string;
    targetSent: number;
    replyRate?: number;
    positiveShareOfReplies?: number;
  },
): Promise<DerivedCampaignStats> {
  const stats = deriveCampaignStatsFromSent(
    params.targetSent,
    params.replyRate,
    params.positiveShareOfReplies,
  );
  if (stats.sent === 0) {
    return stats;
  }
  await upsertCampaignStatsTotals(supabase, {
    campaignId: params.campaignId,
    accountId: params.accountId,
    stats,
  });
  return stats;
}

async function updateEventCreatedAt(
  supabase: DbClient,
  params: {
    campaignId: string;
    messageJobId: string;
    eventType: 'sent' | 'replied';
    createdAt: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ created_at: params.createdAt })
    .eq('campaign_id', params.campaignId)
    .eq('message_job_id', params.messageJobId)
    .eq('event_type', params.eventType);
  if (error) {
    throw new Error(`seedCampaignStats: ${params.eventType} event timestamp update failed: ${error.message}`);
  }
}

export async function seedThreadSentAndRepliedEvents(
  supabase: DbClient,
  params: SeedThreadStatsParams,
): Promise<void> {
  const source = params.source ?? DEFAULT_SOURCE;
  const sentEventData = {
    provider_message_id: `<demo-hub-${params.messageJobId}-sent@demo.furnace.test>`,
    sent_at: params.sentAt,
    source,
  };

  const { error: sentErr } = await supabase.rpc('record_sent_event_and_increment', {
    p_campaign_id: params.campaignId,
    p_lead_id: params.leadId,
    p_enrollment_id: params.enrollmentId,
    p_message_job_id: params.messageJobId,
    p_event_data: sentEventData,
  });
  if (sentErr) {
    throw new Error(`seedCampaignStats: record_sent_event_and_increment failed: ${sentErr.message}`);
  }
  await updateEventCreatedAt(supabase, {
    campaignId: params.campaignId,
    messageJobId: params.messageJobId,
    eventType: 'sent',
    createdAt: params.sentAt,
  });

  if (!params.replyAt) {
    return;
  }

  if (params.isPositive) {
    const { error: categoryErr } = await supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'system',
        updated_at: params.replyAt,
      })
      .eq('campaign_id', params.campaignId)
      .eq('lead_id', params.leadId);
    if (categoryErr) {
      throw new Error(`seedCampaignStats: positive category update failed: ${categoryErr.message}`);
    }
  }

  const replyEventData = {
    detected_at: params.replyAt,
    source,
  };
  const { error: repliedErr } = await supabase.rpc('record_replied_event_and_increment', {
    p_campaign_id: params.campaignId,
    p_lead_id: params.leadId,
    p_enrollment_id: params.enrollmentId,
    p_message_job_id: params.messageJobId,
    p_event_data: replyEventData,
    p_is_positive: params.isPositive === true,
  });
  if (repliedErr) {
    throw new Error(`seedCampaignStats: record_replied_event_and_increment failed: ${repliedErr.message}`);
  }
  await updateEventCreatedAt(supabase, {
    campaignId: params.campaignId,
    messageJobId: params.messageJobId,
    eventType: 'replied',
    createdAt: params.replyAt,
  });
}

export async function applyDemoHubCampaignStats(
  supabase: DbClient,
  params: {
    campaignId: string;
    accountId: string;
    targetSent: number;
    replyRate?: number;
    positiveShareOfReplies?: number;
  },
): Promise<DerivedCampaignStats> {
  return applyDerivedCampaignStats(supabase, params);
}
