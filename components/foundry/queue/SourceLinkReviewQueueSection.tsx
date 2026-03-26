import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import {
  fetchSourceRecordDetail,
  postLinkSourceRecord,
  postReviewTaskResolve,
} from '@/lib/foundry/registry-client';
import type { ReviewTaskRow, SourceRecordDetailResponse } from '@/lib/foundry/registry-types';
import { SourceImportedRowSummary } from '@/components/foundry/source-records/SourceImportedRowSummary';
import { SourceCompanyCandidateList } from '@/components/foundry/source-records/SourceCompanyCandidateList';
import { SourceLinkAdjudicationExplainer } from '@/components/foundry/source-records/SourceLinkAdjudicationExplainer';
import { SourceLinkNoMatchGuidance } from '@/components/foundry/source-records/SourceLinkNoMatchGuidance';
import { RegistryCompanySearchPanel } from '@/components/foundry/source-records/RegistryCompanySearchPanel';
import { buildSourceRecordViewModel } from '@/components/foundry/source-records/sourceRecordViewModel';

export function SourceLinkReviewQueueSection({
  task,
  onResolved,
  onError,
}: {
  task: ReviewTaskRow;
  onResolved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<SourceRecordDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [chosenCompanyId, setChosenCompanyId] = useState('');
  const [busyAdvanced, setBusyAdvanced] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);

  const actionBusy = busyAdvanced || busyCreate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchErr(null);
    void fetchSourceRecordDetail(task.entity_id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setFetchErr(e instanceof Error ? e.message : 'Failed to load source record');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.entity_id]);

  const vm = useMemo(() => (detail ? buildSourceRecordViewModel(detail) : null), [detail]);

  const importRunRecordsHref =
    vm?.imported.ingestionRunId != null
      ? `/foundry/imports/${vm.imported.ingestionRunId}/records`
      : null;
  const notLinked = vm != null && vm.linked.companyId == null;
  const noCandidates = vm != null && vm.candidates.length === 0;

  const linkCompany = async (companyId: string) => {
    setBusyCompanyId(companyId);
    onError('');
    try {
      await postReviewTaskResolve(task.id, {
        chosen_company_id: companyId,
        resolution: { via: 'foundry_ui' },
      });
      onResolved('Linked');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Resolve failed');
    } finally {
      setBusyCompanyId(null);
    }
  };

  if (loading) {
    return (
      <Text className="text-gray-500 font-instrument text-xs mt-2">Loading source row and candidates…</Text>
    );
  }
  if (fetchErr) {
    return <Text className="text-red-400 font-instrument text-xs mt-2">{fetchErr}</Text>;
  }
  if (!vm) {
    return null;
  }

  return (
    <View className="mt-2">
      <SourceLinkAdjudicationExplainer variant="compact" />
      <SourceImportedRowSummary imported={vm.imported} normalization={vm.normalization} />

      <SourceLinkNoMatchGuidance
        variant="compact"
        weakAutomaticMatch={vm.match.weakAutomaticMatch}
        bestCandidateScore={vm.match.bestCandidateScore}
        noCandidates={noCandidates}
        notLinked={notLinked}
        importRunRecordsHref={importRunRecordsHref}
      />

      <SourceCompanyCandidateList
        candidates={vm.candidates}
        busyCompanyId={busyCompanyId}
        disabled={actionBusy}
        onPickCompany={linkCompany}
      />

      {notLinked ? (
        <RegistryCompanySearchPanel
          variant="compact"
          busyCompanyId={busyCompanyId}
          disabled={actionBusy}
          onLinkCompany={linkCompany}
        />
      ) : null}

      {notLinked ? (
        <View className="mb-3">
          <Text className="text-gray-500 font-instrument text-[11px] leading-5 mb-2">
            New company uses the imported row name as <Text className="text-gray-400">legal name</Text>—fix the source
            row first if that name is wrong.
          </Text>
          <Button
            variant="default"
            size="sm"
            className="self-start"
            disabled={busyCompanyId != null || actionBusy}
            onPress={async () => {
              setBusyCreate(true);
              onError('');
              try {
                await postLinkSourceRecord(task.entity_id, { createNew: true });
                onResolved('Created company and linked');
              } catch (e) {
                onError(e instanceof Error ? e.message : 'Create failed');
              } finally {
                setBusyCreate(false);
              }
            }}
          >
            Create company + link
          </Button>
        </View>
      ) : null}

      <Button
        variant="link"
        size="xs"
        className="self-start px-0 mb-2"
        onPress={() => router.push(`/foundry/source-records/${task.entity_id}`)}
      >
        Open full source record
      </Button>

      <Pressable onPress={() => setShowAdvanced((s) => !s)} className="py-2">
        <Text className="text-gray-500 font-instrument text-xs">
          {showAdvanced ? '▼ Hide advanced (paste company UUID)' : '▶ Advanced: paste company UUID'}
        </Text>
      </Pressable>
      {showAdvanced ? (
        <View className="mt-1">
          <Text className="text-gray-400 font-instrument text-xs mb-1">Company UUID to link</Text>
          <TextInput
            value={chosenCompanyId}
            onChangeText={setChosenCompanyId}
            placeholder="company id"
            placeholderTextColor="#666"
            className="text-gray-200 font-mono text-xs p-2 rounded border border-[#3A3A3A] bg-[#121212]"
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 self-start"
            disabled={busyAdvanced || busyCompanyId != null || busyCreate}
            onPress={async () => {
              setBusyAdvanced(true);
              onError('');
              try {
                await postReviewTaskResolve(task.id, {
                  chosen_company_id: chosenCompanyId.trim(),
                  resolution: { via: 'foundry_ui', advanced_uuid: true },
                });
                onResolved('Linked');
                setChosenCompanyId('');
              } catch (e) {
                onError(e instanceof Error ? e.message : 'Resolve failed');
              } finally {
                setBusyAdvanced(false);
              }
            }}
          >
            Link to pasted UUID
          </Button>
        </View>
      ) : null}
    </View>
  );
}
