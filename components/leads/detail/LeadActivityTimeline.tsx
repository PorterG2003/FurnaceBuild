import { View, Text, ScrollView } from 'react-native';
import { format } from 'date-fns';
import { LeadActivityTimelineSkeleton } from '@/components/skeletons';
import { Alert, EmptyState } from '@/components/ui/feedback';
import type { LeadReplacementSummary } from '@/lib/leads/replacementSummary';
import type { LeadActivityItem } from '@/lib/leads/activity/loadLeadActivity';
import {
  EnvelopeIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  EyeIcon,
  CursorArrowRaysIcon,
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
} from 'react-native-heroicons/outline';

function getActivityIcon(type: LeadActivityItem['type']) {
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
    case 'lead_replaced':
      return <ArrowPathIcon size={20} color="#FDBA74" />;
    default:
      return <ClockIcon size={20} color="#6b7280" />;
  }
}

function getActivityLabel(item: LeadActivityItem) {
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
    case 'lead_replaced':
      return 'Lead Replaced';
    default:
      return 'Activity';
  }
}

export function LeadActivityTimeline({
  activities,
  loading,
  error,
  replacementSummary = null,
  maxHeight,
  flat = false,
}: {
  activities: LeadActivityItem[];
  loading?: boolean;
  error?: string | null;
  replacementSummary?: LeadReplacementSummary | null;
  maxHeight?: number;
  /** Mobile drill-in: list rows without per-item cards. */
  flat?: boolean;
}) {
  if (loading) {
    return <LeadActivityTimelineSkeleton flat={flat} />;
  }

  if (error) {
    return <Alert variant="error" message={error} className={maxHeight != null ? 'my-2' : undefined} />;
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description={
          flat || maxHeight != null
            ? undefined
            : 'No emails, enrollments, or other events have been recorded for this campaign membership yet.'
        }
        className={maxHeight != null || flat ? 'py-10' : undefined}
      />
    );
  }

  const content = (
    <View className={flat ? 'gap-0' : 'gap-4'}>
      {replacementSummary?.role === 'new' ? (
        <View className="rounded-xl border border-[#F973164D] bg-[#F973161A] px-4 py-3">
          <Text className="text-sm font-instrument-medium text-[#FDBA74]">
            This lead continues the campaign after replacing{' '}
            {replacementSummary.counterpartLabel || replacementSummary.counterpartEmail || 'the previous lead'}.
          </Text>
        </View>
      ) : null}
      {activities.map((item, index) => {
        const isModal = maxHeight != null;
        const isLast = index === activities.length - 1;
        return (
        <View
          key={item.id}
          className={
            isModal
              ? 'flex-row gap-4 relative'
              : flat
                ? `flex-row gap-3 py-3 ${isLast ? '' : 'border-b border-[#2A2A2A]'}`
                : 'flex-row gap-4 rounded-lg border border-[#2A2A2A] bg-[#181818] px-3 py-3'
          }
        >
          {isModal && index < activities.length - 1 ? (
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
          ) : null}

          <View className="relative z-10 mt-0.5">
            {getActivityIcon(item.type)}
          </View>

          <View className={`flex-1 min-w-0 ${isModal ? 'pb-4' : ''}`}>
            <View className="flex-row items-start justify-between mb-1">
              <Text className="text-white font-instrument-semibold text-sm flex-1">
                {getActivityLabel(item)}
              </Text>
              <Text className="text-gray-500 font-instrument text-xs ml-2 shrink-0">
                {format(new Date(item.timestamp), flat ? 'MMM d' : 'MMM d, h:mm a')}
              </Text>
            </View>

            {item.subject && !flat ? (
              <Text className="text-gray-300 font-instrument text-sm mb-1">{item.subject}</Text>
            ) : null}

            {item.details && !flat ? (
              <Text className="text-gray-400 font-instrument text-xs">{item.details}</Text>
            ) : null}

            {item.status && item.status !== 'sent' ? (
              <View className="mt-2 self-start px-2 py-1 rounded" style={{ backgroundColor: '#6b728020' }}>
                <Text className="text-xs font-instrument-semibold text-gray-500">{item.status}</Text>
              </View>
            ) : null}
          </View>
        </View>
        );
      })}
    </View>
  );

  if (maxHeight != null) {
    return (
      <ScrollView style={{ maxHeight }}>
        {content}
      </ScrollView>
    );
  }

  return content;
}
