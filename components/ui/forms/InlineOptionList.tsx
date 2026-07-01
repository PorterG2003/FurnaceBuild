import { Pressable, ScrollView, Text, View, type ReactNode } from 'react-native';
import { Checkbox } from '@/components/ui/Checkbox';
import { FormFieldLabel } from './FormFieldHelp';
import { FORM_FIELD_VARIANTS, type FormFieldVariant } from './formFieldStyles';
import { INLINE_OPTION_LIST_ROW_SIZING, inlineOptionListRowStyle } from './inlineOptionListStyles';

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
          <View key={id} style={inlineOptionListRowStyle(selected)}>
            {selectionMode === 'multi' ? (
              <Checkbox
                checked={selected}
                onPress={() => handlePress(id)}
                disabled={disabled}
                size={18}
                circleSize={28}
              />
            ) : null}
            <Pressable
              onPress={() => handlePress(id)}
              disabled={disabled}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Text
                selectable={false}
                className={`text-white font-instrument-medium ${INLINE_OPTION_LIST_ROW_SIZING.rowTextClassName}`}
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
