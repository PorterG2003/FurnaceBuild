import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Select } from '@/components/ui/forms/Select';
import { EmptyState } from '@/components/ui/feedback';
import { loadLeadActivityForMembership } from '@/lib/leads/activity/loadLeadActivity';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { LeadActivityTimeline } from './LeadActivityTimeline';
import { LeadDetailSection, useLeadDetailLayout } from './leadDetailLayout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';

export function LeadActivitySection({
  detail,
  defaultCampaignId,
}: {
  detail: AccountLeadDetail;
  defaultCampaignId?: string | null;
}) {
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader: isMobileDrill } = useLeadDetailMobilePage();
  const memberships = useMemo(
    () =>
      [...detail.person.memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [detail.person.memberships],
  );

  const campaignOptions = useMemo(
    () =>
      memberships.map((membership) => {
        const campaign = detail.campaigns.find((item) => item.id === membership.campaignId);
        return {
          id: membership.campaignId,
          name: campaign?.name ?? membership.campaignId,
        };
      }),
    [detail.campaigns, memberships],
  );

  const initialCampaignId =
    defaultCampaignId && memberships.some((m) => m.campaignId === defaultCampaignId)
      ? defaultCampaignId
      : memberships[0]?.campaignId ?? '';

  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaignId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof loadLeadActivityForMembership>>>([]);

  const selectedMembership = memberships.find((m) => m.campaignId === selectedCampaignId) ?? memberships[0];
  const replacementSummary = selectedMembership
    ? detail.replacementSummariesByLeadId[selectedMembership.id] ?? null
    : null;
  const useBorderedTimelineShell = loading || activities.length > 0;

  useEffect(() => {
    if (!selectedMembership) {
      setActivities([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const items = await loadLeadActivityForMembership(
          selectedMembership.id,
          selectedMembership.campaignId,
          replacementSummary,
        );
        if (!cancelled) {
          setActivities(items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load activity');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [replacementSummary, selectedMembership]);

  if (memberships.length === 0) {
    return (
      <LeadDetailSection title="Activity">
        <EmptyState
          title="No activity"
          description={
            isMobileDrill ? undefined : 'This person is not enrolled in any campaigns yet.'
          }
        />
      </LeadDetailSection>
    );
  }

  return (
    <LeadDetailSection title="Activity">
      {campaignOptions.length > 1 ? (
        <View className={isMobileDrill ? undefined : 'max-w-md'}>
          <Select
            label="Campaign"
            items={campaignOptions}
            getItemId={(item) => item.id}
            getItemLabel={(item) => ({ primary: item.name })}
            value={selectedCampaignId}
            onChange={(id) => setSelectedCampaignId(id)}
          />
        </View>
      ) : null}

      {isMobileDrill ? (
        <LeadActivityTimeline
          activities={activities}
          loading={loading}
          error={error}
          replacementSummary={replacementSummary}
          flat
        />
      ) : useBorderedTimelineShell ? (
        <View className={`rounded-xl border border-[#2A2A2A] bg-[#121212] ${isMobile ? 'px-4 py-4' : 'px-5 py-5'}`}>
          <LeadActivityTimeline
            activities={activities}
            loading={loading}
            error={error}
            replacementSummary={replacementSummary}
          />
        </View>
      ) : (
        <LeadActivityTimeline
          activities={activities}
          loading={loading}
          error={error}
          replacementSummary={replacementSummary}
        />
      )}
    </LeadDetailSection>
  );
}
