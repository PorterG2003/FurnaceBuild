import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Skeleton, useToast } from '@/components/ui/feedback';
import type { AccountApiKey, Account } from '@/lib/supabase/types';
import { listAccountApiKeys, type AccountApiKeyWithSecret } from '@/lib/supabase/services/accounts';
import { getClientApiBaseUrl } from '@/lib/client-api/client';
import { MAX_ACTIVE_API_KEYS } from './constants';
import { CreateApiKeyModal } from './CreateApiKeyModal';
import { ApiKeyCreatedModal } from './ApiKeyCreatedModal';
import { EditApiKeyModal } from './EditApiKeyModal';

function ApiKeysListSkeleton() {
  return (
    <View className="gap-3">
      <Skeleton style={{ width: 160, height: 12, borderRadius: 4 }} />
      <Skeleton style={{ width: '100%', height: 56, borderRadius: 8 }} />
      <Skeleton style={{ width: '100%', height: 56, borderRadius: 8 }} />
    </View>
  );
}

interface AccountApiKeysSectionProps {
  account: Account;
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  headerTitleClassName?: string;
  initialKeys?: AccountApiKey[];
  /** Spotlight anchor — attach to the card root, not a wrapper (avoids measuring card margin). */
  anchorRef?: RefObject<View | null>;
}

export function AccountApiKeysSection({
  account,
  cardVariant,
  cardClassName,
  titleClassName,
  headerTitleClassName,
  initialKeys,
  anchorRef,
}: AccountApiKeysSectionProps) {
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const headerTitle = headerTitleClassName ?? titleClassName;
  const headerRowMb = isMobile ? 'mb-3' : 'mb-4';
  const hasInitialData = initialKeys !== undefined;

  const [keys, setKeys] = useState<AccountApiKey[]>(initialKeys ?? []);
  const [loading, setLoading] = useState(!hasInitialData);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createdKey, setCreatedKey] = useState<AccountApiKeyWithSecret | null>(null);
  const [editKey, setEditKey] = useState<AccountApiKey | null>(null);

  const docsUrl = useMemo(() => {
    const base = getClientApiBaseUrl();
    return base ? `${base}/docs` : 'https://api.getfurnace.io/docs';
  }, []);

  const activeKeys = useMemo(() => keys.filter((key) => !key.revoked_at), [keys]);

  const refresh = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const nextKeys = await listAccountApiKeys(account.id);
      setKeys(nextKeys);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load API keys.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (hasInitialData) return;
    void refresh();
  }, [account.id, hasInitialData]);

  useEffect(() => {
    if (initialKeys !== undefined) {
      setKeys(initialKeys);
      setLoading(false);
    }
  }, [initialKeys]);

  const openDocs = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    toast.info(docsUrl);
  };

  const handleCreated = (key: AccountApiKeyWithSecret) => {
    setCreatedKey(key);
    void refresh({ silent: true });
  };

  return (
    <Card ref={anchorRef} variant={cardVariant} className={cardClassName ?? ''}>
      <View
        className={`flex-row items-center justify-between gap-3 border-b border-[#2A2A2A] pb-2 ${headerRowMb}`}
      >
        <Text className={`flex-1 min-w-0 pr-2 ${headerTitle}`} numberOfLines={2}>
          API Keys
        </Text>
        <View className="flex-row items-center gap-2 flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            className="flex-shrink-0"
            onPress={() => setCreateModalVisible(true)}
            disabled={activeKeys.length >= MAX_ACTIVE_API_KEYS}
          >
            Create key
          </Button>
          <Button variant="secondary" size="sm" className="flex-shrink-0" onPress={openDocs}>
            Open docs
          </Button>
        </View>
      </View>

      <Text className="text-xs text-gray-500 mb-4 leading-5">
        Programmatic access to Furnace via the Client API. You can have up to {MAX_ACTIVE_API_KEYS} active keys per
        account.
      </Text>

      {!loading ? (
        <Text className="text-xs text-gray-400 font-instrument-medium mb-3">
          {activeKeys.length} active {activeKeys.length === 1 ? 'key' : 'keys'} · max {MAX_ACTIVE_API_KEYS}
        </Text>
      ) : null}

      {loading ? (
        <ApiKeysListSkeleton />
      ) : keys.length === 0 ? (
        <View className="py-2">
          <Text className="text-sm text-gray-400 mb-3">No API keys yet. Create one to connect Zapier, scripts, or other tools.</Text>
          <Button size="sm" onPress={() => setCreateModalVisible(true)}>
            Create API key
          </Button>
        </View>
      ) : (
        <View className="rounded-lg overflow-hidden">
          {keys.map((key, index) => (
            <View
              key={key.id}
              className={`py-3 ${index < keys.length - 1 ? 'border-b border-[#2A2A2A]' : ''}`}
            >
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center gap-2 flex-wrap mb-1">
                    <Text className="text-white text-sm font-instrument-medium">{key.name}</Text>
                    {key.revoked_at ? (
                      <View className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30">
                        <Text className="text-xs font-instrument-medium text-red-400">Revoked</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="text-gray-400 text-xs font-instrument">
                    {key.secret_prefix}…
                  </Text>
                  <Text className="text-gray-500 text-xs font-instrument mt-1">
                    {key.last_used_at
                      ? `Last used ${new Date(key.last_used_at).toLocaleString()}`
                      : 'Never used'}
                  </Text>
                </View>
                <Button variant="secondary" size="xs" onPress={() => setEditKey(key)}>
                  Manage
                </Button>
              </View>
            </View>
          ))}
        </View>
      )}

      <CreateApiKeyModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        accountId={account.id}
        activeKeyCount={activeKeys.length}
        onCreated={handleCreated}
      />
      <ApiKeyCreatedModal
        visible={createdKey !== null}
        createdKey={createdKey}
        onClose={() => setCreatedKey(null)}
      />
      <EditApiKeyModal
        visible={editKey !== null}
        onClose={() => setEditKey(null)}
        accountId={account.id}
        apiKey={editKey}
        onSaved={() => void refresh({ silent: true })}
        onRevoked={() => void refresh({ silent: true })}
      />
    </Card>
  );
}
