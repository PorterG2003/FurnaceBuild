import { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout } from '@/components/ui/layout';
import { supabase } from '@/lib/supabase/client';
import { createCampaign } from '@/lib/supabase/services/campaigns';
import { assignMailboxesToCampaign } from '@/lib/supabase/services/campaigns';
import { createMailbox } from '@/lib/supabase/services/mailboxes';
import { createLead } from '@/lib/supabase/services/leads';
import { getAccountMembershipsForUser } from '@/lib/supabase/services/accounts';
import type { WizardStep, FlowTemplate, ScheduleConfig } from '@/lib/devtools/campaign-flow/types';
import { ALLOWED_EMAIL } from '@/lib/devtools/campaign-flow/constants';
import { createFlowTemplate } from '@/lib/devtools/campaign-flow/flow-templates';
import { validateSchedule, generateTestLead } from '@/lib/devtools/campaign-flow/utils';
import {
  FlowSelectionStep,
  MailboxConfigurationStep,
  ScheduleConfigurationStep,
  LeadConfigurationStep,
  ProcessingStep,
  CompleteStep,
} from '@/lib/devtools/campaign-flow/components';

export default function CampaignFlowTestPage() {
  const { user } = useAccount();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>('flow');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form data - Step 1: Flow Selection
  const [selectedFlow, setSelectedFlow] = useState<FlowTemplate>('simple-email');
  const [campaignName, setCampaignName] = useState('Campaign Flow Test');

  // Form data - Step 2: Mailbox Configuration
  const [mailboxCount, setMailboxCount] = useState<number>(1);

  // Form data - Step 3: Schedule Configuration
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({
    timezone: 'America/New_York',
    start_hour: 9,
    start_minute: 0,
    end_hour: 17,
    end_minute: 0,
    days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
    sending_interval_seconds: 300, // 5 minutes
  });

  // Form data - Step 4: Lead Configuration
  const [leadCount, setLeadCount] = useState<number>(1);

  // Test result
  const [campaignId, setCampaignId] = useState<string | null>(null);
  
  // Creation progress
  const [creationProgress, setCreationProgress] = useState<{
    step: string;
    current?: number;
    total?: number;
  } | null>(null);

  const getUserEmail = useCallback(() => user?.email?.toLowerCase().trim() ?? null, [user]);

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

  const handleNext = () => {
    if (currentStep === 'flow') {
      if (!campaignName.trim()) {
        setError('Please enter a campaign name');
        return;
      }
      setError(null);
      setCurrentStep('mailbox');
    } else if (currentStep === 'mailbox') {
      if (mailboxCount < 1 || mailboxCount > 10) {
        setError('Mailbox count must be between 1 and 10');
        return;
      }
      setError(null);
      setCurrentStep('schedule');
    } else if (currentStep === 'schedule') {
      const validation = validateSchedule(scheduleConfig);
      if (!validation.valid) {
        setError(validation.error || 'Invalid schedule configuration');
        return;
      }
      setError(null);
      setCurrentStep('lead');
          } else if (currentStep === 'lead') {
            if (!leadCount || leadCount < 1) {
              setError('Please enter a number of leads (minimum 1)');
              return;
            }
            if (leadCount > 10000) {
              setError('Number of leads cannot exceed 10,000');
              return;
            }
            setError(null);
            setCurrentStep('processing');
            handleCreateTest();
          }
  };

  const handleBack = () => {
    if (currentStep === 'mailbox') {
      setCurrentStep('flow');
      setError(null);
    } else if (currentStep === 'schedule') {
      setCurrentStep('mailbox');
      setError(null);
    } else if (currentStep === 'lead') {
      setCurrentStep('schedule');
      setError(null);
    } else if (currentStep === 'processing') {
      setCurrentStep('lead');
      setError(null);
      setCreating(false);
    } else if (currentStep === 'complete') {
      setCurrentStep('flow');
      setError(null);
      setCampaignId(null);
    }
  };

  const handleCreateTest = async () => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    setCreating(true);
    setError(null);
    setCreationProgress(null);

    try {
      // 1. Get user profile
      setCreationProgress({ step: 'Getting user profile...' });
      if (!user?.id) throw new Error('User not authenticated.');

      // 2. Get user's account
      setCreationProgress({ step: 'Getting user account...' });
      const memberships = await getAccountMembershipsForUser(user.id);
      if (!memberships || memberships.length === 0) {
        throw new Error('User has no account. Please complete account setup first.');
      }
      const account = memberships[0].account;

      // 3. Create campaign with flow template
      setCreationProgress({ step: 'Creating campaign...' });
      const flowData = createFlowTemplate(selectedFlow);
      
      // Build schedule
      const schedule = {
        timezone: scheduleConfig.timezone,
        start_hour: scheduleConfig.start_hour,
        start_minute: scheduleConfig.start_minute,
        end_hour: scheduleConfig.end_hour,
        end_minute: scheduleConfig.end_minute,
        days_of_week: scheduleConfig.days_of_week,
      };
      
      const campaignData: any = {
        name: campaignName,
        owner_id: user.id,
        account_id: account.id,
        organization_id: null,
        status: 'running',
        flow_data: flowData,
        schedule: schedule,
        sending_interval_seconds: scheduleConfig.sending_interval_seconds,
      };
      
      const campaign = await createCampaign(campaignData);
      setCampaignId(campaign.id);

      // Wait for database trigger to sync nodes from flow_data
      setCreationProgress({ step: 'Syncing flow nodes...' });
      await new Promise(resolve => setTimeout(resolve, 500));

      // 4. Create test mailboxes
      setCreationProgress({ step: 'Creating mailboxes', current: 0, total: mailboxCount });
      const mailboxIds: string[] = [];
      for (let i = 1; i <= mailboxCount; i++) {
        setCreationProgress({ step: 'Creating mailboxes', current: i, total: mailboxCount });
        const mailbox = await createMailbox({
          user_id: user.id,
          account_id: account.id,
          email_address: `test-mailbox-${i}@furnace.test`,
          display_name: `Test Mailbox ${i}`,
          smtp_host: 'smtp.gmail.com',
          smtp_port: 587,
          smtp_username: `test-mailbox-${i}@furnace.test`,
          smtp_password: 'test-password',
          smtp_use_tls: true,
          smtp_use_ssl: false,
          imap_host: 'imap.gmail.com',
          imap_port: 993,
          imap_username: `test-mailbox-${i}@furnace.test`,
          imap_password: 'test-password',
          imap_use_ssl: true,
          status: 'connected',
          provider: 'gmail' as any,
        });
        mailboxIds.push(mailbox.id);
      }

      // 5. Assign mailboxes to campaign
      setCreationProgress({ step: 'Assigning mailboxes to campaign...' });
      await assignMailboxesToCampaign(campaign.id, mailboxIds);

      // 6. Create test leads and enrollments
      setCreationProgress({ step: 'Creating leads and enrollments', current: 0, total: leadCount });
      const leads = [];
      for (let i = 1; i <= leadCount; i++) {
        setCreationProgress({ step: 'Creating leads and enrollments', current: i, total: leadCount });
        const leadData = generateTestLead(i);
        const lead = await createLead({
          campaign_id: campaign.id,
          bucket_id: campaign.bucket_id,
          account_id: account.id,
          email: leadData.email,
          name: leadData.name,
          source: 'test-campaign-flow',
        });
        leads.push(lead);

        // Create enrollment for each lead
        const { error: enrollmentError } = await supabase
          .from('enrollments')
          .insert({
            campaign_id: campaign.id,
            account_id: account.id,
            lead_id: lead.id,
            current_node_id: null, // Let evaluateFlow handle entry point
            state: 'active',
            next_run_at: new Date().toISOString(), // Process immediately
            flow_position: {},
          });

        if (enrollmentError) {
          throw new Error(`Failed to create enrollment for lead ${i}: ${enrollmentError.message}`);
        }
      }

      setCreationProgress({ step: 'Complete!' });
      // Small delay to show completion message
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate to complete step
      setCurrentStep('complete');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setCreationProgress(null);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
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
          Campaign Flow Test
        </Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Test full campaign flows end-to-end with multiple mailboxes and schedule configurations
        </Text>
      </View>

      {error && (
        <View className="bg-red-900/20 border border-red-800 rounded-xl p-4 mb-6">
          <Text className="text-red-400 font-instrument text-sm">Error: {error}</Text>
        </View>
      )}

      {/* Step 1: Flow Selection */}
      {currentStep === 'flow' && (
        <FlowSelectionStep
          campaignName={campaignName}
          selectedFlow={selectedFlow}
          onCampaignNameChange={setCampaignName}
          onFlowChange={setSelectedFlow}
          onNext={handleNext}
        />
      )}

      {/* Step 2: Mailbox Configuration */}
      {currentStep === 'mailbox' && (
        <MailboxConfigurationStep
          mailboxCount={mailboxCount}
          onMailboxCountChange={setMailboxCount}
          onBack={handleBack}
          onNext={handleNext}
        />
      )}

      {/* Step 3: Schedule Configuration */}
      {currentStep === 'schedule' && (
        <ScheduleConfigurationStep
          schedule={scheduleConfig}
          onScheduleChange={setScheduleConfig}
          onBack={handleBack}
          onNext={handleNext}
        />
      )}

      {/* Step 4: Lead Configuration */}
      {currentStep === 'lead' && (
        <LeadConfigurationStep
          leadCount={leadCount}
          onLeadCountChange={setLeadCount}
          onBack={handleBack}
          onNext={handleNext}
        />
      )}

      {/* Step 5: Processing */}
      {currentStep === 'processing' && (
        <ProcessingStep creating={creating} progress={creationProgress} />
      )}

      {/* Step 6: Complete - Test Interface */}
      {currentStep === 'complete' && campaignId && <CompleteStep campaignId={campaignId} />}
    </PageLayout>
  );
}
