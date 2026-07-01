import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Alert, useToast } from '@/components/ui/feedback';
import type { AccountLeadDetail, AccountPersonProfileUpdate } from '@/lib/leads/types';
import { getAccessToken } from '@/lib/services/auth-token';
import { updateAccountPersonProfile } from '@/lib/supabase/services/leads/lead-detail';
import { callApolloEnrich } from '@/lib/apollo/callApolloEnrich';
import type { ApolloProfileSuggestion } from '@/lib/apollo/mapApolloToProfile';
import { pickPhoneFromNumbers } from '@/lib/apollo/mapApolloToProfile';
import {
  getEnrichmentSession,
  getLatestEnrichmentSession,
  pollEnrichmentSession,
} from '@/lib/apollo/pollEnrichmentSession';
import type { ApolloEnrichmentSessionRow } from '@/lib/apollo/enrichmentSessionTypes';
import { isPendingEnrichmentSession } from '@/lib/apollo/enrichmentSessionTypes';
import { getCreditBalance, type CreditBalance } from '@/lib/credits/balance';
import { CREDIT_METERS } from '@/lib/credits/meters';
import {
  ENRICH_COPY,
  enrichIdleInfo,
  enrichMatchInfo,
  enrichNoMatchInfo,
  enrichNothingToApplyInfo,
  enrichErrorInfo,
  enrichRetryInfo,
} from './enrichCopy';
import { EnrichActionGroup } from './EnrichLeadMeta';

type FieldKey =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'title'
  | 'phone_number'
  | 'linkedin_url'
  | 'company_name'
  | 'website';

interface FieldConfig {
  key: FieldKey;
  label: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  isCustom?: boolean;
}

const FIELD_CONFIG: FieldConfig[] = [
  { key: 'name', label: 'Name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'linkedin_url', label: 'LinkedIn', autoCapitalize: 'none' },
  { key: 'company_name', label: 'Company' },
  { key: 'phone_number', label: ENRICH_COPY.companyPhoneLabel },
  { key: 'website', label: 'Website', autoCapitalize: 'none' },
  { key: 'title', label: 'Title', isCustom: true },
];

interface RowState {
  value: string;
  checked: boolean;
}

interface CreditInfo {
  creditsRemaining: number;
  creditLimit: number;
}

function toCreditBalance(credits: CreditInfo): CreditBalance {
  return {
    remaining: credits.creditsRemaining,
    limit: credits.creditLimit,
    used: credits.creditLimit - credits.creditsRemaining,
  };
}

function creditBalanceFromState(state: ScreenState): CreditBalance | null {
  if (state.kind === 'loading') return null;
  return toCreditBalance({
    creditsRemaining: state.creditsRemaining,
    creditLimit: state.creditLimit,
  });
}

function mergeCustomFields(detail: AccountLeadDetail): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const membership of detail.person.memberships) {
    for (const [key, value] of Object.entries(membership.customLeadData)) {
      if (value != null && merged[key] === undefined) {
        merged[key] = String(value);
      }
    }
  }
  return merged;
}

function getNewestMembership(detail: AccountLeadDetail) {
  let newest = detail.person.memberships[0] ?? null;
  for (const membership of detail.person.memberships) {
    if (!newest || membership.createdAt.localeCompare(newest.createdAt) > 0) {
      newest = membership;
    }
  }
  return newest;
}

function pickCurrent(detail: AccountLeadDetail): Record<FieldKey, string> {
  const newest = getNewestMembership(detail);
  const custom = mergeCustomFields(detail);
  return {
    name: detail.person.displayName ?? '',
    first_name: detail.person.firstName ?? '',
    last_name: detail.person.lastName ?? '',
    title: custom.title ?? '',
    phone_number: newest?.phone ?? '',
    linkedin_url: newest?.linkedinUrl ?? '',
    company_name: newest?.companyName ?? '',
    website: newest?.website ?? '',
  };
}

function pickCurrentMobilePhone(detail: AccountLeadDetail): string {
  const newest = getNewestMembership(detail);
  return newest?.mobilePhone ?? '';
}

function buildRowState(suggestedValue: string | null | undefined, currentValue: string): RowState | null {
  const nextValue = (suggestedValue ?? '').trim();
  if (!nextValue) return null;
  if (currentValue && currentValue.toLowerCase() === nextValue.toLowerCase()) return null;
  return { value: nextValue, checked: currentValue === '' };
}

