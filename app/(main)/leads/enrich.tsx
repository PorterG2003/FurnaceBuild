import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Alert } from '@/components/ui/feedback';
import { DetailPageHeader, MobileFormPageLayout } from '@/components/ui/layout';
import { useAccountBootstrap } from '@/lib/account/useAccountBootstrap';
import { getAccountLeadDetail } from '@/lib/supabase/services/leads/lead-detail';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { buildLeadDetailPath, type LeadDetailFrom } from '@/lib/leads/navigation';
import type { CreditBalance } from '@/lib/credits/balance';
import { EnrichLeadScreen } from '@/components/leads/detail/EnrichLeadScreen';
import { ENRICH_COPY } from '@/components/leads/detail/enrichCopy';
import { EnrichCreditBalancePill } from '@/components/leads/detail/EnrichLeadMeta';

export default function EnrichLeadPage() {
  const router = useRouter();
  const { accountId, isAccountBootstrapping } = useAccountBootstrap();

  const params = useLocalSearchParams<{
    globalLeadId?: string;
    from?: LeadDetailFrom;
    campaignId?: string;
    listId?: string;
    listName?: string;
    campaignName?: string;
    threadId?: string;
  }>();
  const globalLeadId = typeof params.globalLeadId === 'string' ? params.globalLeadId : '';

  const navigationContext = useMemo(
    () => ({
      from: typeof params.from === 'string' ? params.from : undefined,
      campaignId: typeof params.campaignId === 'string' ? params.campaignId : undefined,
      listId: typeof params.listId === 'string' ? params.listId : undefined,
      listName: typeof params.listName === 'string' ? params.listName : undefined,
      campaignName: typeof params.campaignName === 'string' ? params.campaignName : undefined,
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
    }),
    [
      params.campaignId,
      params.campaignName,
      params.from,
      params.listId,
      params.listName,
      params.threadId,
    ],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountLeadDetail | null>(null);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);

  const backToDetail = useCallback(() => {
    if (!globalLeadId) {
      router.replace('/leads' as Href);
      return;
    }
    router.replace(
      buildLeadDetailPath({ globalLeadId, ...navigationContext }) as Href,
    );
  }, [globalLeadId, navigationContext, router]);

  const leadDetailHref = globalLeadId
    ? buildLeadDetailPath({ globalLeadId, ...navigationContext })
    : '/leads';

  const breadcrumbLeadLabel =
    detail?.person.displayName?.trim() || detail?.person.email || 'Lead';

  useEffect(() => {
    if (isAccountBootstrapping) return;
    if (!accountId || !globalLeadId) {
      setLoading(false);
      setError('Missing lead.');
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getAccountLeadDetail(accountId as string, globalLeadId);
        if (cancelled) return;
        if (!loaded) {
          setError('Lead not found.');
          setDetail(null);
          return;
        }
        setDetail(loaded);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load lead.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, globalLeadId, isAccountBootstrapping]);

  const titleAddon = creditBalance ? (
    <EnrichCreditBalancePill
      creditsRemaining={creditBalance.remaining}
      creditLimit={creditBalance.limit}
    />
  ) : null;

  return (
    <MobileFormPageLayout
      header={
        <DetailPageHeader
          breadcrumbItems={[
            { label: breadcrumbLeadLabel, href: leadDetailHref },
            { label: 'Enrich' },
          ]}
          backHref={leadDetailHref}
          title={ENRICH_COPY.title}
          titleAddon={titleAddon}
          subtitle={
            detail?.person.displayName?.trim()
              ? detail.person.email
              : null
          }
          onBack={backToDetail}
        />
      }
    >
      {loading || isAccountBootstrapping ? (
        <View className="flex-1 items-center justify-center py-10">
          <ActivityIndicator color="#fff" />
        </View>
      ) : error || !detail || !accountId ? (
        <Alert variant="error" message={error ?? 'Unable to load lead.'} />
      ) : (
        <EnrichLeadScreen
          accountId={accountId}
          detail={detail}
          onApplied={backToDetail}
          onCancel={backToDetail}
          layout="page"
          onCreditsChange={setCreditBalance}
        />
      )}
    </MobileFormPageLayout>
  );
}
