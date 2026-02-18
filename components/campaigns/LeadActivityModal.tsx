import { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { supabase } from '@/lib/supabase/client';
import { format } from 'date-fns';
import {
  EnvelopeIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  EyeIcon,
  CursorArrowRaysIcon,
  ChatBubbleLeftRightIcon,
} from 'react-native-heroicons/outline';

interface LeadActivityModalProps {
  visible: boolean;
  onClose: () => void;
  leadId: string;
  campaignId: string;
  leadEmail: string;
  leadName: string | null;
}

interface ActivityItem {
  id: string;
  timestamp: string;
  type: 'enrollment_started' | 'email_scheduled' | 'email_sent' | 'email_failed' | 'email_opened' | 'email_clicked' | 'email_replied' | 'node_progress';
  nodeLabel?: string;
  nodeType?: string;
  subject?: string;
  status?: string;
  details?: string;
}

export function LeadActivityModal({
  visible,
  onClose,
  leadId,
  campaignId,
  leadEmail,
  leadName,
}: LeadActivityModalProps) {
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !leadId || !campaignId) {
      return;
    }

    const loadActivity = async () => {
      try {
        setLoading(true);
        setError(null);

        const activityItems: ActivityItem[] = [];

        // Load enrollment (for enrollment_started and current position)
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('created_at, updated_at, current_node_id, state')
          .eq('lead_id', leadId)
          .eq('campaign_id', campaignId)
          .single();

        if (enrollment) {
          // Enrollment started
          activityItems.push({
            id: `enrollment-${enrollment.created_at}`,
            timestamp: enrollment.created_at,
            type: 'enrollment_started',
            details: 'Lead entered campaign',
          });

          // Node progress (if current_node_id exists)
          if (enrollment.current_node_id) {
            const { data: node } = await supabase
              .from('nodes')
              .select('flow_node_id, node_type, node_data')
              .eq('id', enrollment.current_node_id)
              .single();

            if (node) {
              const nodeData = (node.node_data as any) || {};
              activityItems.push({
                id: `node-progress-${enrollment.updated_at}`,
                timestamp: enrollment.updated_at,
                type: 'node_progress',
                nodeLabel: nodeData.label || node.flow_node_id,
                nodeType: node.node_type,
                details: `At ${nodeData.label || node.flow_node_id} (${enrollment.state})`,
              });
            }
          }
        }

        // Load message jobs (emails)
        const { data: messageJobs } = await supabase
          .from('message_jobs')
          .select('id, created_at, scheduled_at, sent_at, status, message_data, node_id, updated_at')
          .eq('lead_id', leadId)
          .eq('campaign_id', campaignId)
          .order('created_at', { ascending: true });

        // Load nodes for message jobs
        const nodeIds = messageJobs?.map((job: any) => job.node_id).filter(Boolean) || [];
        const nodesMap = new Map();
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
            const node = nodesMap.get(job.node_id);
            if (!node) continue;
            const nodeData = (node.node_data as any) || {};
            const messageData = (job.message_data as any) || {};

            // Email scheduled
            activityItems.push({
              id: `job-scheduled-${job.id}`,
              timestamp: job.created_at,
              type: 'email_scheduled',
              nodeLabel: nodeData.label || node.flow_node_id,
              nodeType: node.node_type,
              subject: messageData.subject,
              status: job.status,
              details: `Scheduled: ${format(new Date(job.scheduled_at), 'MMM d, h:mm a')}`,
            });

            // Email sent or failed
            if (job.sent_at) {
              activityItems.push({
                id: `job-sent-${job.id}`,
                timestamp: job.sent_at,
                type: job.status === 'failed' ? 'email_failed' : 'email_sent',
                nodeLabel: nodeData.label || node.flow_node_id,
                nodeType: node.node_type,
                subject: messageData.subject,
                status: job.status,
                details: job.status === 'failed' ? 'Failed to send' : 'Email sent',
              });
            } else if (job.status === 'failed') {
              activityItems.push({
                id: `job-failed-${job.id}`,
                timestamp: job.updated_at,
                type: 'email_failed',
                nodeLabel: nodeData.label || node.flow_node_id,
                nodeType: node.node_type,
                subject: messageData.subject,
                status: job.status,
                details: 'Failed to send',
              });
            }
          }
        }

        // Load events (opened, clicked, replied)
        const { data: events } = await supabase
          .from('events')
          .select('id, event_type, created_at, message_job_id')
          .eq('lead_id', leadId)
          .eq('campaign_id', campaignId)
          .in('event_type', ['opened', 'clicked', 'replied'])
          .order('created_at', { ascending: true });

        // Load message jobs for events to get node info (reuse nodesMap if possible)
        const eventJobIds = events?.map((e: any) => e.message_job_id).filter(Boolean) || [];
        const eventJobsMap = new Map();
        if (eventJobIds.length > 0) {
          const { data: eventJobs } = await supabase
            .from('message_jobs')
            .select('id, node_id')
            .in('id', eventJobIds);

          if (eventJobs) {
            eventJobs.forEach((job: any) => {
              eventJobsMap.set(job.id, job);
            });
          }
        }

        if (events) {
          for (const event of events) {
            const job = eventJobsMap.get(event.message_job_id);
            if (!job) continue;
            const node = nodesMap.get(job.node_id);
            if (!node) continue;
            const nodeData = (node.node_data as any) || {};

            let type: ActivityItem['type'];
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
              nodeLabel: nodeData.label || node.flow_node_id,
              nodeType: node.node_type,
              details,
            });
          }
        }

        // Sort all activities by timestamp
        activityItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        setActivities(activityItems);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadActivity();
  }, [visible, leadId, campaignId]);

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'enrollment_started':
        return <CheckCircleIcon size={20} color="#10b981" />;
      case 'email_scheduled':
        return <ClockIcon size={20} color="#6b7280" />;
      case 'email_sent':
        return <EnvelopeIcon size={20} color="#3b82f6" />;
      case 'email_failed':
        return <XCircleIcon size={20} color="#ef4444" />;
      case 'email_opened':
        return <EyeIcon size={20} color="#10b981" />;
      case 'email_clicked':
        return <CursorArrowRaysIcon size={20} color="#3b82f6" />;
      case 'email_replied':
        return <ChatBubbleLeftRightIcon size={20} color="#f59e0b" />;
      case 'node_progress':
        return <ClockIcon size={20} color="#8b5cf6" />;
      default:
        return <ClockIcon size={20} color="#6b7280" />;
    }
  };

  const getActivityLabel = (item: ActivityItem) => {
    switch (item.type) {
      case 'enrollment_started':
        return 'Enrollment Started';
      case 'email_scheduled':
        return item.nodeLabel ? `Email Scheduled: ${item.nodeLabel}` : 'Email Scheduled';
      case 'email_sent':
        return item.nodeLabel ? `Email Sent: ${item.nodeLabel}` : 'Email Sent';
      case 'email_failed':
        return item.nodeLabel ? `Email Failed: ${item.nodeLabel}` : 'Email Failed';
      case 'email_opened':
        return item.nodeLabel ? `Email Opened: ${item.nodeLabel}` : 'Email Opened';
      case 'email_clicked':
        return item.nodeLabel ? `Link Clicked: ${item.nodeLabel}` : 'Link Clicked';
      case 'email_replied':
        return item.nodeLabel ? `Replied: ${item.nodeLabel}` : 'Replied';
      case 'node_progress':
        return item.nodeLabel ? `Node: ${item.nodeLabel}` : 'Node Progress';
      default:
        return 'Activity';
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={`Activity: ${leadName || leadEmail}`}
      description={leadEmail}
      maxWidth="2xl"
    >
      {loading ? (
        <View className="py-12 items-center">
          <ActivityIndicator size="large" color="#f85102" />
          <Text className="mt-4 text-gray-400 font-instrument text-sm">Loading activity...</Text>
        </View>
      ) : error ? (
        <View className="py-12 items-center">
          <Text className="text-red-400 font-instrument text-sm">Error: {error}</Text>
        </View>
      ) : activities.length === 0 ? (
        <View className="py-12 items-center">
          <Text className="text-gray-400 font-instrument text-sm">No activity found</Text>
        </View>
      ) : (
        <ScrollView className="max-h-[600px]">
          <View className="gap-4">
            {activities.map((item, index) => (
              <View key={item.id} className="flex-row gap-4 relative">
                {/* Timeline line */}
                {index < activities.length - 1 && (
                  <View
                    className="absolute"
                    style={{
                      left: 10,
                      top: 28,
                      width: 2,
                      height: '100%',
                      backgroundColor: '#2A2A2A',
                    }}
                  />
                )}

                {/* Icon */}
                <View className="relative z-10 mt-0.5">
                  {getActivityIcon(item.type)}
                </View>

                {/* Content */}
                <View className="flex-1 pb-4">
                  <View className="flex-row items-start justify-between mb-1">
                    <Text className="text-white font-instrument-semibold text-sm flex-1">
                      {getActivityLabel(item)}
                    </Text>
                    <Text className="text-gray-500 font-instrument text-xs ml-2">
                      {format(new Date(item.timestamp), 'MMM d, h:mm a')}
                    </Text>
                  </View>

                  {item.subject && (
                    <Text className="text-gray-300 font-instrument text-sm mb-1">
                      {item.subject}
                    </Text>
                  )}

                  {item.details && (
                    <Text className="text-gray-400 font-instrument text-xs">
                      {item.details}
                    </Text>
                  )}

                  {item.status && item.status !== 'sent' && (
                    <View className="mt-2 self-start px-2 py-1 rounded" style={{ backgroundColor: '#6b728020' }}>
                      <Text className="text-xs font-instrument-semibold text-gray-500">
                        {item.status}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </BaseModal>
  );
}