function seedRowsFromSuggestion(
  suggestion: ApolloProfileSuggestion,
  current: Record<FieldKey, string>,
): Partial<Record<FieldKey, RowState>> {
  const seeded: Partial<Record<FieldKey, RowState>> = {};
  for (const field of FIELD_CONFIG) {
    const suggestedValue = (suggestion[field.key] ?? '').toString().trim();
    if (!suggestedValue) continue;
    const currentValue = (current[field.key] ?? '').trim();
    if (currentValue && currentValue.toLowerCase() === suggestedValue.toLowerCase()) continue;
    seeded[field.key] = { value: suggestedValue, checked: currentValue === '' };
  }
  return seeded;
}

function suggestionFromSession(session: ApolloEnrichmentSessionRow): ApolloProfileSuggestion | null {
  if (!session.sync_suggestion) return null;
  return {
    ...session.sync_suggestion,
    mobile_phone_number: pickPhoneFromNumbers(session.phone_numbers),
  };
}

type ScreenState =
  | { kind: 'loading'; mode: 'initial' | 'enriching' }
  | { kind: 'idle'; creditsRemaining: number; creditLimit: number }
  | { kind: 'error'; message: string; code?: string; creditsRemaining: number; creditLimit: number }
  | {
      kind: 'no_match';
      creditsRemaining: number;
      creditLimit: number;
      isCached: boolean;
      enrichedAt?: string;
    }
  | {
      kind: 'match';
      sessionId: string;
      suggestion: ApolloProfileSuggestion;
      creditsRemaining: number;
      creditLimit: number;
      phonePending: boolean;
      phoneFetchTimedOut: boolean;
      isCached: boolean;
      enrichedAt?: string;
    };

