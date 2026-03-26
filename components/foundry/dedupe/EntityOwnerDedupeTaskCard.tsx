import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { DedupeMergeModal, type DedupeMergeField } from '@/components/foundry/dedupe/DedupeMergeModal';
import { DedupeDeleteDialog } from '@/components/foundry/dedupe/DedupeDeleteDialog';
import {
  fetchEntityOwnersByCluster,
  fetchEntityOwnersByIds,
  postEntityOwnerMerge,
  postReviewTaskResolve,
} from '@/lib/foundry/registry-client';
import {
  parseEntityOwnerDedupeTaskPayload,
  type RegistryEntityOwnerRow,
  type ReviewTaskRow,
} from '@/lib/foundry/registry-types';

const ownerMergeFields: DedupeMergeField[] = [
  { key: 'owner_name', label: 'Owner name' },
  { key: 'title_role', label: 'Title / role' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
];

export function EntityOwnerDedupeTaskCard({
  task,
  onTasksChanged,
}: {
  task: ReviewTaskRow;
  onTasksChanged: () => void;
}) {
  const [rows, setRows] = useState<RegistryEntityOwnerRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const parsed = parseEntityOwnerDedupeTaskPayload(task.payload);
    try {
      if (parsed.status === 'ready') {
        const r = await fetchEntityOwnersByIds(parsed.candidateIds);
        setRows(r.entity_owners);
        return;
      }
      if (parsed.status === 'needs_cluster_fetch') {
        const r = await fetchEntityOwnersByCluster(parsed.stateEntityId, parsed.ownerNormalizedKey);
        setRows(r.entity_owners);
        return;
      }
      setRows([]);
      setLoadError('This task has no usable duplicate candidate list.');
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [task.payload, task.id]);

  useEffect(() => {
    setSelectedKeys(new Set());
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (mergeOpen && selectedKeys.size < 2) setMergeOpen(false);
  }, [mergeOpen, selectedKeys.size]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(r.id)),
    [rows, selectedKeys],
  );

  const columns = useMemo(
    (): TableColumn<RegistryEntityOwnerRow>[] => [
      {
        key: 'owner',
        label: 'Owner',
        flex: 1.4,
        minWidth: 140,
        render: (r) => (
          <View className="min-w-0">
            <Text className="text-white font-instrument text-sm" numberOfLines={2}>
              {r.owner_name}
            </Text>
            {r.owner_normalized_key ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {r.owner_normalized_key}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'title',
        label: 'Title',
        flex: 0.9,
        minWidth: 90,
        render: (r) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {r.title_role ?? '—'}
          </Text>
        ),
      },
      {
        key: 'names',
        label: 'Parsed name',
        flex: 1,
        minWidth: 100,
        render: (r) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}
          </Text>
        ),
      },
    ],
    [],
  );

  const valueMatrix = useMemo(
    () => [
      selectedRows.map((r) => r.owner_name),
      selectedRows.map((r) => r.title_role ?? ''),
      selectedRows.map((r) => r.first_name ?? ''),
      selectedRows.map((r) => r.last_name ?? ''),
    ],
    [selectedRows],
  );

  const canMerge = selectedRows.length >= 2;
  const deleteTargetId = selectedRows.length === 1 ? selectedRows[0]!.id : null;
  const needsDismissOnly = !loading && !loadError && rows.length < 2;

  const dismiss = async () => {
    setActionErr(null);
    setActionMsg(null);
    try {
      await postReviewTaskResolve(task.id, {
        entity_owner_dedupe_dismiss: true,
        resolution: { via: 'foundry_dedupe_ui' },
      });
      setActionMsg('Task dismissed.');
      onTasksChanged();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Dismiss failed');
    }
  };

  const handleMergeConfirm = async (merged: Record<string, string>, survivorIdx: number) => {
    const list = selectedRows;
    if (list.length < 2) return;
    const survivor = list[survivorIdx];
    if (!survivor) return;
    const others = list.filter((_, i) => i !== survivorIdx).map((r) => r.id);
    setMergeBusy(true);
    setActionErr(null);
    try {
      await postEntityOwnerMerge({
        survivor_entity_owner_id: survivor.id,
        other_entity_owner_ids: others,
        merged: {
          owner_name: merged.owner_name,
          title_role: merged.title_role.trim() ? merged.title_role : null,
          first_name: merged.first_name.trim() ? merged.first_name : null,
          last_name: merged.last_name.trim() ? merged.last_name : null,
        },
        review_task_id: task.id,
      });
      setMergeOpen(false);
      setSelectedKeys(new Set());
      onTasksChanged();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setMergeBusy(false);
    }
  };

  const p = task.payload as Record<string, unknown>;
  const keyHint =
    typeof p.owner_normalized_key === 'string' ? p.owner_normalized_key : null;

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
      <View className="flex-row flex-wrap items-start justify-between gap-2 mb-2">
        <View className="flex-1 min-w-[200px]">
          <Text className="text-white font-instrument-semibold text-sm">Contact dedupe</Text>
          <Text className="text-gray-500 font-instrument text-xs mt-1" selectable>
            Task {task.id.slice(0, 8)}… · {rows.length} candidate{rows.length === 1 ? '' : 's'}
            {keyHint ? ` · key ${keyHint.slice(0, 36)}${keyHint.length > 36 ? '…' : ''}` : ''}
          </Text>
        </View>
        <Button variant="secondary" size="sm" onPress={() => void dismiss()}>
          Dismiss task
        </Button>
      </View>

      {actionErr ? <Text className="text-red-400 font-instrument text-xs mb-2">{actionErr}</Text> : null}
      {actionMsg ? <Text className="text-emerald-400/90 font-instrument text-xs mb-2">{actionMsg}</Text> : null}
      {loadError ? <Text className="text-red-400 font-instrument text-sm mb-2">{loadError}</Text> : null}

      {needsDismissOnly ? (
        <Text className="text-amber-400/90 font-instrument text-xs mb-2">
          Fewer than two contacts in this cluster. Dismiss if this is resolved.
        </Text>
      ) : null}

      {!loadError || rows.length > 0 ? (
        <DataTable<RegistryEntityOwnerRow>
          items={rows}
          columns={columns}
          getItemKey={(r) => r.id}
          loading={loading}
          pagination={false}
          compactHeader
          equalColumnWidths={false}
          itemsPerPage={50}
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          emptyMessage={loading ? '…' : 'No rows.'}
        />
      ) : null}

      <View className="flex-row flex-wrap gap-2 mt-3">
        <Button variant="default" size="sm" disabled={!canMerge} onPress={() => setMergeOpen(true)}>
          Merge selected
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!deleteTargetId}
          onPress={() => {
            setActionErr(null);
            setDeleteOpen(true);
          }}
        >
          Delete selected
        </Button>
      </View>

      <DedupeMergeModal
        visible={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge contacts (owners)"
        columnLabels={selectedRows.map((r) => r.owner_name.slice(0, 48))}
        fields={ownerMergeFields}
        valueMatrix={valueMatrix}
        onConfirm={handleMergeConfirm}
        busy={mergeBusy}
      />

      <DedupeDeleteDialog
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        mode="entity_owner"
        targetId={deleteTargetId}
        onDeleted={() => {
          setDeleteOpen(false);
          setSelectedKeys(new Set());
          void loadRows();
          onTasksChanged();
        }}
      />
    </View>
  );
}
