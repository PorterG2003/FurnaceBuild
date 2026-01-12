import { useState, useEffect, useMemo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { DataTable, type TableColumn } from './DataTable';
import { Tabs, type Tab } from './Tabs';

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
    interval_time: string;
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
  refreshTrigger?: number; // When this changes, reload data
}

export function ScheduleTab({ campaignId, refreshTrigger }: ScheduleTabProps) {
  const [messageJobs, setMessageJobs] = useState<MessageJob[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('emails');

  useEffect(() => {
    const loadScheduleData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load message jobs (fetch all in chunks due to 1000 row limit)
        const jobsData: any[] = [];
        let jobsOffset = 0;
        const jobsPageSize = 1000;
        let jobsHasMore = true;
        
        while (jobsHasMore) {
          const { data: jobsPage, error: jobsError } = await supabase
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
              interval_time,
              status
            )
          `)
            .eq('campaign_id', campaignId)
            .range(jobsOffset, jobsOffset + jobsPageSize - 1)
            .order('created_at', { ascending: false });

        if (jobsError) {
          throw jobsError;
        }

          if (jobsPage && jobsPage.length > 0) {
            jobsData.push(...jobsPage);
            jobsHasMore = jobsPage.length === jobsPageSize;
            jobsOffset += jobsPageSize;
          } else {
            jobsHasMore = false;
          }
        }

        // Load enrollments (fetch all in chunks due to 1000 row limit)
        const enrollmentsData: any[] = [];
        let enrollmentsOffset = 0;
        const enrollmentsPageSize = 1000;
        let enrollmentsHasMore = true;
        
        while (enrollmentsHasMore) {
          const { data: enrollmentsPage, error: enrollmentsError } = await supabase
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
            .eq('campaign_id', campaignId)
            .range(enrollmentsOffset, enrollmentsOffset + enrollmentsPageSize - 1)
            .order('created_at', { ascending: false });

        if (enrollmentsError) {
          throw enrollmentsError;
          }

          if (enrollmentsPage && enrollmentsPage.length > 0) {
            enrollmentsData.push(...enrollmentsPage);
            enrollmentsHasMore = enrollmentsPage.length === enrollmentsPageSize;
            enrollmentsOffset += enrollmentsPageSize;
          } else {
            enrollmentsHasMore = false;
          }
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
  }, [campaignId, refreshTrigger]); // Reload when campaignId or refreshTrigger changes

  // Sort message jobs by scheduled_at
  const sortedMessageJobs = useMemo(() => {
    return [...messageJobs].sort((a, b) => {
      return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(); // Newest first
    });
  }, [messageJobs]);

  // Sort enrollments by next_run_at
  const sortedEnrollments = useMemo(() => {
    return [...enrollments]
      .filter(e => e.next_run_at !== null) // Only show enrollments with next_run_at
      .sort((a, b) => {
        return new Date(b.next_run_at!).getTime() - new Date(a.next_run_at!).getTime(); // Newest first
    });
  }, [enrollments]);

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

  const tabs: Tab[] = [
    { id: 'emails', label: `Emails (${messageJobs.length})` },
    { id: 'enrollments', label: `Enrollments (${sortedEnrollments.length})` },
  ];

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

  // Columns for Email (Message Job) table
  const emailColumns: TableColumn<MessageJob>[] = [
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
      sortValue: (item) => new Date(item.scheduled_at).getTime(),
      render: (item) => (
        <View>
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {format(new Date(item.scheduled_at), 'MMM d, h:mm a')}
          </Text>
          {item.sent_at && (
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
        if (item.interval) {
          return new Date(item.interval.interval_time).getTime();
        }
        return Number.MAX_SAFE_INTEGER;
      },
      render: (item) => {
        if (item.interval) {
          return (
            <View>
              <Text className="text-white font-instrument text-sm" numberOfLines={1}>
                {format(new Date(item.interval.interval_time), 'h:mm a')}
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
      sortValue: (item) => item.status,
      render: (item) => getStatusBadge(item.status),
    },
    {
      key: 'details',
      label: 'Details',
      minWidth: 160,
      flex: 0,
      render: (item) => (
        <View>
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
        </View>
      ),
    },
  ];

  // Columns for Enrollment table
  const enrollmentColumns: TableColumn<Enrollment>[] = [
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
      label: 'Next Run',
      minWidth: 180,
      flex: 1,
      sortable: true,
      sortValue: (item) => new Date(item.next_run_at || '').getTime(),
      render: (item) => (
        <View>
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {item.next_run_at
              ? format(new Date(item.next_run_at), 'MMM d, h:mm a')
              : '—'}
          </Text>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      minWidth: 130,
      flex: 0,
      sortable: true,
      sortValue: (item) => item.state,
      render: (item) => getStatusBadge(item.state),
    },
    {
      key: 'details',
      label: 'Node Type',
      minWidth: 160,
      flex: 0,
      render: (item) => (
        <View>
              {item.node && (
                <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                  {item.node.node_type || '—'}
                </Text>
          )}
        </View>
      ),
    },
  ];

  return (
    <View>
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'emails' && (
        <DataTable
          title="Email Jobs"
          items={sortedMessageJobs}
          columns={emailColumns}
          searchable={true}
          searchPlaceholder="Search by lead email..."
          searchFilter={(item, query) => {
            const email = item.lead?.email?.toLowerCase() || '';
            const name = item.lead?.name?.toLowerCase() || '';
            return email.includes(query) || name.includes(query);
          }}
          emptyMessage="No email jobs found for this campaign"
          getItemKey={(item) => item.id}
        />
      )}

      {activeTab === 'enrollments' && (
      <DataTable
          title="Enrollments"
          items={sortedEnrollments}
          columns={enrollmentColumns}
        searchable={true}
        searchPlaceholder="Search by lead email..."
        searchFilter={(item, query) => {
          const email = item.lead?.email?.toLowerCase() || '';
          const name = item.lead?.name?.toLowerCase() || '';
          return email.includes(query) || name.includes(query);
        }}
          emptyMessage="No enrollments found for this campaign"
        getItemKey={(item) => item.id}
      />
      )}
    </View>
  );
}

