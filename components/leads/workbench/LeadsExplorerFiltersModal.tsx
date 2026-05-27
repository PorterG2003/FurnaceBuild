import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { SearchAndSelectMulti } from '@/components/ui/forms';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import { resolveTagColor } from '@/lib/tags/tag-colors';
import type {
  LeadsListFilters,
  LeadsReplyStatusFilter,
  MockCampaign,
  MockEnrollmentState,
  MockReplyCategory,
} from '@/lib/devtools/leads-workbench/types';

export const EMPTY_EXPLORER_FILTERS: LeadsListFilters = {
  replyStatuses: [],
  campaignIds: [],
  campaignTagIds: [],
  enrollmentStates: [],
  replyCategories: [],
};

export interface LeadsExplorerFiltersModalProps {
  visible: boolean;
  filters: LeadsListFilters;
  campaigns: MockCampaign[];
  accountCampaignTags: CampaignTag[];
  onApply: (filters: LeadsListFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

const REPLY_STATUS_OPTIONS: Array<{ value: LeadsReplyStatusFilter; label: string }> = [
  { value: 'has_reply', label: 'Has replied' },
  { value: 'no_reply', label: 'Has not replied' },
];

const ENROLLMENT_OPTIONS: Array<{ value: MockEnrollmentState; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'active', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'completed', label: 'Completed' },
];

type ReplyCategoryFilterValue = NonNullable<MockReplyCategory> | 'not_categorized';

const REPLY_CATEGORY_OPTIONS: Array<{ value: ReplyCategoryFilterValue; label: string }> = [
  { value: 'Interested', label: 'Interested' },
  { value: 'Neutral', label: 'Neutral' },
  { value: 'Not Interested', label: 'Not interested' },
  { value: 'not_categorized', label: 'Not categorized' },
];

export function countActiveExplorerFilters(filters: LeadsListFilters): number {
  const replyStatuses = filters.replyStatuses ?? (filters.requireReply ? ['has_reply'] : []);
  const enrollmentStates = filters.enrollmentStates ?? filters.statuses ?? [];
  return (
    (replyStatuses.length > 0 ? 1 : 0) +
    ((filters.campaignIds?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.campaignTagIds?.length ?? 0) > 0 ? 1 : 0) +
    (enrollmentStates.length > 0 ? 1 : 0) +
    ((filters.replyCategories?.length ?? 0) > 0 ? 1 : 0)
  );
}

export function LeadsExplorerFiltersModal({
  visible,
  filters,
  campaigns,
  accountCampaignTags,
  onApply,
  onClear,
  onClose,
}: LeadsExplorerFiltersModalProps) {
  const [draft, setDraft] = useState<LeadsListFilters>(filters);

  useEffect(() => {
    if (visible) {
      setDraft({
        ...filters,
        replyStatuses: filters.replyStatuses ?? (filters.requireReply ? ['has_reply'] : []),
        enrollmentStates: filters.enrollmentStates ?? filters.statuses ?? [],
      });
    }
  }, [filters, visible]);

  const campaignOptions = useMemo(
    () => campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
    [campaigns]
  );

  const footer = useMemo(
    () => (
      <ModalFooter>
        <Button variant="secondary" onPress={onClear}>
          Clear filters
        </Button>
        <Button
          onPress={() => {
            onApply({
              ...draft,
              requireReply: undefined,
              statuses: undefined,
            });
            onClose();
          }}
        >
          Apply filters
        </Button>
      </ModalFooter>
    ),
    [draft, onApply, onClose, onClear]
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Lead filters"
      description="Choose campaign membership criteria. Empty multi-selects mean all values in that group."
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-5">
        <SearchAndSelectMulti
          label="Reply status"
          items={REPLY_STATUS_OPTIONS}
          getItemId={(item) => item.value}
          getItemLabel={(item) => item.label}
          value={draft.replyStatuses ?? []}
          onChange={(ids) =>
            setDraft((current) => ({ ...current, replyStatuses: ids as LeadsReplyStatusFilter[] }))
          }
          placeholder="All"
          listMaxHeight={160}
        />

        <SearchAndSelectMulti
          label="Campaigns"
          items={campaignOptions}
          getItemId={(item) => item.value}
          getItemLabel={(item) => item.label}
          value={draft.campaignIds ?? []}
          onChange={(ids) => setDraft((current) => ({ ...current, campaignIds: ids }))}
          placeholder="All campaigns"
          listMaxHeight={280}
        />

        <SearchAndSelectMulti
          label="Campaign tags"
          items={accountCampaignTags}
          getItemId={(tag) => tag.id}
          getItemLabel={(tag) => tag.name}
          getItemColor={(tag) => resolveTagColor(tag.color)}
          value={draft.campaignTagIds ?? []}
          onChange={(ids) => setDraft((current) => ({ ...current, campaignTagIds: ids }))}
          placeholder="All campaign tags"
          searchPlaceholder="Search campaign tags…"
          listMaxHeight={200}
          emptyMessage={(hasSearch) =>
            hasSearch ? 'No matching campaign tags.' : 'No campaign tags yet.'
          }
        />

        <SearchAndSelectMulti
          label="Enrollment"
          items={ENROLLMENT_OPTIONS}
          getItemId={(item) => item.value}
          getItemLabel={(item) => item.label}
          value={draft.enrollmentStates ?? draft.statuses ?? []}
          onChange={(ids) =>
            setDraft((current) => ({ ...current, enrollmentStates: ids as MockEnrollmentState[] }))
          }
          placeholder="All enrollment states"
          listMaxHeight={240}
        />

        <SearchAndSelectMulti
          label="Reply category"
          items={REPLY_CATEGORY_OPTIONS}
          getItemId={(item) => item.value}
          getItemLabel={(item) => item.label}
          value={draft.replyCategories ?? []}
          onChange={(ids) =>
            setDraft((current) => ({
              ...current,
              replyCategories: ids as ReplyCategoryFilterValue[],
            }))
          }
          placeholder="All reply categories"
          listMaxHeight={200}
        />
      </View>
    </BaseModal>
  );
}
