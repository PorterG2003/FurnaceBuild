import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms/Select';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import {
  billingFilters,
  countActiveAccountManagementFilters,
  lifecycleFilters,
  type AccountManagementBillingFilter,
  type AccountManagementLifecycleFilter,
} from './accountManagementFilters';

export type { AccountManagementBillingFilter, AccountManagementLifecycleFilter };
export { countActiveAccountManagementFilters };

export function AccountManagementFiltersModal({
  visible,
  lifecycle,
  billing,
  onApply,
  onClose,
}: {
  visible: boolean;
  lifecycle: AccountManagementLifecycleFilter;
  billing: AccountManagementBillingFilter;
  onApply: (filters: {
    lifecycle: AccountManagementLifecycleFilter;
    billing: AccountManagementBillingFilter;
  }) => void;
  onClose: () => void;
}) {
  const [draftLifecycle, setDraftLifecycle] = useState<AccountManagementLifecycleFilter>(lifecycle);
  const [draftBilling, setDraftBilling] = useState<AccountManagementBillingFilter>(billing);

  useEffect(() => {
    if (visible) {
      setDraftLifecycle(lifecycle);
      setDraftBilling(billing);
    }
  }, [billing, lifecycle, visible]);

  const footer = (
    <ModalFooter>
      <Button
        variant="secondary"
        onPress={() => {
          setDraftLifecycle('all');
          setDraftBilling('all');
        }}
      >
        Clear filters
      </Button>
      <Button
        onPress={() => {
          onApply({ lifecycle: draftLifecycle, billing: draftBilling });
          onClose();
        }}
      >
        Apply filters
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Account filters"
      description="Filter account management rows by lifecycle status and billing status."
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-5">
        <Select
          label="Lifecycle"
          items={lifecycleFilters}
          value={draftLifecycle}
          searchable={false}
          variant="solid"
          placeholder="Active pipeline"
          getItemId={(item) => item.id}
          getItemLabel={(item) => ({ primary: item.label })}
          onChange={(id) => setDraftLifecycle(id as AccountManagementLifecycleFilter)}
        />

        <Select
          label="Billing"
          items={billingFilters}
          value={draftBilling}
          searchable={false}
          variant="solid"
          placeholder="All billing"
          getItemId={(item) => item.id}
          getItemLabel={(item) => ({ primary: item.label })}
          onChange={(id) => setDraftBilling(id as AccountManagementBillingFilter)}
        />
      </View>
    </BaseModal>
  );
}