export function EnrichLeadScreen({
  accountId,
  detail,
  onApplied,
  onCancel,
  layout = 'panel',
  onCreditsChange,
}: {
  accountId: string;
  detail: AccountLeadDetail;
  onApplied: () => void;
  onCancel: () => void;
  /** Desktop side panel vs mobile full page. */
  layout?: 'panel' | 'page';
  /** Fired when the screen learns an updated credit balance (e.g. after enrich). */
  onCreditsChange?: (balance: CreditBalance) => void;
}) {
  const isPage = layout === 'page';
  const { toast } = useToast();
  const globalLeadId = detail.person.globalLeadId;
  const current = useMemo(() => pickCurrent(detail), [detail]);
  const currentMobilePhone = useMemo(() => pickCurrentMobilePhone(detail), [detail]);
  const existingCustom = useMemo(() => mergeCustomFields(detail), [detail]);

  const [state, setState] = useState<ScreenState>({ kind: 'loading', mode: 'initial' });
  const [rows, setRows] = useState<Partial<Record<FieldKey, RowState>>>({});
  const [mobileRow, setMobileRow] = useState<RowState | null>(null);
  const [saving, setSaving] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const lastNotifiedCreditsRef = useRef<string | null>(null);
  const initialLoadIdRef = useRef(0);

  const applyMatchState = useCallback(
    (
      sessionId: string,
      suggestion: ApolloProfileSuggestion,
      credits: CreditInfo,
      phonePending: boolean,
      options: { isCached: boolean; enrichedAt?: string } = { isCached: false },
    ) => {
      setRows(seedRowsFromSuggestion(suggestion, current));
      setMobileRow(buildRowState(suggestion.mobile_phone_number, currentMobilePhone));
      setState({
        kind: 'match',
        sessionId,
        suggestion,
        creditsRemaining: credits.creditsRemaining,
        creditLimit: credits.creditLimit,
        phonePending,
        phoneFetchTimedOut: false,
        isCached: options.isCached,
        enrichedAt: options.enrichedAt,
      });
    },
    [current, currentMobilePhone],
  );

  const startPhonePolling = useCallback(
    (sessionId: string) => {
      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      void pollEnrichmentSession(
        sessionId,
        (session) => {
          if (!session.sync_suggestion) return;

          const mobilePhone = pickPhoneFromNumbers(session.phone_numbers);
          const mergedSuggestion: ApolloProfileSuggestion = {
            ...session.sync_suggestion,
            mobile_phone_number: mobilePhone,
          };

          setState((prev) => {
            if (prev.kind !== 'match' || prev.sessionId !== sessionId) return prev;
            const stillPending = isPendingEnrichmentSession(session);
            return {
              ...prev,
              suggestion: mergedSuggestion,
              phonePending: stillPending,
              phoneFetchTimedOut: !stillPending && !mobilePhone,
            };
          });

          if (mobilePhone) {
            setMobileRow((prev) => {
              if (!prev) {
                return buildRowState(mobilePhone, currentMobilePhone);
              }
              return { ...prev, value: mobilePhone };
            });
          }
        },
        { signal: controller.signal },
      ).catch(() => {
        // Aborted or transient — non-fatal while panel is open.
      });
    },
    [currentMobilePhone],
  );

  const loadInitialState = useCallback(async (loadId: number) => {
    setState({ kind: 'loading', mode: 'initial' });
    try {
      const [session, balance] = await Promise.all([
        getLatestEnrichmentSession(accountId, globalLeadId),
        getCreditBalance(accountId, CREDIT_METERS.apolloEnrichment),
      ]);
      if (loadId !== initialLoadIdRef.current) return;

      const credits: CreditInfo = {
        creditsRemaining: balance.remaining,
        creditLimit: balance.limit,
      };

      if (!session) {
        setState({ kind: 'idle', ...credits });
        return;
      }

      if (session.status === 'no_match') {
        setState({
          kind: 'no_match',
          creditsRemaining: credits.creditsRemaining,
          creditLimit: credits.creditLimit,
          isCached: true,
          enrichedAt: session.created_at,
        });
        return;
      }

      const suggestion = suggestionFromSession(session);
      if (!suggestion) {
        setState({ kind: 'idle', ...credits });
        return;
      }

      const phonePending = isPendingEnrichmentSession(session);
      applyMatchState(session.id, suggestion, credits, phonePending, {
        isCached: true,
        enrichedAt: session.created_at,
      });
      if (phonePending) {
        startPhonePolling(session.id);
      }
    } catch (err) {
      if (loadId !== initialLoadIdRef.current) return;
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load enrichment',
        creditsRemaining: 0,
        creditLimit: 0,
      });
    }
  }, [accountId, applyMatchState, globalLeadId, startPhonePolling]);

  const runEnrich = useCallback(async () => {
    const priorCredits =
      state.kind !== 'loading'
        ? { creditsRemaining: state.creditsRemaining, creditLimit: state.creditLimit }
        : null;
    setState({ kind: 'loading', mode: 'enriching' });
    const result = await callApolloEnrich({ accountId, globalLeadId });

    if (!result.ok) {
      setState({
        kind: 'error',
        message: result.message,
        code: result.code,
        creditsRemaining: result.creditsRemaining ?? priorCredits?.creditsRemaining ?? 0,
        creditLimit: result.creditLimit ?? priorCredits?.creditLimit ?? 0,
      });
      return;
    }

    if ('pending' in result && result.pending) {
      const session = await getEnrichmentSession(result.sessionId);
      const balance = await getCreditBalance(accountId, CREDIT_METERS.apolloEnrichment);
      const credits = { creditsRemaining: balance.remaining, creditLimit: balance.limit };
      const suggestion = session ? suggestionFromSession(session) : null;
      if (!suggestion) {
        setState({
          kind: 'error',
          message: 'Enrichment is in progress but results are not ready yet.',
          ...credits,
        });
        startPhonePolling(result.sessionId);
        return;
      }
      applyMatchState(
        result.sessionId,
        suggestion,
        credits,
        true,
        { isCached: false },
      );
      startPhonePolling(result.sessionId);
      return;
    }

    if ('match' in result && !result.match) {
      setState({
        kind: 'no_match',
        creditsRemaining: result.creditsRemaining,
        creditLimit: result.creditLimit,
        isCached: false,
      });
      return;
    }

    if (!('match' in result) || !result.match) {
      return;
    }

    const credits: CreditInfo = {
      creditsRemaining: result.creditsRemaining,
      creditLimit: result.creditLimit,
    };

    applyMatchState(
      result.sessionId,
      result.suggestion,
      credits,
      result.phonePending,
      { isCached: false },
    );
    if (result.phonePending && result.sessionId) {
      startPhonePolling(result.sessionId);
    }
  }, [accountId, applyMatchState, globalLeadId, startPhonePolling, state]);

  useEffect(() => {
    const loadId = ++initialLoadIdRef.current;
    pollAbortRef.current?.abort();
    lastNotifiedCreditsRef.current = null;
    void loadInitialState(loadId);
  }, [accountId, globalLeadId, loadInitialState]);

  useEffect(() => {
    const balance = creditBalanceFromState(state);
    if (!balance || !onCreditsChange) return;
    const key = `${balance.remaining}:${balance.limit}`;
    if (lastNotifiedCreditsRef.current === key) return;
    lastNotifiedCreditsRef.current = key;
    onCreditsChange(balance);
  }, [onCreditsChange, state]);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  const activeFields = useMemo(
    () => FIELD_CONFIG.filter((field) => rows[field.key] !== undefined),
    [rows],
  );

  const selectedCount = useMemo(
    () =>
      activeFields.filter((field) => rows[field.key]?.checked).length + (mobileRow?.checked ? 1 : 0),
    [activeFields, mobileRow?.checked, rows],
  );

  const handleApply = useCallback(async () => {
    const updates: AccountPersonProfileUpdate = {};
    let customTitle: string | null | undefined;

    for (const field of activeFields) {
      const row = rows[field.key];
      if (!row || !row.checked) continue;
      const value = row.value.trim() || null;
      if (field.isCustom && field.key === 'title') {
        customTitle = value;
      } else {
        (updates as Record<string, string | null>)[field.key] = value;
      }
    }

    if (customTitle !== undefined) {
      updates.custom_lead_data = { ...existingCustom, title: customTitle };
    }

    if (mobileRow?.checked) {
      updates.mobile_phone_number = mobileRow.value.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      toast.error('Select at least one field to apply.');
      return;
    }

    try {
      setSaving(true);
      pollAbortRef.current?.abort();
      await getAccessToken();
      await updateAccountPersonProfile(accountId, globalLeadId, updates);
      toast.success('Lead enriched');
      onApplied();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply enrichment');
    } finally {
      setSaving(false);
    }
  }, [accountId, activeFields, existingCustom, globalLeadId, mobileRow, onApplied, rows, toast]);

  if (state.kind === 'loading') {
    return (
      <View className="items-center justify-center py-12 gap-3">
        <ActivityIndicator color="#fff" />
        <Text className="text-sm font-instrument text-gray-400">
          {state.mode === 'initial' ? ENRICH_COPY.loadingInitial : ENRICH_COPY.loading}
        </Text>
      </View>
    );
  }

  if (state.kind === 'idle') {
    return (
      <View className="gap-4 py-2">
        <Alert variant="info" message={enrichIdleInfo(state.creditsRemaining)} />
        <EnrichPaidAction
          isPage={isPage}
          label={ENRICH_COPY.enrichButton}
          creditsRemaining={state.creditsRemaining}
          onPress={() => void runEnrich()}
        />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View className="gap-4 py-2">
        <Alert
          variant="error"
          message={enrichErrorInfo(state.message, state.creditsRemaining, state.code)}
        />
        <EnrichPaidAction
          isPage={isPage}
          label={ENRICH_COPY.retryButton}
          creditsRemaining={state.creditsRemaining}
          onPress={() => void runEnrich()}
        />
      </View>
    );
  }

  if (state.kind === 'no_match') {
    return (
      <View className="gap-4 py-2">
        <Alert
          variant="info"
          message={enrichNoMatchInfo(state.creditsRemaining, {
            isCached: state.isCached,
            enrichedAt: state.enrichedAt,
          })}
        />
        <EnrichPaidAction
          isPage={isPage}
          label={ENRICH_COPY.reEnrichButton}
          creditsRemaining={state.creditsRemaining}
          onPress={() => void runEnrich()}
        />
      </View>
    );
  }

  const showPhonePending = state.phonePending;
  const showPhoneTimeout = state.phoneFetchTimedOut && !showPhonePending;
  const showMobileBox = showPhonePending || showPhoneTimeout || mobileRow !== null;
  const reEnrichDisabled = state.creditsRemaining <= 0;
  const nothingToApply = activeFields.length === 0 && !showMobileBox;

  if (nothingToApply) {
    return (
      <View className="gap-4 py-2">
        <Alert
          variant="info"
          message={enrichNothingToApplyInfo(state.creditsRemaining, {
            isCached: state.isCached,
            enrichedAt: state.enrichedAt,
          })}
        />
        {showMobileBox ? (
          <EnrichMobileNumberBox
            isPage={isPage}
            currentValue={currentMobilePhone}
            row={mobileRow}
            pending={showPhonePending}
            timedOut={showPhoneTimeout}
            onToggle={() => setMobileRow((prev) => (prev ? { ...prev, checked: !prev.checked } : prev))}
            onChangeValue={(next) => setMobileRow((prev) => (prev ? { ...prev, value: next } : prev))}
          />
        ) : null}
        <EnrichPaidAction
          isPage={isPage}
          label={ENRICH_COPY.reEnrichButton}
          creditsRemaining={state.creditsRemaining}
          onPress={() => void runEnrich()}
        />
      </View>
    );
  }

  return (
    <View className="gap-4 py-2">
      <Alert
        variant="info"
        message={enrichMatchInfo(state.creditsRemaining, {
          isCached: state.isCached,
          enrichedAt: state.enrichedAt,
        })}
      />

      <View className={isPage ? 'gap-2' : 'flex-row justify-end'}>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={isPage}
          onPress={() => void runEnrich()}
          disabled={reEnrichDisabled}
        >
          {ENRICH_COPY.reEnrichButton}
        </Button>
      </View>

      <View className={isPage ? 'gap-4' : 'gap-3'}>
          {!isPage ? (
            <View className="flex-row gap-4 ml-9">
              <Text className="flex-1 text-[10px] font-instrument-medium text-gray-500 uppercase tracking-wide">
                Current
              </Text>
              <Text className="flex-1 text-[10px] font-instrument-medium text-gray-500 uppercase tracking-wide">
                Suggested
              </Text>
            </View>
          ) : null}
          {activeFields.map((field) => {
            const row = rows[field.key]!;
            const currentValue = (current[field.key] ?? '').trim();
            return (
              <EnrichRow
                key={field.key}
                label={field.label}
                isPage={isPage}
                currentValue={currentValue}
                checked={row.checked}
                value={row.value}
                autoCapitalize={field.autoCapitalize}
                onToggle={() =>
                  setRows((prev) => ({
                    ...prev,
                    [field.key]: { ...row, checked: !row.checked },
                  }))
                }
                onChangeValue={(next) =>
                  setRows((prev) => ({
                    ...prev,
                    [field.key]: { ...row, value: next },
                  }))
                }
              />
            );
          })}
          {showMobileBox ? (
            <EnrichMobileNumberBox
              isPage={isPage}
              currentValue={currentMobilePhone}
              row={mobileRow}
              pending={showPhonePending}
              timedOut={showPhoneTimeout}
              onToggle={() => setMobileRow((prev) => (prev ? { ...prev, checked: !prev.checked } : prev))}
              onChangeValue={(next) => setMobileRow((prev) => (prev ? { ...prev, value: next } : prev))}
            />
          ) : null}
      </View>

      <EnrichActionFooter
        isPage={isPage}
        saving={saving}
        showCancel
        onCancel={onCancel}
        primaryLabel={
          saving
            ? 'Applying...'
            : selectedCount > 0
              ? `Apply ${selectedCount} field${selectedCount === 1 ? '' : 's'}`
              : 'Apply'
        }
        onPrimary={() => void handleApply()}
        primaryDisabled={saving || selectedCount === 0}
      />
    </View>
  );
}

