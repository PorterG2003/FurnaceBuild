import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { ClockIcon, PauseIcon, PlayIcon } from 'react-native-heroicons/outline';
import { openAppRoute } from '@/lib/navigation/openAppRoute';
import { SmartleadBadge } from '@/components/campaigns';
import { LeadActivityModal } from '@/components/campaigns/LeadActivityModal';
import { EmptyState, useToast } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { RowOverflowMenu, type RowOverflowMenuItem } from '@/components/ui/RowOverflowMenu';
import type { AccountLeadDetail } from '@/lib/leads/types';
import type { MockMembership } from '@/lib/devtools/leads-workbench/types';
import { pauseEnrollmentsForLeads } from '@/lib/supabase/services/leads/pause-enrollments';
import { resumeEnrollmentsForLeads } from '@/lib/supabase/services/leads/resume-enrollments';
import {
  LeadDetailListRow,
  LeadDetailListShell,
  LeadDetailSection,
} from './leadDetailLayout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';

function enrollmentLabel(state: MockMembership['enrollmentState']) {
  switch (state) {
    case 'active':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    case 'stopped':
      return 'Stopped';
    case 'paused':
      return 'Paused';
    case 'not_started':
    default:
      return 'Not Started';
  }
}

function enrollmentColors(state: MockMembership['enrollmentState']) {
  switch (state) {
    case 'active':
      return { bg: '#3b82f620', text: '#3b82f6' };
    case 'completed':
      return { bg: '#10b98120', text: '#10b981' };
    case 'stopped':
      return { bg: '#f59e0b20', text: '#f59e0b' };
    case 'paused':
      return { bg: '#8b5cf620', text: '#8b5cf6' };
    default:
      return { bg: '#6b728020', text: '#9ca3af' };
  }
}

