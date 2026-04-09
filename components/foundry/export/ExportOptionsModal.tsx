import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { InformationCircleIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';

export type ExportMode = 'owner_rows' | 'chain_people';

export const EXPORT_CHAIN_DEPTH_OPTIONS = [2, 4, 6] as const;

export interface ExportOptionsState {
  mode: ExportMode;
  mergePeoplePerCompany: boolean;
  chainMaxDepth: number;
  /** Adds matched enrichment emails/phones to CSV (and API rows); off by default. */
  includeContactEnrichment: boolean;
  /** Adds tier/score/reason columns; requires includeContactEnrichment. */
  includeContactConfidence: boolean;
  /** Adds per-row cost columns (USD cents) to CSV and API when enabled. */
  includeCost: boolean;
}

function HintIcon({ title, hint }: { title: string; hint: string }) {
  const content = (
    <Text className="text-gray-300 font-instrument text-xs max-w-xs">{hint}</Text>
  );
  const icon = <InformationCircleIcon size={18} color="#9CA3AF" />;

  if (Platform.OS === 'web') {
    return (
      <Tooltip content={content} placement="right">
        <Pressable hitSlop={8} className="p-0.5">
          {icon}
        </Pressable>
      </Tooltip>
    );
  }

  return (
    <Pressable hitSlop={8} className="p-0.5" onPress={() => Alert.alert(title, hint)}>
      {icon}
    </Pressable>
  );
}

function DepthChip({
  value,
  selected,
  onPress,
}: {
  value: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-2.5 py-1.5 rounded-lg border ${
        selected ? 'border-brand-orange bg-[#241814]' : 'border-[#3A3A3A] bg-[#202020] active:opacity-80'
      }`}
    >
      <Text className={`font-instrument-semibold text-xs ${selected ? 'text-white' : 'text-gray-300'}`}>
        {value}
      </Text>
    </Pressable>
  );
}

function ExportOptionRow({
  label,
  hint,
  trailing,
}: {
  label: string;
  hint: string;
  trailing: ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-2.5 border-b border-[#2A2A2A]">
      <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
        <Text
          className="text-white font-instrument-semibold text-sm shrink min-w-0"
          numberOfLines={1}
        >
          {label}
        </Text>
        <View className="flex-shrink-0">
          <HintIcon title={label} hint={hint} />
        </View>
      </View>
      <View className="flex-shrink-0 flex-row items-center">{trailing}</View>
    </View>
  );
}

export function ExportOptionsModal({
  visible,
  onClose,
  options,
  downloading,
  onApply,
  onDownload,
}: {
  visible: boolean;
  onClose: () => void;
  options: ExportOptionsState;
  downloading: boolean;
  onApply: (options: ExportOptionsState) => void;
  onDownload: (options: ExportOptionsState) => void;
}) {
  const [draft, setDraft] = useState<ExportOptionsState>(options);

  useEffect(() => {
    if (visible) setDraft({ ...options, includeCost: options.includeCost ?? false });
  }, [options, visible]);

  const { previewLine, previewHintFull } = useMemo(() => {
    const base =
      draft.mode === 'owner_rows'
        ? 'Owner-row granularity'
        : `Chain-linked people · depth ${draft.chainMaxDepth}${draft.mergePeoplePerCompany ? ' · merged' : ''}`;
    const line =
      draft.includeContactEnrichment && draft.mode === 'owner_rows'
        ? `${base} · CSV includes contacts`
        : draft.includeContactEnrichment
          ? `${base}; CSV includes contacts`
          : base;

    const full =
      draft.mode === 'owner_rows'
        ? 'Preview and CSV will use owner-row granularity.'
        : `Preview and CSV will use chain-linked people${draft.mergePeoplePerCompany ? ', merged per company/person' : ''} up to depth ${draft.chainMaxDepth}.`;
    const contactNote = draft.includeContactEnrichment
      ? ' Contact columns are included in downloaded CSV (not all columns are shown in the preview table).'
      : '';

    return { previewLine: line, previewHintFull: full + contactNote };
  }, [draft]);

  const depthHint =
    'How far the chain expansion walks through resolved entity owners before collecting people.';

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Export setup"
      description="Adjust options below, then apply to the preview or download CSV."
      maxWidth="lg"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply to preview
          </Button>
          <Button
            variant="default"
            disabled={downloading}
            onPress={() => {
              onDownload(draft);
            }}
          >
            {downloading ? 'Preparing CSV…' : 'Download CSV'}
          </Button>
        </View>
      }
    >
      <View>
        <ExportOptionRow
          label="Registry owner rows"
          hint="One row per current owner record on each promoted company target. Best for a direct ownership export with current registry evidence."
          trailing={
            <Checkbox
              checked={draft.mode === 'owner_rows'}
              onPress={() =>
                setDraft((current) => ({
                  ...current,
                  mode: 'owner_rows',
                  mergePeoplePerCompany: false,
                }))
              }
            />
          }
        />
        <ExportOptionRow
          label="Chain-linked people"
          hint="Start from each promoted company target, walk ownership chains, and export terminal people reached through that chain."
          trailing={
            <Checkbox
              checked={draft.mode === 'chain_people'}
              onPress={() =>
                setDraft((current) => ({
                  ...current,
                  mode: 'chain_people',
                }))
              }
            />
          }
        />

        {draft.mode === 'chain_people' ? (
          <>
            <View className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 border-b border-[#2A2A2A]">
              <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
                <Text
                  className="text-white font-instrument-semibold text-sm shrink min-w-0"
                  numberOfLines={1}
                >
                  Max chain depth
                </Text>
                <View className="flex-shrink-0">
                  <HintIcon title="Max chain depth" hint={depthHint} />
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2 flex-shrink-0 justify-end min-w-[120px]">
                {EXPORT_CHAIN_DEPTH_OPTIONS.map((value) => (
                  <DepthChip
                    key={value}
                    value={value}
                    selected={draft.chainMaxDepth === value}
                    onPress={() =>
                      setDraft((current) => ({
                        ...current,
                        chainMaxDepth: value,
                      }))
                    }
                  />
                ))}
              </View>
            </View>
            <ExportOptionRow
              label="Merge duplicate people per company"
              hint="Collapse duplicate names within the same company into one exported row with combined roles and linkage paths."
              trailing={
                <Toggle
                  value={draft.mergePeoplePerCompany}
                  onValueChange={(mergePeoplePerCompany) =>
                    setDraft((c) => ({ ...c, mergePeoplePerCompany }))
                  }
                />
              }
            />
          </>
        ) : null}

        <ExportOptionRow
          label="Include per-row cost (cents)"
          hint="Adds acquisition split, enrichment, and total cost columns from rate cards and recorded runs. Uses USD cents in API and CSV."
          trailing={
            <Toggle
              value={draft.includeCost}
              onValueChange={(includeCost) => setDraft((c) => ({ ...c, includeCost }))}
            />
          }
        />
        <ExportOptionRow
          label="Include matched contacts in export"
          hint="Adds up to three emails and three phone numbers per person from the latest accepted enrichment match. Preview table stays compact; columns appear in CSV."
          trailing={
            <Toggle
              value={draft.includeContactEnrichment}
              onValueChange={(includeContactEnrichment) =>
                setDraft((c) => ({
                  ...c,
                  includeContactEnrichment,
                  includeContactConfidence: includeContactEnrichment ? c.includeContactConfidence : false,
                }))
              }
            />
          }
        />
        <ExportOptionRow
          label="Include confidence details"
          hint="Adds High/Standard tier, match score, margin vs runner-up, and ambiguity reason codes for sales prioritization."
          trailing={
            <Toggle
              value={draft.includeContactConfidence}
              disabled={!draft.includeContactEnrichment}
              onValueChange={(includeContactConfidence) =>
                setDraft((c) => ({ ...c, includeContactConfidence }))
              }
            />
          }
        />

        <View className="flex-row items-center justify-between gap-4 py-2.5">
          <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
            <Text className="text-gray-300 font-instrument text-sm shrink min-w-0" numberOfLines={1}>
              {previewLine}
            </Text>
            <View className="flex-shrink-0">
              <HintIcon title="Preview" hint={previewHintFull} />
            </View>
          </View>
        </View>
      </View>
    </BaseModal>
  );
}
