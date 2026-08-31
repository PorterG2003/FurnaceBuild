import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { SearchAndSelectMulti } from '@/components/ui/forms';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import { resolveTagColor } from '@/lib/tags/tag-colors';
import type { CampaignListSummary } from '@/lib/supabase/services/campaigns';
import type { CampaignListFilters } from '@/components/campaigns/CampaignListFilterBar';

const STATUS_OPTIONS: Array<{ value: CampaignListSummary['status']; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'stopped', label: 'Stopped' },
];

export interface CampaignListFiltersModalProps {
  visible: boolean;
  filters: CampaignListFilters;
  accountTags: CampaignTag[];
  onApply: (filters: CampaignListFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

export function CampaignListFiltersModal({
  visible,
  filters,
  accountTags,
  onApply,
  onClear,
  onClose,
}: CampaignListFiltersModalProps) {
  const [draft, setDraft] = useState<CampaignListFilters>(filters);

  useEffect(() => {
    if (visible) {
      setDraft(filters);
    }
  }, [filters, visible]);

  const footer = useMemo(
    () => (
      <ModalFooter>
        <Button variant="secondary" onPress={onClear}>
          Clear filters
        </Button>
        <Button
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply filters
        </Button>
      </ModalFooter>
    ),
    [draft, onApply, onClose, onClear],
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Campaign filters"
      description="Filter by status or tags. Empty multi-selects mean all values in that group."
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-5">
        <SearchAndSelectMulti
          label="Status"
          items={STATUS_OPTIONS}
          getItemId={(item) => item.value}
          getItemLabel={(item) => item.label}
          value={draft.statuses}
          onChange={(statuses) =>
            setDraft((current) => ({
              ...current,
              statuses: statuses as CampaignListSummary['status'][],
            }))
          }
          placeholder="All statuses"
          listMaxHeight={200}
        />

        <SearchAndSelectMulti
          label="Campaign tags"
          items={accountTags}
          getItemId={(tag) => tag.id}
          getItemLabel={(tag) => tag.name}
          getItemColor={(tag) => resolveTagColor(tag.color)}
          value={draft.tagIds}
          onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds }))}
          placeholder="All campaign tags"
          searchPlaceholder="Search campaign tags…"
          listMaxHeight={200}
          emptyMessage={(hasSearch) =>
            hasSearch ? 'No matching campaign tags.' : 'No campaign tags yet.'
          }
        />
      </View>
    </BaseModal>
  );
}