function EnrichPaidAction({
  isPage,
  label,
  creditsRemaining,
  onPress,
}: {
  isPage: boolean;
  label: string;
  creditsRemaining: number;
  onPress: () => void;
}) {
  const disabled = creditsRemaining <= 0;
  return (
    <EnrichActionGroup>
      <Button
        variant="default"
        fullWidth={isPage}
        size={isPage ? 'default' : 'sm'}
        onPress={onPress}
        disabled={disabled}
      >
        {label}
      </Button>
    </EnrichActionGroup>
  );
}

function EnrichActionFooter({
  isPage,
  saving,
  onCancel,
  showCancel = false,
  cancelLabel = 'Cancel',
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
}: {
  isPage: boolean;
  saving: boolean;
  onCancel: () => void;
  showCancel?: boolean;
  cancelLabel?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
}) {
  if (isPage) {
    return (
      <View className="gap-2 pt-1">
        {primaryLabel && onPrimary ? (
          <Button variant="default" fullWidth onPress={onPrimary} disabled={primaryDisabled || saving}>
            {primaryLabel}
          </Button>
        ) : null}
        {showCancel ? (
          <Button variant="secondary" fullWidth onPress={onCancel} disabled={saving}>
            {cancelLabel}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-row gap-3 justify-end">
      {showCancel ? (
        <Button variant="secondary" size="sm" onPress={onCancel} disabled={saving}>
          {cancelLabel}
        </Button>
      ) : null}
      {primaryLabel && onPrimary ? (
        <Button variant="default" size="sm" onPress={onPrimary} disabled={primaryDisabled || saving}>
          {primaryLabel}
        </Button>
      ) : null}
    </View>
  );
}

function EnrichMobileNumberBox({
  isPage,
  currentValue,
  row,
  pending,
  timedOut,
  onToggle,
  onChangeValue,
}: {
  isPage: boolean;
  currentValue: string;
  row: RowState | null;
  pending: boolean;
  timedOut: boolean;
  onToggle: () => void;
  onChangeValue: (next: string) => void;
}) {
  if (row) {
    return (
      <EnrichRow
        label={ENRICH_COPY.mobileLabel}
        isPage={isPage}
        currentValue={currentValue}
        checked={row.checked}
        value={row.value}
        onToggle={onToggle}
        onChangeValue={onChangeValue}
      />
    );
  }

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#171717] p-3 gap-3">
      <Text className="text-xs font-instrument-medium text-gray-300">{ENRICH_COPY.mobileLabel}</Text>
      {pending ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color="#9CA3AF" size="small" />
          <Text className="text-sm font-instrument text-gray-400">{ENRICH_COPY.mobileLoading}</Text>
        </View>
      ) : timedOut ? (
        <Text className="text-sm font-instrument text-gray-400">{ENRICH_COPY.mobileNotFound}</Text>
      ) : null}
    </View>
  );
}

function EnrichRow({
  label,
  hint,
  isPage,
  currentValue,
  checked,
  value,
  autoCapitalize,
  onToggle,
  onChangeValue,
}: {
  label: string;
  hint?: string;
  isPage: boolean;
  currentValue: string;
  checked: boolean;
  value: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onToggle: () => void;
  onChangeValue: (next: string) => void;
}) {
  const inputClassName =
    'text-white font-instrument text-sm px-3 py-2.5 rounded-xl border border-[#3A3A3A] bg-[#111111]';
  const inputScrollMarginWeb =
    Platform.OS === 'web' ? ({ scrollMarginBottom: 24 } as unknown as object) : undefined;
  const currentDisplay = currentValue !== '' ? currentValue : '—';
  const hasCurrentValue = currentValue !== '';

  const wasLabel = hasCurrentValue ? ` · was ${currentDisplay}` : ` · ${ENRICH_COPY.wasEmpty}`;

  const hintPill = hint ? (
    <View className="rounded-full border border-[#3A3A3A] bg-[#1A1A1A] px-2 py-0.5">
      <Text className="text-[10px] font-instrument text-gray-400">{hint}</Text>
    </View>
  ) : null;

  if (isPage) {
    return (
      <View className="rounded-xl border border-[#2A2A2A] bg-[#171717] p-3 gap-3">
        <View className="flex-row items-center gap-2">
          <Checkbox checked={checked} onPress={onToggle} size={18} circleSize={28} />
          <Text className="flex-1 min-w-0 text-xs font-instrument-medium text-gray-300 leading-4">
            {label}
            <Text className="font-instrument text-gray-500">{wasLabel}</Text>
          </Text>
        </View>
        {hintPill ? (
          <View className="flex-row flex-wrap items-center gap-1.5 pl-9">{hintPill}</View>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeValue}
          placeholderTextColor="#6b7280"
          autoCapitalize={autoCapitalize}
          editable={checked}
          className={inputClassName}
          style={[inputScrollMarginWeb, !checked ? { opacity: 0.45 } : undefined]}
        />
      </View>
    );
  }

  const labelRow = (
    <View className="flex-row items-center gap-2 mb-1.5 flex-wrap">
      <Checkbox checked={checked} onPress={onToggle} size={18} circleSize={28} />
      <Text className="text-xs font-instrument-medium text-gray-400">{label}</Text>
      {hintPill}
    </View>
  );

  return (
    <View>
      {labelRow}
      <View className="flex-row gap-4 ml-9">
        <View className="flex-1">
          <View className="rounded-xl border border-[#2A2A2A] bg-[#0d0d0d] px-3 py-2.5">
            <Text className="text-gray-300 font-instrument text-sm break-all" selectable>
              {currentDisplay}
            </Text>
          </View>
        </View>
        <View className="flex-1">
          <TextInput
            value={value}
            onChangeText={onChangeValue}
            placeholderTextColor="#6b7280"
            autoCapitalize={autoCapitalize}
            editable={checked}
            className={inputClassName}
            style={[inputScrollMarginWeb, !checked ? { opacity: 0.45 } : undefined]}
          />
        </View>
      </View>
    </View>
  );
}
