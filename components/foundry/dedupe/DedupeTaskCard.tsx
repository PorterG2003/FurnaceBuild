import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { CompanyDedupeTable } from '@/components/foundry/dedupe/CompanyDedupeTable';
import { DedupeMergeModal, type DedupeMergeReadOnlyRow } from '@/components/foundry/dedupe/DedupeMergeModal';
import { DedupeDeleteDialog } from '@/components/foundry/dedupe/DedupeDeleteDialog';
import {
  buildCompanyMergePayload,
  buildCompanyMergeReadOnlyRows,
  companyMergeFields,
  getCompanyValueMatrix,
  getSelectedDeleteTargetId,
  loadCompanyMergePreviewDetails,
} from '@/components/foundry/dedupe/dedupeManualActions';
import {
  fetchCompaniesByIds,
  fetchCompaniesByNormalizedKey,
  fetchCompanyDetail,
  postCompanyMerge,
  postReviewTaskResolve,
} from '@/lib/foundry/registry-client';
import {
  parseCompanyDedupeTaskPayload,
  type ParsedCompanyDetail,
  type RegistryCompany,
  type ReviewTaskRow,
} from '@/lib/foundry/registry-types';

export function DedupeTaskCard({
  task,
  onTasksChanged,
}: {
  task: ReviewTaskRow;
  onTasksChanged: () => void;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<RegistryCompany[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [mergePreviewDetails, setMergePreviewDetails] = useState<ParsedCompanyDetail[] | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergePreviewError, setMergePreviewError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const parsed = parseCompanyDedupeTaskPayload(task.payload);
    try {
      if (parsed.status === 'ready') {
        const r = await fetchCompaniesByIds(parsed.candidateIds);
        setCompanies(r.companies);
        return;
      }
      if (parsed.status === 'needs_fetch_by_key') {
        const r = await fetchCompaniesByNormalizedKey(parsed.normalizedKey);
        setCompanies(r.companies);
        return;
      }
      if (parsed.status === 'needs_company_hint') {
        const det = await fetchCompanyDetail(parsed.companyId);
        const nk = det.company?.normalized_key;
        if (nk) {
          const r = await fetchCompaniesByNormalizedKey(nk);
          setCompanies(r.companies);
        } else {
          setCompanies([]);
          setLoadError('Legacy task: company has no normalized_key to expand duplicates.');
        }
        return;
      }
      setCompanies([]);
      setLoadError('This task has no usable duplicate candidate list.');
    } catch (e) {
      setCompanies([]);
      setLoadError(e instanceof Error ? e.message : 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, [task.payload, task.id]);

  useEffect(() => {
    setSelectedKeys(new Set());
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (mergeOpen && selectedKeys.size < 2) setMergeOpen(false);
  }, [mergeOpen, selectedKeys.size]);

  const selectedCompanyIds = useMemo(
    () => companies.filter((c) => selectedKeys.has(c.id)).map((c) => c.id).join(','),
    [companies, selectedKeys],
  );

  useEffect(() => {
    if (!mergeOpen) {
      setMergePreviewLoading(false);
      setMergePreviewDetails(null);
      setMergePreviewError(null);
      return;
    }
    const ids = selectedCompanyIds.split(',').filter(Boolean);
    if (ids.length < 2) return;

    let cancelled = false;
    setMergePreviewLoading(true);
    setMergePreviewError(null);
    setMergePreviewDetails(null);

    void loadCompanyMergePreviewDetails(ids)
      .then((details) => {
        if (cancelled) return;
        setMergePreviewDetails(details);
        setMergePreviewLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setMergePreviewError(e instanceof Error ? e.message : 'Failed to load merge preview');
        setMergePreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mergeOpen, selectedCompanyIds]);

  const selectedCompanies = useMemo(
    () => companies.filter((c) => selectedKeys.has(c.id)),
    [companies, selectedKeys],
  );

  const companyValueMatrix = useMemo(() => getCompanyValueMatrix(selectedCompanies), [selectedCompanies]);

  const mergeReadOnlyRows = useMemo((): DedupeMergeReadOnlyRow[] | undefined => {
    if (!mergeOpen) return undefined;
    return buildCompanyMergeReadOnlyRows(selectedCompanies, mergePreviewLoading, mergePreviewDetails);
  }, [mergeOpen, selectedCompanies, mergePreviewLoading, mergePreviewDetails]);

  const canMerge = selectedCompanies.length >= 2;
  const deleteTargetId = getSelectedDeleteTargetId(selectedCompanies);
  const needsDismissOnly = !loading && !loadError && companies.length < 2;

  const dismiss = async () => {
    setActionErr(null);
    setActionMsg(null);
    try {
      await postReviewTaskResolve(task.id, {
        company_dedupe_dismiss: true,
        resolution: { via: 'foundry_dedupe_ui' },
      });
      setActionMsg('Task dismissed.');
      onTasksChanged();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Dismiss failed');
    }
  };

  const handleMergeConfirm = async (merged: Record<string, string>, survivorIdx: number) => {
    const list = selectedCompanies;
    const payload = buildCompanyMergePayload(list, merged, survivorIdx);
    if (!payload) return;
    setMergeBusy(true);
    setActionErr(null);
    try {
      await postCompanyMerge({
        ...payload,
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
  const nkHint = typeof p.normalized_key === 'string' ? p.normalized_key : null;

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
      <View className="flex-row flex-wrap items-start justify-between gap-2 mb-2">
        <View className="flex-1 min-w-[200px]">
          <Text className="text-white font-instrument-semibold text-sm">Company dedupe</Text>
          <Text className="text-gray-500 font-instrument text-xs mt-1" selectable>
            Task {task.id.slice(0, 8)}… · {companies.length} candidate{companies.length === 1 ? '' : 's'}
            {nkHint ? ` · key ${nkHint.slice(0, 40)}${nkHint.length > 40 ? '…' : ''}` : ''}
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
          Fewer than two companies in this cluster. Dismiss if this is resolved.
        </Text>
      ) : null}

      {!loadError || companies.length > 0 ? (
        <CompanyDedupeTable
          rows={companies}
          loading={loading}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          onRowPress={(c) => router.push(`/foundry/companies/${c.id}`)}
          emptyMessage={loading ? '…' : 'No rows.'}
        />
      ) : null}

      <View className="flex-row flex-wrap gap-2 mt-3">
        <Button
          variant="default"
          size="sm"
          disabled={!canMerge}
          onPress={() => {
            setMergePreviewLoading(true);
            setMergePreviewError(null);
            setMergePreviewDetails(null);
            setMergeOpen(true);
          }}
        >
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
        title="Merge companies"
        columnLabels={selectedCompanies.map((c) => c.legal_name.slice(0, 48))}
        fields={companyMergeFields}
        valueMatrix={companyValueMatrix}
        onConfirm={handleMergeConfirm}
        busy={mergeBusy}
        readOnlyRows={mergeReadOnlyRows}
        readOnlyBannerError={mergePreviewError}
      />

      <DedupeDeleteDialog
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        mode="company"
        targetId={deleteTargetId}
        onDeleted={() => {
          setDeleteOpen(false);
          setSelectedKeys(new Set());
          void loadCompanies();
          onTasksChanged();
        }}
      />
    </View>
  );
}
