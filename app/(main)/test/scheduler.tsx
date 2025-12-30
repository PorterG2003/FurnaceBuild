import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, TextInput } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { supabase } from '@/lib/supabase/client';
import { createCampaign } from '@/lib/supabase/services/campaigns';
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
              label: 'Wait 1 Day',
              duration: 1,
              unit: 'days',
              wait_duration_seconds: 86400, // 1 day in seconds
            },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 600, y: 0 },
            data: {
              label: 'Follow-up Email',
              subject: 'Follow-up Email',
              body: 'Hello {{name}},\n\nThis is a follow-up email after 1 day.',
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
              label: 'Wait 2 Days',
              duration: 2,
              unit: 'days',
              wait_duration_seconds: 172800, // 2 days in seconds
            },
          },
          {
            id: 'waitTime-2',
            type: 'waitTime',
            position: { x: 600, y: 0 },
            data: {
              label: 'Wait 1 Day',
              duration: 1,
              unit: 'days',
              wait_duration_seconds: 86400, // 1 day in seconds
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

  // Results
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);

  // Verification data
  const [verificationData, setVerificationData] = useState<{
    enrollment: any;
    messageJobs: any[];
    lastChecked: string | null;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [autoVerify, setAutoVerify] = useState(true);
  const [autoVerifyInterval, setAutoVerifyInterval] = useState<NodeJS.Timeout | null>(null);

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
    }
  };

  const verifyTest = async () => {
    if (!enrollmentId) return;

    setVerifying(true);
    try {
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
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      setVerificationData({
        enrollment,
        messageJobs: messageJobs || [],
        lastChecked: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error verifying test:', err);
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
        updateStep('mailbox', 'success', `Using existing mailbox`);
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
        updateStep('mailbox', 'success', `Created test mailbox (⚠️ Update SMTP credentials!)`);
      }

      // 4. Create campaign with selected flow template
      updateStep('campaign', 'loading', 'Creating campaign with flow...');
      const flowData = createFlowTemplate(selectedFlow);
      
      // Build schedule if enabled
      const schedule = enableSchedule ? {
        timezone: scheduleTimezone,
        start_hour: scheduleStartHour,
        end_hour: scheduleEndHour,
        days_of_week: scheduleDays,
      } : null;
      
      // Build campaign data with schedule and jitter
      const campaignData: any = {
        name: campaignName,
        owner_id: userProfile.id,
        organization_id: null,
        status: 'running',
        flow_data: flowData,
      };
      
      if (schedule) {
        campaignData.schedule = schedule;
      }
      
      if (enableJitter && jitterPercentage) {
        campaignData.jitter_percentage = parseFloat(jitterPercentage);
      }
      
      const campaign = await createCampaign(campaignData);
      setCampaignId(campaign.id);
      updateStep('campaign', 'success', `Campaign created${schedule ? ' (with schedule)' : ''}${enableJitter ? ` (jitter: ${jitterPercentage}%)` : ''}`);

      // 5. Create nodes from flow data
      updateStep('nodes', 'loading', 'Creating flow nodes...');
      
      // First, delete any existing nodes for this campaign (in case of retry)
      await supabase.from('nodes').delete().eq('campaign_id', campaign.id);
      
      const nodeInserts = flowData.nodes
        .filter(node => node.type !== 'leadSource') // Skip leadSource nodes
        .map((node, index) => ({
          campaign_id: campaign.id,
          flow_node_id: node.id,
          node_type: node.type,
          node_data: node.data || {},
          position_x: node.position.x,
          position_y: node.position.y,
        }));

      if (nodeInserts.length > 0) {
        const { error: nodesError } = await supabase.from('nodes').insert(nodeInserts);
        if (nodesError) throw nodesError;
      }
      updateStep('nodes', 'success', `Created ${nodeInserts.length} node(s)`);

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
      
      // Find the first node (after leadSource) to start at
      const firstNode = flowData.nodes.find(node => node.type !== 'leadSource');
      if (!firstNode) {
        throw new Error('Flow must have at least one non-leadSource node');
      }

      // Get the node ID from database
      const { data: firstNodeData } = await supabase
        .from('nodes')
        .select('id')
        .eq('campaign_id', campaign.id)
        .eq('flow_node_id', firstNode.id)
        .single();

      if (!firstNodeData) {
        throw new Error('Failed to find first node in database');
      }

      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          current_node_id: firstNodeData.id,
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

      // Initial verification
      await verifyTest();

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
        <Text className="text-2xl font-instrument-semibold text-white mb-1">
          Scheduler Testing Dashboard
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Create test campaign flows and enrollments to test scheduler behavior
        </Text>
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
                  desc: 'Lead → Email → Wait 1 Day → Email',
                },
                {
                  value: 'email-wait-wait-email',
                  label: 'Email + Wait + Wait + Email',
                  desc: 'Lead → Email → Wait 2 Days → Wait 1 Day → Email',
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
                  Random delay up to {jitterPercentage || '10'}% of wait time
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

      {/* Step 4: Complete */}
      {currentStep === 'complete' && (
        <View>
          <View className="bg-green-900/20 border border-green-800 rounded-xl p-6 mb-6">
            <Text className="text-green-400 font-instrument-semibold text-lg mb-2">
              Test Created Successfully!
            </Text>
            <View className="gap-2 mt-4">
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

          {/* Verification Section */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-6">
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

            {verificationData && (
              <View className="gap-4">
                {/* Enrollment Status */}
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

                {/* Message Jobs */}
                <View>
                  <Text className="text-gray-300 font-instrument-medium text-sm mb-2">
                    Message Jobs ({verificationData.messageJobs.length})
                  </Text>
                  {verificationData.messageJobs.length === 0 ? (
                    <View className="bg-[#121212] rounded-lg p-3">
                      <Text className="text-gray-500 font-instrument text-sm text-center">
                        No message jobs created yet. The scheduler may not have processed this
                        enrollment yet.
                      </Text>
                    </View>
                  ) : (
                    <View className="gap-2">
                      {verificationData.messageJobs.map((job) => (
                        <View
                          key={job.id}
                          className="bg-[#121212] rounded-lg p-3 border border-[#2A2A2A]"
                        >
                          <View className="flex-row items-center justify-between mb-2">
                            <Text className="text-gray-300 font-instrument text-sm">
                              {job.node?.node_type || 'Unknown'} Node
                            </Text>
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
                            Scheduled: {new Date(job.scheduled_at).toLocaleString()}
                          </Text>
                          {job.scheduled_at && (
                            <Text className="text-gray-500 font-instrument text-xs">
                              (UTC: {new Date(job.scheduled_at).toISOString()})
                            </Text>
                          )}
                          {job.sent_at && (
                            <Text className="text-gray-500 font-instrument text-xs">
                              Sent: {new Date(job.sent_at).toLocaleString()}
                            </Text>
                          )}
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

                {verificationData.lastChecked && (
                  <Text className="text-gray-500 font-instrument text-xs text-center">
                    Last checked: {new Date(verificationData.lastChecked).toLocaleString()}
                  </Text>
                )}
              </View>
            )}

            {!verificationData && !verifying && (
              <Text className="text-gray-500 font-instrument text-sm text-center">
                Click Refresh to verify the test status
              </Text>
            )}
          </View>

          <Pressable
            onPress={handleBack}
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-6 py-3 flex-row items-center justify-center"
          >
            <Text className="text-gray-300 font-instrument-semibold text-base">
              Create Another Test
            </Text>
          </Pressable>
        </View>
      )}
    </PageLayout>
  );
}