function LeadCampaignMembershipActions({
  campaignName,
  canPause,
  canResume,
  isBusy,
  isMobileDrill,
  onPause,
  onResume,
  onActivity,
}: {
  campaignName: string;
  canPause: boolean;
  canResume: boolean;
  isBusy: boolean;
  isMobileDrill: boolean;
  onPause: () => void;
  onResume: () => void;
  onActivity: () => void;
}) {
  const menuItems = useMemo((): RowOverflowMenuItem[] => {
    const items: RowOverflowMenuItem[] = [];
    if (canPause) {
      items.push({
        key: 'pause',
        label: 'Pause Lead',
        icon: PauseIcon,
        onPress: onPause,
      });
    }
    if (canResume) {
      items.push({
        key: 'resume',
        label: 'Resume Lead',
        icon: PlayIcon,
        onPress: onResume,
      });
    }
    items.push({
      key: 'activity',
      label: 'Activity',
      icon: ClockIcon,
      onPress: onActivity,
    });
    return items;
  }, [canPause, canResume, onActivity, onPause, onResume]);

  if (isMobileDrill) {
    return (
      <RowOverflowMenu
        items={menuItems}
        disabled={isBusy}
        sheetTitle={campaignName}
        horizontalAlign="end"
        triggerAccessibilityLabel="Campaign membership actions"
      />
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2 justify-end">
      {canPause ? (
        <Button variant="secondary" size="sm" disabled={isBusy} onPress={onPause}>
          Pause Lead
        </Button>
      ) : null}
      {canResume ? (
        <Button variant="secondary" size="sm" disabled={isBusy} onPress={onResume}>
          Resume Lead
        </Button>
      ) : null}
      <Button variant="secondary" size="sm" onPress={onActivity}>
        Activity
      </Button>
    </View>
  );
}

export function LeadCampaignsSection({
  accountId,
  detail,
  highlightCampaignId,
  onMembershipChanged,
}: {
  accountId: string;
  detail: AccountLeadDetail;
  highlightCampaignId?: string | null;
  onMembershipChanged?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { suppressSectionHeader: isMobileDrill } = useLeadDetailMobilePage();
  const [activityLead, setActivityLead] = useState<{
    leadId: string;
    campaignId: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);

  const handleMembershipAction = useCallback(
    async (membership: MockMembership, action: 'pause' | 'resume') => {
      if (!accountId || !detail.person.globalLeadId) return;
      setBusyMembershipId(membership.id);
      try {
        if (action === 'pause') {
          const result = await pauseEnrollmentsForLeads(
            accountId,
            membership.campaignId,
            [detail.person.globalLeadId],
          );
          if (result.paused > 0) {
            toast.success('Membership paused.');
            onMembershipChanged?.();
          } else if (result.skipped > 0) {
            toast.info('No change — membership was already in the target state or not eligible.');
          } else {
            toast.warning('Could not pause membership.');
          }
        } else {
          const result = await resumeEnrollmentsForLeads(
            accountId,
            membership.campaignId,
            [detail.person.globalLeadId],
          );
          if (result.resumed > 0) {
            toast.success('Membership resumed.');
            onMembershipChanged?.();
          } else if (result.skipped > 0) {
            toast.info('No change — membership was already in the target state or not eligible.');
          } else {
            toast.warning('Could not resume membership.');
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setBusyMembershipId(null);
      }
    },
    [accountId, detail.person.globalLeadId, onMembershipChanged, toast],
  );

  const campaignNameById = useMemo(
    () => new Map(detail.campaigns.map((campaign) => [campaign.id, campaign.name])),
    [detail.campaigns],
  );
  const smartleadByCampaignId = useMemo(
    () => new Map(detail.campaigns.map((campaign) => [campaign.id, campaign.isSmartlead])),
    [detail.campaigns],
  );

  const memberships = useMemo(
    () =>
      [...detail.person.memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [detail.person.memberships],
  );

  if (memberships.length === 0) {
    return (
      <LeadDetailSection title="Campaigns">
        <EmptyState
          title="No campaign memberships"
          description={isMobileDrill ? undefined : 'This person is not enrolled in any campaigns yet.'}
        />
      </LeadDetailSection>
    );
  }

  return (
    <LeadDetailSection title="Campaigns">
      <LeadDetailListShell>
        {memberships.map((membership, index) => {
          const campaignName = campaignNameById.get(membership.campaignId) ?? 'Unknown campaign';
          const isHighlighted = highlightCampaignId === membership.campaignId;
          const replacement = detail.replacementSummariesByLeadId[membership.id] ?? null;
          const colors = enrollmentColors(membership.enrollmentState);
          const isSmartlead = smartleadByCampaignId.get(membership.campaignId);
          const canPause = !isSmartlead && membership.enrollmentState === 'active';
          const canResume = !isSmartlead && membership.enrollmentState === 'paused';
          const isBusy = busyMembershipId === membership.id;

          return (
            <LeadDetailListRow
              key={membership.id}
              highlighted={isHighlighted}
              isLast={index === memberships.length - 1}
            >
              <View className="flex-row items-start justify-between gap-3">
                <Pressable
                  className="flex-1 min-w-0 gap-2"
                  onPress={() =>
                    openAppRoute(router, `/campaigns/${membership.campaignId}`, { newTab: true })
                  }
                >
                  <Text className="text-white font-instrument-semibold text-base" numberOfLines={1}>
                    {campaignName}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-2">
                    {smartleadByCampaignId.get(membership.campaignId) ? <SmartleadBadge /> : null}
                    <View className="px-2.5 py-1 rounded-md" style={{ backgroundColor: colors.bg }}>
                      <Text className="text-xs font-instrument-semibold" style={{ color: colors.text }}>
                        {enrollmentLabel(membership.enrollmentState)}
                      </Text>
                    </View>
                    {membership.replyCategory ? (
                      <View className="px-2.5 py-1 rounded-md bg-[#34D39922]">
                        <Text className="text-xs font-instrument-semibold text-[#34D399]">
                          {membership.replyCategory}
                        </Text>
                      </View>
                    ) : membership.hasReply ? (
                      <Text className="text-xs text-[#34D399] font-instrument-semibold">Replied</Text>
                    ) : null}
                  </View>
                </Pressable>
                <LeadCampaignMembershipActions
                  campaignName={campaignName}
                  canPause={canPause}
                  canResume={canResume}
                  isBusy={isBusy}
                  isMobileDrill={isMobileDrill}
                  onPause={() => void handleMembershipAction(membership, 'pause')}
                  onResume={() => void handleMembershipAction(membership, 'resume')}
                  onActivity={() =>
                    setActivityLead({
                      leadId: membership.id,
                      campaignId: membership.campaignId,
                      email: detail.person.email,
                      name: detail.person.displayName,
                    })
                  }
                />
              </View>

              {isMobileDrill ? (
                membership.companyName ? (
                  <Text className="text-sm text-gray-400 font-instrument">{membership.companyName}</Text>
                ) : null
              ) : (
                <View className="gap-1">
                  {membership.companyName ? (
                    <Text className="text-sm text-gray-400 font-instrument">{membership.companyName}</Text>
                  ) : null}
                  <Text className="text-xs text-gray-500 font-instrument">
                    Added {format(new Date(membership.createdAt), 'MMM d, yyyy')}
                    {membership.lastActivityAt
                      ? ` · Last activity ${format(new Date(membership.lastActivityAt), 'MMM d, yyyy')}`
                      : ''}
                  </Text>
                </View>
              )}

              {replacement ? (
                <View className="rounded-lg border border-[#F9731640] bg-[#F9731612] px-3 py-2">
                  <Text className="text-xs font-instrument-medium text-[#FDBA74]">
                    {replacement.role === 'new'
                      ? `Replaces ${replacement.counterpartLabel || replacement.counterpartEmail || 'previous lead'}`
                      : `Replaced by ${replacement.counterpartLabel || replacement.counterpartEmail || 'new lead'}`}
                  </Text>
                </View>
              ) : null}
            </LeadDetailListRow>
          );
        })}
      </LeadDetailListShell>

      {activityLead ? (
        <LeadActivityModal
          visible
          onClose={() => setActivityLead(null)}
          leadId={activityLead.leadId}
          campaignId={activityLead.campaignId}
          leadEmail={activityLead.email}
          leadName={activityLead.name}
          replacementSummary={detail.replacementSummariesByLeadId[activityLead.leadId] ?? null}
        />
      ) : null}
    </LeadDetailSection>
  );
}
