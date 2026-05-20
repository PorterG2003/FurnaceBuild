import crypto from 'node:crypto';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';
import { getCampaignCustomFieldKeys } from '../../../lib/client-api/flow-fields.js';
import type { Json } from '../../../lib/supabase/types/database.js';

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

async function enqueueWebhookEvent(eventId: string): Promise<void> {
  const queueUrl = process.env.WEBHOOK_QUEUE_URL?.trim();
  if (!queueUrl) {
    return;
  }
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ eventId }),
  }));
}

async function processJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from('api_import_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Failed to load import job: ${jobError.message}`);
  if (!job) return;
  if (job.status === 'completed') return;

  const { error: markRunningError } = await supabase
    .from('api_import_jobs')
    .update({ status: 'running', started_at: now, updated_at: now })
    .eq('id', job.id);
  if (markRunningError) throw new Error(`Failed to mark import job running: ${markRunningError.message}`);

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, account_id, bucket_id, flow_data, deleted_at')
    .eq('id', job.campaign_id)
    .maybeSingle();
  if (campaignError) throw new Error(`Failed to load campaign for import job: ${campaignError.message}`);
  if (!campaign || campaign.deleted_at) {
    throw new Error('Campaign not found or deleted');
  }

  const rows = Array.isArray((job.input as any)?.leads) ? ((job.input as any).leads as Record<string, unknown>[]) : [];
  const customFieldKeys = getCampaignCustomFieldKeys(campaign.flow_data);
  let processed = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (let index = 0; index < rows.length; index += 1) {
    const lead = rows[index] ?? {};
    try {
      const email = normalizeEmail(typeof lead.email === 'string' ? lead.email : null);
      if (!email) throw new Error('Lead email is required');
      const customLeadData = (lead.custom_lead_data ?? {}) as Record<string, unknown>;
      for (const key of customFieldKeys) {
        if (!(key in customLeadData)) {
          throw new Error(`Lead payload must include custom field "${key}"`);
        }
      }
      const { data: existing, error: existingError } = await supabase
        .from('leads')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('account_id', campaign.account_id!)
        .eq('email', email)
        .is('deleted_at', null)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      const patch = {
        email,
        name: typeof lead.name === 'string' ? lead.name.trim() || null : null,
        first_name: typeof lead.first_name === 'string' ? lead.first_name.trim() || null : null,
        last_name: typeof lead.last_name === 'string' ? lead.last_name.trim() || null : null,
        company_name: typeof lead.company_name === 'string' ? lead.company_name.trim() || null : null,
        website: typeof lead.website === 'string' ? lead.website.trim() || null : null,
        linkedin_url: typeof lead.linkedin_url === 'string' ? lead.linkedin_url.trim() || null : null,
        company_linkedin_url: typeof lead.company_linkedin_url === 'string' ? lead.company_linkedin_url.trim() || null : null,
        custom_lead_data: customLeadData as Json,
        source: 'api',
        updated_at: new Date().toISOString(),
      };
      let leadId: string;
      if (existing) {
        const { data, error } = await supabase
          .from('leads')
          .update(patch)
          .eq('id', existing.id)
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        leadId = data.id;
      } else {
        const { data, error } = await supabase
          .from('leads')
          .insert({
            ...patch,
            global_lead_id: sha256(email),
            campaign_id: campaign.id,
            bucket_id: campaign.bucket_id,
            account_id: campaign.account_id!,
            status: 'new',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        leadId = data.id;
        const { error: enrollmentError } = await supabase
          .from('enrollments')
          .upsert({
            campaign_id: campaign.id,
            account_id: campaign.account_id!,
            lead_id: leadId,
            current_node_id: null,
            state: 'active',
            next_run_at: new Date().toISOString(),
            flow_position: {},
            deleted_at: null,
          } as never, {
            onConflict: 'campaign_id,lead_id',
            ignoreDuplicates: true,
          });
        if (enrollmentError) throw new Error(enrollmentError.message);
      }
      processed += 1;
      const progress = Math.round(((index + 1) / Math.max(1, rows.length)) * 100);
      await supabase
        .from('api_import_jobs')
        .update({
          progress,
          result: { imported: processed, failed: errors.length },
          errors,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', job.id);
      const { data: webhookEvent, error: webhookInsertError } = await supabase
        .from('webhook_events')
        .insert({
          account_id: campaign.account_id!,
          campaign_id: campaign.id,
          event_type: existing ? 'lead.updated' : 'lead.created',
          payload: { campaign_id: campaign.id, lead_id: leadId, email },
          dedupe_key: `${existing ? 'lead.updated' : 'lead.created'}:${leadId}:${job.id}`,
        } as never)
        .select('id')
        .single();
      if (webhookInsertError) throw new Error(webhookInsertError.message);
      await enqueueWebhookEvent(webhookEvent.id);
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const completedAt = new Date().toISOString();
  const { error: finishError } = await supabase
    .from('api_import_jobs')
    .update({
      status: errors.length > 0 && processed === 0 ? 'failed' : 'completed',
      progress: 100,
      result: { imported: processed, failed: errors.length },
      errors,
      completed_at: completedAt,
      updated_at: completedAt,
    } as never)
    .eq('id', job.id);
  if (finishError) throw new Error(`Failed to finalize import job: ${finishError.message}`);
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body ?? '{}') as { jobId?: string };
      if (!parsed.jobId) continue;
      await processJob(parsed.jobId);
    } catch (error) {
      console.error('[clientApiBulkImport] failed record', error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
