import { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { EmptyState, LoadingState } from '@/components/ui/feedback';
import type { WebhookDeliveryRow } from '@/hooks/useAccountSettingsData';

export interface FailedWebhookDeliveriesModalProps {
  visible: boolean;
  onClose: () => void;
  deliveries: WebhookDeliveryRow[];
  loading: boolean;
  onRefresh?: () => void | Promise<void>;
}

function truncateUrl(url: string, maxLen = 40): string {
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen - 1)}…`;
}

function formatDeliveryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function FailedWebhookDeliveriesModal({
  visible,
  onClose,
  deliveries,
  loading,
  onRefresh,
}: FailedWebhookDeliveriesModalProps) {
  useEffect(() => {
    if (visible && onRefresh) {
      void onRefresh();
    }
  }, [visible, onRefresh]);

  const columns = useMemo(
    (): TableColumn<WebhookDeliveryRow>[] => [
      {
        key: 'event',
        label: 'Event',
        flex: 1,
        minWidth: 100,
        render: (item) => (
          <Text className="text-white font-instrument text-xs" numberOfLines={1}>
            {item.event_type}
          </Text>
        ),
      },
      {
        key: 'time',
        label: 'Time',
        flex: 0.9,
        minWidth: 88,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {formatDeliveryTime(item.created_at)}
          </Text>
        ),
      },
      {
        key: 'http',
        label: 'HTTP',
        flex: 0.45,
        minWidth: 44,
        render: (item) => (
          <Text className="text-gray-300 font-instrument text-xs">
            {item.response_status ?? '—'}
          </Text>
        ),
      },
      {
        key: 'endpoint',
        label: 'Endpoint',
        flex: 1.2,
        minWidth: 100,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {truncateUrl(item.endpoint_url)}
          </Text>
        ),
      },
      {
        key: 'error',
        label: 'Error',
        flex: 1.2,
        minWidth: 80,
        render: (item) => (
          <Text className="text-red-300 font-instrument text-xs" numberOfLines={2}>
            {item.error ?? '—'}
          </Text>
        ),
      },
    ],
    []
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Failed webhook deliveries"
      description="All failed deliveries for this account. Records are kept until manually removed or the account is deleted."
      maxWidth="3xl"
      maxHeight={720}
    >
      <View className="gap-4" style={{ flex: 1 }}>
        {loading && deliveries.length === 0 ? (
          <LoadingState message="Loading failed deliveries..." />
        ) : deliveries.length === 0 ? (
          <EmptyState
            title="No failed deliveries"
            description="When a webhook delivery fails after retries, it will appear here."
            className="py-8"
          />
        ) : (
          <DataTable<WebhookDeliveryRow>
            items={deliveries}
            columns={columns}
            getItemKey={(item) => item.id}
            fillAvailableWidth
            compactHeader
            equalColumnWidths={false}
            itemsPerPage={20}
            hidePaginationWhenSinglePage={false}
          />
        )}
      </View>
    </BaseModal>
  );
}
