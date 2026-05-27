import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState, useSmoothLoading } from '@/components/ui/feedback';
import { WorkbenchBulkReviewSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { useAccount } from '@/contexts/AccountContext';
import { bulkScopeFromListMembership } from '@/lib/leads/workbench/bulk/bulkScope';
import {
  WorkbenchBulkMetricRow,
  WorkbenchBulkMetricsGrid,
} from '@/lib/leads/workbench/bulk/workbenchBulkModalMetrics';
import {
  LIST_MEMBERSHIP_LARGE_VIEW_THRESHOLD,
} from '@/lib/leads/workbench/listMembershipConstants';
import { LIST_MEMBERSHIP_REVIEW_HELP } from '@/lib/leads/workbench/listMembershipReviewHelp';
import type { AccountLeadExplorerQuery } from '@/lib/supabase/services/leads/account-leads';
import { getListMembershipReviewForScope } from '@/lib/supabase/services/leads/list-membership-scoped';
import type {
  AddListMembershipReviewSummary,
  RemoveListMembershipReviewSummary,
} from '@/lib/supabase/services/leads/list-membership-review';
import {
  addExplorerViewToSavedLeadList,
  addMembersToSavedLeadList,
  getSavedLeadLists,
  removeAllFromSavedLeadList,
  removeExplorerViewFromSavedLeadList,
  removeMembersFromSavedLeadList,
  removeSavedListPeopleView,
  type AddMembersToSavedLeadListResult,
  type RemoveMembersFromSavedLeadListResult,
  type SavedLeadListPeopleQuery,
  type SavedLeadListSummary,
} from '@/lib/supabase/services/leads/saved-lists';

export type ListMembershipMode = 'add' | 'remove';
export type ListMembershipScope = 'selection' | 'explorerView' | 'listAll' | 'listFiltered';

type Step = 'choose' | 'review' | 'applying';

export type ListMembershipSuccessResult =
  | AddMembersToSavedLeadListResult
  | RemoveMembersFromSavedLeadListResult
  | { removed: number };

function formatListLabel(list: SavedLeadListSummary) {
  return {
    primary: list.name,
    secondary: `${list.leadCount.toLocaleString()} lead${list.leadCount === 1 ? '' : 's'}`,
  };
}

function listEmptyMessage(hasSearch: boolean): string {
  return hasSearch ? 'No lists match' : 'No saved lists available.';
}

export function LeadsListMembershipModal({
  visible,
  mode,
  scope,
  globalLeadIds = [],
  explorerQuery,
  listPeopleQuery,
  targetListId = null,
  excludeListId = null,
  matchingCount = 0,
  scopeLabel,
  listName,
  memberSource = 'selection',
  onClose,
  onSuccess,
}: {
  visible: boolean;
  mode: ListMembershipMode;
  scope: ListMembershipScope;
  globalLeadIds?: string[];
  explorerQuery?: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
  listPeopleQuery?: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
  targetListId?: string | null;
  excludeListId?: string | null;
  matchingCount?: number;
  scopeLabel: string;
  listName?: string;
  memberSource?: 'selection' | 'manual';
  onClose: () => void;
  onSuccess: (result: ListMembershipSuccessResult) => void;
}) {
  const { account } = useAccount();
  const [step, setStep] = useState<Step>(targetListId ? 'review' : 'choose');
  const [lists, setLists] = useState<SavedLeadListSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(targetListId);
  const [addReview, setAddReview] = useState<AddListMembershipReviewSummary | null>(null);
  const [removeReview, setRemoveReview] = useState<RemoveListMembershipReviewSummary | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const showReviewSkeleton = useSmoothLoading(reviewLoading);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Updating list...');
  const [sessionLeadIds, setSessionLeadIds] = useState<string[]>([]);
  const [sessionScopeLabel, setSessionScopeLabel] = useState('');
  const wasVisibleRef = useRef(false);

  const effectiveListId = targetListId ?? selectedListId;

  const effectiveCount =
    scope === 'selection'
      ? sessionLeadIds.length
      : (addReview?.requested ?? removeReview?.requested ?? matchingCount);

  const availableLists = useMemo(
    () => (excludeListId ? lists.filter((list) => list.id !== excludeListId) : lists),
    [excludeListId, lists],
  );

  const selectedList = useMemo(
    () => availableLists.find((list) => list.id === effectiveListId) ?? null,
    [availableLists, effectiveListId],
  );

  const title =
    mode === 'add'
      ? scope === 'explorerView'
        ? 'Add view to list'
        : 'Add to list'
      : scope === 'listAll'
        ? 'Remove all from list'
        : scope === 'listFiltered'
          ? 'Remove from list'
          : scope === 'explorerView'
            ? 'Remove view from list'
            : 'Remove from list';

  const targetListLabel = listName ?? selectedList?.name;

  const description =
    mode === 'add'
      ? `Add ${sessionScopeLabel || scopeLabel} to an existing saved list.`
      : targetListId && targetListLabel
        ? `Remove ${sessionScopeLabel || scopeLabel} from "${targetListLabel}". This does not remove people from campaigns.`
        : `Remove ${sessionScopeLabel || scopeLabel} from a saved list. This does not remove people from campaigns.`;

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSessionLeadIds(scope === 'selection' ? [...globalLeadIds] : []);
      setSessionScopeLabel(scopeLabel);
      setStep(targetListId ? 'review' : 'choose');
      setSaving(false);
      setSelectedListId(targetListId);
      setAddReview(null);
      setRemoveReview(null);
      setError(null);
      setLoadingMessage('Updating list...');
    }
    wasVisibleRef.current = visible;
  }, [globalLeadIds, scope, scopeLabel, targetListId, visible]);

  useEffect(() => {
    if (!visible || !account?.id || targetListId) {
      if (!targetListId) setLists([]);
      return;
    }

    let cancelled = false;
    setListsLoading(true);
    void (async () => {
      try {
        const rows = await getSavedLeadLists(account.id);
        if (!cancelled) setLists(rows);
      } catch {
        if (!cancelled) setLists([]);
      } finally {
        if (!cancelled) setListsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, targetListId, visible]);

  const reviewLeadIds = useMemo(() => {
    if (scope !== 'selection') return [];
    return sessionLeadIds.length > 0 ? sessionLeadIds : globalLeadIds;
  }, [globalLeadIds, scope, sessionLeadIds]);

  useEffect(() => {
    if (!visible || step !== 'review' || !effectiveListId || !account?.id) return;

    let cancelled = false;
    setReviewLoading(true);
    setError(null);

    void (async () => {
      try {
        const reviewScope = bulkScopeFromListMembership(scope, {
          globalLeadIds: reviewLeadIds,
          explorerQuery,
          listId: effectiveListId,
          listPeopleQuery,
        });
        const summary = await getListMembershipReviewForScope(
          account.id,
          effectiveListId,
          reviewScope,
          mode,
        );
        if (cancelled) return;
        if (mode === 'add') {
          setAddReview(summary as AddListMembershipReviewSummary);
          setRemoveReview(null);
        } else {
          setRemoveReview(summary as RemoveListMembershipReviewSummary);
          setAddReview(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load review details.');
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    account?.id,
    effectiveListId,
    explorerQuery,
    listPeopleQuery,
    mode,
    reviewLeadIds,
    scope,
    step,
    visible,
  ]);

  const handleClose = useCallback(() => {
    if (saving) return;
    setError(null);
    onClose();
  }, [onClose, saving]);

  const handleContinueToReview = useCallback(() => {
    if (!effectiveListId) {
      setError('Choose a list first.');
      return;
    }
    setStep('review');
  }, [effectiveListId]);

  const handleConfirm = useCallback(async () => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    if (!effectiveListId) {
      setError('Choose a list first.');
      return;
    }
    if (scope === 'selection' && sessionLeadIds.length === 0) {
      setError('No leads in scope.');
      return;
    }

    try {
      setSaving(true);
      setStep('applying');
      setError(null);

      if (effectiveCount >= LIST_MEMBERSHIP_LARGE_VIEW_THRESHOLD) {
        setLoadingMessage('Updating list… this may take a minute.');
      }

      let result: ListMembershipSuccessResult;

      if (mode === 'add') {
        if (scope === 'explorerView' && explorerQuery) {
          result = await addExplorerViewToSavedLeadList(account.id, {
            listId: effectiveListId,
            query: explorerQuery,
            source: memberSource,
          });
        } else {
          result = await addMembersToSavedLeadList(account.id, {
            listId: effectiveListId,
            globalLeadIds: sessionLeadIds,
            source: memberSource,
          });
        }
      } else if (scope === 'listAll') {
        result = await removeAllFromSavedLeadList(account.id, effectiveListId);
      } else if (scope === 'listFiltered' && listPeopleQuery) {
        result = await removeSavedListPeopleView(account.id, {
          listId: effectiveListId,
          query: listPeopleQuery,
        });
      } else if (scope === 'explorerView' && explorerQuery) {
        result = await removeExplorerViewFromSavedLeadList(account.id, {
          listId: effectiveListId,
          query: explorerQuery,
        });
      } else {
        result = await removeMembersFromSavedLeadList(account.id, {
          listId: effectiveListId,
          globalLeadIds: sessionLeadIds,
        });
      }

      onClose();
      onSuccess(result);
    } catch (nextError) {
      setStep('review');
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to update list membership.',
      );
    } finally {
      setSaving(false);
      setLoadingMessage('Updating list...');
    }
  }, [
    account?.id,
    effectiveCount,
    effectiveListId,
    explorerQuery,
    listPeopleQuery,
    memberSource,
    mode,
    onClose,
    onSuccess,
    scope,
    sessionLeadIds,
  ]);

  const confirmDisabled = useMemo(() => {
    if (reviewLoading) return true;
    if (mode === 'add') {
      return (addReview?.toAdd ?? 0) === 0;
    }
    const reviewedToRemove = removeReview?.toRemove;
    if (reviewedToRemove !== undefined) {
      return reviewedToRemove === 0;
    }
    if (scope === 'listAll' || scope === 'listFiltered') {
      return (matchingCount ?? 0) === 0;
    }
    return true;
  }, [addReview?.toAdd, matchingCount, mode, removeReview?.toRemove, reviewLoading, scope]);

  const confirmLabel =
    mode === 'add'
      ? 'Add to list'
      : scope === 'listAll'
        ? 'Remove all from list'
        : scope === 'listFiltered' && matchingCount > 0
          ? `Remove filtered (${matchingCount.toLocaleString()})`
          : 'Remove from list';

  const footer =
    step === 'applying' ? null : step === 'choose' ? (
      <ModalFooter>
        <Button variant="secondary" onPress={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button onPress={handleContinueToReview} disabled={!effectiveListId || listsLoading}>
          Continue
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        {!targetListId ? (
          <Button variant="secondary" onPress={() => setStep('choose')} disabled={saving}>
            Back
          </Button>
        ) : (
          <Button variant="secondary" onPress={handleClose} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button
          variant={mode === 'remove' ? 'destructive' : 'primary'}
          onPress={() => void handleConfirm()}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title={title}
      description={description}
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {error ? <Alert variant="error" message={error} /> : null}

        {step === 'applying' ? (
          <LoadingState message={loadingMessage} className="py-12" />
        ) : null}

        {step === 'choose' && !targetListId ? (
          <>
            <Select<SavedLeadListSummary>
              label="Saved list"
              items={availableLists}
              getItemId={(item) => item.id}
              getItemLabel={formatListLabel}
              value={selectedListId}
              onChange={(id) => setSelectedListId(id)}
              placeholder={listsLoading ? 'Loading lists…' : 'Select a list'}
              searchPlaceholder="Search lists…"
              emptyMessage={listEmptyMessage}
              loading={listsLoading}
              variant="solid"
              listMaxHeight={280}
            />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            {scope === 'listAll' ? (
              <Alert
                variant="error"
                message={`This removes every member from "${listName ?? selectedList?.name ?? 'this list'}". ${LIST_MEMBERSHIP_REVIEW_HELP.emptyList}`}
              />
            ) : null}

            {reviewLoading || showReviewSkeleton ? (
              <WorkbenchBulkReviewSkeleton />
            ) : mode === 'add' && addReview ? (
              <WorkbenchBulkMetricsGrid>
                {selectedList || listName ? (
                  <Text className="text-white font-instrument text-sm mb-1">
                    Target: {selectedList?.name ?? listName}
                  </Text>
                ) : null}
                <WorkbenchBulkMetricRow
                  label="Requested"
                  value={addReview.requested}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.requested}
                />
                <WorkbenchBulkMetricRow
                  label="Already in list"
                  value={addReview.alreadyMember}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.alreadyMember}
                />
                <WorkbenchBulkMetricRow
                  label="Will add"
                  value={addReview.toAdd}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.toAdd}
                />
                <WorkbenchBulkMetricRow
                  label="Not in account"
                  value={addReview.notInAccount}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.notInAccount}
                />
              </WorkbenchBulkMetricsGrid>
            ) : mode === 'remove' && removeReview ? (
              <WorkbenchBulkMetricsGrid>
                {selectedList || listName ? (
                  <Text className="text-white font-instrument text-sm mb-1">
                    Target: {selectedList?.name ?? listName}
                  </Text>
                ) : null}
                <WorkbenchBulkMetricRow
                  label="Requested"
                  value={removeReview.requested}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.requested}
                />
                <WorkbenchBulkMetricRow
                  label="In list"
                  value={removeReview.inList}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.inList}
                />
                <WorkbenchBulkMetricRow
                  label="Will remove"
                  value={removeReview.toRemove}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.toRemove}
                />
                <WorkbenchBulkMetricRow
                  label="Not in list"
                  value={removeReview.notInList}
                  help={LIST_MEMBERSHIP_REVIEW_HELP.notInList}
                />
              </WorkbenchBulkMetricsGrid>
            ) : null}
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
