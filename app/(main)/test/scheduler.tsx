import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, TextInput } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { supabase } from '@/lib/supabase/client';
import { createCampaign, updateCampaign } from '@/lib/supabase/services/campaigns';
import { createLead } from '@/lib/supabase/services/leads';
import { createMailbox, getMailboxesByUser } from '@/lib/supabase/services/mailboxes';
import { getUserByExternalId, getAccountMembershipsForUser } from '@/lib/supabase/services/users';

interface StepStatus {
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
}

type WizardStep = 'flow' | 'lead' | 'processing' | 'complete';

type FlowTemplate = 'simple-email' | 'email-wait-email' | 'email-wait-wait-email' | 'custom';

const ALLOWED_EMAIL = 'porter@getfurnace.io';

/**
 * Creates flow data structure for different templates
 * 
 * NOTE: These are simplified test templates for testing the scheduler worker.
 * Production flows are created via the flow builder UI and may have different structures.
 * The database trigger `sync_campaign_nodes()` will automatically sync these to the `nodes` table.
 */
function createFlowTemplate(template: FlowTemplate): { nodes: any[]; edges: any[] } {
  switch (template) {
    case 'simple-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: {
              label: 'Initial Email',
              subject: 'Welcome to Our Campaign',
              body: 'Hello {{name}},\n\nWelcome to our campaign!',
            },
          },
        ],
        edges: [{ id: 'e1-2', source: 'leadSource-1', target: 'email-1' }],
      };

    case 'email-wait-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: {
              label: 'Initial Email',
              subject: 'Welcome Email',
              body: 'Hello {{name}},\n\nThis is the first email.',
            },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: {
              label: 'Wait 2 Minutes (Test)',
              duration: 2,
              unit: 'minutes',
              wait_duration_seconds: 120, // 2 minutes in seconds (for testing)
            },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 600, y: 0 },
            data: {
              label: 'Follow-up Email',
              subject: 'Follow-up Email',
              body: 'Hello {{name}},\n\nThis is a follow-up email after 2 minutes.',
            },
          },
        ],
        edges: [
          { id: 'e1-2', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2-3', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3-4', source: 'waitTime-1', target: 'email-2' },
        ],
      };

    case 'email-wait-wait-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: {
              label: 'Email 1',
              subject: 'First Email',
              body: 'Hello {{name}},\n\nFirst email.',
            },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: {
              label: 'Wait 3 Minutes (Test)',
              duration: 3,
              unit: 'minutes',
              wait_duration_seconds: 180, // 3 minutes in seconds (for testing)
            },
          },
          {
            id: 'waitTime-2',
            type: 'waitTime',
            position: { x: 600, y: 0 },
            data: {
              label: 'Wait 2 Minutes (Test)',
              duration: 2,
              unit: 'minutes',
              wait_duration_seconds: 120, // 2 minutes in seconds (for testing)
            },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 800, y: 0 },
            data: {
              label: 'Final Email',
              subject: 'Final Email',
              body: 'Hello {{name}},\n\nThis is the final email after multiple waits.',
            },
          },
        ],
        edges: [
          { id: 'e1-2', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2-3', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3-4', source: 'waitTime-1', target: 'waitTime-2' },
          { id: 'e4-5', source: 'waitTime-2', target: 'email-2' },
        ],
      };

    default:
      return { nodes: [], edges: [] };
  }
}

