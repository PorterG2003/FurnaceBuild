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
import { SourceCompanyCandidateList } from '@/components/foundry/source-records/SourceCompanyCandidateList';
import { SourceLinkAdjudicationExplainer } from '@/components/foundry/source-records/SourceLinkAdjudicationExplainer';
import { SourceLinkNoMatchGuidance } from '@/components/foundry/source-records/SourceLinkNoMatchGuidance';
import { RegistryCompanySearchPanel } from '@/components/foundry/source-records/RegistryCompanySearchPanel';
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
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

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

  const notLinked = vm != null && vm.linked.companyId == null;
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
        subtitle="Connect this one imported row to one company in your registry—or create that company if it does not exist yet."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {actionMsg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{actionMsg}</Text> : null}

      {!vm ? (
        <Text className="text-gray-500 font-instrument text-sm">Loading…</Text>
      ) : (
        <>
          <SourceLinkAdjudicationExplainer variant="full" />

          <SourceImportedRowSummary imported={vm.imported} normalization={vm.normalization} />

          <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#121212]">
            <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-1">Link status</Text>
            {vm.linked.companyId ? (
              <Text className="text-emerald-400/90 font-instrument text-sm">
                Linked to {vm.linked.companyLegalName ?? vm.linked.companyId}
              </Text>
            ) : (
              <Text className="text-amber-500/90 font-instrument text-sm">Not linked — pick a candidate or create a new company.</Text>
            )}
            {vm.linked.companyId ? (
              <Button
                variant="link"
                size="xs"
                className="self-start px-0 mt-1"
                onPress={() => router.push(`/foundry/companies/${vm.linked.companyId}`)}
              >
                Open linked company
              </Button>
            ) : null}
          </View>

          <SourceLinkNoMatchGuidance
            variant="full"
            weakAutomaticMatch={vm.match.weakAutomaticMatch}
            bestCandidateScore={vm.match.bestCandidateScore}
            noCandidates={noCandidates}
            notLinked={notLinked}
            importRunRecordsHref={runRecordsHref}
          />

          <SourceCompanyCandidateList
            candidates={vm.candidates}
            busyCompanyId={busyCompanyId}
            disabled={busy}
            onPickCompany={linkFromSearchOrCandidate}
          />

          {notLinked ? (
            <RegistryCompanySearchPanel
              variant="full"
              busyCompanyId={busyCompanyId}
              disabled={busy}
              onLinkCompany={linkFromSearchOrCandidate}
            />
          ) : null}

          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">More actions</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
            <Text className="text-gray-400">Generate candidates</Text> searches the company directory and adds suggested
            links. <Text className="text-gray-400">Create company + link</Text> adds a new company from this import row.
            <Text className="text-gray-400"> Reject candidates</Text> marks current suggestions wrong so you can regenerate.
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
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
                    setActionMsg(`Tip: wait for the import normalize job to finish, then refresh—or open Runs if it failed.`);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Generate candidates
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
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
                  setBusy(false);
                }
              }}
            >
              Create company + link
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
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

          <Pressable onPress={() => setShowRawJson((v) => !v)} className="mb-2 py-2">
            <Text className="text-gray-500 font-instrument text-xs">
              {showRawJson ? '▼ Hide API payload (debug)' : '▶ Show API payload (debug)'}
            </Text>
          </Pressable>
          {showRawJson && detail ? (
            <Text className="text-gray-300 font-mono text-xs leading-5 mb-4">
              {JSON.stringify(detail, null, 2)}
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
