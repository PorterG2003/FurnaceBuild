import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReplaceLeadScreen } from '@/components/inbox/ReplaceLeadScreen';
import { Alert } from '@/components/ui/feedback';
import { DetailPageHeader, PageLayout } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';
import { normalizeInboxThreadParam } from '@/hooks/useInboxThreadRouteSync';
import { getMessagesByThread, getThreadById } from '@/lib/supabase/services/inbox';
import { getLeadById } from '@/lib/supabase/services/leads';
import type { Lead, EmailThread } from '@/lib/supabase/types';

export default function ReplaceLeadPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { thread: threadParamRaw } = useLocalSearchParams<{ thread?: string | string[] }>();
  const threadId = normalizeInboxThreadParam(threadParamRaw) ?? null;
  const { account } = useAccount();
  const accountId = account?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);

  const returnToInbox = useCallback(() => {
    router.replace(threadId ? { pathname: '/inbox', params: { thread: threadId } } : '/inbox');
  }, [router, threadId]);

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
    <PageLayout scrollable={false} mobileLayout="fixed" hideMobileBottomNav>
      <View className="flex-1 bg-[#121212] min-h-0 px-4">
        <DetailPageHeader
          breadcrumbItems={[{ label: 'Inbox', href: '/inbox' }, { label: 'Replace lead' }]}
          backHref="/inbox"
          title="Replace lead"
          subtitle={lead?.email ?? thread?.subject ?? null}
          onBack={returnToInbox}
        />

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-sm font-instrument text-gray-400 mb-4">
            Create a new lead for the new contact and move the active campaign ownership there.
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
              sourceMessageId={sourceMessageId}
              onReplaced={() => {
                returnToInbox();
              }}
              onCancel={returnToInbox}
              layout="page"
            />
          )}
        </ScrollView>
      </View>
    </PageLayout>
  );
}
