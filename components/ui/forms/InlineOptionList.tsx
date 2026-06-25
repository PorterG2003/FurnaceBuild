import { Platform, Pressable, ScrollView, Text, View, type ReactNode } from 'react-native';
import { FormFieldLabel } from './FormFieldHelp';
import { FORM_FIELD_VARIANTS, type FormFieldVariant } from './formFieldStyles';

const noSelectStyle = Platform.OS === 'web' ? ({ userSelect: 'none' } as const) : undefined;

const ROW_SIZING = {
  rowGap: 10,
  rowPaddingY: 10,
  rowPaddingX: 12,
  rowRadius: 12,
  rowMarginBottom: 6,
  checkboxSize: 18,
  checkboxRadius: 4,
  rowTextClassName: 'text-sm',
} as const;

function rowStyle(isSelected: boolean) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: ROW_SIZING.rowGap,
    paddingVertical: ROW_SIZING.rowPaddingY,
    paddingHorizontal: ROW_SIZING.rowPaddingX,
    borderRadius: ROW_SIZING.rowRadius,
    marginBottom: ROW_SIZING.rowMarginBottom,
    borderWidth: 1,
    backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.14)' : '#121212',
    borderColor: isSelected ? 'rgba(243, 68, 13, 0.4)' : '#2A2A2A',
    ...noSelectStyle,
  };
}

type InlineOptionListBaseProps<T> = {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => string;
  getItemSecondaryLabel?: (item: T) => string | null | undefined;
  label?: string;
  labelHelp?: string;
  disabled?: boolean;
  variant?: FormFieldVariant;
  listMaxHeight?: number;
  noMargin?: boolean;
  renderRowAccessory?: (item: T) => ReactNode;
};

export type InlineOptionListProps<T> = InlineOptionListBaseProps<T> &
  (
    | {
        selectionMode: 'single';
        value: string | null;
        onChange: (id: string) => void;
      }
    | {
        selectionMode: 'multi';
        value: string[];
        onChange: (ids: string[]) => void;
      }
  );

export function InlineOptionList<T>({
  items,
  getItemId,
  getItemLabel,
  getItemSecondaryLabel,
  label,
  labelHelp,
  disabled = false,
  variant = 'solid',
  listMaxHeight,
  noMargin = false,
  renderRowAccessory,
  selectionMode,
  value,
  onChange,
}: InlineOptionListProps<T>) {
  const fieldVariant = FORM_FIELD_VARIANTS[variant];

  const isSelected = (id: string) =>
    selectionMode === 'single' ? value === id : value.includes(id);

  const handlePress = (id: string) => {
    if (disabled) return;
    if (selectionMode === 'single') {
      onChange(id);
      return;
    }
    if (value.includes(id)) {
      onChange(value.filter((entry) => entry !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const list = (
    <View>
      {items.map((item) => {
        const id = getItemId(item);
        const selected = isSelected(id);
        const secondaryLabel = getItemSecondaryLabel?.(item);
        return (
          <View key={id} style={rowStyle(selected)}>
            <Pressable
              onPress={() => handlePress(id)}
              disabled={disabled}
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ROW_SIZING.rowGap }}
            >
              {selectionMode === 'multi' ? (
                <View
                  style={{
                    width: ROW_SIZING.checkboxSize,
                    height: ROW_SIZING.checkboxSize,
                    borderRadius: ROW_SIZING.checkboxRadius,
                    borderWidth: 1,
                    borderColor: selected ? '#F3440D' : '#4B5563',
                    backgroundColor: selected ? 'rgba(243, 68, 13, 0.3)' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? (
                    <Text selectable={false} className="text-orange-500 text-xs font-bold">
                      ✓
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  selectable={false}
                  className={`text-white font-instrument-medium ${ROW_SIZING.rowTextClassName}`}
                  numberOfLines={2}
                >
                  {getItemLabel(item)}
                </Text>
                {secondaryLabel ? (
                  <Text
                    selectable={false}
                    className="text-gray-400 font-instrument mt-0.5 text-[11px]"
                    numberOfLines={2}
                  >
                    {secondaryLabel}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {renderRowAccessory ? (
              <View style={{ flexShrink: 0 }}>{renderRowAccessory(item)}</View>
            ) : null}
          </View>
        );
      })}
    </View>
  );

  return (
    <View
      style={{
        marginBottom: noMargin ? 0 : 12,
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {label != null ? (
        <FormFieldLabel label={label} labelClassName={fieldVariant.labelClassName} help={labelHelp} />
      ) : null}
      {listMaxHeight != null ? (
        <ScrollView
          style={{ maxHeight: listMaxHeight }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {list}
        </ScrollView>
      ) : (
        list
      )}
    </View>
  );
}
