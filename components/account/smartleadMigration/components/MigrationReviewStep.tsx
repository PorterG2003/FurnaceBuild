import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState, useSmoothLoading } from '@/components/ui/feedback';
import { Select } from '@/components/ui/forms';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import { Tabs, type Tab } from '@/components/ui/tabs';
import type { CampaignMigrationResult } from '@/lib/smartlead/migration';
import type {
  EmailThread,
  Lead,
  SmartleadMigrationEvent,
  SmartleadMigrationRun,
} from '@/lib/supabase/types';
import { REVIEW_PAGE_SIZE } from '../constants';
import type {
  MigrationResultState,
  ReviewCampaignOption,
  ReviewTabKey,
} from '../types';
import { formatCount, formatDateTime } from '../utils';
import { MigrationInlineNotice, MigrationStatusPill } from './MigrationReviewPrimitives';
import {
  migrationLeadColumns,
  migrationConversationColumns,
} from './tableColumns';

interface MigrationReviewStepProps {
  run: SmartleadMigrationRun | null;
  result: MigrationResultState | null;
  reviewCampaignResults: CampaignMigrationResult[];
  reviewCampaignOptions: ReviewCampaignOption[];
  selectedReviewCampaign: ReviewCampaignOption | null;
  activeReviewTab: ReviewTabKey;
  leadPage: number;
  leadRows: Lead[];
  leadRowsLoading: boolean;
  leadRowsError: string | null;
  conversationPage: number;
  conversationRows: EmailThread[];
  conversationRowsLoading: boolean;
  conversationRowsError: string | null;
  runEvents: SmartleadMigrationEvent[];
  onReviewTabChange: (tab: ReviewTabKey) => void;
  onReviewCampaignChange: (id: string | null) => void;
  onLeadPrevious: () => void;
  onLeadNext: () => void;
  onConversationPrevious: () => void;
  onConversationNext: () => void;
}

const REVIEW_TABS: Tab[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'leads', label: 'Leads' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'activity', label: 'Activity' },
];

function getRunTone(run: SmartleadMigrationRun | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (!run) return 'neutral';
  if (run.status === 'completed') return 'success';
  if (run.status === 'completed_with_warnings') return 'warning';
  if (run.status === 'failed' || run.status === 'failed_to_launch' || run.status === 'failed_to_claim') {
    return 'danger';
  }
  if (run.status === 'cancelled') return 'warning';
  return 'neutral';
}

function SummaryLegendRow({
  color,
  label,
  value,
  helper,
}: {
  color: string;
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-instrument text-gray-300">{label}</Text>
        {helper ? <Text className="text-xs font-instrument text-gray-500">{helper}</Text> : null}
      </View>
      <Text className="text-sm font-instrument-medium text-white">{value}</Text>
    </View>
  );
}

