import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms/Select';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import type { PlatformInvitationLifecycleStatus } from '@/lib/supabase/services/platform';

const lifecycleFilters: Array<{ id: 'all' | PlatformInvitationLifecycleStatus | 'active'; label: string }> = [
  { id: 'all', label: 'All statuses' },
  { id: 'draft', label: 'Draft' },
  { id: 'approved', label: 'Approved' },
  { id: 'sent', label: 'Sent' },
  { id: 'pending_payment', label: 'Pending payment' },
  { id: 'active', label: 'Active' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'expired', label: 'Expired' },
];

const billingFilters = [
  { id: 'all', label: 'All billing' },
  { id: 'active', label: 'Active' },
  { id: 'payment_required', label: 'Payment required' },
  { id: 'canceled', label: 'Canceled' },
  { id: 'none', label: 'No billing' },
] as const;

export type AccountManagementLifecycleFilter = (typeof lifecycleFilters)[number]['id'];
export type AccountManagementBillingFilter = (typeof billingFilters)[number]['id'];

export function countActiveAccountManagementFilters(params: {
  lifecycle: AccountManagementLifecycleFilter;
  billing: AccountManagementBillingFilter;
}) {
  return (params.lifecycle !== 'all' ? 1 : 0) + (params.billing !== 'all' ? 1 : 0);
}

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
          placeholder="All statuses"
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
