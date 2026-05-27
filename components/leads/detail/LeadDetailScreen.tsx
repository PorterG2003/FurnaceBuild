import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DetailPageShell, DETAIL_CONTENT_MAX_WIDTH, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, EmptyState, usePageSkeleton, useToast } from '@/components/ui/feedback';
import { LeadDetailSkeleton } from '@/components/skeletons';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { useAccountBootstrap } from '@/lib/account/useAccountBootstrap';
import type { LeadDetailFrom } from '@/lib/leads/navigation';
import { getAccountLeadDetail } from '@/lib/supabase/services/leads/lead-detail';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { LeadProfileSection } from './LeadProfileSection';
import { LeadCampaignsSection } from './LeadCampaignsSection';
import { LeadConversationsSection } from './LeadConversationsSection';
import { LeadActivitySection } from './LeadActivitySection';
import { LeadDetailSummary } from './LeadDetailSummary';
import { LeadDetailMobileView } from './mobile/LeadDetailMobileView';
import { useLeadDetailMobileNavigation } from './mobile/useLeadDetailMobileNavigation';

const DETAIL_TABS: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'activity', label: 'Activity' },
];

export function LeadDetailScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { accountId, isAccountBootstrapping, accountBootstrapError } = useAccountBootstrap();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  const params = useLocalSearchParams<{
    globalLeadId: string;
    campaignId?: string;
    from?: LeadDetailFrom;
    listId?: string;
    listName?: string;
    campaignName?: string;
    threadId?: string;
  }>();

  const globalLeadId = typeof params.globalLeadId === 'string' ? params.globalLeadId : '';
  const campaignId = typeof params.campaignId === 'string' ? params.campaignId : null;
  const from = typeof params.from === 'string' ? (params.from as LeadDetailFrom) : undefined;
  const listId = typeof params.listId === 'string' ? params.listId : undefined;
  const listName = typeof params.listName === 'string' ? params.listName : undefined;
  const campaignName = typeof params.campaignName === 'string' ? params.campaignName : undefined;
  const threadId = typeof params.threadId === 'string' ? params.threadId : undefined;

  const [activeTab, setActiveTab] = useState('overview');
  const [detail, setDetail] = useState<AccountLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (isAccountBootstrapping) {
      setLoading(true);
      setError(null);
      return;
    }

    if (accountBootstrapError) {
      setDetail(null);
      setError(accountBootstrapError);
      setLoading(false);
      return;
    }

    if (!accountId || !globalLeadId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const loaded = await getAccountLeadDetail(accountId, globalLeadId);
      setDetail(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [accountBootstrapError, accountId, globalLeadId, isAccountBootstrapping]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const displayName = useMemo(() => {
    if (!detail) return 'Lead';
    return (
      detail.person.displayName ||
      [detail.person.firstName, detail.person.lastName].filter(Boolean).join(' ') ||
      detail.person.email
    );
  }, [detail]);

  const breadcrumbItems = useMemo(() => {
    if (from === 'list' && listId) {
      return [
        { label: 'Leads', href: '/leads', openInNewTab: true },
        { label: 'Saved lists', href: '/leads/lists', openInNewTab: true },
        { label: listName ?? 'Saved list', href: `/leads/lists/${listId}`, openInNewTab: true },
        { label: displayName },
      ];
    }
    if (from === 'campaign' && campaignId) {
      return [
        { label: 'Campaigns', href: '/campaigns', openInNewTab: true },
        { label: campaignName ?? 'Campaign', href: `/campaigns/${campaignId}`, openInNewTab: true },
        { label: displayName },
      ];
    }
    if (from === 'inbox') {
      return [
        {
          label: 'Inbox',
          href: threadId ? `/inbox?thread=${threadId}` : '/inbox',
          openInNewTab: true,
        },
        { label: displayName },
      ];
    }
    return [{ label: 'Leads', href: '/leads', openInNewTab: true }, { label: displayName }];
  }, [campaignId, campaignName, displayName, from, listId, listName, threadId]);

  const backHref = useMemo(() => {
    if (from === 'list' && listId) return `/leads/lists/${listId}`;
    if (from === 'campaign' && campaignId) return `/campaigns/${campaignId}`;
    if (from === 'inbox' && threadId) return `/inbox?thread=${threadId}`;
    return '/leads';
  }, [campaignId, from, listId, threadId]);

  const handleExitPage = useCallback(() => {
    if (from === 'inbox' && threadId) {
      router.push({ pathname: '/inbox', params: { thread: threadId } });
      return;
    }
    router.push(backHref);
  }, [backHref, from, router, threadId]);

  const mobileNav = useLeadDetailMobileNavigation({
    isMobile,
    campaignId,
    displayName,
    email: detail?.person.email ?? null,
    fromInbox: from === 'inbox',
    onExitPage: handleExitPage,
  });

  const handleSaved = useCallback(() => {
    toast.success('Lead profile updated');
    void loadDetail();
  }, [loadDetail, toast]);

  const contentWidthStyle = isMobile
    ? undefined
    : { maxWidth: DETAIL_CONTENT_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const };

  const shellOnBack = isMobile ? mobileNav.onBack : from === 'inbox' ? handleExitPage : undefined;
  const { showPlaceholder } = usePageSkeleton(loading || isAccountBootstrapping);
  const shellTitle = showPlaceholder ? 'Lead' : (isMobile ? mobileNav.headerTitle : displayName);
  const shellSubtitle = showPlaceholder ? null : (isMobile ? mobileNav.headerSubtitle : detail?.person.email ?? null);

  if (!globalLeadId) {
    return (
      <DetailPageShell
        breadcrumbItems={[{ label: 'Leads', href: '/leads', openInNewTab: true }, { label: 'Lead' }]}
        backHref="/leads"
        title="Lead"
      >
        <View style={contentWidthStyle} className="gap-6 w-full">
          <EmptyState title="Invalid lead" description="No lead identifier was provided." />
        </View>
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell
      breadcrumbItems={breadcrumbItems}
      backHref={backHref}
      onBack={shellOnBack}
      title={shellTitle}
      subtitle={shellSubtitle}
      contentPadding={16}
    >
      <View style={contentWidthStyle} className="gap-6 w-full">
        {showPlaceholder ? <LeadDetailSkeleton isMobile={isMobile} /> : null}
        {!showPlaceholder && !isAccountBootstrapping && error ? (
          <Alert variant="error" message={error} />
        ) : null}
        {!showPlaceholder && !isAccountBootstrapping && !error && !detail ? (
          <EmptyState
            title="Lead not found"
            description="This lead could not be found for the current account."
          />
        ) : null}

        {!showPlaceholder && !error && detail && accountId ? (
          <View className={`gap-4 ${isMobile ? '' : 'pt-1'}`}>
            {isMobile ? (
              <LeadDetailMobileView
                detail={detail}
                accountId={accountId}
                section={mobileNav.section}
                highlightCampaignId={campaignId}
                onSectionChange={mobileNav.setSection}
                onSaved={handleSaved}
                onMembershipChanged={loadDetail}
              />
            ) : (
              <>
                <LeadDetailSummary detail={detail} />

                <Tabs
                  tabs={DETAIL_TABS}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  layout="content"
                  marginBottom={0}
                />

                {activeTab === 'overview' ? (
                  <LeadProfileSection accountId={accountId} detail={detail} onSaved={handleSaved} />
                ) : null}

                {activeTab === 'campaigns' ? (
                  <LeadCampaignsSection
                    accountId={accountId}
                    detail={detail}
                    highlightCampaignId={campaignId}
                    onMembershipChanged={loadDetail}
                  />
                ) : null}

                {activeTab === 'conversations' ? (
                  <LeadConversationsSection detail={detail} />
                ) : null}

                {activeTab === 'activity' ? (
                  <LeadActivitySection detail={detail} defaultCampaignId={campaignId} />
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    </DetailPageShell>
  );
}
