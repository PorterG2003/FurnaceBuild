import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { DetailPageShell, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, usePageSkeleton } from '@/components/ui/feedback';
import { SavedLeadListsSkeleton } from '@/components/skeletons';
import { LeadsSavedListsGallery, LEADS_DESKTOP_ONLY_MESSAGE } from '@/components/leads/workbench';
import { useAccount } from '@/contexts/AccountContext';
import { getSavedLeadLists, type SavedLeadListSummary } from '@/lib/supabase/services/leads/saved-lists';

export default function LeadsListsIndexPage() {
  const router = useRouter();
  const { account } = useAccount();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const [lists, setLists] = useState<SavedLeadListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account?.id) {
      setLists([]);
      setLoading(false);
      setError('No active account found.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextLists = await getSavedLeadLists(account.id);
        if (!cancelled) setLists(nextLists);
      } catch (nextError) {
        if (!cancelled) {
          setLists([]);
          setError(nextError instanceof Error ? nextError.message : 'Failed to load saved lists.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id]);

  const { showPlaceholder } = usePageSkeleton(loading);

  return (
    <DetailPageShell
      breadcrumbItems={[
        { label: 'Leads', href: '/leads' },
        { label: 'Saved lists' },
      ]}
      backHref="/leads"
      title="Saved lists"
      subtitle={
        isMobile
          ? 'View saved workbench layouts'
          : 'Static saved lead lists backed by real account data'
      }
    >
      <View className="gap-6">
        {isMobile ? (
          <Alert variant="info" message={LEADS_DESKTOP_ONLY_MESSAGE} />
        ) : null}

        {error ? <Alert variant="error" message={error} /> : null}
        {showPlaceholder ? (
          <SavedLeadListsSkeleton />
        ) : (
          <LeadsSavedListsGallery
            lists={lists}
            onCreateList={() => router.push('/leads')}
            allowCreateList={false}
          />
        )}
      </View>
    </DetailPageShell>
  );
}
