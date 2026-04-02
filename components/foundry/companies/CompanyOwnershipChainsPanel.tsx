import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type {
  CompanyOwnershipChain,
  CompanyOwnershipChainsResponse,
  CompanyOwnershipChainStep,
  CompanyOwnershipChainTarget,
} from '@/lib/foundry/registry-types';

function labelForStep(step: CompanyOwnershipChainStep): string {
  if (step.kind === 'person') return step.name;
  return step.legal_name?.trim() || step.registry_entity_id || step.state_entity_id;
}

function ChainBreadcrumb({ chain }: { chain: CompanyOwnershipChain }) {
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
      {chain.steps.map((step, index) => {
        const label = labelForStep(step);
        const role = step.kind === 'person' ? step.title_role?.trim() : null;
        const isTarget = step.kind === 'entity' && step.is_target;
        return (
          <View key={`${step.kind}-${step.kind === 'person' ? step.owner_row_id : step.state_entity_id}-${index}`} className="flex-row items-center">
            {index > 0 ? <Text className="text-gray-600 font-instrument text-xs mx-1">→</Text> : null}
            <View className="flex-row items-center gap-1">
              <Text
                className={
                  isTarget
                    ? 'text-white font-instrument-semibold text-xs border border-violet-500/40 bg-violet-500/10 px-2 py-1 rounded'
                    : step.kind === 'person'
                      ? 'text-emerald-300 font-instrument text-xs border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded'
                      : 'text-gray-200 font-instrument text-xs border border-[#3A3A3A] px-2 py-1 rounded'
                }
              >
                {label}
              </Text>
              {role ? (
                <Text className="text-gray-400 font-instrument text-[10px] border border-[#3A3A3A] px-1.5 py-1 rounded">
                  {role}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TargetSection({ target }: { target: CompanyOwnershipChainTarget }) {
  const [expanded, setExpanded] = useState(false);
  const sortedChains = useMemo(() => [...target.chains].sort((a, b) => a.depth - b.depth), [target.chains]);
  const visibleChains = expanded ? sortedChains : sortedChains.slice(0, 3);

  return (
    <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-2">
      <View className="flex-row flex-wrap items-center gap-2 mb-2">
        <Text className="text-white font-instrument-semibold text-sm border border-[#3A3A3A] px-2 py-0.5 rounded">
          {target.registry_state || '—'}
        </Text>
        <Text className="text-gray-200 font-instrument-semibold text-sm flex-1 min-w-[180px]">
          {target.legal_name?.trim() || target.registry_entity_id || 'Matched registry entity'}
        </Text>
      </View>
      <Text className="text-gray-500 font-instrument text-xs mb-3">
        {sortedChains.length > 0
          ? `${sortedChains.length} chain${sortedChains.length === 1 ? '' : 's'} found`
          : 'No resolved ownership chains for this matched entity yet.'}
      </Text>
      {visibleChains.map((chain, index) => (
        <View key={`${target.company_entity_match_id}-${index}`} className="mb-3 last:mb-0">
          <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-1">
            Depth {chain.depth}
          </Text>
          <ChainBreadcrumb chain={chain} />
        </View>
      ))}
      {sortedChains.length > 3 ? (
        <Pressable onPress={() => setExpanded((v) => !v)} className="pt-1">
          <Text className="text-gray-500 font-instrument text-xs">
            {expanded ? 'Show fewer chains' : `Show ${sortedChains.length - 3} more chains`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CompanyOwnershipChainsPanel({
  data,
  loading,
  error,
}: {
  data: CompanyOwnershipChainsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const targets = data?.targets ?? [];

  if (loading) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
          Ownership chains
        </Text>
        <Text className="text-gray-500 font-instrument text-sm">Loading ownership chains…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
          Ownership chains
        </Text>
        <Text className="text-red-400 font-instrument text-sm">{error}</Text>
      </View>
    );
  }

  if (targets.length === 0) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
          Ownership chains
        </Text>
        <Text className="text-gray-500 font-instrument text-sm">
          No current promoted registry matches for this company.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
        Ownership chains
      </Text>
      {targets.map((target) => (
        <TargetSection key={target.company_entity_match_id} target={target} />
      ))}
    </View>
  );
}
