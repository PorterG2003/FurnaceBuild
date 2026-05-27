import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Alert } from '@/components/ui/feedback';
import { Select } from '@/components/ui/forms';
import {
  LEADS_COLUMN_GROUPS,
  buildStableColumnId,
  columnLayoutKey,
  getCatalogField,
  getColumnGroupForSourceType,
  type LeadsColumnCatalogField,
  type LeadsColumnDef,
  type LeadsColumnGroupDefinition,
  type LeadsColumnSourceType,
} from '@/lib/leads/columns';
import type { MockCampaign } from '@/lib/devtools/leads-workbench/types';

export function LeadsEditColumnsModal({
  visible,
  campaigns,
  columns,
  onClose,
  onSaveColumns,
}: {
  visible: boolean;
  campaigns: MockCampaign[];
  columns: LeadsColumnDef[];
  onClose: () => void;
  onSaveColumns: (columns: LeadsColumnDef[]) => void;
}) {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setEnabledKeys(new Set(columns.filter((column) => column.visible).map((column) => columnLayoutKey(column))));
    const firstMembership = columns.find(
      (column) => column.sourceType === 'membership' && column.visible && column.campaignId,
    );
    setCampaignId(firstMembership?.campaignId ?? null);
    setError(null);
  }, [visible]);

  function resetAndClose() {
    setError(null);
    onClose();
  }

  function toggleField(group: LeadsColumnGroupDefinition, field: LeadsColumnCatalogField) {
    const campaignIdForField = group.requiresCampaign ? campaignId : null;
    if (group.requiresCampaign && !campaignIdForField) return;

    const key = columnLayoutKey({
      sourceType: field.sourceType,
      fieldKey: field.fieldKey,
      campaignId: campaignIdForField,
    });

    setEnabledKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleSave() {
    setError(null);
    if (enabledKeys.size === 0) {
      setError('Keep at least one column in the table.');
      return;
    }

    onSaveColumns(buildColumnsFromEnabledKeys(columns, enabledKeys, campaigns));
    resetAndClose();
  }

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={resetAndClose}>
        Cancel
      </Button>
      <Button onPress={handleSave}>Save columns</Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={resetAndClose}
      title="Edit columns"
      description="Choose which columns appear in this list. Changes save automatically."
      maxWidth="2xl"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {error ? <Alert variant="error" message={error} /> : null}

        <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
          <View className="gap-6 pr-1">
            {LEADS_COLUMN_GROUPS.map((group) => (
              <ColumnGroupSection
                key={group.id}
                group={group}
                campaigns={campaigns}
                campaignId={campaignId}
                onCampaignChange={setCampaignId}
                enabledKeys={enabledKeys}
                onToggleField={(field) => toggleField(group, field)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </BaseModal>
  );
}

function ColumnGroupSection({
  group,
  campaigns,
  campaignId,
  onCampaignChange,
  enabledKeys,
  onToggleField,
}: {
  group: LeadsColumnGroupDefinition;
  campaigns: MockCampaign[];
  campaignId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  enabledKeys: Set<string>;
  onToggleField: (field: LeadsColumnCatalogField) => void;
}) {
  const campaignReady = !group.requiresCampaign || Boolean(campaignId);

  return (
    <View className="gap-3">
      <Text className="text-white font-instrument-semibold text-sm">{group.label}</Text>

      {group.requiresCampaign ? (
        <Select<MockCampaign>
          label="Campaign"
          items={campaigns}
          getItemId={(campaign) => campaign.id}
          getItemLabel={(campaign) => ({ primary: campaign.name })}
          value={campaignId}
          onChange={onCampaignChange}
          placeholder="Select a campaign"
          emptyMessage={() => 'No campaigns available.'}
          variant="solid"
          listMaxHeight={240}
        />
      ) : null}

      <View className="gap-2">
        {group.fields.map((field) => {
          const campaignIdForField = group.requiresCampaign ? campaignId : null;
          const key = columnLayoutKey({
            sourceType: field.sourceType,
            fieldKey: field.fieldKey,
            campaignId: campaignIdForField,
          });
          const checked = enabledKeys.has(key);
          const disabled = !campaignReady;

          return (
            <ColumnFieldRow
              key={key}
              field={field}
              checked={checked}
              disabled={disabled}
              onToggle={() => onToggleField(field)}
            />
          );
        })}
      </View>
    </View>
  );
}

function ColumnFieldRow({
  field,
  checked,
  disabled,
  onToggle,
}: {
  field: LeadsColumnCatalogField;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <View className={`flex-row items-center gap-3 border border-[#2A2A2A] rounded-xl px-3 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <Checkbox checked={checked} onPress={disabled ? () => {} : onToggle} />
      <View className="flex-1 min-w-0">
        <Text className="text-white font-instrument-medium text-sm">{field.label}</Text>
        {field.description ? (
          <Text className="text-gray-500 font-instrument text-xs mt-1">{field.description}</Text>
        ) : null}
      </View>
    </View>
  );
}

function buildColumnsFromEnabledKeys(
  existingColumns: LeadsColumnDef[],
  enabledKeys: Set<string>,
  campaigns: MockCampaign[],
): LeadsColumnDef[] {
  const existingByKey = new Map(existingColumns.map((column) => [columnLayoutKey(column), column]));
  const nextColumns: LeadsColumnDef[] = [];

  for (const column of existingColumns) {
    const key = columnLayoutKey(column);
    if (enabledKeys.has(key)) {
      nextColumns.push({ ...column, visible: true });
    }
  }

  for (const key of enabledKeys) {
    if (existingByKey.has(key)) continue;
    const parsed = parseLayoutKey(key);
    if (!parsed) continue;

    const field = getCatalogField(parsed.sourceType, parsed.fieldKey);
    const group = getColumnGroupForSourceType(parsed.sourceType);
    if (!field || !group) continue;

    const campaign = parsed.campaignId
      ? campaigns.find((candidate) => candidate.id === parsed.campaignId) ?? null
      : null;

    nextColumns.push({
      id: buildStableColumnId(parsed.sourceType, parsed.fieldKey, parsed.campaignId),
      sourceType: parsed.sourceType,
      sourceLabel: group.label,
      fieldKey: parsed.fieldKey,
      label: field.label,
      visible: true,
      campaignId: parsed.sourceType === 'membership' ? parsed.campaignId : null,
      campaignName: parsed.sourceType === 'membership' ? campaign?.name ?? null : null,
      width: parsed.fieldKey.includes('count') ? 120 : 180,
    });
  }

  return nextColumns;
}

function parseLayoutKey(
  key: string,
): { sourceType: LeadsColumnSourceType; fieldKey: string; campaignId: string | null } | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;

  const sourceType = parts[0];
  if (sourceType === 'membership') {
    const campaignId = parts[1];
    const fieldKey = parts.slice(2).join(':');
    if (!campaignId || !fieldKey) return null;
    return { sourceType: 'membership', fieldKey, campaignId };
  }

  if (sourceType !== 'person' && sourceType !== 'rollup') return null;
  const fieldKey = parts.slice(2).join(':');
  if (!fieldKey) return null;
  return { sourceType, fieldKey, campaignId: null };
}
