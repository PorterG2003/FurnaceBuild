import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TextInput, TouchableOpacity } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/layout';
import { supabase } from '@/lib/supabase/client';
import { createCampaign } from '@/lib/supabase/services/campaigns';
import { createLead } from '@/lib/supabase/services/leads';
import { createMailbox, getMailboxesByUser } from '@/lib/supabase/services/mailboxes';
import { getUserByExternalId, getAccountMembershipsForUser } from '@/lib/supabase/services/users';
import { Button } from '@/components/ui/button';

interface StepStatus {
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
}

type WizardStep = 'configure' | 'processing' | 'complete';

/**
 * Wizard-style test page for creating message_jobs with all dependencies
 * 
 * Step 1: Configure test email (recipient, subject, body)
 * Step 2: Process (create dependencies and send to queue)
 * Step 3: Complete (show verification guide)
 */
export default function TestWorkerPage() {
  const { user } = useAuthenticator();
  const [currentStep, setCurrentStep] = useState<WizardStep>('configure');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageJobId, setMessageJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, StepStatus>>({});

  // Form data
  const [testMode, setTestMode] = useState<'single' | 'scale'>('single');
  const [scaleCount, setScaleCount] = useState('100');
  const [recipientEmail, setRecipientEmail] = useState('test-recipient@example.com');
  const [recipientName, setRecipientName] = useState('Test Recipient');
  const [emailSubject, setEmailSubject] = useState('Test Email from Worker');
  const [emailBody, setEmailBody] = useState('Hello {{name}},\n\nThis is a test email from the ECS send worker!\n\nYou can customize this message using template variables like {{name}} and {{email}}.');
  
  // Scale test results
  const [totalCreated, setTotalCreated] = useState(0);
  const [totalSent, setTotalSent] = useState(0);

  const updateStep = (step: string, status: StepStatus['status'], message?: string) => {
    setSteps(prev => ({
      ...prev,
      [step]: { status, message },
    }));
  };

  const handleNext = () => {
    if (currentStep === 'configure') {
      // Validate form
      if (!recipientEmail || !recipientEmail.includes('@')) {
        setError('Please enter a valid recipient email address');
        return;
      }
      if (!emailSubject.trim()) {
        setError('Please enter an email subject');
        return;
      }
      if (!emailBody.trim()) {
        setError('Please enter an email body');
        return;
      }
      if (testMode === 'scale') {
        const count = parseInt(scaleCount, 10);
        if (isNaN(count) || count < 1 || count > 10000) {
          setError('Please enter a valid number between 1 and 10,000');
          return;
        }
      }
      setError(null);
      setCurrentStep('processing');
      handleCreateAndSend();
    }
  };

  const handleBack = () => {
    if (currentStep === 'processing' && !loading && !sending) {
      setCurrentStep('configure');
      setSteps({});
      setError(null);
    }
  };

  const handleCreateAndSend = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    setMessageJobId(null);
    setSteps({});

    try {
      // 1. Get or create user profile
      updateStep('user', 'loading', 'Getting user profile...');
      let userProfile = await getUserByExternalId(user.userId);
      if (!userProfile) {
        throw new Error('User profile not found. Please complete account setup first.');
      }
      updateStep('user', 'success', `User: ${userProfile.id.substring(0, 8)}...`);

      // 2. Get or create campaign
      updateStep('campaign', 'loading', 'Getting or creating campaign...');
      const { data: existingCampaigns } = await supabase
        .from('campaigns')
        .select('*')
        .eq('owner_id', userProfile.id)
        .limit(1);

      let campaign;
      if (existingCampaigns && existingCampaigns.length > 0) {
        campaign = existingCampaigns[0];
        updateStep('campaign', 'success', `Using existing campaign`);
      } else {
        campaign = await createCampaign({
          name: 'Test Campaign - Worker',
          owner_id: userProfile.id,
          organization_id: null,
          status: 'draft',
          flow_data: {
            nodes: [],
            edges: [],
          },
        });
        updateStep('campaign', 'success', `Created campaign`);
      }

      // 3. Get user's account (required for mailbox)
      updateStep('account', 'loading', 'Getting user account...');
      const memberships = await getAccountMembershipsForUser(userProfile.id);
      if (!memberships || memberships.length === 0) {
        throw new Error('User has no account. Please complete account setup first.');
      }
      const account = memberships[0].account;
      updateStep('account', 'success', `Account ready`);

      // 4. Get or create mailbox
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

      // 5. Create test lead(s) with custom recipient
      updateStep('lead', 'loading', testMode === 'scale' ? 'Creating leads...' : 'Creating lead...');
      const lead = await createLead({
        campaign_id: campaign.id,
        bucket_id: campaign.bucket_id,
        email: recipientEmail,
        name: recipientName,
        status: 'new',
        global_lead_id: null,
      });
      updateStep('lead', 'success', `Created lead: ${lead.email}`);

      // 6. Create enrollment(s)
      updateStep('enrollment', 'loading', testMode === 'scale' ? 'Creating enrollments...' : 'Creating enrollment...');
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

      if (enrollmentError) {
        throw new Error(`Failed to create enrollment: ${enrollmentError.message}`);
      }
      updateStep('enrollment', 'success', `Enrollment created`);

      // 7. Create email node with custom subject and body
      updateStep('node', 'loading', 'Creating email node...');
      const nodeId = `email-${Date.now()}`;
      const { data: node, error: nodeError } = await supabase
        .from('nodes')
        .insert({
          campaign_id: campaign.id,
          flow_node_id: nodeId,
          node_type: 'email',
          node_data: {
            subject: emailSubject,
            body: emailBody,
          },
          position_x: 0,
          position_y: 0,
        })
        .select()
        .single();

      if (nodeError) {
        throw new Error(`Failed to create node: ${nodeError.message}`);
      }
      updateStep('node', 'success', `Email node created`);

      // 8. Create message_job(s) with custom message data
      const count = testMode === 'scale' ? parseInt(scaleCount, 10) : 1;
      updateStep('messageJob', 'loading', `Creating ${count} message job${count > 1 ? 's' : ''}...`);
      const scheduledAt = new Date().toISOString();
      
      const messageJobsData = Array.from({ length: count }, () => ({
        enrollment_id: enrollment.id,
        campaign_id: campaign.id,
        lead_id: lead.id,
        mailbox_id: mailbox.id,
        node_id: node.id,
        status: 'pending' as const,
        scheduled_at: scheduledAt,
        message_data: {
          node_config: {
            subject: emailSubject,
            body: emailBody,
          },
          lead_data: {
            email: lead.email,
            name: lead.name,
          },
          // Add test mode flag for scale tests - worker will skip SMTP sending
          skip_smtp: testMode === 'scale',
        },
      }));

      const { data: messageJobs, error: jobError } = await supabase
        .from('message_jobs')
        .insert(messageJobsData)
        .select();

      if (jobError || !messageJobs || messageJobs.length === 0) {
        throw new Error(`Failed to create message_job(s): ${jobError?.message || 'No jobs created'}`);
      }
      
      updateStep('messageJob', 'success', `Created ${messageJobs.length} message job${messageJobs.length > 1 ? 's' : ''}`);
      setTotalCreated(messageJobs.length);
      setTotalSent(messageJobs.length);
      
      // Store first message job ID for single test mode
      if (messageJobs.length === 1) {
        setMessageJobId(messageJobs[0].id);
      }

      // Message jobs are now created directly in the database
      // Send workers will pick them up automatically via database polling
      setCurrentStep('complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      // Mark current step as error
      const currentStep = Object.keys(steps).find(
        key => steps[key]?.status === 'loading'
      );
      if (currentStep) {
        updateStep(currentStep, 'error', errorMessage);
      }
    } finally {
      setLoading(false);
      setSending(false);
    }
  };

  const StepIndicator = ({ step, label }: { step: string; label: string }) => {
    const stepStatus = steps[step] || { status: 'pending' as const };
    const { status, message } = stepStatus;

    return (
      <View className="flex-row items-center mb-3">
        <View className="w-6 h-6 rounded-full items-center justify-center mr-3">
          {status === 'pending' && (
            <View className="w-4 h-4 rounded-full bg-gray-600" />
          )}
          {status === 'loading' && (
            <ActivityIndicator size="small" color="#3b82f6" />
          )}
          {status === 'success' && (
            <View className="w-4 h-4 rounded-full bg-green-500" />
          )}
          {status === 'error' && (
            <View className="w-4 h-4 rounded-full bg-red-500" />
          )}
        </View>
        <View className="flex-1">
          <Text className="text-white font-medium">{label}</Text>
          {message && (
            <Text className="text-gray-400 text-sm mt-0.5">{message}</Text>
          )}
        </View>
      </View>
    );
  };

  const renderConfigureStep = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-3xl font-bold text-white mb-2">Configure Test Email</Text>
        <Text className="text-gray-400 text-base">
          Customize the recipient and message content for your test email.
        </Text>
      </View>

      <View className="space-y-4">
        {/* Test Mode Selector */}
        <View>
          <Text className="text-sm font-medium mb-2 text-gray-300">Test Mode</Text>
          <View className="flex-row space-x-2">
            <TouchableOpacity
              onPress={() => {
                setTestMode('single');
                setError(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl border ${
                testMode === 'single'
                  ? 'bg-blue-600 border-blue-500'
                  : 'bg-white/5 border-white/30'
              }`}
            >
              <Text className={`text-center font-medium ${testMode === 'single' ? 'text-white' : 'text-gray-400'}`}>
                Single Test
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setTestMode('scale');
                setError(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl border ${
                testMode === 'scale'
                  ? 'bg-blue-600 border-blue-500'
                  : 'bg-white/5 border-white/30'
              }`}
            >
              <Text className={`text-center font-medium ${testMode === 'scale' ? 'text-white' : 'text-gray-400'}`}>
                Scale Test
              </Text>
            </TouchableOpacity>
          </View>
          {testMode === 'scale' && (
            <View className="mt-2">
              <Text className="text-gray-500 text-xs">
                Creates multiple message jobs to test auto-scaling. Workers will process them from the queue.
              </Text>
              <Text className="text-blue-400 text-xs mt-1 font-medium">
                ⚠️ Scale tests skip SMTP sending - workers will process jobs but won't send real emails.
              </Text>
            </View>
          )}
        </View>

        {testMode === 'scale' && (
          <View>
            <Text className="text-sm font-medium mb-2 text-gray-300">Number of Messages</Text>
            <TextInput
              value={scaleCount}
              onChangeText={(text) => {
                setScaleCount(text);
                setError(null);
              }}
              placeholder="100"
              keyboardType="number-pad"
              className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
              style={{
                borderColor: '#FFFFFF4D',
                backgroundColor: '#FFFFFF0D',
                color: '#FFFFFF',
                borderWidth: 1,
              }}
              placeholderTextColor="#666"
              selectionColor="#FF4D00"
            />
            <Text className="text-gray-500 text-xs mt-1">
              Recommended: 100-1000 for scale testing. Higher values will take longer to create.
            </Text>
          </View>
        )}

        <View>
          <Text className="text-sm font-medium mb-2 text-gray-300">Recipient Email *</Text>
          <TextInput
            value={recipientEmail}
            onChangeText={(text) => {
              setRecipientEmail(text);
              setError(null);
            }}
            placeholder="recipient@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            placeholderTextColor="#666"
            selectionColor="#FF4D00"
          />
        </View>

        <View>
          <Text className="text-sm font-medium mb-2 text-gray-300">Recipient Name</Text>
          <TextInput
            value={recipientName}
            onChangeText={(text) => {
              setRecipientName(text);
              setError(null);
            }}
            placeholder="John Doe"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            placeholderTextColor="#666"
            selectionColor="#FF4D00"
          />
          <Text className="text-gray-500 text-xs mt-1">
            Used for template variable {'{{name}}'} in the email body
          </Text>
        </View>

        <View>
          <Text className="text-sm font-medium mb-2 text-gray-300">Email Subject *</Text>
          <TextInput
            value={emailSubject}
            onChangeText={(text) => {
              setEmailSubject(text);
              setError(null);
            }}
            placeholder="Test Email Subject"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            placeholderTextColor="#666"
            selectionColor="#FF4D00"
          />
        </View>

        <View>
          <Text className="text-sm font-medium mb-2 text-gray-300">Email Body *</Text>
          <TextInput
            value={emailBody}
            onChangeText={(text) => {
              setEmailBody(text);
              setError(null);
            }}
            placeholder="Email body text..."
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
              minHeight: 120,
            }}
            placeholderTextColor="#666"
            selectionColor="#FF4D00"
          />
          <Text className="text-gray-500 text-xs mt-1">
            Use template variables like {'{{name}}'} and {'{{email}}'} - they'll be replaced with actual values
          </Text>
        </View>
      </View>

      {error && (
        <View className="bg-red-900/20 border border-red-700 rounded-lg p-4">
          <Text className="text-red-400 font-semibold mb-1">❌ Error</Text>
          <Text className="text-gray-300 text-sm">{error}</Text>
        </View>
      )}

      <Button
        onPress={handleNext}
        disabled={loading}
        className="bg-blue-600"
      >
        <Text className="text-white font-semibold">Continue →</Text>
      </Button>
    </View>
  );

  const renderProcessingStep = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-3xl font-bold text-white mb-2">Processing...</Text>
        <Text className="text-gray-400 text-base">
          Creating dependencies and message jobs. Send workers will process them automatically.
        </Text>
      </View>

      {Object.keys(steps).length > 0 && (
        <View className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <Text className="text-white font-semibold mb-4 text-lg">Progress</Text>
          <StepIndicator step="user" label="User Profile" />
          <StepIndicator step="account" label="Account" />
          <StepIndicator step="campaign" label="Campaign" />
          <StepIndicator step="mailbox" label="Mailbox" />
          <StepIndicator step="lead" label="Lead" />
          <StepIndicator step="enrollment" label="Enrollment" />
          <StepIndicator step="node" label="Email Node" />
          <StepIndicator step="messageJob" label="Message Job" />
        </View>
      )}

      {error && (
        <View className="bg-red-900/20 border border-red-700 rounded-lg p-4">
          <Text className="text-red-400 font-semibold mb-2">❌ Error</Text>
          <Text className="text-gray-300 text-sm">{error}</Text>
        </View>
      )}

      {!loading && !sending && error && (
        <Button
          onPress={handleBack}
          variant="outline"
          className="border-gray-600"
        >
          <Text className="text-white font-semibold">← Back to Configuration</Text>
        </Button>
      )}
    </View>
  );

  const renderCompleteStep = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-3xl font-bold text-white mb-2">✅ Success!</Text>
        <Text className="text-gray-400 text-base">
          Message jobs have been created in the database. Send workers will pick them up automatically.
        </Text>
      </View>

      {messageJobId && (
        <View className="bg-green-900/20 border border-green-700 rounded-lg p-4">
          <View className="mb-2">
            <Text className="text-gray-300 text-sm mb-1">Message Job ID:</Text>
            <Text className="text-white font-mono text-sm">{messageJobId}</Text>
          </View>
        </View>
      )}

      <View className="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
        <Text className="text-purple-400 font-semibold mb-3 text-lg">📋 How to Verify It's Working</Text>
        
        <Text className="text-white font-medium mb-2 mt-3">1. Check CloudWatch Logs</Text>
        <Text className="text-gray-300 text-sm mb-1 font-mono bg-gray-900 p-2 rounded">
          aws logs tail /ecs/furnace/send-worker --follow --region us-west-2
        </Text>
        <Text className="text-gray-400 text-xs mb-4">
          Look for: "Received X messages", "Processing message job", "Email sent successfully"
        </Text>

        <Text className="text-white font-medium mb-2">2. Check ECS Service Status</Text>
        <Text className="text-gray-300 text-sm mb-1 font-mono bg-gray-900 p-2 rounded">
          aws ecs describe-services{'\n'}
          --cluster furnace-cluster{'\n'}
          --services $(aws ecs list-services --cluster furnace-cluster --query 'serviceArns[0]' --output text | awk -F'/' {'{'}print $NF{'}'}){'\n'}
          --region us-west-2{'\n'}
          --query 'services[0].[runningCount,desiredCount]'{'\n'}
          --output table
        </Text>
        <Text className="text-gray-400 text-xs mb-4">
          Check that tasks are running (runningCount should match desiredCount)
        </Text>

        <Text className="text-white font-medium mb-2">4. Check Message Job Status (Supabase SQL Editor)</Text>
        <Text className="text-gray-300 text-sm mb-1 font-mono bg-gray-900 p-2 rounded">
          {testMode === 'scale' 
            ? `SELECT status, COUNT(*) as count\nFROM message_jobs\nWHERE campaign_id = (SELECT id FROM campaigns WHERE name = 'Test Campaign - Worker' LIMIT 1)\nGROUP BY status;`
            : `SELECT id, status, sent_at, provider_message_id, error_message\nFROM message_jobs\nWHERE id = '${messageJobId || ''}';`}
        </Text>
        <Text className="text-gray-400 text-xs mb-4">
          {testMode === 'scale' 
            ? "Watch 'pending' count decrease and 'sent' count increase as workers process messages"
            : "Expected: status should change from 'pending' to 'sent' (or 'failed' if there's an error)"}
        </Text>

        <Text className="text-white font-medium mb-2">5. Check Events Table</Text>
        <Text className="text-gray-300 text-sm mb-1 font-mono bg-gray-900 p-2 rounded">
          {testMode === 'scale'
            ? `SELECT event_type, COUNT(*) as count\nFROM events\nWHERE campaign_id = (SELECT id FROM campaigns WHERE name = 'Test Campaign - Worker' LIMIT 1)\nGROUP BY event_type;`
            : `SELECT * FROM events\nWHERE message_job_id = '${messageJobId || ''}'\nORDER BY created_at DESC;`}
        </Text>
        <Text className="text-gray-400 text-xs mb-4">
          {testMode === 'scale'
            ? "Watch 'sent' event count increase as workers process messages"
            : "Should see an event with event_type = 'sent' after successful processing"}
        </Text>
      </View>

      <Button
        onPress={() => {
          setCurrentStep('configure');
          setMessageJobId(null);
          setTotalCreated(0);
          setTotalSent(0);
          setSteps({});
          setError(null);
        }}
        className="bg-blue-600"
      >
        <Text className="text-white font-semibold">Send Another Test</Text>
      </Button>
    </View>
  );

  return (
    <PageLayout>
      <ScrollView className="flex-1">
        <View className="space-y-6">
          {/* Step indicator */}
          <View className="flex-row items-center justify-center space-x-2 mb-6">
            <View className={`flex-1 h-1 rounded ${currentStep === 'configure' ? 'bg-blue-600' : 'bg-gray-700'}`} />
            <View className={`w-8 h-8 rounded-full items-center justify-center ${currentStep === 'configure' ? 'bg-blue-600' : currentStep === 'processing' || currentStep === 'complete' ? 'bg-green-600' : 'bg-gray-700'}`}>
              <Text className="text-white font-semibold text-sm">1</Text>
            </View>
            <View className={`flex-1 h-1 rounded ${currentStep === 'processing' || currentStep === 'complete' ? 'bg-blue-600' : 'bg-gray-700'}`} />
            <View className={`w-8 h-8 rounded-full items-center justify-center ${currentStep === 'processing' ? 'bg-blue-600' : currentStep === 'complete' ? 'bg-green-600' : 'bg-gray-700'}`}>
              <Text className="text-white font-semibold text-sm">2</Text>
            </View>
            <View className={`flex-1 h-1 rounded ${currentStep === 'complete' ? 'bg-blue-600' : 'bg-gray-700'}`} />
            <View className={`w-8 h-8 rounded-full items-center justify-center ${currentStep === 'complete' ? 'bg-green-600' : 'bg-gray-700'}`}>
              <Text className="text-white font-semibold text-sm">3</Text>
            </View>
          </View>

          {currentStep === 'configure' && renderConfigureStep()}
          {currentStep === 'processing' && renderProcessingStep()}
          {currentStep === 'complete' && renderCompleteStep()}

          <View className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
            <Text className="text-yellow-400 font-semibold mb-2">⚠️ Important</Text>
            <Text className="text-gray-300 text-sm leading-5">
              {testMode === 'scale' ? (
                <>
                  • Scale tests skip SMTP sending - workers process jobs but don't send real emails{'\n'}
                  • This allows testing auto-scaling without spamming recipients{'\n'}
                  • Workers will still update status and create events for verification{'\n'}
                  • Perfect for testing queue processing and ECS scaling behavior
                </>
              ) : (
                <>
                  • Make sure your mailbox has valid SMTP credentials{'\n'}
                  • The test mailbox created here uses placeholder credentials{'\n'}
                  • Update the mailbox with real SMTP settings before testing
                </>
              )}
            </Text>
          </View>
        </View>
      </ScrollView>
    </PageLayout>
  );
}
