import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { BaseModal } from '@/components/ui/modals/BaseModal';

export type ExportMode = 'owner_rows' | 'chain_people';

export const EXPORT_CHAIN_DEPTH_OPTIONS = [2, 4, 6] as const;

export interface ExportOptionsState {
  mode: ExportMode;
  mergePeoplePerCompany: boolean;
  chainMaxDepth: number;
}

function OptionCard({
  label,
  hint,
  checked,
  onPress,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-2xl border px-4 py-4 ${
        checked ? 'border-brand-orange bg-[#241814]' : 'border-[#3A3A3A] bg-[#202020] active:opacity-80'
      }`}
    >
      <View className="flex-row items-start gap-3">
        <Checkbox checked={checked} onPress={onPress} />
        <View className="flex-1 min-w-0">
          <Text className="text-white font-instrument-semibold text-sm">{label}</Text>
          <Text className="text-gray-400 font-instrument text-sm mt-1 leading-5">{hint}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function DepthOption({
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
      className={`px-3 py-2 rounded-xl border ${
        selected ? 'border-brand-orange bg-[#241814]' : 'border-[#3A3A3A] bg-[#202020] active:opacity-80'
      }`}
    >
      <Text className={`font-instrument-semibold text-sm ${selected ? 'text-white' : 'text-gray-300'}`}>
        Depth {value}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onPress,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className={`flex-row items-start gap-3 rounded-xl border px-3 py-3 ${
        disabled ? 'border-[#2A2A2A] bg-[#171717] opacity-60' : 'border-[#3A3A3A] bg-[#202020] active:opacity-80'
      }`}
    >
      <Checkbox checked={checked} onPress={disabled ? () => {} : onPress} />
      <View className="flex-1 min-w-0">
        <Text className="text-white font-instrument-semibold text-sm">{label}</Text>
        <Text className="text-gray-400 font-instrument text-sm mt-1 leading-5">{hint}</Text>
      </View>
    </Pressable>
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
    if (visible) setDraft(options);
  }, [options, visible]);

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Export setup"
      description="Choose the export format first, then fine-tune chain behavior before applying to the preview or downloading."
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
      <View className="gap-3">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider">Export format</Text>
        <OptionCard
          label="Registry owner rows"
          hint="One row per current owner record on each promoted company target. Best for a direct ownership export with current registry evidence."
          checked={draft.mode === 'owner_rows'}
          onPress={() =>
            setDraft((current) => ({
              ...current,
              mode: 'owner_rows',
              mergePeoplePerCompany: false,
            }))
          }
        />
        <OptionCard
          label="Chain-linked people"
          hint="Start from each promoted company target, walk ownership chains, and export terminal people reached through that chain."
          checked={draft.mode === 'chain_people'}
          onPress={() =>
            setDraft((current) => ({
              ...current,
              mode: 'chain_people',
            }))
          }
        />

        {draft.mode === 'chain_people' ? (
          <View className="rounded-2xl border border-[#303030] bg-[#171717] px-4 py-4 gap-3">
            <View>
              <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Chain setup</Text>
              <Text className="text-gray-400 font-instrument text-sm leading-5 mb-3">
                Choose how far the chain expansion should walk through resolved entity owners before collecting people.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {EXPORT_CHAIN_DEPTH_OPTIONS.map((value) => (
                  <DepthOption
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
            <ToggleRow
              label="Merge duplicate people per company"
              hint="Collapse duplicate names within the same company into one exported row with combined roles and linkage paths."
              checked={draft.mergePeoplePerCompany}
              onPress={() =>
                setDraft((current) => ({
                  ...current,
                  mergePeoplePerCompany: !current.mergePeoplePerCompany,
                }))
              }
            />
          </View>
        ) : null}

        <View className="rounded-2xl border border-[#2A2A2A] bg-[#161616] px-4 py-3">
          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Current preview behavior</Text>
          <Text className="text-gray-300 font-instrument text-sm leading-5">
            {draft.mode === 'owner_rows'
              ? 'Preview and CSV will use owner-row granularity.'
              : `Preview and CSV will use chain-linked people${draft.mergePeoplePerCompany ? ', merged per company/person' : ''} up to depth ${draft.chainMaxDepth}.`}
          </Text>
        </View>
      </View>
    </BaseModal>
  );
}
