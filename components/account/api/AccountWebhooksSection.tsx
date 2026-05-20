import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Skeleton, useToast } from '@/components/ui/feedback';
import type { Account } from '@/lib/supabase/types';
import { fetchFailedWebhookDeliveries } from '@/lib/supabase/services/accounts';
import type { WebhookDeliveryRow } from '@/hooks/useAccountSettingsData';
import { parseWebhookEnabledEvents } from './constants';
import { ConfigureWebhookModal } from './ConfigureWebhookModal';
import { FailedWebhookDeliveriesModal } from './FailedWebhookDeliveriesModal';

interface AccountWebhooksSectionProps {
  account: Account;
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  headerTitleClassName?: string;
  onAccountUpdated?: () => Promise<void>;
  initialFailedDeliveryCount?: number;
}

function truncateUrl(url: string, maxLen = 48): string {
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen - 1)}…`;
}

function webhookStatusLabel(account: Account): string {
  const url = account.webhook_url?.trim();
  if (!url) return 'Not configured';
  if (account.webhook_url_verified_at) return 'Verified';
  return 'Configured (unverified)';
}

function failedDeliveriesSummary(count: number): string {
  if (count === 0) return 'No failed deliveries.';
  if (count === 1) return '1 failed delivery';
  return `${count} failed deliveries`;
}

export function AccountWebhooksSection({
  account,
  cardVariant,
  cardClassName,
  titleClassName,
  headerTitleClassName,
  onAccountUpdated,
  initialFailedDeliveryCount,
}: AccountWebhooksSectionProps) {
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const headerTitle = headerTitleClassName ?? titleClassName;
  const headerRowMb = isMobile ? 'mb-3' : 'mb-4';

  const [deliveries, setDeliveries] = useState<WebhookDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [configureModalVisible, setConfigureModalVisible] = useState(false);
  const [deliveriesModalVisible, setDeliveriesModalVisible] = useState(false);

  const enabledEvents = useMemo(
    () => parseWebhookEnabledEvents(account.webhook_enabled_events),
    [account.webhook_enabled_events]
  );

  const failedDeliveries = useMemo(
    () => deliveries.filter((d) => d.status === 'failed'),
    [deliveries]
  );

  const displayCount =
    !loading || deliveries.length > 0
      ? failedDeliveries.length
      : (initialFailedDeliveryCount ?? 0);

  const refreshDeliveries = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) setLoading(true);
      try {
        const rows = await fetchFailedWebhookDeliveries(account.id);
        setDeliveries(rows);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load webhook deliveries.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [account.id, toast]
  );

  const refreshDeliveriesSilent = useCallback(() => {
    return refreshDeliveries({ silent: true });
  }, [refreshDeliveries]);

  useEffect(() => {
    void refreshDeliveries();
  }, [account.id, refreshDeliveries]);

  const handleSaved = async () => {
    await onAccountUpdated?.();
    await refreshDeliveries({ silent: true });
  };

  const previewEvents = enabledEvents.slice(0, 3);
  const extraEventCount = enabledEvents.length - previewEvents.length;

  return (
    <Card variant={cardVariant} className={cardClassName ?? ''}>
      <View
        className={`flex-row items-center justify-between gap-3 border-b border-[#2A2A2A] pb-2 ${headerRowMb}`}
      >
        <Text className={`flex-1 min-w-0 pr-2 ${headerTitle}`} numberOfLines={2}>
          Webhooks
        </Text>
        <Button
          variant="secondary"
          size="sm"
          className="flex-shrink-0"
          onPress={() => setConfigureModalVisible(true)}
        >
          Configure
        </Button>
      </View>

      <Text className="text-xs text-gray-500 mb-4 leading-5">
        Receive Furnace events at your endpoint. Campaigns can override this URL in Mission Control.
      </Text>

      <View className="mb-5 rounded-xl border border-[#2A2A2A] bg-[#141414] p-3 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-white text-sm font-instrument-medium">Account webhook</Text>
          <View className="rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2.5 py-1">
            <Text className="text-[11px] text-gray-300 font-instrument-medium">
              {webhookStatusLabel(account)}
            </Text>
          </View>
        </View>
        <View>
          <Text className="text-xs text-gray-500 font-instrument mb-0.5">Endpoint</Text>
          <Text className="text-sm text-gray-300 font-instrument" numberOfLines={2}>
            {account.webhook_url?.trim() ? truncateUrl(account.webhook_url.trim()) : 'Not set'}
          </Text>
        </View>
        <View>
          <Text className="text-xs text-gray-500 font-instrument mb-0.5">Signing secret</Text>
          <Text className="text-sm text-gray-300 font-instrument">
            {account.webhook_signing_secret?.trim() ? 'Set' : 'Not set'}
          </Text>
        </View>
        <View>
          <Text className="text-xs text-gray-500 font-instrument mb-1">Events</Text>
          {enabledEvents.length === 0 ? (
            <Text className="text-sm text-gray-400 font-instrument">None selected</Text>
          ) : (
            <View className="flex-row flex-wrap gap-1.5">
              {previewEvents.map((event) => (
                <View
                  key={event}
                  className="rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2 py-0.5"
                >
                  <Text className="text-[11px] text-gray-300 font-instrument">{event}</Text>
                </View>
              ))}
              {extraEventCount > 0 ? (
                <View className="rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2 py-0.5">
                  <Text className="text-[11px] text-gray-400 font-instrument">+{extraEventCount} more</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 min-w-0">
          <Text className="text-sm text-white font-instrument-medium mb-1">Failed deliveries</Text>
          {loading && deliveries.length === 0 ? (
            <Skeleton style={{ width: 160, height: 14, borderRadius: 4 }} />
          ) : (
            <Text className="text-sm text-gray-400 font-instrument">
              {failedDeliveriesSummary(displayCount)}
            </Text>
          )}
        </View>
        <Button
          variant="secondary"
          size="sm"
          className="flex-shrink-0"
          onPress={() => setDeliveriesModalVisible(true)}
        >
          View failed deliveries
        </Button>
      </View>

      <ConfigureWebhookModal
        visible={configureModalVisible}
        onClose={() => setConfigureModalVisible(false)}
        account={account}
        onSaved={handleSaved}
      />

      <FailedWebhookDeliveriesModal
        visible={deliveriesModalVisible}
        onClose={() => setDeliveriesModalVisible(false)}
        deliveries={failedDeliveries}
        loading={loading}
        onRefresh={refreshDeliveriesSilent}
      />
    </Card>
  );
}
