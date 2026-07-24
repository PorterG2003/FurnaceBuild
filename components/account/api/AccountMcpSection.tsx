import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Skeleton, useToast } from '@/components/ui/feedback';
import type { Account } from '@/lib/supabase/types';
import {
  getClientApiBaseUrl,
  listMcpSessions,
  revokeMcpSession,
  type McpSessionSummary,
} from '@/lib/client-api/client';
import outputs from '@/amplify_outputs.json';

interface AccountMcpSectionProps {
  account: Account;
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  headerTitleClassName?: string;
  /** Spotlight anchor — attach to the card root, not a wrapper (avoids measuring card margin). */
  anchorRef?: RefObject<View | null>;
}

function getMcpUrl(): string {
  const custom = (outputs as { custom?: { mcpUrl?: string } }).custom;
  return (
    process.env.EXPO_PUBLIC_MCP_URL?.trim() ||
    custom?.mcpUrl?.replace(/\/$/, '') ||
    'https://mcp.getfurnace.io'
  );
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AccountMcpSection({
  account: _account,
  cardVariant,
  cardClassName,
  titleClassName,
  headerTitleClassName,
  anchorRef,
}: AccountMcpSectionProps) {
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const headerTitle = headerTitleClassName ?? titleClassName;
  const headerRowMb = isMobile ? 'mb-3' : 'mb-4';
  const mcpUrl = useMemo(() => getMcpUrl(), []);
  const endpoint = `${mcpUrl}/mcp`;
  const [copied, setCopied] = useState(false);
  const [sessions, setSessions] = useState<McpSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const docsUrl = useMemo(() => {
    const base = getClientApiBaseUrl() || 'https://api.getfurnace.io';
    return `${base.replace(/\/$/, '')}/docs/guides/mcp/`;
  }, []);

  const refreshSessions = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingSessions(true);
    try {
      const next = await listMcpSessions();
      setSessions(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load MCP sessions.');
    } finally {
      if (!options?.silent) setLoadingSessions(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const copyUrl = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(endpoint);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      toast.info(endpoint);
    } catch {
      toast.error('Could not copy the URL.');
    }
  };

  const openDocs = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    toast.info(docsUrl);
  };

  const onRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await revokeMcpSession(sessionId);
      toast.success('MCP session revoked.');
      await refreshSessions({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke session.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card ref={anchorRef} variant={cardVariant} className={cardClassName ?? ''}>
      <View
        className={`flex-row items-center justify-between gap-3 border-b border-[#2A2A2A] pb-2 ${headerRowMb}`}
      >
        <Text className={`flex-1 min-w-0 pr-2 ${headerTitle}`} numberOfLines={2}>
          MCP
        </Text>
        <Button variant="secondary" size="sm" className="flex-shrink-0" onPress={openDocs}>
          Open docs
        </Button>
      </View>

      <Text className="text-xs text-gray-500 mb-4 leading-5">
        Connect Cursor, Claude, ChatGPT, and other MCP clients with OAuth. Connections are
        user-scoped and can access the workspaces you grant at consent.
      </Text>

      <View className="rounded-lg border border-[#2A2A2A] bg-[#121212] p-3 gap-3 mb-4">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-xs text-gray-400 font-instrument-medium">Server URL</Text>
          <Button variant="secondary" size="xs" onPress={() => void copyUrl()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </View>
        <Text className="text-sm text-white font-mono" selectable numberOfLines={1}>
          {endpoint}
        </Text>
      </View>

      <View className="flex-row items-center justify-between gap-3 mb-3">
        <Text className="text-xs text-gray-400 font-instrument-medium uppercase tracking-wider">
          Your connections
        </Text>
        <Button variant="secondary" size="xs" onPress={() => void refreshSessions()}>
          Refresh
        </Button>
      </View>

      {loadingSessions ? (
        <View className="gap-2">
          <Skeleton style={{ width: '100%', height: 48, borderRadius: 8 }} />
          <Skeleton style={{ width: '100%', height: 48, borderRadius: 8 }} />
        </View>
      ) : sessions.length === 0 ? (
        <Text className="text-xs text-gray-500 leading-5">
          No active MCP sessions. Connect from your MCP client using the server URL above.
        </Text>
      ) : (
        <View className="gap-2">
          {sessions.map((session) => (
            <View
              key={session.id}
              className="rounded-lg border border-[#2A2A2A] bg-[#121212] p-3 gap-2"
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 min-w-0">
                  <Text className="text-sm text-white font-instrument" numberOfLines={1}>
                    {session.client_id || 'MCP client'}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-1">
                    {session.allowed_account_ids.length} workspace
                    {session.allowed_account_ids.length === 1 ? '' : 's'} · last used{' '}
                    {formatWhen(session.last_used_at || session.created_at)}
                  </Text>
                </View>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={revokingId === session.id}
                  onPress={() => void onRevoke(session.id)}
                >
                  {revokingId === session.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
