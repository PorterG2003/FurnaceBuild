import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import {
  ArrowPathIcon,
  CommandLineIcon,
  MagnifyingGlassIcon,
  UserIcon,
} from 'react-native-heroicons/outline';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Alert } from '@/components/ui/feedback';
import { AcceptStandaloneCard, BrandedStandalonePageShell } from '@/components/ui/layout';
import { buildMcpConsentAuthHref } from '@/lib/mcp/consentReturn';
import { getAccessToken } from '@/lib/supabase/client';
import outputs from '@/amplify_outputs.json';

const WORKSPACE_LIST_MAX_HEIGHT = 320;
const SHOW_SEARCH_THRESHOLD = 4;
const TWO_COLUMN_MIN_WIDTH = 680;

const PERMISSIONS = [
  {
    Icon: CommandLineIcon,
    label: 'Full workspace access with your role permissions',
  },
  {
    Icon: ArrowPathIcon,
    label: 'Stays connected until you revoke',
  },
  {
    Icon: UserIcon,
    label: 'Actions attributed to your account',
  },
] as const;

function getMcpOrigin(): string {
  const custom = (outputs as { custom?: { mcpUrl?: string } }).custom;
  return (
    process.env.EXPO_PUBLIC_MCP_URL?.trim() ||
    custom?.mcpUrl?.replace(/\/$/, '') ||
    'https://mcp.getfurnace.io'
  );
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * OAuth consent page for hosted Furnace MCP.
 * Multi-select workspaces; grants a user-scoped session (no API key minting).
 */
export default function McpOAuthConsentPage() {
  const router = useRouter();
  const rawParams = useLocalSearchParams<{
    client_id?: string | string[];
    redirect_uri?: string | string[];
    state?: string | string[];
    code_challenge?: string | string[];
    code_challenge_method?: string | string[];
    mcp_complete_url?: string | string[];
  }>();
  const params = useMemo(
    () => ({
      client_id: firstParam(rawParams.client_id),
      redirect_uri: firstParam(rawParams.redirect_uri),
      state: firstParam(rawParams.state),
      code_challenge: firstParam(rawParams.code_challenge),
      code_challenge_method: firstParam(rawParams.code_challenge_method),
      mcp_complete_url: firstParam(rawParams.mcp_complete_url),
    }),
    [rawParams],
  );
  const {
    memberships,
    loading: accountLoading,
    initialized: accountInitialized,
  } = useAccount();
  const { user, loading: authLoading } = useAuth();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const hasOAuthParams = Boolean(
    params.client_id && params.redirect_uri && params.code_challenge,
  );

  const filteredMemberships = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memberships;
    return memberships.filter((entry) => {
      const name = (entry.account.name ?? '').toLowerCase();
      const role = (entry.membership.role ?? '').toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [memberships, search]);

  useEffect(() => {
    if (memberships.length === 0) return;
    setSelectedIds((prev) => {
      if (prev.length > 0) return prev;
      return memberships.map((m) => m.account?.id).filter(Boolean) as string[];
    });
  }, [memberships.length]);

  const consentPathWithQuery = useMemo(() => {
    if (typeof window !== 'undefined') {
      return `${window.location.pathname}${window.location.search}`;
    }
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) searchParams.set(key, value);
    }
    const q = searchParams.toString();
    return q ? `/mcp/oauth/consent?${q}` : '/mcp/oauth/consent';
  }, [params]);

  const mcpCompleteUrl = useMemo(() => {
    const fromQuery = params.mcp_complete_url;
    if (fromQuery && !/mcp\.internal/i.test(fromQuery)) return fromQuery;
    return `${getMcpOrigin()}/oauth/complete`;
  }, [params.mcp_complete_url]);

  const onCancel = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.close();
    }
    router.replace('/');
  }, [router]);

  const onSignIn = useCallback(() => {
    router.replace(buildMcpConsentAuthHref(consentPathWithQuery) as never);
  }, [consentPathWithQuery, router]);

  const allIds = useMemo(
    () => memberships.map((m) => m.account?.id).filter(Boolean) as string[],
    [memberships],
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

  const toggleAccount = useCallback((accountId: string) => {
    setSelectedIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId],
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allCurrentlySelected = allIds.every((id) => prev.includes(id));
      return allCurrentlySelected ? [] : [...allIds];
    });
  }, [allIds]);

  const onApprove = useCallback(async () => {
    setError(null);
    if (!user) {
      setError('You must be signed in.');
      return;
    }
    if (!hasOAuthParams) {
      setError('Missing OAuth parameters. Restart the connection from your MCP client.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Select at least one workspace.');
      return;
    }

    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Missing session token');

      const response = await fetch(mcpCompleteUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: params.client_id,
          redirect_uri: params.redirect_uri,
          state: params.state ?? '',
          code_challenge: params.code_challenge,
          account_ids: selectedIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        redirect_to?: string;
        error?: string;
        error_description?: string;
      };
      if (!response.ok || !payload.redirect_to) {
        throw new Error(payload.error_description || payload.error || 'OAuth complete failed');
      }

      if (typeof window !== 'undefined') {
        window.location.href = payload.redirect_to;
        return;
      }
      router.replace(payload.redirect_to as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve MCP access');
    } finally {
      setBusy(false);
    }
  }, [hasOAuthParams, mcpCompleteUrl, params, router, selectedIds, user]);

  if (authLoading || (user && (accountLoading || !accountInitialized))) {
    return <AppBootScreen />;
  }

  if (!hasOAuthParams) {
    return (
      <BrandedStandalonePageShell>
        <AcceptStandaloneCard
          actions={
            <Button onPress={() => router.replace('/')} variant="default">
              Home
            </Button>
          }
        >
          <Text className="text-white text-2xl font-instrument-bold">
            Missing connection details
          </Text>
          <Text className="text-gray-300 text-sm font-instrument leading-5">
            Restart the connection from your MCP client so Furnace receives a fresh authorize
            request.
          </Text>
        </AcceptStandaloneCard>
      </BrandedStandalonePageShell>
    );
  }

  if (!user) {
    return (
      <BrandedStandalonePageShell>
        <AcceptStandaloneCard
          actions={
            <>
              <Button onPress={onSignIn} variant="default">
                Sign in
              </Button>
              <Button onPress={onCancel} variant="outline">
                Cancel
              </Button>
            </>
          }
        >
          <Text className="text-white text-2xl font-instrument-bold">
            An MCP client wants to access your Furnace account
          </Text>
          <Text className="text-gray-300 text-sm font-instrument leading-5">
            Sign in to connect an MCP client to your Furnace account.
          </Text>
        </AcceptStandaloneCard>
      </BrandedStandalonePageShell>
    );
  }

  if (memberships.length === 0) {
    return (
      <BrandedStandalonePageShell>
        <AcceptStandaloneCard
          actions={
            <Button onPress={() => router.replace('/')} variant="default">
              Home
            </Button>
          }
        >
          <Text className="text-white text-2xl font-instrument-bold">No workspace available</Text>
          <Text className="text-gray-300 text-sm font-instrument leading-5">
            You are signed in, but no Furnace workspace is available. Join or create a workspace,
            then restart the MCP connection.
          </Text>
        </AcceptStandaloneCard>
      </BrandedStandalonePageShell>
    );
  }

  const canApprove = selectedIds.length > 0 && !busy;
  const showSearch = memberships.length > SHOW_SEARCH_THRESHOLD;
  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH;

  return (
    <BrandedStandalonePageShell maxWidthClassName={twoColumn ? 'max-w-2xl' : 'max-w-md'}>
      <AcceptStandaloneCard>
        {/* Header */}
        <View className="gap-2">
          <Text className="text-white text-2xl font-instrument-bold">
            An MCP client wants to access your Furnace account
          </Text>
          <Text className="text-gray-300 text-sm font-instrument leading-5">
            It will act as you across the workspaces you select — reading and writing campaigns,
            leads, inbox, and more.
          </Text>
        </View>

        {/* Two balanced columns: permissions | workspace picker */}
        <View className={twoColumn ? 'flex-row gap-6' : 'gap-5'}>
          {/* Permissions */}
          <View className={twoColumn ? 'flex-1 gap-2' : 'gap-2'}>
            <Text className="text-gray-500 text-xs font-instrument-medium uppercase tracking-wider">
              Permissions
            </Text>
            <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] px-4 py-3.5 gap-4">
              {PERMISSIONS.map(({ Icon, label }) => (
                <View key={label} className="flex-row items-start gap-3">
                  <View className="mt-0.5">
                    <Icon size={16} color="#9CA3AF" />
                  </View>
                  <Text className="flex-1 text-gray-300 text-sm font-instrument leading-5">
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Workspace picker */}
          <View className={twoColumn ? 'flex-1 gap-2' : 'gap-2'}>
            <Text className="text-gray-500 text-xs font-instrument-medium uppercase tracking-wider">
              Choose workspaces
            </Text>

            {showSearch ? (
              <View className="flex-row items-center rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] px-3 py-2.5 gap-2">
                <MagnifyingGlassIcon size={16} color="#9CA3AF" />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search workspaces…"
                  placeholderTextColor="#666"
                  className="flex-1 text-sm text-white font-instrument"
                  style={{ paddingVertical: 0 }}
                  selectionColor="#FF4D00"
                  underlineColorAndroid="transparent"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}

            <Pressable
              onPress={toggleSelectAll}
              className="flex-row items-center gap-0.5"
            >
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && selectedIds.length > 0}
                onPress={toggleSelectAll}
                size={16}
              />
              <Text className="text-gray-400 text-xs font-instrument-medium">Select all</Text>
            </Pressable>

            <ScrollView
              style={{ maxHeight: WORKSPACE_LIST_MAX_HEIGHT }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              <View className="gap-1">
                {filteredMemberships.length === 0 ? (
                  <View className="px-1 py-1">
                    <Text className="text-gray-500 text-sm font-instrument">
                      No workspaces match "{search.trim()}".
                    </Text>
                  </View>
                ) : (
                  filteredMemberships.map((entry) => {
                    const acct = entry.account;
                    const id = acct?.id;
                    if (!id) return null;
                    const name = acct.name?.trim() || 'Untitled workspace';
                    const selected = selectedIds.includes(id);
                    return (
                      <Pressable
                        key={id}
                        onPress={() => toggleAccount(id)}
                        className={`rounded-lg border px-2 py-1.5 flex-row items-center gap-0.5 ${
                          selected
                            ? 'border-brand-orange bg-brand-orange/10'
                            : 'border-[#2A2A2A] bg-[#141414]'
                        }`}
                      >
                        <Checkbox
                          checked={selected}
                          onPress={() => toggleAccount(id)}
                          size={16}
                        />
                        <Text
                          className="flex-1 text-white text-sm font-instrument"
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </View>
        </View>

        {/* Actions */}
        <View className="gap-3 pt-4 border-t border-[#2A2A2A]">
          {error ? <Alert variant="error" message={error} /> : null}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button disabled={busy} onPress={onCancel} variant="outline" fullWidth>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button disabled={!canApprove} onPress={() => void onApprove()} variant="default" fullWidth>
                {busy ? 'Connecting…' : 'Approve'}
              </Button>
            </View>
          </View>
        </View>
      </AcceptStandaloneCard>
    </BrandedStandalonePageShell>
  );
}
