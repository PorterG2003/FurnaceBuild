import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, useWindowDimensions, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DetailPageShell, DETAIL_CONTENT_MAX_WIDTH, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, EmptyState, usePageSkeleton, useToast } from '@/components/ui/feedback';
import { LeadDetailSkeleton } from '@/components/skeletons';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { useAccountBootstrap } from '@/lib/account/useAccountBootstrap';
import type { LeadDetailFrom } from '@/lib/leads/navigation';
import { buildInboxThreadHref, buildInboxThreadPath } from '@/lib/inbox/inboxRoutes';
import { getAccountLeadDetail } from '@/lib/supabase/services/leads/lead-detail';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { LeadProfileSection } from './LeadProfileSection';
import { LeadCampaignsSection } from './LeadCampaignsSection';
import { LeadConversationsSection } from './LeadConversationsSection';
import { LeadActivitySection } from './LeadActivitySection';
import { LeadDetailSummary } from './LeadDetailSummary';
import { LeadDetailMobileView } from './mobile/LeadDetailMobileView';
import { useLeadDetailMobileNavigation } from './mobile/useLeadDetailMobileNavigation';
import { EnrichLeadPanel } from './EnrichLeadPanel';

const ENRICH_PANEL_WIDTH = 480;

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
  const [enrichVisible, setEnrichVisible] = useState(false);
  const [enrichStatusRefreshKey, setEnrichStatusRefreshKey] = useState(0);
  const slideAnim = useRef(new Animated.Value(1)).current;

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
          href: threadId ? buildInboxThreadPath(threadId) : '/inbox',
          openInNewTab: true,
        },
        { label: displayName },
      ];
    }
    return [{ label: 'Leads', href: '/leads', openInNewTab: true }, { label: displayName }];
  }, [campaignId, campaignName, displayName, from, listId, listName, threadId, accountId]);

  const backHref = useMemo(() => {
    if (from === 'list' && listId) return `/leads/lists/${listId}`;
    if (from === 'campaign' && campaignId) return `/campaigns/${campaignId}`;
    if (from === 'inbox' && threadId) return buildInboxThreadPath(threadId);
    return '/leads';
  }, [accountId, campaignId, from, listId, threadId]);

  const handleExitPage = useCallback(() => {
    if (from === 'inbox' && threadId) {
      router.push(buildInboxThreadHref(threadId) as import('expo-router').Href);
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

  const closeEnrichPanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setEnrichVisible(false);
      setEnrichStatusRefreshKey((key) => key + 1);
    });
  }, [slideAnim]);

  const openEnrichPanel = useCallback(() => {
    setEnrichVisible(true);
    slideAnim.setValue(1);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  const handleEnrichApplied = useCallback(() => {
    handleSaved();
    closeEnrichPanel();
  }, [closeEnrichPanel, handleSaved]);

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
      desktopSidePanel={
        !isMobile && enrichVisible && detail && accountId ? (
          <EnrichLeadPanel
            visible={enrichVisible}
            onClose={closeEnrichPanel}
            accountId={accountId}
            detail={detail}
            onApplied={handleEnrichApplied}
            slideAnim={slideAnim}
            panelWidth={ENRICH_PANEL_WIDTH}
          />
        ) : undefined
      }
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
          <View className={`gap-4 ${isMobile ? '' : 'pt-1 flex-1 min-h-0'}`}>
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
              <View className="gap-4 pt-1">
                <LeadDetailSummary detail={detail} />

                <Tabs
                  tabs={DETAIL_TABS}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  layout="content"
                  marginBottom={0}
                />

                {activeTab === 'overview' ? (
                  <LeadProfileSection
                    accountId={accountId}
                    detail={detail}
                    onSaved={handleSaved}
                    onOpenEnrich={openEnrichPanel}
                    enrichmentStatusRefreshKey={enrichStatusRefreshKey}
                  />
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
              </View>
            )}
          </View>
        ) : null}
      </View>
    </DetailPageShell>
  );
}
