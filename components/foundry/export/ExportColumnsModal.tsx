import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { ExportPresentationMode } from '@/components/foundry/export/exportFilterTypes';
import {
  getDefaultExportColumnKeys,
  getExportColumnGroups,
} from '@/components/foundry/export/exportColumns';

function ColumnRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-2 border-b border-[#232323]">
      <Text className="text-gray-200 font-instrument text-sm flex-1">{label}</Text>
      <Checkbox checked={checked} onPress={onPress} />
    </View>
  );
}

export function ExportColumnsModal({
  visible,
  mode,
  selectedKeys,
  onClose,
  onApply,
}: {
  visible: boolean;
  mode: ExportPresentationMode;
  selectedKeys: string[];
  onClose: () => void;
  onApply: (nextKeys: string[]) => void;
}) {
  const [draftKeys, setDraftKeys] = useState<string[]>(selectedKeys);

  useEffect(() => {
    if (visible) {
      setDraftKeys(selectedKeys);
    }
  }, [selectedKeys, visible]);

  const groups = useMemo(() => getExportColumnGroups(mode), [mode]);

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Columns"
      description={`Choose which ${mode === 'contact' ? 'contact' : 'company'} columns appear in the preview and CSV.`}
      maxWidth="xl"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button
            variant="secondary"
            onPress={() => {
              setDraftKeys(getDefaultExportColumnKeys(mode));
            }}
          >
            Reset to defaults
          </Button>
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            onPress={() => {
              onApply(draftKeys.length > 0 ? draftKeys : getDefaultExportColumnKeys(mode));
              onClose();
            }}
          >
            Done
          </Button>
        </View>
      }
    >
      <ScrollView className="max-h-[60vh]" showsVerticalScrollIndicator>
        <View className="gap-6">
          {groups.map(({ group, columns }) => (
            <View key={group}>
              <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">{group}</Text>
              <View className="border border-[#2A2A2A] rounded-xl px-3 bg-[#171717]">
                {columns.map((column) => {
                  const checked = draftKeys.includes(column.key);
                  return (
                    <ColumnRow
                      key={column.key}
                      label={column.label}
                      checked={checked}
                      onPress={() => {
                        setDraftKeys((current) =>
                          checked ? current.filter((key) => key !== column.key) : [...current, column.key],
                        );
                      }}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </BaseModal>
  );
}
