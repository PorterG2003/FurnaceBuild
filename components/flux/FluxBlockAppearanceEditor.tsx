import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { FluxHexColorField } from '@/components/flux/FluxHexColorField';
import {
  FLUX_BLOCK_APPEARANCE_FIELDS,
  type FluxBlockAppearanceFieldDef,
} from '@/lib/flux/fluxBlockAppearanceFields';
import { fluxPanelHexContainerRowClass, fluxPanelLabelClass } from '@/lib/flux/fluxEditorPanelClasses';
import type { Block, FluxBlockAppearance } from '@/lib/flux/types';

interface FluxBlockAppearanceEditorProps {
  block: Block;
  onChange: (appearance: FluxBlockAppearance | undefined) => void;
  pairFieldColumns?: boolean;
}

function renderField(
  field: FluxBlockAppearanceFieldDef,
  appearance: FluxBlockAppearance | undefined,
  onPatch: (key: keyof FluxBlockAppearance, value: string | undefined) => void,
  pairFieldColumns: boolean,
) {
  const value = appearance?.[field.key] ?? '';
  const fieldNode = (
    <View className={pairFieldColumns ? 'flex-1 min-w-[140px]' : 'w-full'}>
      <Text className={fluxPanelLabelClass}>{field.label}</Text>
      {field.help ? (
        <Text className="text-gray-500 text-[10px] font-instrument mb-0.5 leading-3">{field.help}</Text>
      ) : null}
      <FluxHexColorField
        value={value}
        onChange={(hex) => onPatch(field.key, hex.trim() ? hex : undefined)}
        placeholder={field.placeholder}
        fallbackHex={field.fallbackHex}
        containerClassName={pairFieldColumns ? fluxPanelHexContainerRowClass : undefined}
      />
    </View>
  );
  return fieldNode;
}

export function FluxBlockAppearanceEditor({
  block,
  onChange,
  pairFieldColumns = false,
}: FluxBlockAppearanceEditorProps) {
  const fields = FLUX_BLOCK_APPEARANCE_FIELDS[block.type];
  const appearance = block.appearance;

  const onPatch = (key: keyof FluxBlockAppearance, value: string | undefined) => {
    const next = { ...(appearance ?? {}) };
    if (value) next[key] = value;
    else delete next[key];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  if (fields.length === 0) return null;

  const rows: FluxBlockAppearanceFieldDef[][] = [];
  if (pairFieldColumns) {
    for (let i = 0; i < fields.length; i += 2) {
      rows.push(fields.slice(i, i + 2));
    }
  } else {
    for (const f of fields) rows.push([f]);
  }

  return (
    <View className="border border-[#333] rounded-md p-2 bg-[#1A1A1A] gap-2 mb-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-gray-300 text-xs font-instrument-semibold">Block colors</Text>
        {appearance ? (
          <Pressable onPress={() => onChange(undefined)} hitSlop={8}>
            <Text className="text-indigo-400 text-[11px] font-instrument-semibold">Reset</Text>
          </Pressable>
        ) : null}
      </View>
      {rows.map((row, ri) =>
        pairFieldColumns && row.length > 1 ? (
          <View key={ri} className="flex-row gap-2 flex-wrap">
            {row.map((field) => (
              <React.Fragment key={field.key}>
                {renderField(field, appearance, onPatch, true)}
              </React.Fragment>
            ))}
          </View>
        ) : (
          row.map((field) => (
            <React.Fragment key={field.key}>
              {renderField(field, appearance, onPatch, false)}
            </React.Fragment>
          ))
        ),
      )}
    </View>
  );
}
