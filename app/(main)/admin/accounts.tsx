import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { FunnelIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { EyeIcon, DocumentDuplicateIcon } from 'react-native-heroicons/outline';
import { DataTable, type TableColumn, TableHeaderLabel } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { EmptyState, Alert, LoadingState, useToast } from '@/components/ui/feedback';
import { Breadcrumb, PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { RowOverflowMenu } from '@/components/ui/RowOverflowMenu';
import {
  listPlatformAccountManagementRecords,
  type PlatformAccountManagementRecord,
} from '@/lib/supabase/services/platform';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { ClientLinkPill, StatusBadge, formatUsd } from '@/components/platform/admin/shared';
import { isProposalPlanTier } from '@/lib/platform/contract/proposalPlans';
import {
  AccountManagementFiltersModal,
  countActiveAccountManagementFilters,
  type AccountManagementBillingFilter,
  type AccountManagementLifecycleFilter,
} from '@/components/platform/admin/AccountManagementFiltersModal';
import { matchesAccountManagementLifecycleFilter } from '@/components/platform/admin/accountManagementFilters';

function formatTimestamp(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInviteUrl(invitationId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
  return `${origin}/accept-platform-invite/${invitationId}`;
}

export default function AccountManagementPage() {
  const access = usePlatformAdminAccess();
  const { toast } = useToast();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PlatformAccountManagementRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedLifecycleFilter, setSelectedLifecycleFilter] =
    useState<AccountManagementLifecycleFilter>('all');
  const [selectedBillingFilter, setSelectedBillingFilter] =
    useState<AccountManagementBillingFilter>('all');

  const loadRecords = async () => {
    setLoading(true);
    try {
      setRecords(await listPlatformAccountManagementRecords());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load account management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (access === 'allowed') {
      void loadRecords();
    }
  }, [access]);

  const filteredRecords = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesSearch =
        !searchValue ||
        record.display_name.toLowerCase().includes(searchValue) ||
        (record.primary_email ?? '').toLowerCase().includes(searchValue);
      const matchesLifecycle = matchesAccountManagementLifecycleFilter(
        record.lifecycle_status,
        selectedLifecycleFilter,
        record,
      );
      const billingValue = record.billing_status ?? 'none';
      const matchesBilling =
        selectedBillingFilter === 'all' || billingValue === selectedBillingFilter;
      return matchesSearch && matchesLifecycle && matchesBilling;
    });
  }, [records, search, selectedLifecycleFilter, selectedBillingFilter]);

  const activeFilterCount = useMemo(
    () =>
      countActiveAccountManagementFilters({
        lifecycle: selectedLifecycleFilter,
        billing: selectedBillingFilter,
      }),
    [selectedBillingFilter, selectedLifecycleFilter],
  );

  const columns = useMemo<Array<TableColumn<PlatformAccountManagementRecord>>>(
    () => [
      {
        key: 'name',
        label: <TableHeaderLabel>Name</TableHeaderLabel>,
        minWidth: 220,
        flex: 2,
        render: (record) => (
          <View className="min-w-0 gap-1">
            <Text className="text-white font-instrument-medium" numberOfLines={1}>
              {record.display_name}
            </Text>
            {record.primary_email ? (
              <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                {record.primary_email}
              </Text>
            ) : null}
            {record.account_id ? (
              <View className="flex-row flex-wrap gap-1 mt-1">
                {record.has_pending_terms ? (
                  <ClientLinkPill label="Pending terms" tone="drift" />
                ) : null}
                {record.has_amendment_draft ? (
                  <ClientLinkPill label="Draft amendment" tone="offline" />
                ) : null}
                {record.billing_status === 'payment_required' ? (
                  <ClientLinkPill label="Payment required" tone="drift" />
                ) : null}
                {record.has_scheduled_downgrade ? (
                  <ClientLinkPill label="Scheduled downgrade" tone="offline" />
                ) : null}
                {record.plan_tier && isProposalPlanTier(record.plan_tier) ? (
                  <ClientLinkPill label={record.plan_tier} tone="live" />
                ) : record.agreement_type === 'platform_agreement' ? (
                  <ClientLinkPill label="Platform Access" tone="live" />
                ) : null}
              </View>
            ) : null}
          </View>
        ),
      },
      {
        key: 'status',
        label: <TableHeaderLabel>Status</TableHeaderLabel>,
        minWidth: 130,
        render: (record) => <StatusBadge status={record.lifecycle_status} />,
      },
      {
        key: 'retainer',
        label: <TableHeaderLabel>Retainer</TableHeaderLabel>,
        minWidth: 120,
        render: (record) => (
          <Text className="text-gray-200 font-instrument">
            {record.monthly_retainer_cents ? formatUsd(record.monthly_retainer_cents) : '-'}
          </Text>
        ),
      },
      {
        key: 'revision',
        label: <TableHeaderLabel>Revision</TableHeaderLabel>,
        minWidth: 180,
        flex: 1.3,
        render: (record) => (
          <Text className="text-gray-300 font-instrument text-sm" numberOfLines={2}>
            {record.revision_state ?? 'Legacy account'}
          </Text>
        ),
      },
      {
        key: 'billing',
        label: <TableHeaderLabel>Billing</TableHeaderLabel>,
        minWidth: 150,
        render: (record) =>
          record.billing_status ? (
            <StatusBadge
              status={record.billing_status}
              label={record.billing_status.replace(/_/g, ' ')}
            />
          ) : (
            <Text className="text-gray-500 font-instrument text-sm">No billing</Text>
          ),
      },
      {
        key: 'updated',
        label: <TableHeaderLabel>Updated</TableHeaderLabel>,
        minWidth: 120,
        render: (record) => (
          <Text className="text-gray-400 font-instrument text-sm">
            {formatTimestamp(record.updated_at)}
          </Text>
        ),
      },
      {
        key: 'actions',
        label: <TableHeaderLabel>Actions</TableHeaderLabel>,
        minWidth: 92,
        align: 'end',
        render: (record) => (
          <RowOverflowMenu
            items={[
              {
                key: 'view',
                label: 'View details',
                onPress: () =>
                  router.push({
                    pathname: '/admin/accounts/[id]',
                    params: { id: record.record_id, kind: record.record_kind },
                  }),
                icon: EyeIcon,
              },
              ...(record.account_id
                ? [
                    {
                      key: 'manage-contract',
                      label: 'Manage contract & billing',
                      onPress: () =>
                        router.push({
                          pathname: '/admin/accounts/sign-account-amendment',
                          params: { accountId: record.account_id },
                        }),
                      icon: EyeIcon,
                    },
                  ]
                : []),
              ...(record.record_kind === 'invitation' && record.invitation_id
                ? [
                    {
                      key: 'copy-link',
                      label: 'Copy invite link',
                      onPress: async () => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          await navigator.clipboard.writeText(getInviteUrl(record.invitation_id!));
                          toast.success('Invite link copied.');
                        } else {
                          toast.info('Clipboard is only available on web.');
                        }
                      },
                      icon: DocumentDuplicateIcon,
                    },
                  ]
                : []),
            ]}
            sheetTitle={record.display_name}
          />
        ),
      },
    ],
    [router, toast],
  );

  if (access === 'loading' || loading) {
    return (
      <PageLayout>
        <LoadingState message="Loading account management..." />
      </PageLayout>
    );
  }

  if (access !== 'allowed') {
    return (
      <PageLayout>
        <Alert variant="error" message="You do not have access to admin tools." />
      </PageLayout>
    );
  }

  const primaryAction = (
    <Button
      onPress={() => router.push('/admin/accounts/sign-new-client')}
    >
      Sign New Client
    </Button>
  );

  return (
    <PageLayout>
      {!isMobile ? (
        <View className="mb-4">
          <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Account Management' }]} />
        </View>
      ) : null}
      <PageHeader
        title="Account Management"
        subtitle="Track draft deals, sent invites, and active client accounts from one admin surface."
        primaryAction={!isMobile ? primaryAction : undefined}
      />

      {isMobile ? (
        <View className="mb-6">
          <Button onPress={() => router.push('/admin/accounts/sign-new-client')} fullWidth>
            Sign New Client
          </Button>
        </View>
      ) : null}

      <View className="gap-3">
        <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
          <View
            className="flex-1 flex-row items-center rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2.5"
            style={{ borderWidth: 1, minWidth: 0 }}
          >
            <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by account name or invite email"
              placeholderTextColor="#6B7280"
              className="flex-1 py-0 text-base font-instrument text-white"
              style={{ minHeight: 24 }}
            />
          </View>
          <View className="relative" style={{ flexShrink: 0 }}>
            <IconButton
              icon={FunnelIcon}
              variant="secondary"
              size="sm"
              matchButtonPadding="sm"
              className="!h-11 !w-11 !border-[#2A2A2A] !bg-[#1A1A1A]"
              accessibilityLabel="Account filters"
              onPress={() => setFiltersOpen(true)}
            />
            {activeFilterCount > 0 ? (
              <View className="absolute -right-1 -top-1 min-h-[18px] min-w-[18px] items-center justify-center rounded-full border border-[#1A1A1A] bg-brand-orange px-1">
                <Text className="text-[10px] leading-none font-instrument-semibold text-white">
                  {activeFilterCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {filteredRecords.length === 0 ? (
          <EmptyState
            title="No matching accounts"
            description="Try a different search or filter, use the Revoked or Expired lifecycle filters to view archived invites, or sign a new client to create a draft."
            action={
              <Button onPress={() => router.push('/admin/accounts/sign-new-client')}>
                Sign New Client
              </Button>
            }
          />
        ) : isMobile ? (
          <View className="gap-3">
            {filteredRecords.map((record) => (
              <View
                key={`${record.record_kind}-${record.record_id}`}
                className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4 gap-3"
              >
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/admin/accounts/[id]',
                      params: { id: record.record_id, kind: record.record_kind },
                    })
                  }
                  className="active:opacity-80"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-base font-instrument-medium text-white">
                        {record.display_name}
                      </Text>
                      {record.primary_email ? (
                        <Text className="mt-1 text-sm font-instrument text-gray-400">
                          {record.primary_email}
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge status={record.lifecycle_status} />
                  </View>

                  <View className="mt-4 gap-2">
                    <Text className="text-sm font-instrument text-gray-300">
                      Retainer:{' '}
                      {record.monthly_retainer_cents
                        ? formatUsd(record.monthly_retainer_cents)
                        : '-'}
                    </Text>
                    <Text className="text-sm font-instrument text-gray-400">
                      {record.revision_state ?? 'Legacy account'}
                    </Text>
                    <Text className="text-xs font-instrument text-gray-500">
                      Updated {formatTimestamp(record.updated_at)}
                    </Text>
                  </View>
                </Pressable>
                {record.account_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onPress={() =>
                      router.push({
                        pathname: '/admin/accounts/sign-account-amendment',
                        params: { accountId: record.account_id! },
                      })
                    }
                  >
                    Manage contract & billing
                  </Button>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <DataTable
            items={filteredRecords}
            columns={columns}
            getItemKey={(record) => `${record.record_kind}-${record.record_id}`}
            onRowPress={(record) =>
              router.push({
                pathname: '/admin/accounts/[id]',
                params: { id: record.record_id, kind: record.record_kind },
              })
            }
            pagination={false}
            widthMode="weighted-fill"
          />
        )}
      </View>

      <AccountManagementFiltersModal
        visible={filtersOpen}
        lifecycle={selectedLifecycleFilter}
        billing={selectedBillingFilter}
        onApply={({ lifecycle, billing }) => {
          setSelectedLifecycleFilter(lifecycle);
          setSelectedBillingFilter(billing);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </PageLayout>
  );
}
