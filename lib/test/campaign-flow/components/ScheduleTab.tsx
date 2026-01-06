import { useState, useEffect, useMemo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { DataTable, type TableColumn } from './DataTable';

interface MessageJob {
  id: string;
  type: 'message_job';
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string;
  reserved_at: string | null;
  sent_at: string | null;
  interval_id: string | null;
  interval: {
    id: string;
    interval_start: string;
    interval_end: string;
    status: 'available' | 'locked' | 'scheduled' | 'completed';
  } | null;
  lead: {
    email: string | null;
    name: string | null;
  } | null;
  mailbox: {
    email_address: string;
  } | null;
  node: {
    id: string;
    node_data: any;
  } | null;
  message_data: any;
  error_message: string | null;
  retry_count: number;
}

interface Enrollment {
  id: string;
  type: 'enrollment';
  state: 'active' | 'paused' | 'stopped' | 'completed';
  next_run_at: string | null;
  current_node_id: string | null;
  lead: {
    email: string | null;
    name: string | null;
  } | null;
  node: {
    id: string;
    node_type: string;
    node_data: any;
  } | null;
  created_at: string;
  updated_at: string;
}

type ScheduleItem = MessageJob | Enrollment;

interface ScheduleTabProps {
  campaignId: string;
}

export function ScheduleTab({ campaignId }: ScheduleTabProps) {
  const [messageJobs, setMessageJobs] = useState<MessageJob[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadScheduleData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load message jobs
        const { data: jobsData, error: jobsError } = await supabase
          .from('message_jobs')
          .select(`
            id,
            status,
            scheduled_at,
            reserved_at,
            sent_at,
            interval_id,
            message_data,
            error_message,
            retry_count,
            lead:leads (
              email,
              name
            ),
            mailbox:mailboxes (
              email_address
            ),
            node:nodes (
              id,
              node_data
            ),
            interval:campaign_intervals (
              id,
              interval_start,
              interval_end,
              status
            )
          `)
          .eq('campaign_id', campaignId);

        if (jobsError) {
          throw jobsError;
        }

        // Load enrollments
        const { data: enrollmentsData, error: enrollmentsError } = await supabase
          .from('enrollments')
          .select(`
            id,
            state,
            next_run_at,
            current_node_id,
            created_at,
            updated_at,
            lead:leads (
              email,
              name
            ),
            node:nodes (
              id,
              node_type,
              node_data
            )
          `)
          .eq('campaign_id', campaignId);

        if (enrollmentsError) {
          throw enrollmentsError;
        }

        // Add type markers
        const jobsWithType = (jobsData || []).map(job => ({ ...job, type: 'message_job' as const }));
        const enrollmentsWithType = (enrollmentsData || []).map(enrollment => ({ ...enrollment, type: 'enrollment' as const }));

        setMessageJobs(jobsWithType);
        setEnrollments(enrollmentsWithType);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load schedule data';
        setError(errorMessage);
        console.error('Error loading schedule data:', err);
      } finally {
        setLoading(false);
      }
    };

    if (campaignId) {
      loadScheduleData();
    }
  }, [campaignId]);

  // Combine and sort by time (scheduled_at for jobs, next_run_at for enrollments)
  const scheduleItems = useMemo(() => {
    const items: ScheduleItem[] = [
      ...messageJobs,
      ...enrollments.filter(e => e.next_run_at !== null), // Only show enrollments with next_run_at
    ];

    return items.sort((a, b) => {
      const aTime = a.type === 'message_job' ? a.scheduled_at : a.next_run_at || '';
      const bTime = b.type === 'message_job' ? b.scheduled_at : b.next_run_at || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime(); // Newest first
    });
  }, [messageJobs, enrollments]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return '#10b981';
      case 'pending':
        return '#3b82f6';
      case 'reserved':
      case 'sending':
        return '#f59e0b';
      case 'failed':
        return '#ef4444';
      case 'cancelled':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'sent':
        return '#10b98120';
      case 'pending':
        return '#3b82f620';
      case 'reserved':
      case 'sending':
        return '#f59e0b20';
      case 'failed':
        return '#ef444420';
      case 'cancelled':
        return '#6b728020';
      default:
        return '#6b728020';
    }
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center py-12">
        <ActivityIndicator size="large" color="#f85102" />
        <Text className="mt-4 text-gray-400 font-instrument text-sm">Loading schedule...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="bg-red-900/20 border border-red-800 rounded-xl p-6">
        <Text className="text-red-400 font-instrument text-sm">Error: {error}</Text>
      </View>
    );
  }

  if (scheduleItems.length === 0) {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8">
        <Text className="text-gray-400 font-instrument text-center text-base">
          No scheduled items found for this campaign
        </Text>
        <Text className="text-gray-500 font-instrument text-center text-sm mt-2">
          Schedule items will appear here once the scheduler creates them
        </Text>
      </View>
    );
  }

  const getStatusBadge = (status: string) => {
    return (
      <View
        className="px-2 py-1 rounded"
        style={{ backgroundColor: getStatusBgColor(status) }}
      >
        <Text
          className="text-xs font-instrument-semibold uppercase"
          style={{ color: getStatusColor(status) }}
        >
          {status}
        </Text>
      </View>
    );
  };

  const columns: TableColumn<ScheduleItem>[] = [
    {
      key: 'type',
      label: 'Type',
      minWidth: 100,
      flex: 0,
      sortable: true,
      sortValue: (item) => item.type,
      render: (item) => (
        <Text className="text-gray-500 font-instrument text-xs uppercase">
          {item.type === 'message_job' ? 'Email' : 'Enrollment'}
        </Text>
      ),
    },
    {
      key: 'lead',
      label: 'Lead',
      minWidth: 200,
      flex: 1,
      sortable: true,
      sortValue: (item) => item.lead?.email?.toLowerCase() || '',
      render: (item) => (
        <View>
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {item.lead?.email || 'Unknown'}
          </Text>
          {item.lead?.name && (
            <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
              {item.lead.name}
            </Text>
          )}
        </View>
      ),
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      minWidth: 180,
      flex: 1,
      sortable: true,
      sortValue: (item) => {
        const time = item.type === 'message_job' ? item.scheduled_at : item.next_run_at || '';
        return new Date(time).getTime();
      },
      render: (item) => (
        <View>
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {item.type === 'message_job'
              ? format(new Date(item.scheduled_at), 'MMM d, h:mm a')
              : item.next_run_at
                ? format(new Date(item.next_run_at), 'MMM d, h:mm a')
                : '—'}
          </Text>
          {item.type === 'message_job' && item.sent_at && (
            <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
              Sent: {format(new Date(item.sent_at), 'h:mm a')}
            </Text>
          )}
        </View>
      ),
    },
    {
      key: 'interval',
      label: 'Interval',
      minWidth: 200,
      flex: 1,
      sortable: true,
      sortValue: (item) => {
        if (item.type === 'message_job' && item.interval) {
          return new Date(item.interval.interval_start).getTime();
        }
        // Null values should be sorted last (maximum)
        return Number.MAX_SAFE_INTEGER;
      },
      render: (item) => {
        if (item.type === 'message_job' && item.interval) {
          return (
            <View>
              <Text className="text-white font-instrument text-sm" numberOfLines={1}>
                {format(new Date(item.interval.interval_start), 'h:mm a')} - {format(new Date(item.interval.interval_end), 'h:mm a')}
              </Text>
              <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                {item.interval.status}
              </Text>
            </View>
          );
        }
        return <Text className="text-gray-500 font-instrument text-sm">—</Text>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      minWidth: 130,
      flex: 0,
      sortable: true,
      sortValue: (item) => (item.type === 'message_job' ? item.status : item.state),
      render: (item) =>
        item.type === 'message_job' ? getStatusBadge(item.status) : getStatusBadge(item.state),
    },
    {
      key: 'details',
      label: 'Details',
      minWidth: 160,
      flex: 0,
      render: (item) => (
        <View>
          {item.type === 'message_job' ? (
            <>
              {item.mailbox && (
                <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                  {item.mailbox.email_address}
                </Text>
              )}
              {item.error_message && (
                <Text className="text-red-400 font-instrument text-xs" numberOfLines={1}>
                  Error
                </Text>
              )}
            </>
          ) : (
            <>
              {item.node && (
                <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                  {item.node.node_type || '—'}
                </Text>
              )}
            </>
          )}
        </View>
      ),
    },
  ];

  return (
    <View>
      <View className="flex-row items-center justify-between mb-4">
        <View />
        <View className="flex-row gap-4">
          <View className="flex-row items-center gap-2">
            <View className="w-2 h-2 rounded-full bg-[#3b82f6]" />
            <Text className="text-gray-400 font-instrument text-xs">
              {messageJobs.length} Jobs
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="w-2 h-2 rounded-full bg-[#10b981]" />
            <Text className="text-gray-400 font-instrument text-xs">
              {enrollments.filter(e => e.next_run_at).length} Enrollments
            </Text>
          </View>
        </View>
      </View>

      <DataTable
        title="Schedule"
        items={scheduleItems}
        columns={columns}
        searchable={true}
        searchPlaceholder="Search by lead email..."
        searchFilter={(item, query) => {
          const email = item.lead?.email?.toLowerCase() || '';
          const name = item.lead?.name?.toLowerCase() || '';
          return email.includes(query) || name.includes(query);
        }}
        emptyMessage="No scheduled items found for this campaign"
        getItemKey={(item) => item.id}
      />
    </View>
  );
}

