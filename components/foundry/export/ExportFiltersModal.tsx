import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import {
  DEFAULT_EXPORT_FILTERS,
  type ExportFiltersState,
  type ExportPresentationMode,
} from '@/components/foundry/export/exportFilterTypes';
import { ExportFiltersPanel } from '@/components/foundry/export/ExportFiltersPanel';

export function ExportFiltersModal({
  visible,
  onClose,
  mode,
  filters,
  onApply,
  onClearFilters,
}: {
  visible: boolean;
  onClose: () => void;
  mode: ExportPresentationMode;
  filters: ExportFiltersState;
  onApply: (next: ExportFiltersState) => void;
  onClearFilters: () => void;
}) {
  const [draft, setDraft] = useState<ExportFiltersState>(filters);

  useEffect(() => {
    if (visible) {
      setDraft(filters);
    }
  }, [filters, visible]);

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Export filters"
      description="Adjust the draft filters below, then apply them to refresh the export preview."
      maxWidth="lg"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button
            variant="secondary"
            onPress={() => {
              setDraft(DEFAULT_EXPORT_FILTERS);
              onClearFilters();
            }}
          >
            Clear
          </Button>
          <Button
            variant="default"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </Button>
        </View>
      }
    >
      <ExportFiltersPanel mode={mode} filters={draft} onChange={setDraft} showActions={false} />
    </BaseModal>
  );
}
