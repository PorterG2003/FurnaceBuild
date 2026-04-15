import { useCallback, useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/Toggle';
import { getAccountMembershipsForUser } from '@/lib/supabase/services/accounts';
import { deleteTestCampaign } from '@/lib/supabase/services/campaigns';
import { ALLOWED_EMAIL } from '@/lib/test/campaign-flow/constants';
import {
  runEmailVariantsHarnessAssertion,
  sweepAbandonedEmailVariantsHarnessCampaigns,
  EMAIL_VARIANTS_HARNESS_PREFIX,
  type HarnessRunResult,
} from '@/lib/test/email-variants-harness';
import {
  ArrowPathIcon,
  BeakerIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';

export default function EmailVariantsHarnessPage() {
  const router = useRouter();
  const { user } = useAccount();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<HarnessRunResult | null>(null);
  const [sweepMsg, setSweepMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [keepCampaignAfterRun, setKeepCampaignAfterRun] = useState(false);
  const [keptCampaignId, setKeptCampaignId] = useState<string | null>(null);
  const [deletingKept, setDeletingKept] = useState(false);

  const email = user?.email?.toLowerCase().trim() ?? '';

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      setAuthorized(false);
      return;
    }
    setAuthorized(email === ALLOWED_EMAIL.toLowerCase().trim());
    setLoading(false);
  }, [user?.id, email]);

  const runHarness = useCallback(async () => {
    if (!user?.id) return;
    setRunning(true);
    setError(null);
    setLastResult(null);
    setSweepMsg(null);
    setKeptCampaignId(null);
    try {
      const memberships = await getAccountMembershipsForUser(user.id);
      const account = memberships[0]?.account;
      if (!account) throw new Error('No account for user');

      const result = await runEmailVariantsHarnessAssertion(
        { userId: user.id, accountId: account.id },
        { skipCleanup: keepCampaignAfterRun }
      );
      setLastResult(result);
      if (keepCampaignAfterRun) {
        setKeptCampaignId(result.fixture.campaignId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [user?.id, keepCampaignAfterRun]);

  const deleteKeptCampaign = useCallback(async () => {
    if (!keptCampaignId) return;
    setDeletingKept(true);
    setError(null);
    try {
      await deleteTestCampaign(keptCampaignId);
      setKeptCampaignId(null);
      setSweepMsg({ type: 'ok', text: 'Kept harness campaign deleted.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingKept(false);
    }
  }, [keptCampaignId]);

  const runSweep = useCallback(async () => {
    if (!user?.id) return;
    setSweepMsg(null);
    setSweeping(true);
    try {
      const { deletedIds } = await sweepAbandonedEmailVariantsHarnessCampaigns(user.id);
      setSweepMsg({
        type: 'ok',
        text:
          deletedIds.length === 0
            ? 'No stale harness campaigns found (older than 24h).'
            : `Removed ${deletedIds.length} stale harness campaign${deletedIds.length === 1 ? '' : 's'}.`,
      });
    } catch (e) {
      setSweepMsg({ type: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSweeping(false);
    }
  }, [user?.id]);

  if (loading) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center py-16 min-h-[200px]">
          <ActivityIndicator size="large" color="#f85102" />
          <Text className="mt-4 text-gray-400 font-instrument text-sm">Loading…</Text>
        </View>
      </PageLayout>
    );
  }

  if (!user?.id) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center px-6 py-12">
          <Text className="text-xl font-instrument-semibold mb-2 text-white text-center">
            Sign in required
          </Text>
          <Text className="text-gray-400 text-center font-instrument text-sm leading-5">
            Sign in to run internal integration tests.
          </Text>
        </View>
      </PageLayout>
    );
  }

  if (!authorized) {
    return (
      <PageLayout>
        <View className="flex-1 justify-center items-center px-6 py-12">
          <Text className="text-xl font-instrument-semibold mb-2 text-white text-center">
            Access restricted
          </Text>
          <Text className="text-gray-400 text-center mb-4 font-instrument text-sm leading-5">
            This harness is only available to authorized test accounts.
          </Text>
          <Text className="text-gray-500 text-center text-xs font-instrument">
            Signed in as: {email || 'Unknown'}
          </Text>
          <Text className="text-gray-600 text-center text-xs font-instrument mt-1">
            Allowed: {ALLOWED_EMAIL}
          </Text>
        </View>
      </PageLayout>
    );
  }

  const allPassed = lastResult?.assertions.every((a) => a.ok) ?? false;
  const assertionCount = lastResult?.assertions.length ?? 0;

  return (
    <PageLayout>
      {/* Header */}
      <View className="mb-6">
        <View className="flex-row items-start justify-between gap-3 mb-2">
          <View className="flex-1 min-w-0">
            <Text className="text-2xl font-instrument-semibold text-white mb-1">
              Email variants harness
            </Text>
            <Text className="text-gray-400 font-instrument text-sm leading-5">
              End-to-end check for A/B variant round-robin,{' '}
              <Text className="text-gray-300">batch_assign_jobs_to_interval</Text>, and{' '}
              <Text className="text-gray-300">get_campaign_variant_stats</Text>.
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg min-h-[44px] justify-center"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text className="text-gray-300 font-instrument text-sm">Back</Text>
          </Pressable>
        </View>
      </View>

      {/* Primary action */}
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 mb-4">
        <View className="flex-row items-center gap-2 mb-2">
          <View className="bg-brand-orange/20 p-2 rounded-lg">
            <BeakerIcon size={22} color="#f85102" />
          </View>
          <Text className="text-white font-instrument-semibold text-base flex-1">
            Deterministic run
          </Text>
        </View>
        <Text className="text-gray-400 font-instrument text-xs leading-5 mb-4">
          Seeds a campaign named “{EMAIL_VARIANTS_HARNESS_PREFIX} …”, creates two sends with different variants,
          verifies stats, then deletes the campaign via deleteTestCampaign (unless you keep it). No scheduler polling
          or wall-clock waits.
        </Text>
        <View className="flex-row items-center justify-between gap-3 mb-4 py-2 px-1">
          <View className="flex-1 min-w-0 pr-2">
            <Text className="text-white font-instrument-medium text-sm mb-0.5">Keep campaign after run</Text>
            <Text className="text-gray-500 font-instrument text-xs leading-5">
              Leave the campaign and stats in the database so you can open the campaign Details tab and check
              Variant performance.
            </Text>
          </View>
          <Toggle
            value={keepCampaignAfterRun}
            onValueChange={setKeepCampaignAfterRun}
            disabled={running}
          />
        </View>
        <Button onPress={runHarness} disabled={running || sweeping} fullWidth className="min-h-[48px]">
          {running ? (
            <View className="flex-row items-center justify-center gap-2 py-0.5">
              <ActivityIndicator color="#ffffff" size="small" />
              <Text className="text-white font-instrument-medium text-base">Running harness…</Text>
            </View>
          ) : (
            'Run harness'
          )}
        </Button>
      </View>

      {/* Maintenance */}
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 mb-4">
        <View className="flex-row items-center gap-2 mb-2">
          <View className="bg-slate-500/20 p-2 rounded-lg">
            <TrashIcon size={22} color="#94a3b8" />
          </View>
          <Text className="text-white font-instrument-semibold text-base flex-1">
            Stale data sweep
          </Text>
        </View>
        <Text className="text-gray-400 font-instrument text-xs leading-5 mb-4">
          Deletes abandoned harness campaigns older than 24 hours (same prefix + test markers). Use if a run failed
          before cleanup.
        </Text>
        <Button
          onPress={runSweep}
          disabled={sweeping || running}
          variant="secondary"
          fullWidth
          className="min-h-[48px]"
        >
          {sweeping ? (
            <View className="flex-row items-center justify-center gap-2 py-0.5">
              <ActivityIndicator color="#e2e8f0" size="small" />
              <Text className="text-white font-instrument-medium text-base">Sweeping…</Text>
            </View>
          ) : (
            'Sweep stale campaigns'
          )}
        </Button>
        {sweepMsg && (
          <View
            className={`mt-3 flex-row items-start gap-2 rounded-lg px-3 py-2 border ${
              sweepMsg.type === 'ok' ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-red-950/30 border-red-800/50'
            }`}
          >
            {sweepMsg.type === 'ok' ? (
              <CheckCircleIcon size={18} color="#34d399" style={{ marginTop: 1 }} />
            ) : (
              <ExclamationTriangleIcon size={18} color="#f87171" style={{ marginTop: 1 }} />
            )}
            <Text
              className={`flex-1 font-instrument text-sm leading-5 ${
                sweepMsg.type === 'ok' ? 'text-emerald-200' : 'text-red-300'
              }`}
            >
              {sweepMsg.text}
            </Text>
          </View>
        )}
      </View>

      {error && (
        <View className="mb-4 bg-red-950/30 border border-red-800/60 rounded-xl p-4">
          <View className="flex-row items-start gap-2">
            <ExclamationTriangleIcon size={20} color="#f87171" />
            <View className="flex-1 min-w-0">
              <Text className="text-red-300 font-instrument-semibold text-sm mb-1">Harness failed</Text>
              <Text className="text-red-200/90 font-instrument text-sm leading-5">{error}</Text>
            </View>
          </View>
        </View>
      )}

      {keptCampaignId && (
        <View className="mb-4 bg-emerald-950/25 border border-emerald-800/50 rounded-xl p-4">
          <Text className="text-emerald-200 font-instrument-semibold text-sm mb-2">Campaign kept for inspection</Text>
          <Text className="text-gray-400 font-instrument text-xs mb-3 leading-5" selectable>
            ID: {keptCampaignId}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() =>
                router.push({ pathname: '/campaigns/[id]', params: { id: keptCampaignId } } as never)
              }
              className="px-4 py-2.5 bg-brand-orange rounded-lg min-h-[44px] justify-center"
              accessibilityRole="button"
              accessibilityLabel="Open campaign details"
            >
              <Text className="text-white font-instrument-medium text-sm">Open campaign (Details tab)</Text>
            </Pressable>
            <Button
              variant="secondary"
              onPress={deleteKeptCampaign}
              disabled={deletingKept}
              className="min-h-[44px]"
            >
              {deletingKept ? (
                <View className="flex-row items-center gap-2 px-2">
                  <ActivityIndicator color="#e2e8f0" size="small" />
                  <Text className="text-white font-instrument text-sm">Deleting…</Text>
                </View>
              ) : (
                'Delete kept campaign'
              )}
            </Button>
          </View>
          <Text className="text-gray-500 font-instrument text-xs mt-3 leading-5">
            Variant performance is on the campaign page under the Details tab. When finished, delete here or use
            Sweep stale campaigns (24h+).
          </Text>
        </View>
      )}

      {lastResult && (
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 mb-4">
          <View className="flex-row items-center gap-2 mb-4">
            {allPassed ? (
              <CheckCircleIcon size={22} color="#34d399" />
            ) : (
              <ExclamationTriangleIcon size={22} color="#fbbf24" />
            )}
            <Text
              className={`font-instrument-semibold text-base flex-1 ${allPassed ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {allPassed ? 'All checks passed' : 'Some checks failed'}
            </Text>
            <Text className="text-gray-500 font-instrument text-xs">
              {lastResult.assertions.filter((a) => a.ok).length}/{assertionCount}
            </Text>
          </View>

          <View className="gap-0">
            {lastResult.assertions.map((a, index) => {
              const isLast = index === lastResult.assertions.length - 1;
              return (
                <View
                  key={a.name}
                  className={`flex-row items-start gap-3 py-3 ${!isLast ? 'border-b border-[#2A2A2A]' : ''}`}
                >
                  <View className="mt-0.5">
                    {a.ok ? (
                      <CheckCircleIcon size={18} color="#34d399" />
                    ) : (
                      <ExclamationTriangleIcon size={18} color="#f87171" />
                    )}
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text
                      className={`font-instrument-semibold text-sm ${a.ok ? 'text-emerald-200' : 'text-red-300'}`}
                    >
                      {a.name}
                    </Text>
                    {a.detail ? (
                      <Text className="text-gray-500 font-mono text-xs mt-1.5 leading-5" selectable>
                        {a.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          <View className="mt-4 pt-4 border-t border-[#2A2A2A] flex-row items-start gap-2">
            <ArrowPathIcon size={16} color="#64748b" />
            <Text className="text-gray-500 font-instrument text-xs leading-5 flex-1">
              {keptCampaignId
                ? 'Campaign was kept (see box above). Assertions still ran against the same data before you inspect the UI.'
                : 'The test campaign was deleted after assertions. Turn on “Keep campaign after run” above to inspect Variant performance on the campaign Details tab.'}
            </Text>
          </View>
        </View>
      )}

      <View className="bg-blue-950/25 border border-blue-900/50 rounded-xl p-4">
        <Text className="text-blue-300/90 font-instrument-semibold text-sm mb-2">What this does not run</Text>
        <Text className="text-gray-400 font-instrument text-xs leading-5">
          The ECS send worker and inbox checker are not invoked here. Jobs are marked sent and synthetic reply/bounce
          rows are inserted to validate the same stats RPC the campaign detail page uses.
        </Text>
      </View>
    </PageLayout>
  );
}
