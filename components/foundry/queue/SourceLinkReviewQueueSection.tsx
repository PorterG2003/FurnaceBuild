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
import { SourceLinkDecisionLadder } from '@/components/foundry/source-records/SourceLinkDecisionLadder';
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

  if (!notLinked) {
    return (
      <View className="mt-2">
        <Text className="text-emerald-400/90 font-instrument text-xs mb-2">This row is already linked.</Text>
        <Button
          variant="link"
          size="xs"
          className="self-start px-0"
          onPress={() => router.push(`/foundry/source-records/${task.entity_id}`)}
        >
          Open full source record
        </Button>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <SourceLinkDecisionLadder
        vm={vm}
        density="compact"
        importRunRecordsHref={importRunRecordsHref}
        busyCompanyId={busyCompanyId}
        disabled={actionBusy}
        onPickCompany={linkCompany}
        createBusy={busyCreate}
        onCreateCompany={async () => {
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
        trailingSlot={
          <View>
            <Pressable onPress={() => router.push(`/foundry/source-records/${task.entity_id}`)} className="self-start py-1 mb-1">
              <Text className="text-sky-400/90 font-instrument text-sm">Full record</Text>
            </Pressable>
            <Pressable onPress={() => setShowAdvanced((s) => !s)} className="py-2 self-start">
              <Text className="text-neutral-500 font-instrument text-xs">
                {showAdvanced ? '▼' : '▶'} Paste company UUID
              </Text>
            </Pressable>
            {showAdvanced ? (
              <View className="mt-1 mb-1">
                <Text className="text-neutral-500 font-instrument text-[11px] mb-1.5">Company UUID</Text>
                <TextInput
                  value={chosenCompanyId}
                  onChangeText={setChosenCompanyId}
                  placeholder="UUID…"
                  placeholderTextColor="#666"
                  className="text-neutral-100 font-mono text-xs px-3 py-2 rounded-xl border border-white/[0.08] bg-black/30"
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
        }
      />
    </View>
  );
}
