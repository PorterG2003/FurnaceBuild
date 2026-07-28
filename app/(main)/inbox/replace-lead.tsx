import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReplaceLeadScreen } from '@/components/inbox/ReplaceLeadScreen';
import { Alert } from '@/components/ui/feedback';
import { DetailPageHeader, MobileFormPageLayout } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';
import {
  buildInboxInternalThreadHref,
  buildInboxListHref,
  normalizeRouteParam,
} from '@/lib/inbox/inboxRoutes';
import { buildReplaceLeadPrefill } from '@/lib/inbox/replaceLeadPrefill';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import type { Href } from 'expo-router';
import { getMessagesByThread, getThreadById } from '@/lib/supabase/services/inbox';
import { getLeadById } from '@/lib/supabase/services/leads';
import { useInboxThreadActionSession } from '@/contexts/InboxThreadActionContext';
import type { Lead, EmailThread } from '@/lib/supabase/types';

export default function ReplaceLeadPage() {
  const router = useRouter();
  const session = useInboxThreadActionSession();
  const { thread: threadParamRaw } = useLocalSearchParams<{ thread?: string | string[] }>();
  const threadId = normalizeRouteParam(threadParamRaw) ?? null;
  const { account } = useAccount();
  const accountId = account?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [latestInboundFromEmail, setLatestInboundFromEmail] = useState<string | null>(null);
  const [latestInboundFromName, setLatestInboundFromName] = useState<string | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);

  const returnToInbox = useCallback(() => {
    router.replace(
      threadId ? (buildInboxInternalThreadHref(threadId) as Href) : buildInboxListHref()
    );
  }, [router, threadId]);

  const replaceLeadPrefill = useMemo(() => {
    const customLeadData =
      lead?.custom_lead_data &&
      typeof lead.custom_lead_data === 'object' &&
      !Array.isArray(lead.custom_lead_data)
        ? Object.keys(lead.custom_lead_data as Record<string, unknown>)
        : [];

    return buildReplaceLeadPrefill({
      metadata: parseSmartHandlingMetadata(thread?.handling_metadata ?? null),
      inboundFromEmail: latestInboundFromEmail,
      inboundFromName: latestInboundFromName,
      customLeadDataKeys: customLeadData,
    });
  }, [latestInboundFromEmail, latestInboundFromName, lead?.custom_lead_data, thread?.handling_metadata]);

  useEffect(() => {
    if (threadId == null || accountId == null) {
      if (threadId == null) {
        returnToInbox();
      }
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const loadedThread = await getThreadById(threadId);
        if (!loadedThread || loadedThread.account_id !== accountId || !loadedThread.lead_id) {
          returnToInbox();
          return;
        }

        const [loadedLead, messages] = await Promise.all([
          getLeadById(loadedThread.lead_id),
          getMessagesByThread(threadId),
        ]);

        if (!loadedLead) {
          returnToInbox();
          return;
        }

        const latestInbound = [...messages]
          .filter((message) => message.direction === 'received')
          .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0] ?? null;

        if (cancelled) return;

        setThread(loadedThread);
        setLead(loadedLead);
        setLatestInboundFromEmail(latestInbound?.from_email ?? null);
        setLatestInboundFromName(latestInbound?.from_name ?? null);
        setSourceMessageId(latestInbound?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load replace lead.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [accountId, returnToInbox, threadId]);

  return (
    <MobileFormPageLayout
      header={
        <DetailPageHeader
          breadcrumbItems={[{ label: 'Inbox', href: '/inbox' }, { label: 'Replace lead' }]}
          backHref="/inbox"
          title="Replace lead"
          subtitle={lead?.email ?? thread?.subject ?? null}
          onBack={returnToInbox}
        />
      }
    >
      <Text className="text-sm font-instrument text-gray-400 mb-4">
        Move active campaign ownership to the new contact. If they are already in this campaign, the
        conversation attaches to them instead of creating a second lead.
      </Text>

      {loading ? (
        <View className="flex-1 items-center justify-center py-10">
          <ActivityIndicator color="#fff" />
        </View>
      ) : error ? (
        <Alert variant="error" message={error} />
      ) : (
        <ReplaceLeadScreen
          oldLead={lead}
          prefill={replaceLeadPrefill}
          sourceMessageId={sourceMessageId}
          onReplaced={(_result, completion) => {
            void session.completeDeferredActionOnServer('replace_lead', completion).then(() => {
              returnToInbox();
            });
          }}
          onCancel={returnToInbox}
          layout="page"
        />
      )}
    </MobileFormPageLayout>
  );
}
