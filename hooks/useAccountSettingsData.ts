import { useCallback, useEffect, useState } from 'react';
import { countFailedWebhookDeliveries, listAccountApiKeys } from '@/lib/supabase/services/accounts';
import {
  getNotificationPreferences,
  listActivePushSubscriptions,
  type PrefRow,
} from '@/lib/supabase/services/notifications';
import {
  getActiveSmartleadMigrationRun,
  getLatestSmartleadMigrationRun,
} from '@/lib/supabase/services/smartlead-migrations';
import type { AccountApiKey, SmartleadMigrationRun } from '@/lib/supabase/types';

export type { FailedWebhookDeliveryRow as WebhookDeliveryRow } from '@/lib/supabase/services/accounts/webhook-deliveries';

export type AccountSettingsData = {
  prefs: PrefRow[];
  subCount: number;
  apiKeys: AccountApiKey[];
  webhookFailedDeliveryCount: number;
  smartleadRun: SmartleadMigrationRun | null;
};

async function resolveSmartleadRun(accountId: string): Promise<SmartleadMigrationRun | null> {
  const activeRun = await getActiveSmartleadMigrationRun(accountId);
  if (activeRun) return activeRun;
  return getLatestSmartleadMigrationRun(accountId);
}

export interface UseAccountSettingsDataOptions {
  enabled?: boolean;
  includeAdminData?: boolean;
}

export function useAccountSettingsData(
  accountId: string | null | undefined,
  options: UseAccountSettingsDataOptions = {},
) {
  const enabled = (options.enabled ?? true) && !!accountId;
  const includeAdminData = options.includeAdminData ?? true;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccountSettingsData | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!accountId) return;

      if (!silent) setLoading(true);
      setError(null);

      try {
        const [prefsBundle, adminData, smartleadRun] = await Promise.all([
          Promise.all([getNotificationPreferences(accountId), listActivePushSubscriptions()]),
          includeAdminData
            ? Promise.all([listAccountApiKeys(accountId), countFailedWebhookDeliveries(accountId)])
            : Promise.resolve([[], 0] as const),
          resolveSmartleadRun(accountId),
        ]);

        const [prefs, subs] = prefsBundle;
        const [apiKeys, webhookFailedDeliveryCount] = adminData;
        setData({
          prefs,
          subCount: subs.length,
          apiKeys,
          webhookFailedDeliveryCount,
          smartleadRun,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load account settings');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accountId, includeAdminData],
  );

  useEffect(() => {
    if (!enabled || !accountId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    void load(false);
  }, [enabled, accountId, load]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    const intervalId = setInterval(() => {
      void load(true);
    }, 5000);

    return () => clearInterval(intervalId);
  }, [enabled, accountId, load]);

  const refresh = useCallback(() => load(false), [load]);
  const refreshSilent = useCallback(() => load(true), [load]);

  return { data, loading, error, refresh, refreshSilent };
}
