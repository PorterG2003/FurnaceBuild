import { format } from 'date-fns';
import { supabase } from '@/lib/supabase/client';
import type { LeadReplacementSummary } from '@/lib/leads/replacementSummary';

export type LeadActivityItemType =
  | 'enrollment_started'
  | 'email_scheduled'
  | 'email_sent'
  | 'email_failed'
  | 'email_opened'
  | 'email_clicked'
  | 'email_replied'
  | 'node_progress'
  | 'lead_replaced';

export interface LeadActivityItem {
  id: string;
  timestamp: string;
  type: LeadActivityItemType;
  nodeLabel?: string;
  nodeType?: string;
  subject?: string;
  status?: string;
  details?: string;
}

export async function loadLeadActivityForMembership(
  leadId: string,
  campaignId: string,
  replacementSummary: LeadReplacementSummary | null = null,
): Promise<LeadActivityItem[]> {
  const activityItems: LeadActivityItem[] = [];

  const historicalLeadIds =
    replacementSummary?.role === 'new' && replacementSummary.counterpartLeadId
      ? [leadId, replacementSummary.counterpartLeadId]
      : [leadId];

  if (replacementSummary?.role === 'new') {
    activityItems.push({
      id: `lead-replaced-${replacementSummary.replacementId}`,
      timestamp: replacementSummary.completedAt ?? replacementSummary.createdAt,
      type: 'lead_replaced',
      details: `Replaced ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'previous lead'}`,
    });
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('created_at, updated_at, current_node_id, state')
    .eq('lead_id', leadId)
    .eq('campaign_id', campaignId)
    .single();

  if (enrollment) {
    activityItems.push({
      id: `enrollment-${enrollment.created_at}`,
      timestamp: enrollment.created_at,
      type: 'enrollment_started',
      details: 'Lead entered campaign',
    });

    if (enrollment.current_node_id) {
      const { data: node } = await supabase
        .from('nodes')
        .select('flow_node_id, node_type, node_data')
        .eq('id', enrollment.current_node_id)
        .single();

      if (node) {
        const nodeData = (node.node_data as Record<string, unknown>) || {};
        activityItems.push({
          id: `node-progress-${enrollment.updated_at}`,
          timestamp: enrollment.updated_at,
          type: 'node_progress',
          nodeLabel: String(nodeData.label || node.flow_node_id),
          nodeType: node.node_type,
          details: `At ${String(nodeData.label || node.flow_node_id)} (${enrollment.state})`,
        });
      }
    }
  }

  const { data: messageJobs } = await supabase
    .from('message_jobs')
    .select('id, lead_id, created_at, scheduled_at, sent_at, status, message_data, node_id, updated_at')
    .in('lead_id', historicalLeadIds)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  const nodeIds = messageJobs?.map((job) => job.node_id).filter(Boolean) || [];
  const nodesMap = new Map<string, { flow_node_id: string; node_type: string; node_data: unknown }>();
  if (nodeIds.length > 0) {
    const { data: nodes } = await supabase
      .from('nodes')
      .select('id, flow_node_id, node_type, node_data')
      .in('id', nodeIds);

    if (nodes) {
      nodes.forEach((node) => {
        nodesMap.set(node.id, node);
      });
    }
  }

  if (messageJobs) {
    for (const job of messageJobs) {
      const node = job.node_id ? nodesMap.get(job.node_id) : undefined;
      if (!node) continue;
      const nodeData = (node.node_data as Record<string, unknown>) || {};
      const messageData = (job.message_data as Record<string, unknown>) || {};
      const historyPrefix =
        job.lead_id !== leadId
          ? `Historical activity from ${replacementSummary?.counterpartLabel || replacementSummary?.counterpartEmail || 'previous lead'}`
          : null;

      activityItems.push({
        id: `job-scheduled-${job.id}`,
        timestamp: job.created_at,
        type: 'email_scheduled',
        nodeLabel: String(nodeData.label || node.flow_node_id),
        nodeType: node.node_type,
        subject: messageData.subject != null ? String(messageData.subject) : undefined,
        status: job.status ?? undefined,
        details: historyPrefix
          ? `${historyPrefix}. Scheduled: ${format(new Date(job.scheduled_at), 'MMM d, h:mm a')}`
          : `Scheduled: ${format(new Date(job.scheduled_at), 'MMM d, h:mm a')}`,
      });

      if (job.sent_at) {
        activityItems.push({
          id: `job-sent-${job.id}`,
          timestamp: job.sent_at,
          type: job.status === 'failed' ? 'email_failed' : 'email_sent',
          nodeLabel: String(nodeData.label || node.flow_node_id),
          nodeType: node.node_type,
          subject: messageData.subject != null ? String(messageData.subject) : undefined,
          status: job.status ?? undefined,
          details: historyPrefix
            ? `${historyPrefix}. ${job.status === 'failed' ? 'Failed to send' : 'Email sent'}`
            : job.status === 'failed'
              ? 'Failed to send'
              : 'Email sent',
        });
      } else if (job.status === 'failed') {
        activityItems.push({
          id: `job-failed-${job.id}`,
          timestamp: job.updated_at,
          type: 'email_failed',
          nodeLabel: String(nodeData.label || node.flow_node_id),
          nodeType: node.node_type,
          subject: messageData.subject != null ? String(messageData.subject) : undefined,
          status: job.status ?? undefined,
          details: historyPrefix ? `${historyPrefix}. Failed to send` : 'Failed to send',
        });
      }
    }
  }

  const { data: events } = await supabase
    .from('events')
    .select('id, lead_id, event_type, created_at, message_job_id')
    .in('lead_id', historicalLeadIds)
    .eq('campaign_id', campaignId)
    .in('event_type', ['opened', 'clicked', 'replied'])
    .order('created_at', { ascending: true });

  const eventJobIds = events?.map((event) => event.message_job_id).filter(Boolean) || [];
  const eventJobsMap = new Map<string, { id: string; node_id: string | null }>();
  if (eventJobIds.length > 0) {
    const { data: eventJobs } = await supabase
      .from('message_jobs')
      .select('id, node_id')
      .in('id', eventJobIds);

    if (eventJobs) {
      eventJobs.forEach((job) => {
        eventJobsMap.set(job.id, job);
      });
    }
  }

  if (events) {
    for (const event of events) {
      const job = event.message_job_id ? eventJobsMap.get(event.message_job_id) : undefined;
      if (!job?.node_id) continue;
      const node = nodesMap.get(job.node_id);
      if (!node) continue;
      const nodeData = (node.node_data as Record<string, unknown>) || {};

      let type: LeadActivityItem['type'];
      let details = '';

      switch (event.event_type) {
        case 'opened':
          type = 'email_opened';
          details = 'Email opened';
          break;
        case 'clicked':
          type = 'email_clicked';
          details = 'Link clicked';
          break;
        case 'replied':
          type = 'email_replied';
          details = 'Replied to email';
          break;
        default:
          continue;
      }

      activityItems.push({
        id: `event-${event.id}`,
        timestamp: event.created_at,
        type,
        nodeLabel: String(nodeData.label || node.flow_node_id),
        nodeType: node.node_type,
        details:
          event.lead_id !== leadId && replacementSummary?.role === 'new'
            ? `Historical activity from ${replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'previous lead'}. ${details}`
            : details,
      });
    }
  }

  activityItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return activityItems;
}