function ReviewEventList({ events }: { events: SmartleadMigrationEvent[] }) {
  return (
    <View className="gap-2">
      {events.map((event) => (
        <View key={event.id} className="rounded-lg border border-[#232323] bg-[#101010] px-3 py-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text
              className={`text-xs font-instrument-medium ${
                event.level === 'error'
                  ? 'text-red-400'
                  : event.level === 'warning'
                    ? 'text-amber-300'
                    : 'text-white'
              }`}
            >
              {event.detail ?? event.event_type.replace(/_/g, ' ')}
            </Text>
            <Text className="text-[10px] text-gray-500 font-instrument">
              {formatDateTime(event.created_at)}
            </Text>
          </View>
          {event.phase ? (
            <Text className="mt-1 text-[11px] font-instrument text-gray-500 capitalize">
              {event.phase.replace(/_/g, ' ')}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function MigrationReviewStep({
  run,
  result,
  reviewCampaignResults,
  reviewCampaignOptions,
  selectedReviewCampaign,
  activeReviewTab,
  leadPage,
  leadRows,
  leadRowsLoading,
  leadRowsError,
  conversationPage,
  conversationRows,
  conversationRowsLoading,
  conversationRowsError,
  runEvents,
  onReviewTabChange,
  onReviewCampaignChange,
  onLeadPrevious,
  onLeadNext,
  onConversationPrevious,
  onConversationNext,
}: MigrationReviewStepProps) {
  const successCount = result?.succeeded.length ?? 0;
  const failedCampaigns = result?.failed ?? [];
  const failedCount = failedCampaigns.length;
  const totalCampaigns = reviewCampaignResults.length;
  const totalConversationsImported = reviewCampaignResults.reduce(
    (sum, campaign) => sum + (campaign.conversationsImported ?? 0),
    0,
  );
  const totalsStatsCampaignCount = reviewCampaignResults.filter(
    (campaign) => campaign.totalsStatsImported,
  ).length;
  const dayByDayStatsCampaignCount = reviewCampaignResults.filter(
    (campaign) => campaign.dayByDayStatsImported,
  ).length;
  const selectedCampaignResult = useMemo(
    () =>
      selectedReviewCampaign
        ? reviewCampaignResults.find((campaign) => campaign.campaignRowId === selectedReviewCampaign.campaignRowId) ?? null
        : null,
    [reviewCampaignResults, selectedReviewCampaign],
  );
  const selectedCampaignEvents = useMemo(
    () =>
      selectedReviewCampaign
        ? runEvents.filter((event) => event.campaign_row_id === selectedReviewCampaign.campaignRowId)
        : [],
    [runEvents, selectedReviewCampaign],
  );
  const visibleActivityEvents = selectedCampaignEvents.length > 0 ? selectedCampaignEvents : runEvents;
  const activitySummary = selectedReviewCampaign
    ? selectedCampaignEvents.length > 0
      ? `Showing recent activity for ${selectedReviewCampaign.name}.`
      : `No campaign-specific events were captured for ${selectedReviewCampaign.name}. Showing recent run activity instead.`
    : 'Recent run activity.';
  const showLeadTableLoader = useSmoothLoading(leadRowsLoading, {
    delayMs: 120,
    minVisibleMs: 220,
  });
  const showConversationTableLoader = useSmoothLoading(conversationRowsLoading, {
    delayMs: 120,
    minVisibleMs: 220,
  });

  const renderSummaryTab = () => {
    if (!selectedReviewCampaign || !selectedCampaignResult) {
      return (
        <EmptyState
          title="Select a migrated campaign"
          description="Choose a successful campaign to inspect imported leads, conversations, and recent activity."
          className="py-8"
        />
      );
    }

    return (
      <View className="gap-4">
        <View className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm font-instrument-medium text-white">
                {selectedReviewCampaign.name}
              </Text>
              <Text className="mt-1 text-xs font-instrument text-gray-400">
                Use the preview tabs below to verify a few imported records for this campaign.
              </Text>
            </View>
            <MigrationStatusPill label="succeeded" tone="success" />
          </View>

          <View className="gap-3">
            <SummaryLegendRow
              color="#8b5cf6"
              label="Imported leads"
              value={formatCount(selectedReviewCampaign.leadsImported)}
            />
            <SummaryLegendRow
              color="#06b6d4"
              label="Imported conversations"
              value={formatCount(selectedReviewCampaign.conversationsImported)}
              helper={
                selectedReviewCampaign.conversationsImported === 0 &&
                selectedReviewCampaign.conversationZeroReason
                  ? selectedReviewCampaign.conversationZeroReason
                  : undefined
              }
            />
            <SummaryLegendRow
              color="#f59e0b"
              label="Totals stats"
              value={selectedReviewCampaign.totalsStatsImported ? 'Imported' : 'Not imported'}
            />
            <SummaryLegendRow
              color="#facc15"
              label="Daily stats"
              value={selectedReviewCampaign.dayByDayStatsImported ? 'Imported' : 'Not imported'}
            />
          </View>

          <MigrationInlineNotice
            body="Preview tables show the current records in this campaign, not a point-in-time snapshot from when the migration originally finished."
          />
        </View>
      </View>
    );
  };

  const renderLeadsTab = () => {
    if (!selectedReviewCampaign) {
      return (
        <EmptyState
          title="No campaign selected"
          description="Choose a successful campaign to preview imported leads."
          className="py-8"
        />
      );
    }

    return (
      <View className="gap-3">
        {leadRowsError ? (
          <View className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <Text className="text-sm font-instrument text-red-400">{leadRowsError}</Text>
          </View>
        ) : null}

        <DataTable<Lead>
          items={leadRows}
          getItemKey={(lead) => lead.id}
          paginationMode="server"
          itemsPerPage={REVIEW_PAGE_SIZE}
          currentPage={leadPage + 1}
          totalItems={selectedReviewCampaign.leadsImported}
          onPageChange={(page) => {
            if (page < leadPage + 1) onLeadPrevious();
            else if (page > leadPage + 1) onLeadNext();
          }}
          compactHeader
          loading={showLeadTableLoader}
          emptyMessage={`No imported leads found for ${selectedReviewCampaign.name}.`}
          columns={migrationLeadColumns}
        />
      </View>
    );
  };

  const renderConversationsTab = () => {
    if (!selectedReviewCampaign) {
      return (
        <EmptyState
          title="No campaign selected"
          description="Choose a successful campaign to preview imported conversations."
          className="py-8"
        />
      );
    }

    return (
      <View className="gap-3">
        {conversationRowsError ? (
          <View className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <Text className="text-sm font-instrument text-red-400">{conversationRowsError}</Text>
          </View>
        ) : null}

        <DataTable<EmailThread>
          items={conversationRows}
          getItemKey={(thread) => thread.id}
          paginationMode="server"
          itemsPerPage={REVIEW_PAGE_SIZE}
          currentPage={conversationPage + 1}
          totalItems={selectedReviewCampaign.conversationsImported}
          onPageChange={(page) => {
            if (page < conversationPage + 1) onConversationPrevious();
            else if (page > conversationPage + 1) onConversationNext();
          }}
          compactHeader
          loading={showConversationTableLoader}
          emptyMessage={`No imported conversations found for ${selectedReviewCampaign.name}.`}
          columns={migrationConversationColumns}
        />
      </View>
    );
  };

  const renderActivityTab = () => (
    <View className="gap-3">
      <View>
        <Text className="text-sm font-instrument-medium text-white">Activity</Text>
        <Text className="mt-1 text-xs font-instrument text-gray-400">{activitySummary}</Text>
      </View>

      {visibleActivityEvents.length === 0 ? (
        <EmptyState
          title="No activity events"
          description="This run does not have recent activity records to review."
          className="py-8"
        />
      ) : (
        <ReviewEventList events={visibleActivityEvents} />
      )}
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ gap: 12 }}>
      <View className="gap-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium text-white">Review results</Text>
            <Text className="mt-1 text-xs font-instrument text-gray-400">
              Spot check one successful campaign at a time to verify the imported records look right.
            </Text>
          </View>
          <MigrationStatusPill
            label={run ? run.status.replace(/_/g, ' ') : 'completed'}
            tone={getRunTone(run)}
          />
        </View>

        <View className="mt-5 flex-row flex-wrap items-center gap-6">
          <View className="min-w-[132px]">
            <MultiSegmentDial
              segments={[
                { value: successCount, color: '#10b981' },
                { value: failedCount, color: '#ef4444' },
                { value: Math.max(0, totalCampaigns - successCount - failedCount), color: '#6b7280' },
              ]}
              total={Math.max(totalCampaigns, 1)}
              size={132}
              strokeWidth={9}
              centerValue={successCount}
              centerTotal={totalCampaigns}
              centerTopLabel="Succeeded"
              centerBottomLabel="Campaigns"
            />
          </View>

          <View style={{ flex: 1, minWidth: 260 }} className="gap-2.5">
            <SummaryLegendRow
              color="#10b981"
              label="Succeeded campaigns"
              value={formatCount(successCount)}
            />
            <SummaryLegendRow
              color="#ef4444"
              label="Failed campaigns"
              value={formatCount(failedCount)}
              helper={failedCount > 0 ? 'Review needs-attention details below.' : undefined}
            />
            <SummaryLegendRow
              color="#8b5cf6"
              label="Imported leads"
              value={formatCount(result?.totalLeadsImported)}
            />
            <SummaryLegendRow
              color="#06b6d4"
              label="Imported conversations"
              value={formatCount(totalConversationsImported)}
            />
            <SummaryLegendRow
              color="#f59e0b"
              label="Stats coverage"
              value={`${formatCount(totalsStatsCampaignCount)} totals / ${formatCount(dayByDayStatsCampaignCount)} daily`}
            />
            {(run?.warning_count ?? 0) > 0 ? (
              <SummaryLegendRow
                color="#facc15"
                label="Warnings"
                value={formatCount(run?.warning_count)}
                helper="Check Activity if a preview looks unexpected."
              />
            ) : null}
          </View>
        </View>

        <View className="mt-4 flex-row flex-wrap gap-4">
          <Text className="text-xs font-instrument text-gray-500">
            Started {formatDateTime(run?.started_at ?? run?.created_at)}
          </Text>
          <Text className="text-xs font-instrument text-gray-500">
            Finished {formatDateTime(run?.finished_at)}
          </Text>
        </View>

        {(failedCampaigns.length > 0 || (run?.warning_count ?? 0) > 0) && (
          <View className="mt-4 border-t border-[#2A2A2A] pt-4">
            <Text className="text-sm font-instrument-medium text-white">Needs attention</Text>
            <View className="mt-3 gap-2">
              {failedCampaigns.slice(0, 3).map((campaign) => (
                <MigrationInlineNotice
                  key={`${campaign.name}-${campaign.error}`}
                  title={campaign.name}
                  body={campaign.error}
                  tone="danger"
                />
              ))}
              {failedCampaigns.length > 3 ? (
                <Text className="text-xs font-instrument text-gray-500">
                  +{formatCount(failedCampaigns.length - 3)} more failed campaigns
                </Text>
              ) : null}
              {(run?.warning_count ?? 0) > 0 ? (
                <MigrationInlineNotice
                  body={`${formatCount(run?.warning_count)} warnings were recorded for this run. Check the Activity tab if a campaign preview looks unexpected.`}
                  tone="warning"
                />
              ) : null}
            </View>
          </View>
        )}
      </View>

      {reviewCampaignOptions.length === 0 ? (
        <>
          <EmptyState
            title="No successful campaigns to inspect"
            description={
              failedCampaigns.length > 0
                ? 'This run finished without a successful migrated campaign to spot check.'
                : 'This run does not have any migrated campaigns available for review.'
            }
            className="py-8"
          />
          {runEvents.length > 0 ? (
            <View className="border-t border-[#2A2A2A] pt-4">
              <Text className="text-sm font-instrument-medium text-white">Recent activity</Text>
              <Text className="mt-1 text-xs font-instrument text-gray-400">
                This run has no successful campaigns to preview, so recent activity is shown below
                to help with debugging.
              </Text>
              <View className="mt-4">
                <ReviewEventList events={runEvents} />
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <View className="border-t border-[#2A2A2A] pt-4">
          <Select<ReviewCampaignOption>
            items={reviewCampaignOptions}
            getItemId={(campaign) => campaign.id}
            getItemLabel={(campaign) => ({
              primary: campaign.name,
              secondary: `${formatCount(campaign.leadsImported)} leads, ${formatCount(campaign.conversationsImported)} conversations`,
            })}
            value={selectedReviewCampaign?.id ?? null}
            onChange={onReviewCampaignChange}
            label="Campaign"
            placeholder="Select a migrated campaign"
            searchable={false}
            size="compact"
          />

          <Text className="mt-3 text-xs font-instrument text-gray-500">
            Preview rows reflect the current records in this campaign, which keeps historical review
            lightweight but not immutable.
          </Text>

          <View className="mt-4">
            <Tabs
              tabs={REVIEW_TABS}
              activeTab={activeReviewTab}
              onTabChange={(tabId) => onReviewTabChange(tabId as ReviewTabKey)}
              layout="equal"
            />
          </View>

          <View className="pt-1">
            {activeReviewTab === 'summary' ? renderSummaryTab() : null}
            {activeReviewTab === 'leads' ? renderLeadsTab() : null}
            {activeReviewTab === 'conversations' ? renderConversationsTab() : null}
            {activeReviewTab === 'activity' ? renderActivityTab() : null}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
