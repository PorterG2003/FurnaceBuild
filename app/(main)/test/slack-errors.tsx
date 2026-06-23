/**
 * Debug-only test page: triggers and cleans up Slack error scenarios.
 * Uses direct supabase.from/rpc for test data setup/teardown; not part of the app service layer.
 */
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout } from '@/components/ui/layout';
import { MegaphoneIcon, ArrowLeftIcon, TrashIcon } from 'react-native-heroicons/outline';
import { supabase } from '@/lib/supabase/client';
import { createCampaign } from '@/lib/supabase/services/campaigns';
import { createLead } from '@/lib/supabase/services/leads';
import { createMailbox, deleteMailbox } from '@/lib/supabase/services/mailboxes';
import { deleteCampaign } from '@/lib/supabase/services/campaigns';
import { getAccountMembershipsForUser } from '@/lib/supabase/services/accounts';

type Service = 'scheduler' | 'send' | 'inbox-checker';

const SLACK_TEST_CAMPAIGN_NAME_PREFIX = '[Slack test]';
// Send-worker skips SMTP for *@furnace.test (test mode); use another domain so it actually tries SMTP, fails, and reports to Slack.
const SLACK_TEST_MAILBOX_SEND = 'slack-test-send@furnace-slack-test.example.com';
// Inbox-checker excludes *@furnace.test from claim_mailboxes_to_check; use a different domain so this mailbox gets claimed and fails IMAP.
const SLACK_TEST_MAILBOX_INBOX = 'slack-test-inbox@furnace-slack-test.example.com';

