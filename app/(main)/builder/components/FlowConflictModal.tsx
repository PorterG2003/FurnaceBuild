import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { FlowDiagram } from '@/components/campaigns/FlowDiagram';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { ModalFooter } from '@/components/ui/modals/ModalFooter';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import {
  buildFlowConflictSummary,
  type CampaignFlowData,
  type FlowConflictFieldChange,
  type FlowConflictNodeDiff,
  type FlowPreviewStep,
} from '@/lib/campaigns/flow';
import { isReactFlowWebAvailable } from '@/lib/flow';

type FlowConflictModalProps = {
  visible: boolean;
  localFlow: CampaignFlowData;
  serverFlow: CampaignFlowData;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onClose: () => void;
};

const MAX_VISIBLE_STEPS = 8;
const PREVIEW_HEIGHT = 200;
const SEQUENCE_CARD_ID = '__sequence__';

const KIND_LABELS: Record<FlowConflictNodeDiff['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
};

const EMPTY_VALUE = '—';

function getDisplayFields(diff: FlowConflictNodeDiff): FlowConflictFieldChange[] {
  if (diff.kind === 'added') return diff.fields.filter((field) => field.yours !== null);
  if (diff.kind === 'removed') return diff.fields.filter((field) => field.saved !== null);
  return diff.fields;
}