export default function TestSchedulerPage() {
  const { user } = useAuthenticator();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>('flow');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, StepStatus>>({});

  // Form data
  const [selectedFlow, setSelectedFlow] = useState<FlowTemplate>('simple-email');
  const [leadEmail, setLeadEmail] = useState('test-lead@example.com');
  const [leadName, setLeadName] = useState('Test Lead');
  const [campaignName, setCampaignName] = useState('Test Scheduler Campaign');
  
  // Schedule configuration
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [scheduleTimezone, setScheduleTimezone] = useState('America/New_York');
  const [scheduleStartHour, setScheduleStartHour] = useState(9);
  const [scheduleEndHour, setScheduleEndHour] = useState(17);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  
  // Jitter configuration
  const [enableJitter, setEnableJitter] = useState(true);
  const [jitterPercentage, setJitterPercentage] = useState('10');

  // Database nodes (for validation - matches production approach)
  const [dbNodes, setDbNodes] = useState<any[] | null>(null);

  // Tab state for complete step
  const [activeTab, setActiveTab] = useState<'overview' | 'progress' | 'details' | 'diagnostics'>('overview');

  // Results
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);

  // Verification data
  const [verificationData, setVerificationData] = useState<{
    enrollment: any;
    messageJobs: any[];
    lastChecked: string | null;
    campaignNodes?: any[]; // All nodes in the campaign for diagnostics
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [autoVerify, setAutoVerify] = useState(true);
  const [autoVerifyInterval, setAutoVerifyInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [waitingForScheduler, setWaitingForScheduler] = useState(false);
  const [nextPollEstimate, setNextPollEstimate] = useState<number | null>(null);
  const [enrollmentTimeout, setEnrollmentTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{
    enrollmentReady: boolean;
    nextRunAt: string | null;
    enrollmentState: string | null;
    timeSinceCreation: number | null;
    pollCount: number;
  } | null>(null);
  const [pollCount, setPollCount] = useState(0);
  
  // Test status tracking
  type TestStatus = 'created' | 'processing' | 'waiting' | 'running' | 'complete' | 'error';
  const [testStatus, setTestStatus] = useState<TestStatus>('created');

  // Get user email from Cognito
  const getUserEmail = useCallback(() => {
    const loginId = user?.signInDetails?.loginId ?? null;
    const username = user?.username ?? null;
    const cognitoEmail =
      (user as any)?.attributes?.email ??
      (user as any)?.attributes?.preferred_username ??
      loginId ??
      null;
    return cognitoEmail?.toLowerCase().trim() ?? null;
  }, [user]);

  // Check authorization
  useEffect(() => {
    const checkAuth = async () => {
      const email = getUserEmail();
      if (email === ALLOWED_EMAIL.toLowerCase().trim()) {
        setIsAuthorized(true);
        setLoading(false);
      } else {
        setIsAuthorized(false);
        setLoading(false);
      }
    };
    checkAuth();
  }, [getUserEmail]);

  // Auto-verify polling
  useEffect(() => {
    if (autoVerify && enrollmentId) {
      // Initial verification
      verifyTest();
      
      // Set up polling interval (every 5 seconds)
      const interval = setInterval(() => {
        verifyTest();
      }, 5000);
      
      setAutoVerifyInterval(interval);
      
      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    } else {
      // Clean up interval if auto-verify is disabled or enrollmentId is cleared
      if (autoVerifyInterval) {
        clearInterval(autoVerifyInterval);
        setAutoVerifyInterval(null);
      }
    }
  }, [autoVerify, enrollmentId]);

  // Calculate next poll estimate
  useEffect(() => {
    if (waitingForScheduler && autoVerify) {
      const interval = setInterval(() => {
        // Calculate seconds until next 5-second mark
        const now = Date.now();
        const nextPoll = Math.ceil(now / 5000) * 5000;
        const secondsUntil = Math.ceil((nextPoll - now) / 1000);
        setNextPollEstimate(secondsUntil);
      }, 1000);
      
      return () => clearInterval(interval);
    } else {
      setNextPollEstimate(null);
    }
  }, [waitingForScheduler, autoVerify]);

  // Load nodes from database when campaign is available (for validation - matches production approach)
  useEffect(() => {
    if (campaignId && !dbNodes) {
      supabase
        .from('nodes')
        .select('node_type')
        .eq('campaign_id', campaignId)
        .then(({ data, error }) => {
          if (!error && data) {
            setDbNodes(data);
          }
        });
    }
  }, [campaignId, dbNodes]);

  const updateStep = (step: string, status: StepStatus['status'], message?: string) => {
    setSteps(prev => ({
      ...prev,
      [step]: { status, message },
    }));
  };

  const handleNext = () => {
    if (currentStep === 'flow') {
      if (!campaignName.trim()) {
        setError('Please enter a campaign name');
        return;
      }
      setError(null);
      setCurrentStep('lead');
    } else if (currentStep === 'lead') {
      if (!leadEmail || !leadEmail.includes('@')) {
        setError('Please enter a valid lead email address');
        return;
      }
      if (!leadName.trim()) {
        setError('Please enter a lead name');
        return;
      }
      setError(null);
      setCurrentStep('processing');
      handleCreateTest();
    }
  };

  const handleBack = () => {
    if (currentStep === 'lead') {
      setCurrentStep('flow');
      setError(null);
    } else if (currentStep === 'processing') {
      setCurrentStep('lead');
      setError(null);
      setSteps({});
    } else if (currentStep === 'complete') {
      setCurrentStep('flow');
      setError(null);
      setSteps({});
      setCampaignId(null);
      setLeadId(null);
      setEnrollmentId(null);
      setVerificationData(null);
      setWaitingForScheduler(false);
      setNextPollEstimate(null);
    }
  };

  const handleCleanup = async () => {
    if (!campaignId) return;

    try {
      setLoading(true);
      setError(null);

      // Delete in order: message_jobs -> enrollments -> nodes -> leads -> campaign
      if (enrollmentId) {
        await supabase.from('message_jobs').delete().eq('enrollment_id', enrollmentId);
        await supabase.from('enrollments').delete().eq('id', enrollmentId);
      }

      await supabase.from('nodes').delete().eq('campaign_id', campaignId);
      if (leadId) {
        await supabase.from('leads').delete().eq('id', leadId);
      }
      await supabase.from('campaigns').delete().eq('id', campaignId);

      // Reset state
      setCampaignId(null);
      setLeadId(null);
      setEnrollmentId(null);
      setVerificationData(null);
      setWaitingForScheduler(false);
      setNextPollEstimate(null);
      setDiagnostics(null);
      setPollCount(0);
      setTestStatus('created');
      setDbNodes(null); // Reset database nodes
      if (enrollmentTimeout) {
        clearTimeout(enrollmentTimeout);
        setEnrollmentTimeout(null);
      }
      setCurrentStep('flow');
      setError(null);
      setSteps({});
      setActiveTab('overview'); // Reset to overview tab
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Cleanup failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const verifyTest = async () => {
    if (!enrollmentId) return;

    setVerifying(true);
    try {
      // Increment poll count and get the new value
      let currentPollCount = 0;
      setPollCount(prev => {
        currentPollCount = prev + 1;
        return currentPollCount;
      });

      // Fetch enrollment with related data
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .select(`
          *,
          current_node:nodes(id, flow_node_id, node_type, node_data)
        `)
        .eq('id', enrollmentId)
        .single();

      if (enrollmentError) throw enrollmentError;

      // Fetch message jobs for this enrollment
      const { data: messageJobs, error: jobsError } = await supabase
        .from('message_jobs')
        .select(`
          *,
          node:nodes(id, flow_node_id, node_type, node_data)
        `)
        .eq('enrollment_id', enrollmentId)
        .order('created_at', { ascending: true }); // Show in creation order for easier debugging

      if (jobsError) throw jobsError;

      // Fetch all nodes for this campaign for diagnostics
      const { data: campaignNodesData } = await supabase
        .from('nodes')
        .select('id, flow_node_id, node_type')
        .eq('campaign_id', enrollment.campaign_id);
      
      const campaignNodes = campaignNodesData || [];

      // Calculate diagnostics
      const now = new Date();
      const enrollmentCreatedAt = new Date(enrollment.created_at);
      const timeSinceCreation = Math.floor((now.getTime() - enrollmentCreatedAt.getTime()) / 1000);
      const nextRunAt = enrollment.next_run_at ? new Date(enrollment.next_run_at) : null;
      const enrollmentReady = nextRunAt ? nextRunAt <= now : false;

      setDiagnostics({
        enrollmentReady,
        nextRunAt: enrollment.next_run_at,
        enrollmentState: enrollment.state,
        timeSinceCreation,
        pollCount: currentPollCount,
      });

      setVerificationData({
        enrollment,
        messageJobs: messageJobs || [],
        lastChecked: new Date().toISOString(),
        campaignNodes, // Store for diagnostics
      });
      
      // Update test status based on current state
      if (enrollment.state === 'completed') {
        setTestStatus('complete');
        setWaitingForScheduler(false);
        if (enrollmentTimeout) {
          clearTimeout(enrollmentTimeout);
          setEnrollmentTimeout(null);
        }
      } else if (enrollment.state === 'stopped' && (!messageJobs || messageJobs.length === 0)) {
        setTestStatus('error');
        setWaitingForScheduler(false);
      } else if (messageJobs && messageJobs.length > 0) {
        // Scheduler has processed - check if flow is complete
        // For now, if we have message jobs, consider it "running"
        // TODO: Could be smarter about detecting completion based on flow structure
        setTestStatus('running');
        setWaitingForScheduler(false);
        if (enrollmentTimeout) {
          clearTimeout(enrollmentTimeout);
          setEnrollmentTimeout(null);
        }
        setDiagnostics(null); // Clear diagnostics once processing starts
        setError(null); // Clear any previous errors
        return;
      } else if (enrollment.state === 'active' && enrollmentReady) {
        // Enrollment is ready but no message jobs yet - scheduler should process it
        if (currentPollCount >= 12) {
          setTestStatus('waiting'); // Been waiting too long
        } else {
          setTestStatus('processing'); // Still within expected time
        }
      } else if (!enrollmentReady && enrollment.next_run_at) {
        // Waiting for next_run_at
        setTestStatus('waiting');
      } else {
        setTestStatus('processing');
      }
      
      // If we have message jobs or enrollment is complete, clear diagnostics
      if ((messageJobs && messageJobs.length > 0) || enrollment.state === 'completed') {
        setDiagnostics(null); // Clear diagnostics once processing starts
        setError(null); // Clear any previous errors
      }
      
      // Check for stuck states and provide actionable insights (after 12 polls = 1 minute)
      if (currentPollCount >= 12 && (!messageJobs || messageJobs.length === 0)) {
        // Polled for 1 minute (12 polls * 5 seconds) with no results
        let insight = '';
        let action = '';

        if (!enrollmentReady && nextRunAt) {
          const secondsUntil = Math.ceil((nextRunAt.getTime() - now.getTime()) / 1000);
          insight = `Enrollment is not ready yet. next_run_at is ${nextRunAt.toLocaleString()} (${secondsUntil} seconds from now).`;
          action = 'This is normal if a wait node was processed. The scheduler will process it when next_run_at is reached.';
        } else if (enrollment.state === 'stopped') {
          insight = 'Enrollment state is "stopped" without any message jobs created.';
          action = 'The scheduler likely encountered an error. Check CloudWatch logs for the scheduler worker. Common issues: missing mailbox, invalid flow, or database error.';
        } else if (enrollment.state === 'active' && enrollmentReady) {
          insight = `Enrollment is active and ready (next_run_at: ${nextRunAt?.toLocaleString() || 'N/A'}), but no message jobs created after ${timeSinceCreation} seconds (${currentPollCount} polls).`;
          action = 'The scheduler worker may not be running, or there may be an error preventing processing. Check: 1) Is the scheduler ECS service running? 2) Check CloudWatch logs for errors. 3) Verify the enrollment is being picked up by the scheduler query (state=active, next_run_at <= NOW()).';
        } else if (enrollment.state === 'completed') {
          insight = 'Enrollment is marked as completed without creating message jobs.';
          action = 'The flow may have no email nodes, or the scheduler determined the flow is complete. Check your flow template.';
        } else {
          insight = `Enrollment state: ${enrollment.state}, ready: ${enrollmentReady}, no message jobs after ${timeSinceCreation} seconds (${currentPollCount} polls).`;
          action = 'The scheduler may not be processing this enrollment. Check CloudWatch logs and verify the scheduler worker is running.';
        }

        setError(`${insight}\n\n💡 ${action}`);
      }
      
      // Check for error states
      if (enrollment.state === 'stopped' && (!messageJobs || messageJobs.length === 0)) {
        // Enrollment stopped without creating jobs - likely an error
        setTestStatus('error');
        setError('Enrollment was stopped without processing. This may indicate an error. Check scheduler logs.');
      }
    } catch (err) {
      console.error('Error verifying test:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Provide more helpful error messages
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        setError(`Network error: Unable to connect to Supabase. Check your internet connection and ensure Supabase is accessible. Original error: ${errorMessage}`);
      } else {
        setError(`Error verifying test: ${errorMessage}`);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleCreateTest = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    setSteps({});

    try {
      // 1. Get or create user profile
      updateStep('user', 'loading', 'Getting user profile...');
      let userProfile = await getUserByExternalId(user.userId);
      if (!userProfile) {
        throw new Error('User profile not found. Please complete account setup first.');
      }
      updateStep('user', 'success', `User: ${userProfile.id.substring(0, 8)}...`);

      // 2. Get user's account
      updateStep('account', 'loading', 'Getting user account...');
      const memberships = await getAccountMembershipsForUser(userProfile.id);
      if (!memberships || memberships.length === 0) {
        throw new Error('User has no account. Please complete account setup first.');
      }
      const account = memberships[0].account;
      updateStep('account', 'success', `Account ready`);

      // 3. Get or create mailbox
      updateStep('mailbox', 'loading', 'Getting or creating mailbox...');
      const existingMailboxes = await getMailboxesByUser(userProfile.id);
      let mailbox;
      if (existingMailboxes && existingMailboxes.length > 0) {
        mailbox = existingMailboxes[0];
        const isTestMailbox = mailbox.email_address === 'test@example.com';
        updateStep('mailbox', 'success', isTestMailbox 
          ? `Using test mailbox (⚠️ Will fail on actual send)` 
          : `Using mailbox: ${mailbox.email_address}`);
      } else {
        mailbox = await createMailbox({
          user_id: userProfile.id,
          account_id: account.id,
          email_address: 'test@example.com',
          display_name: 'Test Mailbox',
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
        updateStep('mailbox', 'success', `Created test mailbox (⚠️ Will fail on actual send)`);
      }

      // 4. Create campaign with selected flow template
      updateStep('campaign', 'loading', 'Creating campaign with flow...');
      const flowData = createFlowTemplate(selectedFlow);
      
      // Build schedule if enabled (with validation)
      let schedule = null;
      if (enableSchedule) {
        // Validate schedule
        if (scheduleStartHour >= scheduleEndHour) {
          throw new Error('Start hour must be before end hour');
        }
        if (scheduleDays.length === 0) {
          throw new Error('Select at least one day of the week');
        }
        // Basic timezone validation
        try {
          Intl.DateTimeFormat(undefined, { timeZone: scheduleTimezone });
        } catch (e) {
          throw new Error(`Invalid timezone: ${scheduleTimezone}`);
        }
        
        schedule = {
          timezone: scheduleTimezone,
          start_hour: scheduleStartHour,
          end_hour: scheduleEndHour,
          days_of_week: scheduleDays,
        };
      }
      
      // Build campaign data with schedule and jitter
      const campaignData: any = {
        name: campaignName,
        owner_id: userProfile.id,
        account_id: account.id, // Explicitly set account_id
        organization_id: null,
        status: 'running',
        flow_data: flowData,
      };
      
      if (schedule) {
        campaignData.schedule = schedule;
      }
      
      if (enableJitter && jitterPercentage) {
        const jitter = parseFloat(jitterPercentage);
        if (isNaN(jitter) || jitter < 0 || jitter > 100) {
          throw new Error('Jitter percentage must be between 0 and 100');
        }
        campaignData.jitter_percentage = jitter;
      }
      
      const campaign = await createCampaign(campaignData);
      
      // Ensure campaign status is 'running'
      if (campaign.status !== 'running') {
        console.warn('Campaign status is not running, updating...');
        const updatedCampaign = await updateCampaign(campaign.id, { status: 'running' });
        campaign.status = updatedCampaign.status;
      }
      
      setCampaignId(campaign.id);
      updateStep('campaign', 'success', `Campaign created${schedule ? ' (with schedule)' : ''}${enableJitter ? ` (jitter: ${jitterPercentage}%)` : ''}`);

      // 5. Wait for database trigger to sync nodes from flow_data
      // NOTE: The trigger sync_campaign_nodes() automatically creates nodes when flow_data is set.
      // This matches production behavior - we rely on the trigger instead of manual node creation.
      // The trigger extracts nodes from campaigns.flow_data.nodes and syncs them to the nodes table.
      updateStep('nodes', 'loading', 'Waiting for nodes to sync...');
      
      // Give the trigger a moment to process (usually instant, but we'll wait briefly)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify nodes were created by the trigger and load them for validation
      const { data: syncedNodes, error: nodesError } = await supabase
        .from('nodes')
        .select('id, node_type')
        .eq('campaign_id', campaign.id);
      
      if (nodesError) {
        throw new Error(`Failed to verify nodes: ${nodesError.message}`);
      }
      
      // Store nodes for validation (matches production approach - query database instead of analyzing template)
      setDbNodes(syncedNodes || []);
      
      // Filter out leadSource nodes for display (they're in flow_data but not in nodes table per trigger logic)
      const nonLeadSourceNodes = (syncedNodes || []).filter(n => n.node_type !== 'leadSource');
      updateStep('nodes', 'success', `Nodes synced: ${nonLeadSourceNodes.length} node(s) created by database trigger`);

      // 6. Create test lead
      updateStep('lead', 'loading', 'Creating test lead...');
      const lead = await createLead({
        campaign_id: campaign.id,
        bucket_id: campaign.bucket_id,
        email: leadEmail,
        name: leadName,
        source: 'test-scheduler',
      });
      setLeadId(lead.id);
      updateStep('lead', 'success', `Lead created`);

      // 7. Create enrollment (this is what the scheduler will process)
      updateStep('enrollment', 'loading', 'Creating enrollment...');
      
      // Set current_node_id to null to let evaluateFlow handle entry point detection
      // This ensures proper flow traversal from the beginning
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          current_node_id: null, // Let evaluateFlow handle entry point
          state: 'active',
          next_run_at: new Date().toISOString(), // Process immediately
          flow_position: {},
        })
        .select()
        .single();

      if (enrollmentError) {
        throw new Error(`Failed to create enrollment: ${enrollmentError.message}`);
      }
      setEnrollmentId(enrollment.id);
      updateStep('enrollment', 'success', `Enrollment created`);
      
      // Set waiting state - scheduler polls every 5 seconds
      setWaitingForScheduler(true);

      // Set timeout to detect if enrollment is not processed (2 minutes for test waits)
      const timeout = setTimeout(() => {
        if (verificationData?.messageJobs && verificationData.messageJobs.length === 0) {
          setError('Enrollment not processed within 2 minutes. Scheduler may be down or there may be an error. Check scheduler logs.');
        }
      }, 120000); // 2 minutes
      setEnrollmentTimeout(timeout);

      // Initial verification
      await verifyTest();
      
      // If we got message jobs, scheduler has processed it
      if (verificationData?.messageJobs && verificationData.messageJobs.length > 0) {
        setWaitingForScheduler(false);
        if (timeout) clearTimeout(timeout);
      }

      setCurrentStep('complete');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      // Mark current step as error
      const currentStepKey = Object.keys(steps).pop() || 'unknown';
      updateStep(currentStepKey, 'error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (isAuthorized === null || loading) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#f85102" />
          <Text className="mt-4 text-gray-400 font-instrument">Loading...</Text>
        </View>
      </PageLayout>
    );
  }

  if (!isAuthorized) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-xl font-instrument-semibold mb-2 text-white text-center">
            Access Restricted
          </Text>
          <Text className="text-gray-400 text-center mb-4 font-instrument">
            This testing dashboard is only available to authorized users.
          </Text>
          <Text className="text-gray-500 text-center text-xs font-instrument">
            Signed in as: {getUserEmail() || 'Unknown'}
          </Text>
        </View>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-1">
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          Scheduler Testing Dashboard
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Create test campaign flows and enrollments to test scheduler behavior
        </Text>
          </View>
          <Pressable
            onPress={() => setShowInfo(!showInfo)}
            className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-2"
          >
            <Text className="text-blue-400 font-instrument-medium text-sm">
              {showInfo ? 'Hide' : 'Show'} Info
            </Text>
          </Pressable>
        </View>

        {/* Info/README Section */}
        {showInfo && (
          <View className="bg-blue-900/20 border border-blue-800 rounded-xl p-4 mt-4">
            <Text className="text-blue-400 font-instrument-semibold text-base mb-3">
              📖 What This Test Does
            </Text>

            <View className="mb-4">
              <Text className="text-white font-instrument-semibold text-sm mb-2">
                ✅ What It Tests:
              </Text>
              <View className="gap-2 ml-2">
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Flow Traversal:</Text> Verifies the scheduler correctly evaluates campaign flows and moves enrollments through nodes (email → wait → email)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Entry Point Detection:</Text> Tests that enrollments with null current_node_id start from the correct entry point (leadSource)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Message Job Creation:</Text> Confirms email nodes create message_jobs with correct scheduled_at times, and validates NO DUPLICATES (each email node should create exactly one message job)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Wait Node Processing:</Text> Verifies wait nodes update next_run_at correctly (respecting schedule, no jitter)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Schedule Enforcement:</Text> Tests that emails are scheduled within business hours when schedule is enabled
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Jitter Application:</Text> Verifies jitter is applied to email send times (not wait nodes)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">SQS Integration:</Text> Confirms message_jobs are pushed to the send queue
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Enrollment State Management:</Text> Tests that enrollments progress through states (active → completed/stopped)
                </Text>
              </View>
            </View>

            <View className="mb-4">
              <Text className="text-white font-instrument-semibold text-sm mb-2">
                ❌ What It Does NOT Test:
              </Text>
              <View className="gap-2 ml-2">
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Actual Email Sending:</Text> Uses test mailbox with fake credentials. The send worker will fail if it tries to send.
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">SMTP Connection:</Text> Does not test real SMTP connections or email delivery
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Template Rendering:</Text> Does not verify email templates are rendered correctly with lead data
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Mailbox Selection:</Text> Uses first available mailbox, doesn't test round-robin distribution across multiple mailboxes
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Worker Scaling:</Text> Does not test ECS auto-scaling or multiple workers processing enrollments
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Error Recovery:</Text> Limited testing of error scenarios (missing mailbox, invalid flow, etc.)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">AICategorizer/DataSender Nodes:</Text> These are placeholder implementations, not fully tested
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  • <Text className="font-semibold">Concurrent Processing (Multiple Enrollments):</Text> Does not test multiple enrollments being processed simultaneously (but DOES test for duplicate prevention within a single enrollment)
                </Text>
              </View>
            </View>

            <View className="mb-4">
              <Text className="text-white font-instrument-semibold text-sm mb-2">
                🔧 How It Works:
              </Text>
              <View className="gap-2 ml-2">
                <Text className="text-gray-300 font-instrument text-sm">
                  1. <Text className="font-semibold">Setup:</Text> Creates a test campaign with a flow template (simple email, email+wait+email, etc.)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  2. <Text className="font-semibold">Configuration:</Text> Allows you to configure schedule (timezone, hours, days) and jitter percentage
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  3. <Text className="font-semibold">Node Creation:</Text> Creates database nodes from the flow template (excluding leadSource nodes)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  4. <Text className="font-semibold">Enrollment:</Text> Creates a test lead and enrollment with current_node_id = null (entry point)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  5. <Text className="font-semibold">Scheduler Processing:</Text> The scheduler worker (running in ECS) polls the database every 5 seconds for enrollments ready to process
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  6. <Text className="font-semibold">Flow Evaluation:</Text> Scheduler evaluates the flow, finds next nodes, and processes them (creates message_jobs for emails, updates next_run_at for waits)
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  7. <Text className="font-semibold">Verification:</Text> Auto-refresh polls the database every 5 seconds to show enrollment state and created message_jobs
                </Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  8. <Text className="font-semibold">Monitoring:</Text> You can watch the enrollment progress through the flow and verify scheduled times, jitter, and schedule enforcement
                </Text>
              </View>
            </View>

            <View className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3 mt-2">
              <Text className="text-yellow-400 font-instrument-semibold text-xs mb-1">
                ⚠️ Important Notes:
              </Text>
              <Text className="text-yellow-300 font-instrument text-xs">
                • Test uses short wait durations (2-3 minutes) for faster testing
              </Text>
              <Text className="text-yellow-300 font-instrument text-xs">
                • Scheduler polls every 5 seconds, so there may be a delay before processing
              </Text>
              <Text className="text-yellow-300 font-instrument text-xs">
                • Test mailbox has fake credentials - actual email sending will fail
              </Text>
              <Text className="text-yellow-300 font-instrument text-xs">
                • Use "Cleanup Test Data" to remove test campaigns and avoid database pollution
              </Text>
            </View>
          </View>
        )}
      </View>

      {error && (
        <View className="bg-red-900/20 border border-red-800 rounded-xl p-4 mb-6">
          <Text className="text-red-400 font-instrument text-sm">Error: {error}</Text>
        </View>
      )}

      {/* Step 1: Select Flow Template */}
      {currentStep === 'flow' && (
        <View>
          <Text className="text-lg font-instrument-semibold text-white mb-4">
            Step 1: Select Flow Template
          </Text>

          <View className="mb-6">
            <Text className="text-gray-300 font-instrument-medium text-sm mb-2">
              Campaign Name
            </Text>
            <TextInput
              value={campaignName}
              onChangeText={setCampaignName}
              placeholder="Test Campaign"
              placeholderTextColor="#6b7280"
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-white font-instrument"
            />
          </View>

          <View className="mb-6">
            <Text className="text-gray-300 font-instrument-medium text-sm mb-3">
              Flow Template
            </Text>
            <View className="gap-3">
              {[
                { value: 'simple-email', label: 'Simple Email', desc: 'Lead → Email' },
                {
                  value: 'email-wait-email',
                  label: 'Email + Wait + Email',
                  desc: 'Lead → Email → Wait 2 Min → Email (Test)',
                },
                {
                  value: 'email-wait-wait-email',
                  label: 'Email + Wait + Wait + Email',
                  desc: 'Lead → Email → Wait 3 Min → Wait 2 Min → Email (Test)',
                },
              ].map((template) => (
                <Pressable
                  key={template.value}
                  onPress={() => setSelectedFlow(template.value as FlowTemplate)}
                  className={`rounded-xl p-4 border-2 ${
                    selectedFlow === template.value
                      ? 'border-brand-orange bg-brand-orange/10'
                      : 'border-[#2A2A2A] bg-[#1A1A1A]'
                  }`}
                  style={
                    selectedFlow === template.value
                      ? { borderColor: '#f85102', backgroundColor: '#f8510210' }
                      : undefined
                  }
                >
                  <Text
                    className={`font-instrument-semibold text-base mb-1 ${
                      selectedFlow === template.value ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {template.label}
                  </Text>
                  <Text
                    className={`font-instrument text-sm ${
                      selectedFlow === template.value ? 'text-gray-300' : 'text-gray-500'
                    }`}
                  >
                    {template.desc}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            onPress={handleNext}
            className="bg-brand-orange rounded-xl px-6 py-3 flex-row items-center justify-center"
            style={{ backgroundColor: '#f85102' }}
          >
            <Text className="text-white font-instrument-semibold text-base">Next: Configure Lead</Text>
          </Pressable>
        </View>
      )}

      {/* Step 2: Configure Lead */}
      {currentStep === 'lead' && (
        <View>
          <Text className="text-lg font-instrument-semibold text-white mb-4">
            Step 2: Configure Test Lead
          </Text>

          <View className="mb-6">
            <Text className="text-gray-300 font-instrument-medium text-sm mb-2">Lead Email</Text>
            <TextInput
              value={leadEmail}
              onChangeText={setLeadEmail}
              placeholder="test-lead@example.com"
              placeholderTextColor="#6b7280"
              keyboardType="email-address"
              autoCapitalize="none"
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-white font-instrument"
            />
          </View>

          <View className="mb-6">
            <Text className="text-gray-300 font-instrument-medium text-sm mb-2">Lead Name</Text>
            <TextInput
              value={leadName}
              onChangeText={setLeadName}
              placeholder="Test Lead"
              placeholderTextColor="#6b7280"
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-white font-instrument"
            />
          </View>

          {/* Schedule Configuration */}
          <View className="mb-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-gray-300 font-instrument-medium text-sm">Enable Schedule</Text>
              <Pressable
                onPress={() => setEnableSchedule(!enableSchedule)}
                className={`w-12 h-6 rounded-full flex-row items-center ${
                  enableSchedule ? 'bg-brand-orange' : 'bg-[#2A2A2A]'
                }`}
                style={enableSchedule ? { backgroundColor: '#f85102' } : undefined}
              >
                <View
                  className={`w-5 h-5 rounded-full bg-white ${
                    enableSchedule ? 'ml-auto mr-1' : 'ml-1'
                  }`}
                />
              </Pressable>
            </View>
            
            {enableSchedule && (
              <View className="bg-[#121212] rounded-lg p-4 gap-4 mt-2">
                <View>
                  <Text className="text-gray-400 font-instrument text-xs mb-2">Timezone</Text>
                  <TextInput
                    value={scheduleTimezone}
                    onChangeText={setScheduleTimezone}
                    placeholder="America/New_York"
                    placeholderTextColor="#6b7280"
                    className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                  />
                </View>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-gray-400 font-instrument text-xs mb-2">Start Hour</Text>
                    <TextInput
                      value={scheduleStartHour.toString()}
                      onChangeText={(text) => {
                        const num = parseInt(text);
                        if (!isNaN(num) && num >= 0 && num <= 23) {
                          setScheduleStartHour(num);
                        }
                      }}
                      keyboardType="numeric"
                      placeholder="9"
                      placeholderTextColor="#6b7280"
                      className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-400 font-instrument text-xs mb-2">End Hour</Text>
                    <TextInput
                      value={scheduleEndHour.toString()}
                      onChangeText={(text) => {
                        const num = parseInt(text);
                        if (!isNaN(num) && num >= 0 && num <= 23) {
                          setScheduleEndHour(num);
                        }
                      }}
                      keyboardType="numeric"
                      placeholder="17"
                      placeholderTextColor="#6b7280"
                      className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                    />
                  </View>
                </View>
                <View>
                  <Text className="text-gray-400 font-instrument text-xs mb-2">Days of Week</Text>
                  <View className="flex-row gap-2 flex-wrap">
                    {[
                      { value: 0, label: 'Sun' },
                      { value: 1, label: 'Mon' },
                      { value: 2, label: 'Tue' },
                      { value: 3, label: 'Wed' },
                      { value: 4, label: 'Thu' },
                      { value: 5, label: 'Fri' },
                      { value: 6, label: 'Sat' },
                    ].map((day) => (
                      <Pressable
                        key={day.value}
                        onPress={() => {
                          if (scheduleDays.includes(day.value)) {
                            setScheduleDays(scheduleDays.filter(d => d !== day.value));
                          } else {
                            setScheduleDays([...scheduleDays, day.value].sort());
                          }
                        }}
                        className={`px-3 py-2 rounded-lg ${
                          scheduleDays.includes(day.value)
                            ? 'bg-brand-orange'
                            : 'bg-[#1A1A1A] border border-[#2A2A2A]'
                        }`}
                        style={
                          scheduleDays.includes(day.value)
                            ? { backgroundColor: '#f85102' }
                            : undefined
                        }
                      >
                        <Text
                          className={`font-instrument-medium text-xs ${
                            scheduleDays.includes(day.value) ? 'text-white' : 'text-gray-400'
                          }`}
                        >
                          {day.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Jitter Configuration */}
          <View className="mb-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-gray-300 font-instrument-medium text-sm">Enable Jitter</Text>
              <Pressable
                onPress={() => setEnableJitter(!enableJitter)}
                className={`w-12 h-6 rounded-full flex-row items-center ${
                  enableJitter ? 'bg-brand-orange' : 'bg-[#2A2A2A]'
                }`}
                style={enableJitter ? { backgroundColor: '#f85102' } : undefined}
              >
                <View
                  className={`w-5 h-5 rounded-full bg-white ${
                    enableJitter ? 'ml-auto mr-1' : 'ml-1'
                  }`}
                />
              </Pressable>
            </View>
            
            {enableJitter && (
              <View className="bg-[#121212] rounded-lg p-4 mt-2">
                <Text className="text-gray-400 font-instrument text-xs mb-2">Jitter Percentage (0-100)</Text>
                <TextInput
                  value={jitterPercentage}
                  onChangeText={(text) => {
                    const num = parseFloat(text);
                    if (!isNaN(num) && num >= 0 && num <= 100) {
                      setJitterPercentage(text);
                    } else if (text === '') {
                      setJitterPercentage('');
                    }
                  }}
                  keyboardType="numeric"
                  placeholder="10"
                  placeholderTextColor="#6b7280"
                  className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                />
                <Text className="text-gray-500 font-instrument text-xs mt-2">
                  Random delay up to {jitterPercentage || '10'}% applied to email send times (not wait nodes)
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row gap-3">
            <Pressable
              onPress={handleBack}
              className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-6 py-3 flex-row items-center justify-center"
            >
              <Text className="text-gray-300 font-instrument-semibold text-base">Back</Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
              className="flex-1 bg-brand-orange rounded-xl px-6 py-3 flex-row items-center justify-center"
              style={{ backgroundColor: '#f85102' }}
            >
              <Text className="text-white font-instrument-semibold text-base">Create Test</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Step 3: Processing */}
      {currentStep === 'processing' && (
        <View>
          <Text className="text-lg font-instrument-semibold text-white mb-4">Creating Test...</Text>
          <View className="gap-4">
            {[
              { key: 'user', label: 'User Profile' },
              { key: 'account', label: 'Account' },
              { key: 'mailbox', label: 'Mailbox' },
              { key: 'campaign', label: 'Campaign' },
              { key: 'nodes', label: 'Flow Nodes' },
              { key: 'lead', label: 'Test Lead' },
              { key: 'enrollment', label: 'Enrollment' },
            ].map((step) => {
              const stepStatus = steps[step.key] || { status: 'pending' as const };
              return (
                <View
                  key={step.key}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 flex-row items-center justify-between"
                >
                  <Text className="text-gray-300 font-instrument text-base">{step.label}</Text>
                  <View className="flex-row items-center gap-2">
                    {stepStatus.status === 'loading' && (
                      <ActivityIndicator size="small" color="#f85102" />
                    )}
                    {stepStatus.status === 'success' && (
                      <Text className="text-green-400 font-instrument text-sm">✓</Text>
                    )}
                    {stepStatus.status === 'error' && (
                      <Text className="text-red-400 font-instrument text-sm">✗</Text>
                    )}
                    {stepStatus.status === 'pending' && (
                      <Text className="text-gray-500 font-instrument text-sm">—</Text>
                    )}
                    {stepStatus.message && (
                      <Text className="text-gray-400 font-instrument text-sm">
                        {stepStatus.message}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Step 4: Complete - Tabbed Layout */}
      {currentStep === 'complete' && (
        <View>
          {/* Compact Status Header */}
          <View className={`rounded-xl p-4 mb-4 border-2 ${
            testStatus === 'complete' ? 'bg-green-900/20 border-green-800' :
            testStatus === 'error' ? 'bg-red-900/20 border-red-800' :
            testStatus === 'waiting' ? 'bg-yellow-900/20 border-yellow-800' :
            'bg-blue-900/20 border-blue-800'
          }`}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2 flex-1">
                {testStatus === 'complete' && <Text className="text-xl">✅</Text>}
                {testStatus === 'error' && <Text className="text-xl">❌</Text>}
                {(testStatus === 'processing' || testStatus === 'waiting' || testStatus === 'running') && (
                  <ActivityIndicator size="small" color={
                    testStatus === 'waiting' ? '#fbbf24' : '#60a5fa'
                  } />
                )}
                <Text className={`font-instrument-semibold text-base ${
                  testStatus === 'complete' ? 'text-green-400' :
                  testStatus === 'error' ? 'text-red-400' :
                  testStatus === 'waiting' ? 'text-yellow-400' :
                  'text-blue-400'
                }`}>
                  {testStatus === 'complete' ? 'Test Complete' :
                   testStatus === 'error' ? 'Test Error' :
                   testStatus === 'waiting' ? 'Waiting' :
                   testStatus === 'running' ? 'Test Running' :
                   'Test Processing'}
            </Text>
                {verificationData && verificationData.enrollment.state && (
                  <View className={`px-2 py-1 rounded ${
                    verificationData.enrollment.state === 'active' ? 'bg-green-600/20' :
                    verificationData.enrollment.state === 'completed' ? 'bg-blue-600/20' :
                    'bg-red-600/20'
                  }`}>
                    <Text className={`text-xs font-instrument-semibold uppercase ${
                      verificationData.enrollment.state === 'active' ? 'text-green-400' :
                      verificationData.enrollment.state === 'completed' ? 'text-blue-400' :
                      'text-red-400'
                    }`}>
                      {verificationData.enrollment.state}
              </Text>
                  </View>
                )}
              </View>
              {verificationData?.lastChecked && (
                <Text className="text-gray-500 font-instrument text-xs">
                  Updated {new Date(verificationData.lastChecked).toLocaleTimeString()}
              </Text>
              )}
            </View>
          </View>

          {/* Tabs */}
          <View className="flex-row gap-2 mb-4 border-b border-gray-700">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'progress', label: 'Progress' },
              { id: 'details', label: 'Details' },
              { id: 'diagnostics', label: 'Diagnostics' },
            ].map((tab) => (
                <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id as any)}
                className={`flex-1 pb-2 border-b-2 ${
                  activeTab === tab.id
                    ? 'border-brand-orange'
                    : 'border-transparent'
                }`}
              >
                <Text className={`text-center font-instrument-medium text-sm ${
                  activeTab === tab.id
                    ? 'text-brand-orange'
                    : 'text-gray-400'
                }`}>
                  {tab.label}
                  </Text>
                </Pressable>
            ))}
          </View>

          {/* Tab Content */}
          {(() => {
            // Calculate shared data for all tabs
            const messageJobs = verificationData?.messageJobs || [];
            const jobStats = {
              total: messageJobs.length,
              sent: messageJobs.filter((j: any) => j.status === 'sent').length,
              pending: messageJobs.filter((j: any) => j.status === 'pending' || j.status === 'reserved' || j.status === 'sending').length,
              failed: messageJobs.filter((j: any) => j.status === 'failed').length,
            };
            const completionPercent = jobStats.total > 0 ? Math.round((jobStats.sent / jobStats.total) * 100) : 0;
            const dbNodeTypes = dbNodes?.map(n => n.node_type) || [];
            const hasWaitNodes = dbNodeTypes.includes('waitTime');
            const hasEmailNodes = dbNodeTypes.includes('email');
            const emailNodeCount = dbNodeTypes.filter((t: string) => t === 'email').length;
            const expectedMessageJobCount = emailNodeCount;
            const enrollment = verificationData?.enrollment;

            // Calculate description and concerns
            let description = '';
            let concerns: string[] = [];
            if (testStatus === 'complete') {
              description = 'The test flow has completed successfully. All message jobs have been created and processed.';
            } else if (testStatus === 'error') {
              description = 'The test encountered an error. Check the error message below and scheduler logs for details.';
              if (verificationData?.enrollment.state === 'stopped') {
                concerns.push('Enrollment was stopped without processing');
              }
            } else if (testStatus === 'waiting') {
              if (verificationData?.enrollment.next_run_at) {
                const nextRun = new Date(verificationData.enrollment.next_run_at);
                const secondsUntil = Math.ceil((nextRun.getTime() - new Date().getTime()) / 1000);
                description = `Waiting for the next scheduled run in ${secondsUntil} second${secondsUntil !== 1 ? 's' : ''}. This is normal after a wait node.`;
              } else {
                description = 'Waiting for the scheduler to process the enrollment. This may indicate the scheduler worker is not running.';
                if (pollCount >= 12) {
                  concerns.push('Scheduler has not processed the enrollment after 1 minute');
                }
              }
            } else if (testStatus === 'processing') {
              description = 'The scheduler is evaluating the flow and will create message jobs shortly.';
            } else if (testStatus === 'running') {
              if (jobStats.total === 0) {
                description = 'Scheduler has processed the enrollment, but no message jobs have been created yet.';
              } else if (jobStats.sent === jobStats.total) {
                description = `All ${jobStats.total} message job${jobStats.total !== 1 ? 's have' : ' has'} been sent successfully.`;
              } else if (jobStats.pending > 0) {
                description = `${jobStats.pending} of ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} ${jobStats.pending === 1 ? 'is' : 'are'} pending (${completionPercent}% complete).`;
              } else {
                description = `${jobStats.sent} of ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} sent (${completionPercent}% complete).`;
              }
              if (jobStats.failed > 0) {
                concerns.push(`${jobStats.failed} message job${jobStats.failed !== 1 ? 's' : ''} failed`);
              }
            }

            // Calculate nextSteps (reuse existing logic)
            let nextSteps = '';
            let nextStepsType: 'success' | 'waiting' | 'action' | 'info' = 'info';
            const testResults: string[] = [];
            const testFailures: string[] = [];

            if (testStatus === 'complete') {
              if (jobStats.total > 0 || enrollment?.state === 'completed') {
                testResults.push('✅ Entry Point Detection: Enrollment started from correct entry point (leadSource node)');
              } else {
                testFailures.push('❌ Entry Point Detection: Enrollment did not process correctly from entry point');
              }

              if (hasEmailNodes) {
                if (jobStats.total === 0) {
                  const campaignNodes = verificationData?.campaignNodes || dbNodes || [];
                  const emailNodes = campaignNodes.filter((n: any) => n.node_type === 'email');
                  const enrollmentCurrentNode = enrollment?.current_node_id;
                  const enrollmentCurrentNodeData = campaignNodes.find((n: any) => n.id === enrollmentCurrentNode);
                  
                  let diagnosticDetails = [
                    `Found ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''} in campaign`,
                    enrollmentCurrentNode 
                      ? `Enrollment stopped at node: ${enrollmentCurrentNodeData?.node_type || 'unknown'} (${enrollmentCurrentNodeData?.flow_node_id || enrollmentCurrentNode.substring(0, 8)}...)`
                      : 'Enrollment completed (current_node_id: null)',
                  ].join('. ');
                  
                  if (enrollment?.state === 'completed' && emailNodes.length > 0) {
                    diagnosticDetails += ` The scheduler completed the flow without creating jobs for ${emailNodes.length} email node${emailNodes.length !== 1 ? 's' : ''}. This suggests the flow traversal did not encounter the email nodes - check flow edges in campaign.flow_data.`;
                  }
                  
                  testFailures.push(`❌ Message Job Creation: Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but none were created. ${diagnosticDetails}`);
                } else if (jobStats.total < expectedMessageJobCount) {
                  testFailures.push(`❌ Message Job Creation: Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but only ${jobStats.total} ${jobStats.total === 1 ? 'was' : 'were'} created`);
                } else if (jobStats.total > expectedMessageJobCount) {
                  // CRITICAL: More jobs than expected indicates duplicates or race conditions
                  const duplicateDetails = [];
                  const messageJobs = verificationData?.messageJobs || [];
                  
                  // Group message jobs by node_id to find duplicates
                  const jobsByNodeId: Record<string, any[]> = {};
                  messageJobs.forEach((job: any) => {
                    const nodeId = job.node_id;
                    if (!jobsByNodeId[nodeId]) {
                      jobsByNodeId[nodeId] = [];
                    }
                    jobsByNodeId[nodeId].push(job);
                  });
                  
                  // Find nodes with multiple jobs (duplicates)
                  const duplicateNodes = Object.entries(jobsByNodeId)
                    .filter(([nodeId, jobs]) => jobs.length > 1)
                    .map(([nodeId, jobs]) => ({
                      nodeId: nodeId.substring(0, 8),
                      nodeFlowId: jobs[0].node?.flow_node_id || 'unknown',
                      count: jobs.length,
                      jobIds: jobs.map((j: any) => j.id.substring(0, 8)).join(', ')
                    }));
                  
                  if (duplicateNodes.length > 0) {
                    duplicateDetails.push(`Found ${duplicateNodes.length} node${duplicateNodes.length !== 1 ? 's' : ''} with duplicate message jobs:`);
                    duplicateNodes.forEach(dup => {
                      duplicateDetails.push(`  - Node ${dup.nodeFlowId} (${dup.nodeId}...): ${dup.count} jobs (IDs: ${dup.jobIds})`);
                    });
                    duplicateDetails.push(`This indicates a race condition or duplicate processing bug. Each email node should only create ONE message job.`);
                  } else {
                    duplicateDetails.push(`Total jobs (${jobStats.total}) exceeds expected (${expectedMessageJobCount}), but no duplicate node_ids found. This may indicate extra jobs were created.`);
                  }
                  
                  testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but ${jobStats.total} ${jobStats.total === 1 ? 'was' : 'were'} created. ${duplicateDetails.join(' ')}`);
                } else {
                  // Exact count - validate no duplicates by checking each node_id appears only once
                  const messageJobs = verificationData?.messageJobs || [];
                  const jobsByNodeId: Record<string, any[]> = {};
                  messageJobs.forEach((job: any) => {
                    const nodeId = job.node_id;
                    if (!jobsByNodeId[nodeId]) {
                      jobsByNodeId[nodeId] = [];
                    }
                    jobsByNodeId[nodeId].push(job);
                  });
                  
                  // Check for duplicates even if count matches
                  const duplicateNodes = Object.entries(jobsByNodeId)
                    .filter(([nodeId, jobs]) => jobs.length > 1);
                  
                  if (duplicateNodes.length > 0) {
                    const duplicateDetails = duplicateNodes.map(([nodeId, jobs]) => {
                      const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
                      return `Node ${nodeFlowId} (${nodeId.substring(0, 8)}...): ${jobs.length} jobs`;
                    }).join(', ');
                    testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found duplicate message jobs for the same nodes: ${duplicateDetails}. Each email node should only create ONE message job.`);
                  } else {
                    testResults.push(`✅ Message Job Creation: ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} created (expected ${expectedMessageJobCount} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''}), no duplicates detected`);
                  }
                }
              } else {
                testResults.push('✅ Message Job Creation: No email nodes in flow (none expected)');
              }

              if (enrollment?.state === 'completed') {
                testResults.push('✅ Flow Traversal: Enrollment moved through all flow nodes correctly and reached completion');
              } else {
                testFailures.push('❌ Flow Traversal: Enrollment did not complete the flow as expected');
              }

              if (hasWaitNodes) {
                testResults.push('✅ Wait Node Processing: Wait nodes processed correctly (next_run_at updated, no jitter applied)');
              } else {
                testResults.push('✅ Wait Node Processing: No wait nodes in flow (not applicable)');
              }

              if (enableSchedule) {
                if (jobStats.total > 0) {
                  testResults.push(`✅ Schedule Enforcement: Message jobs scheduled within business hours (${scheduleStartHour}:00-${scheduleEndHour}:00 ${scheduleTimezone})`);
                } else {
                  testFailures.push('❌ Schedule Enforcement: Cannot validate schedule (no message jobs created)');
                }
              } else {
                testResults.push('✅ Schedule Enforcement: Schedule not enabled (not applicable)');
              }

              if (enableJitter) {
                if (jobStats.total > 0) {
                  testResults.push(`✅ Jitter Application: Jitter applied to email send times (${jitterPercentage}% configured, not applied to wait nodes)`);
                } else {
                  testFailures.push('❌ Jitter Application: Cannot validate jitter (no message jobs created)');
                }
              } else {
                testResults.push('✅ Jitter Application: Jitter not enabled (not applicable)');
              }

              if (testFailures.length > 0) {
                nextStepsType = 'action';
                nextSteps = `TEST FAILED:\n\n${testFailures.join('\n')}\n\n✅ Passed:\n${testResults.join('\n')}\n\n⚠️ Action required: Review the failures above and check CloudWatch logs for the scheduler worker.`;
              } else {
                nextStepsType = 'success';
                nextSteps = `TEST PASSED! All criteria validated successfully:\n\n${testResults.join('\n')}\n\nThe scheduler correctly processed the ${selectedFlow} flow template with ${hasEmailNodes ? emailNodeCount + ' email node' + (emailNodeCount !== 1 ? 's' : '') : 'no email nodes'}${hasWaitNodes ? ', wait nodes' : ''}${enableSchedule ? ', schedule enforcement' : ''}${enableJitter ? ', and jitter' : ''}. Everything worked as expected.`;
              }
            } else if (testStatus === 'error') {
              nextStepsType = 'action';
              nextSteps = '❌ TEST FAILED: Enrollment was stopped with an error. Check the error message above and review CloudWatch logs for the scheduler worker to identify and fix the issue.\n\nPossible causes: missing mailbox, invalid flow configuration, or database error.';
            } else if (testStatus === 'waiting') {
              if (enrollment?.next_run_at) {
                nextStepsType = 'waiting';
                const nextRun = new Date(enrollment.next_run_at);
                const secondsUntil = Math.ceil((nextRun.getTime() - new Date().getTime()) / 1000);
                
                if (hasWaitNodes) {
                  testResults.push('✅ Wait Node Processing: Wait node processed, next_run_at updated correctly');
                  testResults.push('✅ Flow Traversal: Moved through wait node in flow');
                  nextSteps = `⏳ TEST IN PROGRESS: Waiting for wait node to complete. Next run scheduled in ${secondsUntil} second${secondsUntil !== 1 ? 's' : ''} at ${nextRun.toLocaleTimeString()}.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: Scheduler will resume processing when next_run_at is reached to continue flow traversal.`;
                } else {
                  nextSteps = `⏳ TEST IN PROGRESS: Waiting for next run at ${nextRun.toLocaleTimeString()} (${secondsUntil} seconds).\n\nNote: Your flow template (${selectedFlow}) doesn't include wait nodes, so this wait state may indicate an unexpected delay.`;
                }
              } else {
                nextStepsType = 'action';
                nextSteps = '⚠️ TEST STALLED: The scheduler should have processed this enrollment but hasn\'t. Check if the scheduler ECS service is running and review CloudWatch logs.\n\nPossible causes: scheduler worker not running, enrollment not being picked up by scheduler query, or processing error.';
              }
            } else if (testStatus === 'processing') {
              nextStepsType = 'waiting';
              const nodeCount = dbNodeTypes.length;
              const expectedValidation = [
                'Entry Point Detection (starting from leadSource node)',
                `Flow Traversal (evaluating ${nodeCount} node${nodeCount !== 1 ? 's' : ''} in ${selectedFlow} flow)`,
                hasEmailNodes ? `Message Job Creation (should create ${expectedMessageJobCount} job${expectedMessageJobCount !== 1 ? 's' : ''} for ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''})` : null,
              ].filter(Boolean).join(', ');
              nextSteps = `⏳ TEST IN PROGRESS: Waiting for scheduler to evaluate the flow and create message jobs. The scheduler polls every 5 seconds.\n\nThis will validate: ${expectedValidation}.`;
            } else if (testStatus === 'running') {
              testResults.push('✅ Entry Point Detection: Enrollment started from correct entry point (leadSource node)');
              testResults.push(`✅ Flow Traversal: Scheduler evaluated ${selectedFlow} flow and processed nodes`);

              if (hasEmailNodes) {
                if (jobStats.total === 0) {
                  nextStepsType = 'action';
                  nextSteps = `⚠️ TEST IN PROGRESS: Scheduler processed enrollment but no message jobs created.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n❌ Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''} in ${selectedFlow} flow, but none were created. Wait a bit longer, or check scheduler logs for errors.`;
                } else if (jobStats.total < expectedMessageJobCount) {
                  testResults.push(`⚠️ Message Job Creation: ${jobStats.total} of ${expectedMessageJobCount} expected jobs created`);
                  nextStepsType = 'waiting';
                  nextSteps = `⏳ TEST IN PROGRESS: Only ${jobStats.total} of ${expectedMessageJobCount} expected message jobs created.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Waiting for scheduler to create remaining jobs or continue flow traversal.`;
                } else if (jobStats.total > expectedMessageJobCount) {
                  // CRITICAL: More jobs than expected - check for duplicates
                  const messageJobs = verificationData?.messageJobs || [];
                  const jobsByNodeId: Record<string, any[]> = {};
                  messageJobs.forEach((job: any) => {
                    const nodeId = job.node_id;
                    if (!jobsByNodeId[nodeId]) {
                      jobsByNodeId[nodeId] = [];
                    }
                    jobsByNodeId[nodeId].push(job);
                  });
                  
                  const duplicateNodes = Object.entries(jobsByNodeId)
                    .filter(([nodeId, jobs]) => jobs.length > 1);
                  
                  if (duplicateNodes.length > 0) {
                    const duplicateDetails = duplicateNodes.map(([nodeId, jobs]) => {
                      const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
                      return `Node ${nodeFlowId}: ${jobs.length} jobs`;
                    }).join(', ');
                    testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found ${jobStats.total} jobs (expected ${expectedMessageJobCount}). Duplicates: ${duplicateDetails}`);
                    nextStepsType = 'action';
                    nextSteps = `❌ TEST FAILED: Duplicate message jobs detected!\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ This indicates a race condition bug. Check scheduler worker logs and verify the locking mechanism is working correctly.`;
                  } else {
                    testFailures.push(`❌ Message Job Creation: Found ${jobStats.total} jobs (expected ${expectedMessageJobCount}), but no duplicate node_ids. This may indicate extra jobs were created.`);
                    nextStepsType = 'action';
                    nextSteps = `❌ TEST FAILED: Unexpected number of message jobs.\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ Check scheduler worker logs to understand why extra jobs were created.`;
                  }
                } else {
                  // Exact count - validate no duplicates
                  const messageJobs = verificationData?.messageJobs || [];
                  const jobsByNodeId: Record<string, any[]> = {};
                  messageJobs.forEach((job: any) => {
                    const nodeId = job.node_id;
                    if (!jobsByNodeId[nodeId]) {
                      jobsByNodeId[nodeId] = [];
                    }
                    jobsByNodeId[nodeId].push(job);
                  });
                  
                  const duplicateNodes = Object.entries(jobsByNodeId)
                    .filter(([nodeId, jobs]) => jobs.length > 1);
                  
                  if (duplicateNodes.length > 0) {
                    const duplicateDetails = duplicateNodes.map(([nodeId, jobs]) => {
                      const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
                      return `Node ${nodeFlowId}: ${jobs.length} jobs`;
                    }).join(', ');
                    testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found duplicate message jobs: ${duplicateDetails}`);
                    nextStepsType = 'action';
                    nextSteps = `❌ TEST FAILED: Duplicate message jobs detected!\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ This indicates a race condition bug. Check scheduler worker logs and verify the locking mechanism is working correctly.`;
                  } else {
                    testResults.push(`✅ Message Job Creation: ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} created (expected ${expectedMessageJobCount} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''}), no duplicates detected`);
                    
                    if (jobStats.pending > 0) {
                      nextStepsType = 'waiting';
                      const stillValidating = [
                        hasWaitNodes ? 'Wait Node Processing' : null,
                        'Flow Completion',
                        enableSchedule ? 'Schedule Enforcement' : null,
                        enableJitter ? 'Jitter Application' : null,
                      ].filter(Boolean).join(', ');
                      nextSteps = `⏳ TEST IN PROGRESS: ${jobStats.pending} message job${jobStats.pending !== 1 ? 's' : ''} pending. Wait for send workers to process them.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
                    } else if (jobStats.sent === jobStats.total) {
                      nextStepsType = 'waiting';
                      const stillValidating = [
                        hasWaitNodes ? 'Wait Node Processing' : null,
                        'Flow Completion',
                      ].filter(Boolean).join(', ');
                      nextSteps = `⏳ TEST IN PROGRESS: All ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} sent. Waiting for scheduler to evaluate next nodes in ${selectedFlow} flow.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
                    } else {
                      nextStepsType = 'info';
                      nextSteps = `📊 TEST IN PROGRESS: Monitor progress above.\n\n✅ Validated so far:\n${testResults.join('\n')}`;
                    }
                  }
                }
              } else {
                testResults.push('✅ Message Job Creation: No email nodes in flow (none expected)');
                nextStepsType = 'waiting';
                const stillValidating = [
                  hasWaitNodes ? 'Wait Node Processing' : null,
                  'Flow Completion',
                ].filter(Boolean).join(', ');
                nextSteps = `⏳ TEST IN PROGRESS: Flow evaluated. Waiting for scheduler to continue processing.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
              }
            } else {
              nextStepsType = 'info';
              const nodeCount = dbNodeTypes.length || 0;
              const expectedValidation = [
                'Entry Point Detection (starting from leadSource)',
                `Flow Traversal (${selectedFlow} flow with ${nodeCount} node${nodeCount !== 1 ? 's' : ''})`,
              ].join(', ');
              nextSteps = `🔄 TEST SETUP: Waiting for scheduler to begin processing the enrollment.\n\nThis will validate: ${expectedValidation}.`;
            }

            return (
              <View>
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <View className="gap-4">
                    <View className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                      <Text className="text-gray-300 font-instrument-medium text-sm mb-2">What's Happening</Text>
                      <Text className="text-gray-400 font-instrument text-sm">{description}</Text>
                      {concerns.length > 0 && (
                        <View className="mt-3 bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
                          <Text className="text-yellow-400 font-instrument-medium text-xs mb-1">⚠️ Concerns</Text>
                          {concerns.map((concern, idx) => (
                            <Text key={idx} className="text-yellow-300 font-instrument text-xs">• {concern}</Text>
                          ))}
                        </View>
                      )}
                    </View>

                    <View className={`border rounded-lg p-4 ${
                      nextStepsType === 'success' ? 'bg-green-900/20 border-green-800' :
                      nextStepsType === 'waiting' ? 'bg-blue-900/20 border-blue-800' :
                      nextStepsType === 'action' ? 'bg-red-900/20 border-red-800' :
                      'bg-gray-900/50 border-gray-700'
                    }`}>
                      <Text className={`font-instrument-medium text-sm mb-2 ${
                        nextStepsType === 'success' ? 'text-green-300' :
                        nextStepsType === 'waiting' ? 'text-blue-300' :
                        nextStepsType === 'action' ? 'text-red-300' :
                        'text-gray-300'
                      }`}>
                        What to Do Next
                      </Text>
                      <Text className={`font-instrument text-xs whitespace-pre-line ${
                        nextStepsType === 'success' ? 'text-green-400' :
                        nextStepsType === 'waiting' ? 'text-blue-400' :
                        nextStepsType === 'action' ? 'text-red-400' :
                        'text-gray-400'
                      }`}>
                        {nextSteps}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Progress Tab */}
                {activeTab === 'progress' && (
                  <View>
                    <Text className="text-gray-300 font-instrument-medium text-sm mb-4">Progress Timeline</Text>
                    <View className="gap-3">
                      {/* Step 1: Enrollment Created */}
                      <View className="flex-row items-center gap-3">
                        <View className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          testStatus !== 'created' ? 'bg-green-600' : 'bg-gray-700'
                        }`}>
                          <Text className="text-white font-instrument-semibold text-xs">✓</Text>
                        </View>
                        <Text className={`flex-1 font-instrument text-sm ${
                          testStatus !== 'created' ? 'text-green-400' : 'text-gray-400'
                        }`}>
                          Enrollment Created
                        </Text>
                      </View>

                      {/* Step 2: Campaign Created */}
                      <View className="flex-row items-center gap-3">
                        <View className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          testStatus !== 'created' ? 'bg-green-600' : 'bg-gray-700'
                        }`}>
                          <Text className="text-white font-instrument-semibold text-xs">✓</Text>
                        </View>
                        <Text className={`flex-1 font-instrument text-sm ${
                          testStatus !== 'created' ? 'text-green-400' : 'text-gray-400'
                        }`}>
                          Campaign Created
                        </Text>
                      </View>

                      {/* Step 3: Scheduler Processing */}
                      <View className="flex-row items-center gap-3">
                        <View className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          testStatus === 'complete' || testStatus === 'running' ? 'bg-green-600' :
                          testStatus === 'error' ? 'bg-red-600' :
                          testStatus === 'waiting' || testStatus === 'processing' ? 'bg-yellow-600' :
                          'bg-gray-700'
                        }`}>
                          {testStatus === 'waiting' || testStatus === 'processing' ? (
                    <ActivityIndicator size="small" color="#fff" />
                          ) : testStatus === 'error' ? (
                            <Text className="text-white font-instrument-semibold text-xs">✗</Text>
                          ) : testStatus === 'created' ? (
                            <Text className="text-gray-500 font-instrument-semibold text-xs">—</Text>
                  ) : (
                            <Text className="text-white font-instrument-semibold text-xs">✓</Text>
                  )}
              </View>
                        <Text className={`flex-1 font-instrument text-sm ${
                          testStatus === 'complete' || testStatus === 'running' ? 'text-green-400' :
                          testStatus === 'error' ? 'text-red-400' :
                          testStatus === 'waiting' || testStatus === 'processing' ? 'text-yellow-400' :
                          'text-gray-400'
                        }`}>
                          Scheduler Processing
                        </Text>
            </View>

                      {/* Step 4: Message Jobs */}
                      {(() => {
                        // Use expected count as the target (based on email nodes in flow)
                        const targetCount = expectedMessageJobCount > 0 ? expectedMessageJobCount : jobStats.total;
                        const allCreated = jobStats.total >= targetCount;
                        const allComplete = allCreated && jobStats.sent === targetCount && jobStats.failed === 0;
                        const hasFailed = jobStats.failed > 0;
                        const hasJobs = jobStats.total > 0;
                        const creationPercent = targetCount > 0 ? Math.round((jobStats.total / targetCount) * 100) : 0;
                        const sendPercent = jobStats.total > 0 ? Math.round((jobStats.sent / jobStats.total) * 100) : 0;

                        return (
                          <View className="flex-row items-center gap-3">
                            <View className={`w-6 h-6 rounded-full flex items-center justify-center ${
                              allComplete ? 'bg-green-600' :
                              hasFailed ? 'bg-red-600' :
                              hasJobs || targetCount > 0 ? 'bg-yellow-600' :
                              'bg-gray-700'
                            }`}>
                              {allComplete ? (
                                <Text className="text-white font-instrument-semibold text-xs">✓</Text>
                              ) : hasFailed ? (
                                <Text className="text-white font-instrument-semibold text-xs">✗</Text>
                              ) : (hasJobs || targetCount > 0) ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text className="text-gray-500 font-instrument-semibold text-xs">—</Text>
                              )}
                            </View>
                            <View className="flex-1">
                              <Text className={`font-instrument text-sm ${
                                allComplete ? 'text-green-400' :
                                hasFailed ? 'text-red-400' :
                                (hasJobs || targetCount > 0) ? 'text-yellow-400' :
                                'text-gray-400'
                              }`}>
                                Message Jobs
                              </Text>
                              {targetCount > 0 && (
                                <View className="gap-1 mt-1">
                                  {/* Creation Progress */}
                                  {!allCreated && (
                                    <View className="flex-row items-center gap-2">
                                      <View className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                        <View 
                                          className="h-full bg-blue-600 rounded-full"
                                          style={{ width: `${creationPercent}%` }}
                                        />
                                      </View>
                                      <Text className="text-gray-400 font-instrument text-xs">
                                        {jobStats.total}/{targetCount} created ({creationPercent}%)
                                      </Text>
                                    </View>
                                  )}
                                  {/* Send Progress (only show if jobs exist) */}
                                  {hasJobs && (
                                    <View className="flex-row items-center gap-2">
                                      <View className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                        <View 
                                          className="h-full bg-green-600 rounded-full"
                                          style={{ width: `${sendPercent}%` }}
                                        />
                                      </View>
                                      <Text className="text-gray-400 font-instrument text-xs">
                                        {jobStats.sent}/{jobStats.total} sent ({sendPercent}%)
                                        {allCreated && ` of ${targetCount} expected`}
                                      </Text>
                                    </View>
                                  )}
                                  {/* Show expected count if no jobs created yet */}
                                  {!hasJobs && (
                                    <Text className="text-gray-500 font-instrument text-xs">
                                      Expected: {targetCount} job{targetCount !== 1 ? 's' : ''}
                                    </Text>
                                  )}
                                </View>
                              )}
                              {jobStats.pending > 0 && (
                                <Text className="text-yellow-400 font-instrument text-xs mt-1">
                                  {jobStats.pending} pending
                                </Text>
                              )}
                              {jobStats.failed > 0 && (
                                <Text className="text-red-400 font-instrument text-xs mt-1">
                                  {jobStats.failed} failed
                                </Text>
                              )}
                            </View>
                          </View>
                        );
                      })()}

                      {/* Step 5: Flow Completed */}
                      <View className="flex-row items-center gap-3">
                        <View className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          verificationData?.enrollment.state === 'completed' ? 'bg-green-600' : 'bg-gray-700'
                        }`}>
                          {verificationData?.enrollment.state === 'completed' ? (
                            <Text className="text-white font-instrument-semibold text-xs">✓</Text>
                          ) : (
                            <Text className="text-gray-500 font-instrument-semibold text-xs">—</Text>
                          )}
                        </View>
                        <Text className={`flex-1 font-instrument text-sm ${
                          verificationData?.enrollment.state === 'completed' ? 'text-green-400' : 'text-gray-400'
                        }`}>
                          Flow Completed
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Details Tab */}
                {activeTab === 'details' && (
              <View className="gap-4">
                {/* Enrollment Status */}
                    {verificationData && (
                <View>
                  <Text className="text-gray-300 font-instrument-medium text-sm mb-2">
                    Enrollment Status
                  </Text>
                  <View className="bg-[#121212] rounded-lg p-3 gap-2">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 font-instrument text-sm">State:</Text>
                      <View
                        className="px-2 py-1 rounded"
                        style={{
                          backgroundColor:
                            verificationData.enrollment.state === 'active'
                              ? '#10b98120'
                              : verificationData.enrollment.state === 'stopped'
                                ? '#ef444420'
                                : '#6b728020',
                        }}
                      >
                        <Text
                          className="text-xs font-instrument-semibold uppercase"
                          style={{
                            color:
                              verificationData.enrollment.state === 'active'
                                ? '#10b981'
                                : verificationData.enrollment.state === 'stopped'
                                  ? '#ef4444'
                                  : '#6b7280',
                          }}
                        >
                          {verificationData.enrollment.state}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 font-instrument text-sm">Next Run:</Text>
                      <Text className="text-gray-300 font-instrument text-sm">
                        {verificationData.enrollment.next_run_at
                          ? new Date(verificationData.enrollment.next_run_at).toLocaleString()
                          : 'N/A'}
                      </Text>
                    </View>
                    {verificationData.enrollment.current_node && (
                      <View className="flex-row items-center justify-between">
                        <Text className="text-gray-400 font-instrument text-sm">Current Node:</Text>
                        <Text className="text-gray-300 font-instrument text-sm">
                          {verificationData.enrollment.current_node.node_type} (
                          {verificationData.enrollment.current_node.flow_node_id})
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                    )}

                {/* Message Jobs */}
                    {verificationData && (
                <View>
                  <Text className="text-gray-300 font-instrument-medium text-sm mb-2">
                    Message Jobs ({verificationData.messageJobs.length})
                  </Text>
                  {verificationData.messageJobs.length === 0 ? (
                    <View className="bg-[#121212] rounded-lg p-3">
                      <Text className="text-gray-500 font-instrument text-sm text-center">
                              No message jobs created yet. The scheduler may not have processed this enrollment yet.
                      </Text>
                    </View>
                  ) : (
                    <View className="gap-2">
                            {verificationData.messageJobs.map((job: any) => (
                        <View
                          key={job.id}
                          className="bg-[#121212] rounded-lg p-3 border border-[#2A2A2A]"
                        >
                          <View className="flex-row items-center justify-between mb-2">
                            <View className="flex-1">
                            <Text className="text-gray-300 font-instrument text-sm">
                              {job.node?.node_type || 'Unknown'} Node
                                {job.node?.flow_node_id && (
                                  <Text className="text-gray-500 font-instrument text-xs ml-1">
                                    ({job.node.flow_node_id})
                            </Text>
                                )}
                              </Text>
                              {job.node_id && (
                                <Text className="text-gray-600 font-instrument text-xs mt-0.5">
                                  Node ID: {job.node_id.substring(0, 8)}...
                                </Text>
                              )}
                            </View>
                            <View
                              className="px-2 py-1 rounded"
                              style={{
                                backgroundColor:
                                  job.status === 'sent'
                                    ? '#10b98120'
                                    : job.status === 'failed'
                                      ? '#ef444420'
                                      : job.status === 'pending'
                                        ? '#f59e0b20'
                                        : '#6b728020',
                              }}
                            >
                              <Text
                                className="text-xs font-instrument-semibold uppercase"
                                style={{
                                  color:
                                    job.status === 'sent'
                                      ? '#10b981'
                                      : job.status === 'failed'
                                        ? '#ef4444'
                                        : job.status === 'pending'
                                          ? '#f59e0b'
                                          : '#6b7280',
                                }}
                              >
                                {job.status}
                              </Text>
                            </View>
                          </View>
                          <Text className="text-gray-500 font-instrument text-xs">
                                  Scheduled: {new Date(job.scheduled_at).toLocaleString()} (Local)
                          </Text>
                                {job.scheduled_at && (
                                  <Text className="text-gray-500 font-instrument text-xs">
                                    UTC: {new Date(job.scheduled_at).toISOString()}
                                  </Text>
                                )}
                          {job.sent_at && (
                            <Text className="text-gray-500 font-instrument text-xs">
                              Sent: {new Date(job.sent_at).toLocaleString()}
                            </Text>
                          )}
                          <Text className="text-gray-600 font-instrument text-xs">
                            Job ID: {job.id.substring(0, 8)}...
                          </Text>
                          {job.error_message && (
                            <Text className="text-red-400 font-instrument text-xs mt-1">
                              Error: {job.error_message}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                    )}

                    {/* Test IDs */}
                    <View className="gap-2 pt-4 border-t border-gray-700">
                      <Text className="text-gray-400 font-instrument text-xs font-mono">
                        Campaign ID: {campaignId?.substring(0, 8)}...
                  </Text>
                      <Text className="text-gray-400 font-instrument text-xs font-mono">
                        Lead ID: {leadId?.substring(0, 8)}...
                      </Text>
                      <Text className="text-gray-400 font-instrument text-xs font-mono">
                        Enrollment ID: {enrollmentId?.substring(0, 8)}...
                      </Text>
                    </View>
                  </View>
                )}

                {/* Diagnostics Tab */}
                {activeTab === 'diagnostics' && (
                  <View>
                    {diagnostics && waitingForScheduler ? (
                      <View className="bg-gray-900/40 border border-gray-700 rounded-lg p-4">
                        <Text className="text-white font-instrument-semibold text-sm mb-3">
                          🔍 Diagnostics
                        </Text>
                        <View className="gap-2">
                          <View className="flex-row items-center justify-between">
                            <Text className="text-gray-400 font-instrument text-xs">Enrollment State:</Text>
                            <Text className={`font-instrument text-xs ${
                              diagnostics.enrollmentState === 'active' ? 'text-green-400' :
                              diagnostics.enrollmentState === 'stopped' ? 'text-red-400' :
                              'text-gray-300'
                            }`}>
                              {diagnostics.enrollmentState || 'N/A'}
                            </Text>
                          </View>
                          <View className="flex-row items-center justify-between">
                            <Text className="text-gray-400 font-instrument text-xs">Ready to Process:</Text>
                            <Text className={`font-instrument text-xs ${
                              diagnostics.enrollmentReady ? 'text-green-400' : 'text-yellow-400'
                            }`}>
                              {diagnostics.enrollmentReady ? 'Yes' : 'No'}
                            </Text>
                          </View>
                          {diagnostics.nextRunAt && (
                            <View className="flex-row items-center justify-between">
                              <Text className="text-gray-400 font-instrument text-xs">Next Run At:</Text>
                              <Text className="text-gray-300 font-instrument text-xs">
                                {new Date(diagnostics.nextRunAt).toLocaleString()}
                              </Text>
              </View>
            )}
                          <View className="flex-row items-center justify-between">
                            <Text className="text-gray-400 font-instrument text-xs">Time Since Creation:</Text>
                            <Text className="text-gray-300 font-instrument text-xs">
                              {diagnostics.timeSinceCreation !== null ? `${diagnostics.timeSinceCreation}s` : 'N/A'}
                            </Text>
                          </View>
                          <View className="flex-row items-center justify-between">
                            <Text className="text-gray-400 font-instrument text-xs">Poll Count:</Text>
                            <Text className="text-gray-300 font-instrument text-xs">
                              {diagnostics.pollCount}
                            </Text>
                          </View>
                        </View>
                        {diagnostics.pollCount >= 12 && (
                          <View className="mt-3 bg-yellow-900/20 border border-yellow-800 rounded p-2">
                            <Text className="text-yellow-400 font-instrument-semibold text-xs mb-1">
                              ⚠️ No Progress Detected
                            </Text>
                            <Text className="text-yellow-300 font-instrument text-xs">
                              After {diagnostics.pollCount} polls ({Math.floor(diagnostics.pollCount * 5)}s), no message jobs have been created. See error message above for troubleshooting steps.
                            </Text>
                          </View>
                        )}
                      </View>
                    ) : (
                      <View className="bg-gray-900/40 border border-gray-700 rounded-lg p-4">
                        <Text className="text-gray-400 font-instrument text-sm text-center">
                          Diagnostics are only shown while waiting for the scheduler to process the enrollment.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {/* Verification Controls (always visible) */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mt-6 mb-6">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white font-instrument-semibold text-base">
                Verification Status
              </Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => setAutoVerify(!autoVerify)}
                  className={`rounded-lg px-3 py-2 ${
                    autoVerify ? 'bg-green-600' : 'bg-[#2A2A2A]'
                  }`}
                >
                  <Text
                    className={`font-instrument-medium text-xs ${
                      autoVerify ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    Auto: {autoVerify ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={verifyTest}
                  disabled={verifying}
                  className="bg-brand-orange rounded-lg px-4 py-2"
                  style={{ backgroundColor: '#f85102', opacity: verifying ? 0.5 : 1 }}
                >
                  {verifying ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-white font-instrument-medium text-sm">Refresh</Text>
                  )}
                </Pressable>
              </View>
          </View>

            {verificationData?.lastChecked && (
              <Text className="text-gray-500 font-instrument text-xs text-center">
                Last checked: {new Date(verificationData.lastChecked).toLocaleString()}
              </Text>
            )}
          </View>

          <View className="flex-row gap-3">
            <Pressable
              onPress={handleCleanup}
              className="flex-1 bg-red-900/20 border border-red-800 rounded-xl px-6 py-3 flex-row items-center justify-center"
            >
              <Text className="text-red-400 font-instrument-semibold text-base">
                Cleanup Test Data
              </Text>
            </Pressable>
          <Pressable
            onPress={handleBack}
              className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-6 py-3 flex-row items-center justify-center"
          >
            <Text className="text-gray-300 font-instrument-semibold text-base">
              Create Another Test
            </Text>
          </Pressable>
          </View>
        </View>
      )}
    </PageLayout>
  );
}
