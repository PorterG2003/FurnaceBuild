import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import {
  fetchSourceRecordDetail,
  postGenerateSourceCandidates,
  postLinkSourceRecord,
  postRejectSourceCandidates,
} from '@/lib/foundry/registry-client';
import type { SourceRecordDetailResponse } from '@/lib/foundry/registry-types';
import { SourceImportedRowSummary } from '@/components/foundry/source-records/SourceImportedRowSummary';
import { SourceLinkDecisionLadder } from '@/components/foundry/source-records/SourceLinkDecisionLadder';
import {
  buildSourceRecordViewModel,
  formatGenerateCandidatesMessage,
} from '@/components/foundry/source-records/sourceRecordViewModel';

export default function SourceRecordDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<SourceRecordDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [showLinkingHelp, setShowLinkingHelp] = useState(false);

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setError(null);
    try {
      const d = await fetchSourceRecordDetail(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setDetail(null);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const vm = useMemo(() => (detail ? buildSourceRecordViewModel(detail) : null), [detail]);

  if (!id || typeof id !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid record.</Text>
      </View>
    );
  }

  const runRecordsHref =
    vm?.imported.ingestionRunId != null
      ? `/foundry/imports/${vm.imported.ingestionRunId}/records`
      : null;

  const noCandidates = vm != null && vm.candidates.length === 0;

  const linkFromSearchOrCandidate = async (companyId: string) => {
    setBusyCompanyId(companyId);
    setError(null);
    setActionMsg(null);
    try {
      const r = await postLinkSourceRecord(id, { companyId });
      const cid = (r as { company_id?: string }).company_id;
      await load();
      setActionMsg('Linked successfully.');
      if (cid) router.push(`/foundry/companies/${cid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed');
    } finally {
      setBusyCompanyId(null);
    }
  };

  const runCreateAndLink = async () => {
    setBusyCreate(true);
    setActionMsg(null);
    setError(null);
    try {
      const r = await postLinkSourceRecord(id, { createNew: true });
      const cid = (r as { company_id?: string }).company_id;
      await load();
      if (cid) router.push(`/foundry/companies/${cid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusyCreate(false);
    }
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb
        items={[
          { label: 'Foundry', href: '/foundry' },
          { label: 'Imports', href: '/foundry/imports' },
          { label: 'Source record' },
        ]}
      />
      <PageHeader
        title="Source record"
        subtitle="Link this import to one registry company—or create that company if it is new."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {actionMsg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{actionMsg}</Text> : null}

      {!vm ? (
        <Text className="text-gray-500 font-instrument text-sm">Loading…</Text>
      ) : vm.linked.companyId ? (
        <>
          <SourceImportedRowSummary imported={vm.imported} normalization={vm.normalization} density="comfortable" />

          <View className="mb-4 p-4 rounded-2xl border border-white/[0.08] bg-[#141414]">
            <Text className="text-neutral-500 font-instrument text-[11px] font-medium tracking-wide mb-1">Link status</Text>
            <Text className="text-emerald-400/90 font-instrument text-sm">
              Linked to {vm.linked.companyLegalName ?? vm.linked.companyId}
            </Text>
            <Button
              variant="link"
              size="xs"
              className="self-start px-0 mt-1"
              onPress={() => router.push(`/foundry/companies/${vm.linked.companyId}`)}
            >
              Open linked company
            </Button>
          </View>
        </>
      ) : (
        <>
          <Pressable onPress={() => setShowLinkingHelp((v) => !v)} className="mb-2 py-1 self-start">
            <Text className="text-neutral-500 font-instrument text-xs">
              {showLinkingHelp ? '▼' : '▶'} What is linking?
            </Text>
          </Pressable>
          {showLinkingHelp ? (
            <Text className="text-neutral-400 font-instrument text-xs mb-4 leading-5">
              One import row connects to at most one registry company. Match scores are name similarity—not proof they are
              the same business.
            </Text>
          ) : null}

          <SourceLinkDecisionLadder
            vm={vm}
            density="comfortable"
            importRunRecordsHref={runRecordsHref}
            busyCompanyId={busyCompanyId}
            disabled={busy || busyCreate}
            onPickCompany={linkFromSearchOrCandidate}
            createBusy={busyCreate}
            onCreateCompany={runCreateAndLink}
            showGenerateCandidatesHint={noCandidates}
          />

          <Text className="text-neutral-500 font-instrument text-[11px] font-medium tracking-wide mb-2 mt-8">
            Directory actions
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || busyCreate}
              onPress={async () => {
                setBusy(true);
                setActionMsg(null);
                setError(null);
                try {
                  const r = await postGenerateSourceCandidates(id);
                  setActionMsg(formatGenerateCandidatesMessage(r));
                  await load();
                } catch (e) {
                  const msg = e instanceof Error ? e.message : 'Failed';
                  setError(msg);
                  if (/normalization|normalize/i.test(msg) && runRecordsHref) {
                    setActionMsg(
                      `Tip: wait for the import normalize job to finish, then refresh—or open Runs if it failed.`,
                    );
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Generate candidates
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || busyCreate}
              onPress={async () => {
                setBusy(true);
                setActionMsg(null);
                setError(null);
                try {
                  await postRejectSourceCandidates(id);
                  setActionMsg('Candidates rejected. You can generate again or link manually.');
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reject candidates
            </Button>
          </View>
        </>
      )}

      <Pressable onPress={() => setShowRawJson((v) => !v)} className="mb-2 py-2">
        <Text className="text-gray-500 font-instrument text-xs">
          {showRawJson ? '▼ Hide API payload (debug)' : '▶ Show API payload (debug)'}
        </Text>
      </Pressable>
      {showRawJson && detail ? (
        <Text className="text-gray-300 font-mono text-xs leading-5 mb-4">{JSON.stringify(detail, null, 2)}</Text>
      ) : null}
    </ScrollView>
  );
}
