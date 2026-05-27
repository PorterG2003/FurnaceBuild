import { View } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { SearchAndSelectMulti } from '@/components/ui/forms';
import type {
  CampaignLeadEnrollmentFilterValue,
  CampaignLeadReplyCategoryFilterValue,
} from '@/lib/supabase/services/leads';

export interface CampaignLeadFilters {
  enrollmentStates: CampaignLeadEnrollmentFilterValue[];
  replyCategories: CampaignLeadReplyCategoryFilterValue[];
}

export const EMPTY_CAMPAIGN_LEAD_FILTERS: CampaignLeadFilters = {
  enrollmentStates: [],
  replyCategories: [],
};

const ENROLLMENT_OPTIONS: Array<{ value: CampaignLeadEnrollmentFilterValue; label: string }> = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'active', label: 'In Progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'completed', label: 'Completed' },
];

const REPLY_CATEGORY_OPTIONS: Array<{ value: CampaignLeadReplyCategoryFilterValue; label: string }> = [
  { value: 'Interested', label: 'Interested' },
  { value: 'Neutral', label: 'Neutral' },
  { value: 'Not Interested', label: 'Not Interested' },
  { value: 'not_categorized', label: 'Not Categorized' },
];

export function countActiveCampaignLeadFilters(filters: CampaignLeadFilters): number {
  return (
    (filters.enrollmentStates.length > 0 ? 1 : 0) +
    (filters.replyCategories.length > 0 ? 1 : 0)
  );
}

export function CampaignLeadFiltersModal({
  visible,
  filters,
  onChange,
  onClose,
  onClear,
}: {
  visible: boolean;
  filters: CampaignLeadFilters;
  onChange: (filters: CampaignLeadFilters) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Lead filters"
      description="Choose enrollment and reply category. Empty means all values in that group."
      maxWidth="lg"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button variant="secondary" onPress={onClear}>
            Clear filters
          </Button>
          <Button variant="default" onPress={onClose}>
            Done
          </Button>
        </View>
      }
    >
      <SearchAndSelectMulti
        label="Enrollment"
        items={ENROLLMENT_OPTIONS}
        getItemId={(o) => o.value}
        getItemLabel={(o) => o.label}
        value={filters.enrollmentStates}
        onChange={(ids) =>
          onChange({ ...filters, enrollmentStates: ids as CampaignLeadEnrollmentFilterValue[] })
        }
        placeholder="All enrollment states"
        listMaxHeight={220}
      />
      <SearchAndSelectMulti
        label="Reply category"
        items={REPLY_CATEGORY_OPTIONS}
        getItemId={(o) => o.value}
        getItemLabel={(o) => o.label}
        value={filters.replyCategories}
        onChange={(ids) =>
          onChange({ ...filters, replyCategories: ids as CampaignLeadReplyCategoryFilterValue[] })
        }
        placeholder="All reply categories"
        listMaxHeight={200}
      />
    </BaseModal>
  );
}
