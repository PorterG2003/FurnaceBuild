import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TextInput, TouchableOpacity, RefreshControl } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { supabase } from '@/lib/supabase/client';
import { createCampaign } from '@/lib/supabase/services/campaigns';
import { createLead } from '@/lib/supabase/services/leads';
import { createMailbox, getMailboxesByUser } from '@/lib/supabase/services/mailboxes';
import { getUserByExternalId, getAccountMembershipsForUser } from '@/lib/supabase/services/users';
import { Button } from '@/components/ui/button';

interface JobStatus {
  pending: number;
  reserved: number;
  sending: number;
  sent: number;
  cancelled: number;
  failed: number;
  blocked: number;
}

interface ThrottleStatus {
  sent_count: number;
  daily_limit: number;
  hourly_limit: number;
  min_gap_seconds: number;
  last_sent_at: string | null;
  hourly_sent: Record<string, number>;
}

type TestScenario = 'min-gap' | 'daily-limit' | 'hourly-limit' | 'mixed';

export function RaceConditionTest() {
  const { user } = useAuthenticator();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [testJobIds, setTestJobIds] = useState<string[]>([]);
  const pollingIntervalRef = useRef<number | null>(null);

  // Test configuration
  const [scenario, setScenario] = useState<TestScenario>('min-gap');
  const [jobCount, setJobCount] = useState('20');
  const [dailyLimit, setDailyLimit] = useState('10');
  const [hourlyLimit, setHourlyLimit] = useState('5');
  const [minGapSeconds, setMinGapSeconds] = useState('180');

  // Real-time status
  const [jobStatus, setJobStatus] = useState<JobStatus>({
    pending: 0,
    reserved: 0,
    sending: 0,
    sent: 0,
    cancelled: 0,
    failed: 0,
    blocked: 0,
  });
  const [throttleStatus, setThrottleStatus] = useState<ThrottleStatus | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [functionExists, setFunctionExists] = useState<boolean | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; status: string; error_message: string | null }>>([]);

  // Start polling for status updates
  const startPolling = () => {
    if (pollingIntervalRef.current) return;
    setPolling(true);
    pollingIntervalRef.current = setInterval(async () => {
      if (mailboxId) {
        await refreshStatus();
      }
    }, 2000); // Poll every 2 seconds
  };

  // Stop polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setPolling(false);
  };

  // Check if RPC function exists and get actual error from failed jobs
  const checkFunctionExists = async () => {
    try {
      // Try calling with a dummy UUID - if function exists, we'll get a "not found" error
      // If function doesn't exist, we'll get a "function does not exist" error
      const { data, error } = await supabase
        .rpc('check_mailbox_throttle_and_reserve', {
          p_message_job_id: '00000000-0000-0000-0000-000000000000' // Dummy UUID
        })
        .single();
      
      // If we get an error about function not found, it doesn't exist
      if (error) {
        if (error.message?.includes('does not exist') || 
            error.message?.includes('function') || 
            error.code === '42883' ||
            error.message?.includes('could not find a function')) {
          setFunctionExists(false);
          setRpcError(error.message);
        } else {
          // Function exists but returned an error (expected for dummy UUID or job not found)
          // This is fine - function exists
          setFunctionExists(true);
          setRpcError(null);
        }
      } else {
        setFunctionExists(true);
        setRpcError(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('does not exist') || 
          errorMessage.includes('function') ||
          errorMessage.includes('could not find')) {
        setFunctionExists(false);
        setRpcError(errorMessage);
      } else {
        // Other error - function probably exists
        setFunctionExists(true);
      }
    }
  };

  // Refresh job and throttle status
  const refreshStatus = async () => {
    if (!mailboxId || testJobIds.length === 0) return;

    try {
      // Check function exists on first refresh
      if (functionExists === null) {
        await checkFunctionExists();
      }

      // Get job statuses for only the jobs created in this test
      const { data: jobs, error: jobsError } = await supabase
        .from('message_jobs')
        .select('id, status, error_message, updated_at')
        .in('id', testJobIds)
        .order('updated_at', { ascending: false });
      
      // Store jobs for cancellation reason display
      if (jobs) {
        setJobs(jobs);
      }

      if (jobsError) throw jobsError;

      const statusCounts: JobStatus = {
        pending: 0,
        reserved: 0,
        sending: 0,
        sent: 0,
        cancelled: 0,
        failed: 0,
        blocked: 0,
      };

      // Collect error messages from failed jobs to diagnose the issue
      const failedJobErrors: string[] = [];
      
      jobs?.forEach((job) => {
        const status = job.status as keyof JobStatus;
        if (statusCounts[status] !== undefined) {
          statusCounts[status]++;
        }
        
        // Collect error messages from failed jobs (get the most recent one)
        if (status === 'failed' && job.error_message) {
          failedJobErrors.push(job.error_message);
        }
      });
      
      // If we have failed jobs, check the error messages
      if (failedJobErrors.length > 0) {
        // Use the first (most recent) error message
        const firstError = failedJobErrors[0];
        if (!rpcError || rpcError !== firstError) {
          setRpcError(firstError);
        }
        
        // Check if it's a function not found error
        if (firstError.includes('does not exist') || 
            firstError.includes('function') ||
            firstError.includes('could not find') ||
            firstError.includes('42883')) {
          setFunctionExists(false);
        } else if (functionExists === null) {
          // Function exists but there's another error
          setFunctionExists(true);
        }
      } else if (jobStatus.failed > 0 && !rpcError) {
        // Jobs are failed but no error message - might be a worker crash or timeout
        setRpcError('No error message found in database. Check CloudWatch logs for worker errors.');
      }

      setJobStatus(statusCounts);

      // Get throttle status
      const today = new Date().toISOString().split('T')[0];
      const { data: throttle, error: throttleError } = await supabase
        .from('mailbox_throttles')
        .select('*')
        .eq('mailbox_id', mailboxId)
        .eq('date', today)
        .maybeSingle();

      if (!throttleError && throttle) {
        setThrottleStatus({
          sent_count: throttle.sent_count || 0,
          daily_limit: throttle.daily_limit || 50,
          hourly_limit: throttle.hourly_limit || 10,
          min_gap_seconds: throttle.min_gap_seconds || 180,
          last_sent_at: throttle.last_sent_at,
          hourly_sent: (throttle.hourly_sent as Record<string, number>) || {},
        });
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error refreshing status:', err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  // Auto-start polling when test is running
  useEffect(() => {
    if (testRunning && mailboxId) {
      startPolling();
    } else {
      stopPolling();
    }
  }, [testRunning, mailboxId]);

  const handleCreateTest = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      return;
    }

    const jobCountNum = parseInt(jobCount, 10);
    if (isNaN(jobCountNum) || jobCountNum < 1 || jobCountNum > 100) {
      setError('Job count must be between 1 and 100');
      return;
    }

    setLoading(true);
    setError(null);
    setTestRunning(false);
    stopPolling();

    try {
      // 1. Get user profile (create if doesn't exist)
      let userProfile = await getUserByExternalId(user.userId);
      if (!userProfile) {
        // User profile doesn't exist - create it
        const { createUserProfile } = await import('@/lib/supabase/services/users');
        userProfile = await createUserProfile({
          external_id: user.userId,
          email: user.signInDetails?.loginId || user.username || '',
          name: null,
        });
      }

      // 2. Get account
      const memberships = await getAccountMembershipsForUser(userProfile.id);
      if (!memberships || memberships.length === 0) {
        throw new Error('User has no account');
      }
      const account = memberships[0].account;

      // 3. Create a new mailbox for each test to ensure clean throttle state
      // This prevents throttle counters from previous tests interfering with new tests
      const mailbox = await createMailbox({
        user_id: userProfile.id,
        account_id: account.id,
        email_address: `race-test-${scenario}-${Date.now()}@furnace.test`,
        display_name: `Race Condition Test Mailbox - ${scenario}`,
        smtp_host: 'smtp.gmail.com',
        smtp_port: 587,
        smtp_username: 'test@example.com',
        smtp_password: 'test-password',
        smtp_use_tls: true,
        smtp_use_ssl: false,
        imap_host: 'imap.gmail.com',
        imap_port: 993,
        imap_username: 'test@example.com',
        imap_password: 'test-password',
        imap_use_ssl: true,
        status: 'connected',
        sync_enabled: false,
        provider: 'gmail' as any,
      });

      setMailboxId(mailbox.id);

      // 4. Get or create campaign (pass account_id directly since we have it)
      const { data: existingCampaigns } = await supabase
        .from('campaigns')
        .select('*')
        .eq('owner_id', userProfile.id)
        .limit(1);

      let campaign;
      if (existingCampaigns && existingCampaigns.length > 0) {
        campaign = existingCampaigns[0];
      } else {
        campaign = await createCampaign({
          name: 'Race Condition Test Campaign',
          owner_id: userProfile.id,
          account_id: account.id, // Pass account_id directly
          organization_id: null,
          status: 'draft',
          flow_data: { nodes: [], edges: [] },
        });
      }

      // 5. Create lead
      const lead = await createLead({
        campaign_id: campaign.id,
        bucket_id: campaign.bucket_id,
        email: `test-${Date.now()}@example.com`,
        name: 'Test Lead',
        status: 'new',
        global_lead_id: null,
      });

      // 6. Create enrollment
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          state: 'active',
          next_run_at: new Date().toISOString(),
          flow_position: {},
        })
        .select()
        .single();

      if (enrollmentError) throw enrollmentError;

      // 7. Create email node
      const nodeId = `email-${Date.now()}`;
      const { data: node, error: nodeError } = await supabase
        .from('nodes')
        .insert({
          campaign_id: campaign.id,
          flow_node_id: nodeId,
          node_type: 'email',
          node_data: { subject: 'Race Condition Test', body: 'Test body' },
          position_x: 0,
          position_y: 0,
        })
        .select()
        .single();

      if (nodeError) throw nodeError;

      // 8. Set up throttle limits with clean state (new mailbox ensures no existing throttle data)
      const today = new Date().toISOString().split('T')[0];
      const currentHour = new Date().getHours();
      
      let throttleData: any = {
        mailbox_id: mailbox.id,
        date: today,
        daily_limit: parseInt(dailyLimit, 10),
        hourly_limit: parseInt(hourlyLimit, 10),
        min_gap_seconds: parseInt(minGapSeconds, 10),
        sent_count: 0,
        hourly_sent: {},
        last_sent_at: null, // Start with no previous send
      };

      // Set initial state based on scenario
      if (scenario === 'daily-limit') {
        // Set sent_count to one below limit so first job can pass
        throttleData.sent_count = parseInt(dailyLimit, 10) - 1;
      } else if (scenario === 'hourly-limit') {
        // Set hourly_sent to one below limit so first job can pass
        throttleData.hourly_sent = { [currentHour.toString()]: parseInt(hourlyLimit, 10) - 1 };
      } else if (scenario === 'mixed') {
        // Set both daily and hourly to allow 2 jobs, but min gap will cancel the second
        // For mixed: first job should pass (daily/hourly allow it, last_sent_at is null)
        // Second job will fail min gap (first job updates last_sent_at)
        throttleData.sent_count = parseInt(dailyLimit, 10) - 2;
        throttleData.hourly_sent = { [currentHour.toString()]: parseInt(hourlyLimit, 10) - 2 };
        throttleData.last_sent_at = null; // Start with null so first job can pass, then it updates to NOW()
      } else {
        // min-gap: last_sent_at is null, so first job can pass
        // Subsequent jobs will be cancelled because first job updates last_sent_at
        throttleData.last_sent_at = null;
      }

      // Insert throttle data (new mailbox means no existing record, so this is a clean insert)
      const { error: throttleError } = await supabase
        .from('mailbox_throttles')
        .insert(throttleData);

      if (throttleError) throw throttleError;

      // 9. Create message jobs (all scheduled for NOW() to trigger race condition)
      const messageJobsData = Array.from({ length: jobCountNum }, () => ({
        enrollment_id: enrollment.id,
        campaign_id: campaign.id,
        lead_id: lead.id,
        mailbox_id: mailbox.id,
        node_id: node.id,
        status: 'pending' as const,
        scheduled_at: new Date().toISOString(),
        message_data: {
          node_config: { subject: 'Race Condition Test', body: 'Test body' },
          lead_data: { email: lead.email, name: lead.name },
          skip_smtp: true, // Skip SMTP for testing
        },
      }));

      const { data: createdJobs, error: jobError } = await supabase
        .from('message_jobs')
        .insert(messageJobsData)
        .select('id');

      if (jobError) throw jobError;

      // Store the job IDs for this test
      const jobIds = createdJobs?.map(job => job.id) || [];
      setTestJobIds(jobIds);

      setTestRunning(true);
      await refreshStatus();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTestRunning(false);
    setMailboxId(null);
    setTestJobIds([]);
    setJobStatus({
      pending: 0,
      reserved: 0,
      sending: 0,
      sent: 0,
      cancelled: 0,
      failed: 0,
      blocked: 0,
    });
    setThrottleStatus(null);
    stopPolling();
  };

  const totalJobs = Object.values(jobStatus).reduce((sum, count) => sum + count, 0);
  const completedJobs = jobStatus.sent + jobStatus.cancelled + jobStatus.failed + jobStatus.blocked;
  const isComplete = totalJobs > 0 && completedJobs === totalJobs;

  return (
    <ScrollView
      className="flex-1"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refreshStatus}
          tintColor="#f85102"
        />
      }
    >
      <View className="space-y-6">
        {/* Configuration */}
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
          <Text className="text-xl font-instrument-semibold text-white mb-4">
            Test Configuration
          </Text>

          <View className="space-y-4">
            <View>
              <Text className="text-sm font-medium mb-2 text-gray-300">Test Scenario</Text>
              <View className="flex-row flex-wrap gap-2">
                {(['min-gap', 'daily-limit', 'hourly-limit', 'mixed'] as TestScenario[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setScenario(s)}
                    className={`px-4 py-2 rounded-lg border ${
                      scenario === s
                        ? 'bg-brand-orange border-brand-orange'
                        : 'bg-white/5 border-white/30'
                    }`}
                    style={scenario === s ? { backgroundColor: '#f85102', borderColor: '#f85102' } : undefined}
                  >
                    <Text className={`text-sm font-medium ${scenario === s ? 'text-white' : 'text-gray-400'}`}>
                      {s === 'min-gap' ? 'Min Gap' : s === 'daily-limit' ? 'Daily Limit' : s === 'hourly-limit' ? 'Hourly Limit' : 'Mixed'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text className="text-sm font-medium mb-2 text-gray-300">Number of Jobs</Text>
              <TextInput
                value={jobCount}
                onChangeText={setJobCount}
                keyboardType="number-pad"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={{
                  borderColor: '#FFFFFF4D',
                  backgroundColor: '#FFFFFF0D',
                  color: '#FFFFFF',
                  borderWidth: 1,
                }}
                placeholderTextColor="#666"
              />
            </View>

            <View className="flex-row gap-4">
              <View className="flex-1">
                <Text className="text-sm font-medium mb-2 text-gray-300">Daily Limit</Text>
                <TextInput
                  value={dailyLimit}
                  onChangeText={setDailyLimit}
                  keyboardType="number-pad"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  placeholderTextColor="#666"
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium mb-2 text-gray-300">Hourly Limit</Text>
                <TextInput
                  value={hourlyLimit}
                  onChangeText={setHourlyLimit}
                  keyboardType="number-pad"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            <View>
              <Text className="text-sm font-medium mb-2 text-gray-300">Min Gap (seconds)</Text>
              <TextInput
                value={minGapSeconds}
                onChangeText={setMinGapSeconds}
                keyboardType="number-pad"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={{
                  borderColor: '#FFFFFF4D',
                  backgroundColor: '#FFFFFF0D',
                  color: '#FFFFFF',
                  borderWidth: 1,
                }}
                placeholderTextColor="#666"
              />
            </View>
          </View>

          {error && (
            <View className="mt-4 bg-red-900/20 border border-red-700 rounded-lg p-4">
              <Text className="text-red-400 font-semibold mb-1">❌ Error</Text>
              <Text className="text-gray-300 text-sm">{error}</Text>
            </View>
          )}

          <View className="mt-4 bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
            <Text className="text-yellow-400 font-instrument-semibold text-sm mb-2">⚠️ Multiple Workers Required</Text>
            <Text className="text-gray-300 font-instrument text-xs leading-4 mb-3">
              This test requires multiple workers to actually test race conditions. With a single worker, jobs process sequentially and won't trigger concurrent throttle checks.
            </Text>
            
            <Text className="text-gray-300 font-instrument-semibold text-xs mb-2">Before Test - Scale Up:</Text>
            <View className="bg-gray-900/50 rounded-lg p-3 mb-3">
              <Text className="text-gray-400 font-instrument text-xs font-mono leading-5">
                cd infra/workers{'\n'}
                npm run scale:dev -- 3 1
              </Text>
              <Text className="text-gray-500 font-instrument text-xs mt-1">
                (3 send workers, 1 scheduler worker)
              </Text>
            </View>

            <Text className="text-gray-300 font-instrument-semibold text-xs mb-2">After Test - Scale Down:</Text>
            <View className="bg-gray-900/50 rounded-lg p-3">
              <Text className="text-gray-400 font-instrument text-xs font-mono leading-5">
                cd infra/workers{'\n'}
                npm run scale:dev -- 1 1
              </Text>
              <Text className="text-gray-500 font-instrument text-xs mt-1">
                (Back to 1 send worker, 1 scheduler worker)
              </Text>
            </View>
          </View>

          <Button
            onPress={testRunning ? handleReset : handleCreateTest}
            disabled={loading}
            className="mt-6 bg-brand-orange"
            style={{ backgroundColor: '#f85102' }}
          >
            <Text className="text-white font-semibold">
              {loading ? 'Creating...' : testRunning ? 'Reset Test' : 'Start Test'}
            </Text>
          </Button>
        </View>

        {/* Real-time Status */}
        {testRunning && (
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-xl font-instrument-semibold text-white">
                Real-time Status
              </Text>
              <View className="flex-row items-center gap-2">
                {polling && (
                  <View className="w-2 h-2 rounded-full bg-green-500" />
                )}
                <Text className="text-gray-400 text-xs">
                  {polling ? 'Live' : 'Paused'} • Updated {lastUpdate.toLocaleTimeString()}
                </Text>
              </View>
            </View>

            {/* Job Status Breakdown */}
            <View className="mb-6">
              <Text className="text-sm font-medium mb-3 text-gray-300">Job Status</Text>
              <View className="space-y-2">
                {Object.entries(jobStatus).map(([status, count]) => (
                  <View key={status} className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor:
                            status === 'sent' ? '#10b981' :
                            status === 'cancelled' ? '#f59e0b' :
                            status === 'blocked' ? '#6b7280' :
                            status === 'failed' ? '#ef4444' :
                            status === 'reserved' ? '#3b82f6' :
                            '#6b7280',
                        }}
                      />
                      <Text className="text-gray-300 text-sm capitalize">{status}</Text>
                    </View>
                    <Text className="text-white font-semibold">{count}</Text>
                  </View>
                ))}
              </View>
              
              {/* Show cancellation reasons if any jobs are cancelled */}
              {jobStatus.cancelled > 0 && jobs.length > 0 && (
                <View className="mt-4 pt-4 border-t border-white/10">
                  <Text className="text-sm font-medium mb-2 text-gray-300">Cancellation Reasons</Text>
                  <View className="space-y-1">
                    {(() => {
                      // Get unique error messages from cancelled jobs
                      const cancelledJobs = jobs.filter(j => j.status === 'cancelled');
                      const errorReasons = new Map<string, number>();
                      cancelledJobs.forEach(job => {
                        const reason = job.error_message || 'No reason provided';
                        errorReasons.set(reason, (errorReasons.get(reason) || 0) + 1);
                      });
                      
                      if (errorReasons.size === 0) {
                        return (
                          <Text className="text-gray-400 text-xs">
                            No error messages found for cancelled jobs
                          </Text>
                        );
                      }
                      
                      return Array.from(errorReasons.entries()).map(([reason, count]) => (
                        <View key={reason} className="flex-row items-start gap-2 mb-1">
                          <Text className="text-gray-400 text-xs flex-1 break-words">
                            {reason}
                          </Text>
                          <Text className="text-gray-500 text-xs">({count})</Text>
                        </View>
                      ));
                    })()}
                  </View>
                </View>
              )}
              
              {totalJobs > 0 && (
                <View className="mt-4 pt-4 border-t border-white/10">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-300 text-sm">Total Jobs</Text>
                    <Text className="text-white font-semibold">{totalJobs}</Text>
                  </View>
                  <View className="flex-row items-center justify-between mt-2">
                    <Text className="text-gray-300 text-sm">Completed</Text>
                    <Text className="text-white font-semibold">
                      {completedJobs} / {totalJobs} ({Math.round((completedJobs / totalJobs) * 100)}%)
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Throttle Status */}
            {throttleStatus && (
              <View>
                <Text className="text-sm font-medium mb-3 text-gray-300">Throttle Counters</Text>
                <View className="space-y-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-300 text-sm">Sent Count</Text>
                    <Text className="text-white font-semibold">
                      {throttleStatus.sent_count} / {throttleStatus.daily_limit}
                    </Text>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-300 text-sm">Daily Limit</Text>
                    <Text className="text-white font-semibold">{throttleStatus.daily_limit}</Text>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-300 text-sm">Hourly Limit</Text>
                    <Text className="text-white font-semibold">{throttleStatus.hourly_limit}</Text>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-300 text-sm">Min Gap</Text>
                    <Text className="text-white font-semibold">{throttleStatus.min_gap_seconds}s</Text>
                  </View>
                  {throttleStatus.last_sent_at && (
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-300 text-sm">Last Sent</Text>
                      <Text className="text-white font-semibold text-xs">
                        {new Date(throttleStatus.last_sent_at).toLocaleTimeString()}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Function Status / Error Display */}
            {(functionExists === false || rpcError) && (
              <View className="mt-4 bg-red-900/20 border border-red-800 rounded-lg p-4">
                {functionExists === false ? (
                  <>
                    <Text className="text-red-400 font-instrument-semibold text-sm mb-2">❌ RPC Function Not Found</Text>
                    <Text className="text-gray-300 font-instrument text-xs leading-4 mb-2">
                      The function `check_mailbox_throttle_and_reserve()` does not exist in the database.
                      {'\n\n'}
                      <Text className="font-instrument-semibold">To fix:</Text>
                      {'\n'}
                      1. Apply the migration to your dev branch:
                      {'\n'}
                      <Text className="font-mono text-xs">   supabase link --project-ref {'<dev-branch-ref>'}</Text>
                      {'\n'}
                      <Text className="font-mono text-xs">   supabase db push</Text>
                      {'\n\n'}
                      2. Or manually run the migration SQL in Supabase SQL Editor
                    </Text>
                  </>
                ) : (
                  <>
                    <Text className="text-red-400 font-instrument-semibold text-sm mb-2">⚠️ RPC Function Error</Text>
                    <Text className="text-gray-300 font-instrument text-xs leading-4 mb-2">
                      The function exists but is returning errors. Check the error message below.
                    </Text>
                  </>
                )}
                {rpcError && (
                  <View className="mt-2 bg-gray-900/50 rounded p-2">
                    <Text className="text-gray-400 font-instrument text-xs font-mono break-words">
                      {rpcError}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Test Results */}
            {isComplete && (
              <View className="mt-6 pt-6 border-t border-white/10">
                <Text className="text-lg font-semibold mb-3 text-white">Test Results</Text>
                <View className="space-y-2">
                  {jobStatus.failed > 0 && functionExists !== false && (
                    <View className="bg-red-900/20 border border-red-800 rounded-lg p-3 mb-3">
                      <Text className="text-red-400 font-instrument-semibold text-sm mb-1">⚠️ Jobs Failed</Text>
                      <Text className="text-gray-300 font-instrument text-xs leading-4">
                        {jobStatus.failed} job(s) are marked as "failed" instead of "cancelled". This usually means:
                        {'\n\n'}
                        • There was an error calling the RPC function
                        {'\n'}
                        • Check CloudWatch logs for the actual error message
                        {'\n\n'}
                        {rpcError && (
                          <>
                            <Text className="font-instrument-semibold">Error:</Text> {rpcError}
                          </>
                        )}
                      </Text>
                    </View>
                  )}
                  <View className="flex-row items-center gap-2">
                    {jobStatus.sent === 1 && jobStatus.cancelled === totalJobs - 1 ? (
                      <Text className="text-green-400">✅ PASS</Text>
                    ) : (
                      <Text className="text-red-400">❌ FAIL</Text>
                    )}
                    <Text className="text-gray-300 text-sm">
                      {scenario === 'min-gap' && 'Min gap enforced correctly'}
                      {scenario === 'daily-limit' && 'Daily limit enforced correctly'}
                      {scenario === 'hourly-limit' && 'Hourly limit enforced correctly'}
                      {scenario === 'mixed' && 'All limits enforced correctly'}
                    </Text>
                  </View>
                  <Text className="text-gray-400 text-xs">
                    Expected: 1 sent, {totalJobs - 1} cancelled
                  </Text>
                  <Text className="text-gray-400 text-xs">
                    Actual: {jobStatus.sent} sent, {jobStatus.cancelled} cancelled, {jobStatus.failed} failed{jobStatus.blocked > 0 ? `, ${jobStatus.blocked} blocked` : ''}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Info Section */}
        <View className="bg-blue-900/20 border border-blue-800 rounded-xl p-6">
          <Text className="text-blue-400 font-instrument-semibold text-lg mb-4">ℹ️ How Race Condition Testing Works</Text>
          
          <View className="space-y-4">
            <View>
              <Text className="text-white font-instrument-semibold text-sm mb-2">What This Test Does</Text>
              <Text className="text-gray-300 font-instrument text-sm leading-5">
                Creates multiple message jobs for the same mailbox, all scheduled for immediate processing.
                When multiple workers try to process these jobs simultaneously, they compete to check throttle limits.
                This tests whether the atomic throttle checking system prevents race conditions.
                {'\n\n'}
                <Text className="font-instrument-semibold">Note:</Text> You must scale your ECS send worker service to 2-5 tasks for this test to work properly.
                With a single worker, jobs process sequentially and won't trigger race conditions.
              </Text>
            </View>

            <View>
              <Text className="text-white font-instrument-semibold text-sm mb-2">How Throttle Checking Works</Text>
              <Text className="text-gray-300 font-instrument text-sm leading-5 mb-2">
                Each worker calls the database function `check_mailbox_throttle_and_reserve()` which:
              </Text>
              <View className="ml-4 space-y-1">
                <Text className="text-gray-300 font-instrument text-sm leading-5">
                  • Locks the message job and mailbox throttle records (SELECT FOR UPDATE)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm leading-5">
                  • Checks three throttle limits atomically:
                </Text>
                <View className="ml-4 mt-1 space-y-1">
                  <Text className="text-gray-300 font-instrument text-sm leading-5">
                    - Daily limit: sent_count {'<'} daily_limit
                  </Text>
                  <Text className="text-gray-300 font-instrument text-sm leading-5">
                    - Hourly limit: hourly_sent[current_hour] {'<'} hourly_limit
                  </Text>
                  <Text className="text-gray-300 font-instrument text-sm leading-5">
                    - Min gap: time since last_sent_at {'>='} min_gap_seconds
                  </Text>
                </View>
                <Text className="text-gray-300 font-instrument text-sm leading-5">
                  • If all checks pass: Updates throttle counters and returns success
                </Text>
                <Text className="text-gray-300 font-instrument text-sm leading-5">
                  • If any check fails: Cancels the job and returns failure reason
                </Text>
              </View>
            </View>

            <View>
              <Text className="text-white font-instrument-semibold text-sm mb-2">Test Scenarios</Text>
              <View className="space-y-2">
                <View>
                  <Text className="text-gray-300 font-instrument-semibold text-sm">Min Gap</Text>
                  <Text className="text-gray-400 font-instrument text-xs leading-4">
                    Sets last_sent_at to now, then creates jobs. Only 1 should succeed (first one), rest cancelled due to min gap.
                  </Text>
                </View>
                <View>
                  <Text className="text-gray-300 font-instrument-semibold text-sm">Daily Limit</Text>
                  <Text className="text-gray-400 font-instrument text-xs leading-4">
                    Sets sent_count to 1 below daily limit, then creates jobs. Only 1 should succeed (hits limit), rest cancelled.
                  </Text>
                </View>
                <View>
                  <Text className="text-gray-300 font-instrument-semibold text-sm">Hourly Limit</Text>
                  <Text className="text-gray-400 font-instrument text-xs leading-4">
                    Sets hourly count to 1 below hourly limit, then creates jobs. Only 1 should succeed (hits limit), rest cancelled.
                  </Text>
                </View>
                <View>
                  <Text className="text-gray-300 font-instrument-semibold text-sm">Mixed</Text>
                  <Text className="text-gray-400 font-instrument text-xs leading-4">
                    Tests all limits simultaneously. Jobs should be cancelled due to min gap (most restrictive).
                  </Text>
                </View>
              </View>
            </View>

            <View>
              <Text className="text-white font-instrument-semibold text-sm mb-2">Expected Results</Text>
              <Text className="text-gray-300 font-instrument text-sm leading-5">
                For a successful test, you should see:{'\n'}
                • Exactly 1 job with status "sent" (the first one that passed all checks){'\n'}
                • All other jobs with status "cancelled" (failed throttle checks){'\n'}
                • Throttle counters updated correctly (sent_count incremented by 1){'\n'}
                • No duplicate sends (each lead receives at most 1 email)
              </Text>
            </View>

            <View className="pt-3 border-t border-blue-800/50">
              <Text className="text-gray-300 font-instrument text-xs leading-4">
                <Text className="font-instrument-semibold">Note:</Text> All jobs use test mailboxes (@furnace.test) which skip SMTP sending.
                This allows testing throttle logic without sending real emails.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
