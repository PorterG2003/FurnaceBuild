import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import {
  postCompanyDelete,
  postCompanyDeletePreflight,
  postEntityOwnerDelete,
  postEntityOwnerDeletePreflight,
  postSourceRecordDelete,
  postSourceRecordDeletePreflight,
} from '@/lib/foundry/registry-client';
import type {
  CompanyDeleteImpact,
  EntityOwnerDeleteImpact,
  SourceRecordDeleteImpact,
} from '@/lib/foundry/registry-types';

function ImpactLinesCompany({ impact }: { impact: CompanyDeleteImpact }) {
  return (
    <View className="gap-1">
      <Text className="text-gray-300 font-instrument text-sm">Company {impact.company_id}</Text>
      <Text className="text-gray-400 font-instrument text-xs">
        Current linked sources: {impact.current_linked_source_count}
      </Text>
      <Text className="text-gray-400 font-instrument text-xs">
        Other current links (candidates/rejected): {impact.current_candidate_or_rejected_link_count}
      </Text>
      <Text className="text-gray-400 font-instrument text-xs">
        Promoted registry matches: {impact.current_promoted_match_count}
      </Text>
      <Text className="text-gray-400 font-instrument text-xs">
        Other current matches: {impact.current_other_match_count}
      </Text>
      <Text className="text-gray-400 font-instrument text-xs">Locations: {impact.location_count}</Text>
      {impact.sample_linked_source_record_ids.length > 0 ? (
        <Text className="text-gray-500 font-mono text-[10px] mt-1" selectable>
          Sample source ids: {impact.sample_linked_source_record_ids.join(', ')}
        </Text>
      ) : null}
      {impact.sample_match_ids.length > 0 ? (
        <Text className="text-gray-500 font-mono text-[10px]" selectable>
          Sample match ids: {impact.sample_match_ids.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

function ImpactLinesSource({ impact }: { impact: SourceRecordDeleteImpact }) {
  return (
    <View className="gap-1">
      <Text className="text-gray-300 font-instrument text-sm">Source record {impact.source_business_record_id}</Text>
      <Text className="text-gray-400 font-instrument text-xs">Current links: {impact.current_link_count}</Text>
      {impact.sample_link_ids.length > 0 ? (
        <Text className="text-gray-500 font-mono text-[10px] mt-1" selectable>
          Sample link ids: {impact.sample_link_ids.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

function ImpactLinesEntityOwner({ impact }: { impact: EntityOwnerDeleteImpact }) {
  return (
    <View className="gap-1">
      <Text className="text-gray-300 font-instrument text-sm">Contact (owner) {impact.entity_owner_id}</Text>
      <Text className="text-gray-400 font-instrument text-xs">
        Archived history rows: {impact.history_count}
      </Text>
    </View>
  );
}

export function DedupeDeleteDialog({
  visible,
  onClose,
  mode,
  targetId,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  mode: 'company' | 'source' | 'entity_owner';
  targetId: string | null;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [companyImpact, setCompanyImpact] = useState<CompanyDeleteImpact | null>(null);
  const [sourceImpact, setSourceImpact] = useState<SourceRecordDeleteImpact | null>(null);
  const [entityOwnerImpact, setEntityOwnerImpact] = useState<EntityOwnerDeleteImpact | null>(null);
  const [safe, setSafe] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [cascadeAck, setCascadeAck] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setErr(null);
    setCompanyImpact(null);
    setSourceImpact(null);
    setEntityOwnerImpact(null);
    setConfirmationToken(null);
    setCascadeAck(false);
    try {
      if (mode === 'company') {
        const r = await postCompanyDeletePreflight(targetId);
        setCompanyImpact(r.impact);
        setSafe(r.safe);
        setConfirmationToken(r.confirmation_token);
      } else if (mode === 'entity_owner') {
        const r = await postEntityOwnerDeletePreflight(targetId);
        setEntityOwnerImpact(r.impact);
        setSafe(r.safe);
        setConfirmationToken(r.confirmation_token);
      } else {
        const r = await postSourceRecordDeletePreflight(targetId);
        setSourceImpact(r.impact);
        setSafe(r.safe);
        setConfirmationToken(r.confirmation_token);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Preflight failed');
    } finally {
      setLoading(false);
    }
  }, [mode, targetId]);

  useEffect(() => {
    if (visible && targetId) void load();
  }, [visible, targetId, load]);

  const runDelete = async (force: boolean) => {
    if (!targetId || !confirmationToken) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'company') {
        await postCompanyDelete({
          company_id: targetId,
          force_cascade: force,
          confirmation_token: force ? confirmationToken : undefined,
        });
      } else if (mode === 'entity_owner') {
        await postEntityOwnerDelete({
          entity_owner_id: targetId,
          force_cascade: force,
          confirmation_token: force ? confirmationToken : undefined,
        });
      } else {
        await postSourceRecordDelete({
          source_business_record_id: targetId,
          force_cascade: force,
          confirmation_token: force ? confirmationToken : undefined,
        });
      }
      onDeleted();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <View className="flex-row flex-wrap gap-2 justify-end">
      <Button variant="secondary" onPress={onClose} disabled={busy}>
        Cancel
      </Button>
      {safe ? (
        <Button variant="destructive" disabled={busy || loading || !targetId} onPress={() => void runDelete(false)}>
          Delete
        </Button>
      ) : (
        <Button
          variant="destructive"
          disabled={busy || loading || !targetId || !cascadeAck}
          onPress={() => void runDelete(true)}
        >
          Delete with cascade
        </Button>
      )}
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={
        mode === 'company'
          ? 'Delete company'
          : mode === 'entity_owner'
            ? 'Delete contact (owner)'
            : 'Delete source record'
      }
      description={
        mode === 'entity_owner'
          ? safe
            ? 'No archived owner history — safe to delete.'
            : 'This owner has history rows. Cascade delete removes the owner and related history per database rules.'
          : safe
            ? 'No linked sources and no promoted matches — safe to delete.'
            : 'This row still has dependents. Review the impact below. Cascade delete removes linked rows per database rules.'
      }
      footer={footer}
      maxWidth="lg"
    >
      {loading ? (
        <ActivityIndicator color="#f3440d" className="my-4" />
      ) : err ? (
        <Text className="text-red-400 font-instrument text-sm">{err}</Text>
      ) : companyImpact ? (
        <ImpactLinesCompany impact={companyImpact} />
      ) : entityOwnerImpact ? (
        <ImpactLinesEntityOwner impact={entityOwnerImpact} />
      ) : sourceImpact ? (
        <ImpactLinesSource impact={sourceImpact} />
      ) : (
        <Text className="text-gray-500 font-instrument text-sm">No data</Text>
      )}
      {!safe && !loading && (companyImpact || sourceImpact || entityOwnerImpact) ? (
        <View className="mt-4">
          <Button variant="secondary" size="sm" className="self-start" onPress={() => setCascadeAck((v) => !v)}>
            {cascadeAck ? '✓ I understand what will be removed' : 'Acknowledge cascade risk'}
          </Button>
        </View>
      ) : null}
    </BaseModal>
  );
}