function FlowConflictStepList({ steps }: { steps: FlowPreviewStep[] }) {
  const showDiagram = isReactFlowWebAvailable() && Platform.OS === 'web';
  if (showDiagram && steps.length <= 4) return null;

  const visibleSteps = steps.slice(0, MAX_VISIBLE_STEPS);
  const hiddenCount = steps.length - visibleSteps.length;

  return (
    <View className="gap-1.5 mt-3">
      {visibleSteps.map((step, index) => (
        <View key={`${step.nodeId}-${index}`} className="flex-row gap-2">
          <Text className="text-gray-600 font-instrument text-xs w-4">{index + 1}.</Text>
          <View className="flex-1">
            <Text
              className={`font-instrument text-xs leading-4 ${
                step.isChanged ? 'text-brand-orange' : 'text-gray-400'
              }`}
            >
              {step.title}
              {step.detail ? ` · ${step.detail}` : ''}
            </Text>
          </View>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <Text className="text-gray-500 font-instrument text-xs">
          + {hiddenCount} more {hiddenCount === 1 ? 'step' : 'steps'}
        </Text>
      ) : null}
    </View>
  );
}

function DiffValuePanel({
  label,
  value,
  tone,
  stacked,
}: {
  label: string;
  value: string;
  tone: 'yours' | 'saved' | 'muted';
  stacked: boolean;
}) {
  const isEmpty = value === EMPTY_VALUE;
  const textClass = isEmpty
    ? 'text-gray-600'
    : tone === 'yours'
      ? 'text-gray-100'
      : tone === 'saved'
        ? 'text-gray-100'
        : 'text-gray-500';

  return (
    <View className={stacked ? 'flex-1 min-w-0' : 'flex-1 min-w-0 basis-0'}>
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-1.5">
        {label}
      </Text>
      <View className="rounded-lg border border-[#2A2A2A] bg-[#101010] px-3 py-2.5 min-h-[44px]">
        <Text className={`font-instrument text-xs leading-5 ${textClass}`}>{value}</Text>
      </View>
    </View>
  );
}

function FlowConflictFieldTable({
  fields,
  kind,
}: {
  fields: FlowConflictFieldChange[];
  kind: FlowConflictNodeDiff['kind'];
}) {
  const { width } = useWindowDimensions();
  const stacked = width < LAYOUT_BREAKPOINT;

  if (fields.length === 0) {
    return (
      <Text className="text-gray-500 font-instrument text-sm mt-3">No field details available.</Text>
    );
  }

  return (
    <View className="gap-4 mt-1">
      {fields.map((field, index) => (
        <View
          key={`${field.label}-${index}`}
          className={index > 0 ? 'pt-4 border-t border-[#252525]' : undefined}
        >
          <Text className="text-gray-400 font-instrument-medium text-xs mb-2">{field.label}</Text>
          <View className={stacked ? 'gap-2.5' : 'flex-row gap-2.5'}>
            <DiffValuePanel
              label="Your version"
              value={field.yours ?? EMPTY_VALUE}
              tone={kind === 'removed' ? 'muted' : 'yours'}
              stacked={stacked}
            />
            <DiffValuePanel
              label="Saved version"
              value={field.saved ?? EMPTY_VALUE}
              tone={kind === 'added' ? 'muted' : 'saved'}
              stacked={stacked}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function FlowConflictChangeCard({
  cardId,
  title,
  kind,
  expanded,
  onToggle,
  children,
}: {
  cardId: string;
  title: string;
  kind?: FlowConflictNodeDiff['kind'];
  expanded: boolean;
  onToggle: (cardId: string) => void;
  children?: ReactNode;
}) {
  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] overflow-hidden">
      <Pressable
        onPress={() => onToggle(cardId)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={kind ? `${title}, ${KIND_LABELS[kind]}` : title}
        className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-90"
      >
        {expanded ? (
          <ChevronDownIcon size={16} color="#9CA3AF" />
        ) : (
          <ChevronRightIcon size={16} color="#9CA3AF" />
        )}
        <View className="flex-1 flex-row items-center min-w-0">
          <Text className="text-white font-instrument-semibold text-sm shrink" numberOfLines={1}>
            {title}
          </Text>
          {kind ? (
            <Text className="text-gray-500 font-instrument text-sm shrink-0">{` · ${KIND_LABELS[kind]}`}</Text>
          ) : null}
        </View>
      </Pressable>
      {expanded ? (
        <View className="px-4 pb-4 pt-1 border-t border-[#252525]">{children}</View>
      ) : null}
    </View>
  );
}

function FlowConflictNodeDiffCard({
  diff,
  expanded,
  onToggle,
}: {
  diff: FlowConflictNodeDiff;
  expanded: boolean;
  onToggle: (cardId: string) => void;
}) {
  const displayFields = getDisplayFields(diff);

  return (
    <FlowConflictChangeCard
      cardId={diff.nodeId}
      title={diff.title}
      kind={diff.kind}
      expanded={expanded}
      onToggle={onToggle}
    >
      <FlowConflictFieldTable fields={displayFields} kind={diff.kind} />
    </FlowConflictChangeCard>
  );
}

function FlowConflictSequenceCard({
  sequenceSummary,
  expanded,
  onToggle,
}: {
  sequenceSummary: string;
  expanded: boolean;
  onToggle: (cardId: string) => void;
}) {
  return (
    <FlowConflictChangeCard
      cardId={SEQUENCE_CARD_ID}
      title="Flow order"
      expanded={expanded}
      onToggle={onToggle}
    >
      <View className="rounded-lg border border-[#2A2A2A] bg-[#101010] px-3 py-2.5 mt-1">
        <Text className="text-gray-200 font-instrument text-sm leading-5">{sequenceSummary}</Text>
      </View>
    </FlowConflictChangeCard>
  );
}

function FlowPreviewPane({
  label,
  flow,
  steps,
}: {
  label: string;
  flow: CampaignFlowData;
  steps: FlowPreviewStep[];
}) {
  return (
    <View className="flex-1 min-w-0">
      <Text className="text-white font-instrument-semibold text-sm mb-2">{label}</Text>
      <FlowDiagram nodes={flow.nodes} edges={flow.edges} height={PREVIEW_HEIGHT} />
      <FlowConflictStepList steps={steps} />
    </View>
  );
}

export function FlowConflictModal({
  visible,
  localFlow,
  serverFlow,
  onKeepLocal,
  onUseServer,
  onClose,
}: FlowConflictModalProps) {
  const summary = useMemo(
    () => buildFlowConflictSummary(localFlow, serverFlow),
    [localFlow, serverFlow],
  );

  const cardIds = useMemo(() => {
    const ids: string[] = [];
    if (summary.sequenceSummary) ids.push(SEQUENCE_CARD_ID);
    ids.push(...summary.nodeDiffs.map((diff) => diff.nodeId));
    return ids;
  }, [summary.nodeDiffs, summary.sequenceSummary]);

  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!visible) return;
    const next: Record<string, boolean> = {};
    cardIds.forEach((cardId, index) => {
      next[cardId] = index === 0;
    });
    setExpandedCards(next);
  }, [visible, localFlow, serverFlow, cardIds]);

  const toggleCard = (cardId: string) => {
    setExpandedCards((current) => ({ ...current, [cardId]: !current[cardId] }));
  };

  const footer = (
    <ModalFooter layout="inline">
      <Button fullWidth onPress={onClose} variant="secondary">
        Cancel
      </Button>
      <Button fullWidth onPress={onUseServer} variant="secondary">
        Use saved version
      </Button>
      <Button fullWidth onPress={onKeepLocal}>
        Keep my version
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="This campaign was updated while you were editing"
      description="Another tab saved changes. Compare the previews, review what changed, then pick a version."
      maxWidth="2xl"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-5">
        <View className="flex-col md:flex-row gap-4">
          <FlowPreviewPane label="Your version" flow={localFlow} steps={summary.yoursSteps} />
          <FlowPreviewPane label="Saved version" flow={serverFlow} steps={summary.savedSteps} />
        </View>

        <View className="gap-2">
          <Text className="text-white font-instrument-semibold text-sm">Changes</Text>
          {summary.nodeDiffs.length === 0 && !summary.sequenceSummary ? (
            <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] px-4 py-3.5">
              <Text className="text-gray-500 font-instrument text-sm">No step changes detected</Text>
            </View>
          ) : (
            <View className="gap-2.5">
              {summary.sequenceSummary ? (
                <FlowConflictSequenceCard
                  sequenceSummary={summary.sequenceSummary}
                  expanded={expandedCards[SEQUENCE_CARD_ID] ?? false}
                  onToggle={toggleCard}
                />
              ) : null}
              {summary.nodeDiffs.map((diff) => (
                <FlowConflictNodeDiffCard
                  key={diff.nodeId}
                  diff={diff}
                  expanded={expandedCards[diff.nodeId] ?? false}
                  onToggle={toggleCard}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    </BaseModal>
  );
}

export default FlowConflictModal;
