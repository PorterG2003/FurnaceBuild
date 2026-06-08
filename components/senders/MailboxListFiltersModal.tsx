import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SearchAndSelectMulti } from '@/components/ui/forms';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import type { MailboxTag } from '@/lib/supabase/services/mailbox-tags';
import { resolveTagColor } from '@/lib/tags/tag-colors';
import type { MailboxListFilters } from './MailboxListFilterBar';

export interface MailboxListFiltersModalProps {
  visible: boolean;
  filters: MailboxListFilters;
  accountTags: MailboxTag[];
  onApply: (filters: MailboxListFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

export function MailboxListFiltersModal({
  visible,
  filters,
  accountTags,
  onApply,
  onClear,
  onClose,
}: MailboxListFiltersModalProps) {
  const [draft, setDraft] = useState<MailboxListFilters>(filters);

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
      title="Mailbox filters"
      description="Filter by tags. Empty multi-selects mean all values in that group."
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-5">
        <SearchAndSelectMulti
          label="Mailbox tags"
          items={accountTags}
          getItemId={(tag) => tag.id}
          getItemLabel={(tag) => tag.name}
          getItemColor={(tag) => resolveTagColor(tag.color)}
          value={draft.tagIds}
          onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds }))}
          placeholder="All mailbox tags"
          searchPlaceholder="Search mailbox tags…"
          listMaxHeight={200}
          emptyMessage={(hasSearch) =>
            hasSearch ? 'No matching mailbox tags.' : 'No mailbox tags yet.'
          }
        />
      </View>
    </BaseModal>
  );
}