export default function SlackErrorsTestPage() {
  const router = useRouter();
  const { user } = useAccount();
  const [triggerLoading, setTriggerLoading] = useState<Service | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  const triggerRealSchedulerError = async () => {
    setTriggerMessage(null);
    setTriggerLoading('scheduler');
    try {
      if (!user?.id) throw new Error('User not authenticated');
      const memberships = await getAccountMembershipsForUser(user.id);
      if (!memberships?.length) throw new Error('No account found');
      const accountId = memberships.find((m) => m.membership.is_owner)?.account.id ?? memberships[0].account.id;

      const campaign = await createCampaign({
        name: `${SLACK_TEST_CAMPAIGN_NAME_PREFIX} Scheduler error`,
        owner_id: user.id,
        status: 'running',
        flow_data: {},
      });
      const lead = await createLead({
        campaign_id: campaign.id,
        bucket_id: campaign.bucket_id ?? campaign.id,
        account_id: accountId,
        email: 'slack-test@furnace.test',
        name: 'Slack Test',
      });
      await supabase.from('enrollments').insert({
        campaign_id: campaign.id,
        account_id: accountId,
        lead_id: lead.id,
        state: 'active',
        next_run_at: new Date().toISOString(),
        flow_position: {},
      });
      setTriggerMessage('Bad enrollment created. Scheduler will report an error when it runs (usually within ~1 min). Check Slack.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTriggerMessage(`Error: ${msg}`);
    } finally {
      setTriggerLoading(null);
    }
  };

  const triggerRealSendWorkerError = async () => {
    setTriggerMessage(null);
    setTriggerLoading('send');
    try {
      if (!user?.id) throw new Error('User not authenticated');
      const memberships = await getAccountMembershipsForUser(user.id);
      if (!memberships?.length) throw new Error('No account found');
      const account = memberships.find((m) => m.membership.is_owner)?.account ?? memberships[0].account;

      const mailbox = await createMailbox({
        user_id: user.id,
        account_id: account.id,
        email_address: SLACK_TEST_MAILBOX_SEND,
        display_name: 'Slack test send',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_username: 'bad',
        smtp_password: 'bad',
        smtp_use_tls: true,
        smtp_use_ssl: false,
        imap_host: 'imap.example.com',
        imap_port: 993,
        imap_username: 'bad',
        imap_password: 'bad',
        imap_use_ssl: true,
        status: 'connected',
        provider: 'custom',
      });

      const campaign = await createCampaign({
        name: `${SLACK_TEST_CAMPAIGN_NAME_PREFIX} Send worker error`,
        owner_id: user!.id,
        status: 'running',
        flow_data: { nodes: [{ id: 'email-1', type: 'email', data: { subject: 'Test', body: 'Test' } }], edges: [] },
      });
      const { data: node, error: nodeError } = await supabase
        .from('nodes')
        .select()
        .eq('campaign_id', campaign.id)
        .eq('flow_node_id', 'email-1')
        .single();
      if (nodeError || !node) throw new Error(nodeError?.message ?? 'Failed to find node (trigger may not have run)');

      const lead = await createLead({
        campaign_id: campaign.id,
        bucket_id: campaign.bucket_id ?? campaign.id,
        account_id: account.id,
        email: 'slack-send-test@furnace.test',
        name: 'Slack Send Test',
      });
      const { data: enrollment } = await supabase
        .from('enrollments')
        .insert({
          campaign_id: campaign.id,
          account_id: account.id,
          lead_id: lead.id,
          state: 'active',
          current_node_id: node.id,
          next_run_at: new Date().toISOString(),
          flow_position: {},
        })
        .select()
        .single();
      if (!enrollment) throw new Error('Failed to create enrollment');

      await supabase.from('message_jobs').insert({
        enrollment_id: enrollment.id,
        campaign_id: campaign.id,
        account_id: account.id,
        lead_id: lead.id,
        mailbox_id: mailbox.id,
        node_id: node.id,
        message_type: 'campaign',
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        message_data: {},
      });
      setTriggerMessage('Test message job created. If the send-worker is running (scale ≥ 1), it will claim the job, fail SMTP, and report to Slack. Check Slack in ~1–2 min.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTriggerMessage(`Error: ${msg}`);
    } finally {
      setTriggerLoading(null);
    }
  };

  const triggerRealInboxCheckerError = async () => {
    setTriggerMessage(null);
    setTriggerLoading('inbox-checker');
    try {
      if (!user?.id) throw new Error('User not authenticated');
      const memberships = await getAccountMembershipsForUser(user.id);
      if (!memberships?.length) throw new Error('No account found');
      const account = memberships.find((m) => m.membership.is_owner)?.account ?? memberships[0].account;

      await createMailbox({
        user_id: user.id,
        account_id: account.id,
        email_address: SLACK_TEST_MAILBOX_INBOX,
        display_name: 'Slack test inbox',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_username: 'bad',
        smtp_password: 'bad',
        smtp_use_tls: true,
        smtp_use_ssl: false,
        imap_host: 'imap.invalid',
        imap_port: 993,
        imap_username: 'bad',
        imap_password: 'bad',
        imap_use_ssl: true,
        status: 'connected',
        provider: 'custom',
      });
      setTriggerMessage('Test mailbox created with invalid IMAP. Inbox-checker will mark it as error on sync (per-mailbox IMAP failures no longer report to Slack).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTriggerMessage(`Error: ${msg}`);
    } finally {
      setTriggerLoading(null);
    }
  };

  const cleanupTestData = async () => {
    setCleanupResult(null);
    setCleanupLoading(true);
    try {
      let deletedCampaigns = 0;
      let deletedMailboxes = 0;

      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id')
        .like('name', `${SLACK_TEST_CAMPAIGN_NAME_PREFIX}%`);
      if (campaigns?.length) {
        for (const c of campaigns) {
          try {
            await deleteCampaign(c.id);
            deletedCampaigns++;
          } catch (error) {
            console.error(`Failed to delete Slack test campaign ${c.id}:`, error);
          }
        }
      }

      const { data: mailboxes } = await supabase
        .from('mailboxes')
        .select('id')
        .in('email_address', [SLACK_TEST_MAILBOX_SEND, SLACK_TEST_MAILBOX_INBOX]);
      if (mailboxes?.length) {
        for (const m of mailboxes) {
          try {
            await deleteMailbox(m.id);
            deletedMailboxes++;
          } catch (error) {
            console.error(`Failed to delete Slack test mailbox ${m.id}:`, error);
          }
        }
      }

      if (deletedCampaigns === 0 && deletedMailboxes === 0) {
        setCleanupResult('No test data to clean up.');
      } else {
        setCleanupResult(`Cleaned up: ${deletedCampaigns} campaign(s), ${deletedMailboxes} mailbox(es).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCleanupResult(`Error: ${msg}`);
    } finally {
      setCleanupLoading(false);
    }
  };

  return (
    <PageLayout>
      <ScrollView className="flex-1">
        <View className="mb-6 flex-row items-center gap-3">
          <Pressable
            onPress={() => router.back()}
            className="p-2 rounded-lg bg-[#1A1A1A] active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeftIcon size={24} color="#f85102" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-2xl font-instrument-semibold text-white">
              Slack Error Reporting
            </Text>
            <Text className="text-gray-400 font-instrument text-sm">
              Verify webhook and message format
            </Text>
          </View>
        </View>

        {/* Trigger real errors */}
        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-2">
            Trigger real error from each service
          </Text>
          <Text className="text-gray-400 font-instrument text-sm mb-4">
            Buttons below create intentional bad data so the real worker reports to Slack. All three workers must be running (scale ≥ 1 in ECS). Check Slack after the worker runs (~1–2 min).
          </Text>
          <View className="gap-3 mb-4">
            <Pressable
              onPress={triggerRealSchedulerError}
              disabled={triggerLoading !== null}
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 active:opacity-80 flex-row items-center justify-between"
            >
              <Text className="text-white font-instrument-medium">
                Trigger real scheduler error
              </Text>
              {triggerLoading === 'scheduler' ? <ActivityIndicator size="small" color="#f85102" /> : null}
            </Pressable>
            <Pressable
              onPress={triggerRealSendWorkerError}
              disabled={triggerLoading !== null}
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 active:opacity-80 flex-row items-center justify-between"
            >
              <Text className="text-white font-instrument-medium">
                Trigger real send-worker error
              </Text>
              {triggerLoading === 'send' ? <ActivityIndicator size="small" color="#f85102" /> : null}
            </Pressable>
            <Pressable
              onPress={triggerRealInboxCheckerError}
              disabled={triggerLoading !== null}
              className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 active:opacity-80 flex-row items-center justify-between"
            >
              <Text className="text-white font-instrument-medium">
                Trigger real inbox-checker error
              </Text>
              {triggerLoading === 'inbox-checker' ? <ActivityIndicator size="small" color="#f85102" /> : null}
            </Pressable>
          </View>
          {triggerMessage && (
            <View className="mb-4 p-4 rounded-xl bg-blue-900/20 border border-blue-800">
              <Text className="text-blue-400 font-instrument text-sm">{triggerMessage}</Text>
            </View>
          )}

          <Text className="text-lg font-instrument-semibold text-white mb-2 mt-6">
            Clean up Slack error test data
          </Text>
          <Text className="text-gray-400 font-instrument text-sm mb-3">
            Remove campaigns and mailboxes created by the triggers above.
          </Text>
          <Pressable
            onPress={cleanupTestData}
            disabled={cleanupLoading}
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 active:opacity-80 flex-row items-center gap-3"
          >
            <TrashIcon size={20} color="#f85102" />
            <Text className="text-white font-instrument-medium">
              {cleanupLoading ? 'Cleaning up...' : 'Clean up Slack error test data'}
            </Text>
            {cleanupLoading && <ActivityIndicator size="small" color="#f85102" />}
          </Pressable>
          {cleanupResult && (
            <View className="mt-3 p-4 rounded-xl bg-gray-800/50 border border-gray-700">
              <Text className="text-gray-300 font-instrument text-sm">{cleanupResult}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </PageLayout>
  );
}
