import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { supabase } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Tabs, type Tab } from '@/components/ui/tabs';

interface MessageJob {
  id: string;
  type: 'message_job';
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'blocked';
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

const PAGE_SIZE = 20;

async function lookupCampaignLeadIds(campaignId: string, searchQuery: string): Promise<string[] | null> {
  const search = searchQuery.trim();
  if (!search) return null;

  const pattern = `%${search}%`;
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .or(
      `email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`,
    )
    .limit(1000);

  if (error) {
    throw new Error(`Failed to search leads: ${error.message}`);
  }

  return (data ?? []).map((row) => row.id).filter(Boolean);
}

async function fetchMessageJobsPage(params: {
  campaignId: string;
  page: number;
  searchQuery: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}): Promise<{ rows: MessageJob[]; totalCount: number }> {
  const leadIds = await lookupCampaignLeadIds(params.campaignId, params.searchQuery);
  if (leadIds && leadIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const sortBy = params.sortColumn === 'status' ? 'status' : 'scheduled_at';
  const ascending = params.sortDirection === 'asc';
  let query = supabase
    .from('message_jobs')
    .select(
      `
            id,
            status,
            scheduled_at,
            reserved_at,
            sent_at,
            interval_id,
        lead_id,
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
      `,
      { count: 'exact' },
    )
    .eq('campaign_id', params.campaignId)
    .or('message_type.eq.campaign,message_type.is.null');

  if (leadIds) {
    query = query.in('lead_id', leadIds);
  }

  const { data, error, count } = await query
    .order(sortBy, { ascending, nullsFirst: !ascending })
    .range((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE - 1);

  if (error) {
    throw new Error(`Failed to load message jobs: ${error.message}`);
  }

  return {
    rows: ((data ?? []) as MessageJob[]).map((job) => ({ ...job, type: 'message_job' })),
    totalCount: count ?? 0,
  };
}

async function fetchEnrollmentsPage(params: {
  campaignId: string;
  page: number;
  searchQuery: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}): Promise<{ rows: Enrollment[]; totalCount: number }> {
  const leadIds = await lookupCampaignLeadIds(params.campaignId, params.searchQuery);
  if (leadIds && leadIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const sortBy = params.sortColumn === 'status' ? 'state' : 'next_run_at';
  const ascending = params.sortDirection === 'asc';
  let query = supabase
    .from('enrollments')
    .select(
      `
            id,
            state,
            next_run_at,
            current_node_id,
        lead_id,
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
      `,
      { count: 'exact' },
    )
    .eq('campaign_id', params.campaignId)
    .is('deleted_at', null)
    .not('next_run_at', 'is', null);

  if (leadIds) {
    query = query.in('lead_id', leadIds);
  }

  const { data, error, count } = await query
    .order(sortBy, { ascending, nullsFirst: !ascending })
    .range((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE - 1);

  if (error) {
    throw new Error(`Failed to load enrollments: ${error.message}`);
  }

  return {
    rows: ((data ?? []) as Enrollment[]).map((enrollment) => ({ ...enrollment, type: 'enrollment' })),
    totalCount: count ?? 0,
  };
}

export function ScheduleTab({ campaignId, refreshTrigger }: ScheduleTabProps) {
  const [activeTab, setActiveTab] = useState<string>('emails');

  const [messageJobs, setMessageJobs] = useState<MessageJob[]>([]);
  const [messageJobsLoading, setMessageJobsLoading] = useState(true);
  const [messageJobsError, setMessageJobsError] = useState<string | null>(null);
  const [messageJobsTotalCount, setMessageJobsTotalCount] = useState(0);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [debouncedEmailSearchQuery, setDebouncedEmailSearchQuery] = useState('');
  const [emailPage, setEmailPage] = useState(1);
  const [emailSortColumn, setEmailSortColumn] = useState<string | undefined>('scheduled');
  const [emailSortDirection, setEmailSortDirection] = useState<'asc' | 'desc'>('desc');

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);
  const [enrollmentsError, setEnrollmentsError] = useState<string | null>(null);
  const [enrollmentsTotalCount, setEnrollmentsTotalCount] = useState(0);
  const [enrollmentSearchQuery, setEnrollmentSearchQuery] = useState('');
  const [debouncedEnrollmentSearchQuery, setDebouncedEnrollmentSearchQuery] = useState('');
  const [enrollmentPage, setEnrollmentPage] = useState(1);
  const [enrollmentSortColumn, setEnrollmentSortColumn] = useState<string | undefined>('scheduled');
  const [enrollmentSortDirection, setEnrollmentSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedEmailSearchQuery(emailSearchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [emailSearchQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedEnrollmentSearchQuery(enrollmentSearchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [enrollmentSearchQuery]);

  useEffect(() => {
    let cancelled = false;
    setMessageJobsLoading(true);
    setMessageJobsError(null);

    fetchMessageJobsPage({
      campaignId,
      page: emailPage,
      searchQuery: debouncedEmailSearchQuery,
      sortColumn: emailSortColumn,
      sortDirection: emailSortDirection,
    })
      .then((result) => {
        if (cancelled) return;
        setMessageJobs(result.rows);
        setMessageJobsTotalCount(result.totalCount);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessageJobs([]);
        setMessageJobsTotalCount(0);
        setMessageJobsError(err instanceof Error ? err.message : 'Failed to load email jobs');
      })
      .finally(() => {
        if (!cancelled) setMessageJobsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, debouncedEmailSearchQuery, emailPage, emailSortColumn, emailSortDirection, refreshTrigger]);

  useEffect(() => {
    let cancelled = false;
    setEnrollmentsLoading(true);
    setEnrollmentsError(null);

    fetchEnrollmentsPage({
      campaignId,
      page: enrollmentPage,
      searchQuery: debouncedEnrollmentSearchQuery,
      sortColumn: enrollmentSortColumn,
      sortDirection: enrollmentSortDirection,
    })
      .then((result) => {
        if (cancelled) return;
        setEnrollments(result.rows);
        setEnrollmentsTotalCount(result.totalCount);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEnrollments([]);
        setEnrollmentsTotalCount(0);
        setEnrollmentsError(err instanceof Error ? err.message : 'Failed to load enrollments');
      })
      .finally(() => {
        if (!cancelled) setEnrollmentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    campaignId,
    debouncedEnrollmentSearchQuery,
    enrollmentPage,
    enrollmentSortColumn,
    enrollmentSortDirection,
    refreshTrigger,
  ]);

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
      case 'blocked':
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
      case 'blocked':
        return '#6b728020';
      default:
        return '#6b728020';
    }
  };

  const tabs: Tab[] = [
    { id: 'emails', label: `Emails (${messageJobsTotalCount})` },
    { id: 'enrollments', label: `Enrollments (${enrollmentsTotalCount})` },
  ];

  const getStatusBadge = (status: string) => {
    const label = status === 'blocked' ? 'Blocked' : status;
    return (
      <View
        className="px-2 py-1 rounded"
        style={{ backgroundColor: getStatusBgColor(status) }}
      >
        <Text
          className="text-xs font-instrument-semibold uppercase"
          style={{ color: getStatusColor(status) }}
        >
          {label}
        </Text>
      </View>
    );
  };

  // Columns for Email (Message Job) table
  const emailColumns: TableColumn<MessageJob>[] = [
    {
      key: 'lead',
      label: 'Lead',
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
      maxWidth: 160,
      sortable: true,
      sortValue: (item) => item.status,
      render: (item) => getStatusBadge(item.status),
    },
    {
      key: 'details',
      label: 'Details',
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
      maxWidth: 160,
      sortable: true,
      sortValue: (item) => item.state,
      render: (item) => getStatusBadge(item.state),
    },
    {
      key: 'details',
      label: 'Node Type',
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
        <>
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-instrument-semibold text-white">Email Jobs</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {messageJobsTotalCount} {messageJobsTotalCount !== 1 ? 'items' : 'item'}
            </Text>
          </View>
          <View className="mb-4">
            <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
              <MagnifyingGlassIcon size={18} color="#6b7280" />
              <TextInput
                value={emailSearchQuery}
                onChangeText={(value) => {
                  setEmailSearchQuery(value);
                  setEmailPage(1);
                }}
                placeholder="Search by lead email..."
                placeholderTextColor="#6b7280"
                className="flex-1 ml-2 text-white font-instrument text-sm"
              />
            </View>
          </View>
          <DataTable
            items={messageJobs}
            columns={emailColumns}
            widthMode="content-aware"
            emptyMessage="No email jobs found for this campaign"
            getItemKey={(item) => item.id}
            loading={messageJobsLoading}
            smoothLoading
            smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
            paginationMode="server"
            currentPage={emailPage}
            totalItems={messageJobsTotalCount}
            onPageChange={setEmailPage}
            sortColumn={emailSortColumn}
            sortDirection={emailSortDirection}
            onSortChange={(columnKey, direction) => {
              setEmailSortColumn(columnKey);
              setEmailSortDirection(direction);
              setEmailPage(1);
            }}
          />
          {messageJobsError ? (
            <View className="bg-red-900/20 border border-red-800 rounded-xl p-4 mt-4">
              <Text className="text-red-400 font-instrument text-sm">Error: {messageJobsError}</Text>
            </View>
          ) : null}
        </>
      )}

      {activeTab === 'enrollments' && (
        <>
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-instrument-semibold text-white">Enrollments</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {enrollmentsTotalCount} {enrollmentsTotalCount !== 1 ? 'items' : 'item'}
            </Text>
          </View>
          <View className="mb-4">
            <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
              <MagnifyingGlassIcon size={18} color="#6b7280" />
              <TextInput
                value={enrollmentSearchQuery}
                onChangeText={(value) => {
                  setEnrollmentSearchQuery(value);
                  setEnrollmentPage(1);
                }}
                placeholder="Search by lead email..."
                placeholderTextColor="#6b7280"
                className="flex-1 ml-2 text-white font-instrument text-sm"
              />
            </View>
          </View>
          <DataTable
            items={enrollments}
            columns={enrollmentColumns}
            widthMode="content-aware"
            emptyMessage="No enrollments found for this campaign"
            getItemKey={(item) => item.id}
            loading={enrollmentsLoading}
            smoothLoading
            smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
            paginationMode="server"
            currentPage={enrollmentPage}
            totalItems={enrollmentsTotalCount}
            onPageChange={setEnrollmentPage}
            sortColumn={enrollmentSortColumn}
            sortDirection={enrollmentSortDirection}
            onSortChange={(columnKey, direction) => {
              setEnrollmentSortColumn(columnKey);
              setEnrollmentSortDirection(direction);
              setEnrollmentPage(1);
            }}
          />
          {enrollmentsError ? (
            <View className="bg-red-900/20 border border-red-800 rounded-xl p-4 mt-4">
              <Text className="text-red-400 font-instrument text-sm">Error: {enrollmentsError}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
