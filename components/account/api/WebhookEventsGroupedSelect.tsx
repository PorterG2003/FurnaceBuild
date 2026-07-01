import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { Checkbox } from '@/components/ui/Checkbox';
import { FormFieldLabel } from '@/components/ui/forms/FormFieldHelp';
import { FORM_FIELD_VARIANTS, type FormFieldVariant } from '@/components/ui/forms/formFieldStyles';
import {
  INLINE_OPTION_LIST_ROW_SIZING,
  webhookEventsGroupedCardStyle,
} from '@/components/ui/forms/inlineOptionListStyles';
import {
  groupSelectionState,
  toggleGroupEvents,
  WEBHOOK_GROUPED_EVENT_ITEMS,
  type WebhookEventType,
} from '@/lib/client-api/webhooks/eventGroups';

/** Compact circle hit target — keeps hover ring without 40px row height. */
const CHECKBOX_SIZE = 18;
const CHECKBOX_CIRCLE_SIZE = 36;

export interface WebhookEventsGroupedSelectProps {
  value: WebhookEventType[];
  onChange: (eventTypes: WebhookEventType[]) => void;
  label?: string;
  labelHelp?: string;
  disabled?: boolean;
  variant?: FormFieldVariant;
}

export function WebhookEventsGroupedSelect({
  value,
  onChange,
  label = 'Enabled events',
  labelHelp,
  disabled = false,
  variant = 'solid',
}: WebhookEventsGroupedSelectProps) {
  const fieldVariant = FORM_FIELD_VARIANTS[variant];
  const selectedSet = useMemo(() => new Set(value), [value]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string, selectAll: boolean) => {
    if (disabled) return;
    onChange(toggleGroupEvents(groupId, value, selectAll));
  };

  const toggleEvent = (eventType: WebhookEventType) => {
    if (disabled) return;
    if (selectedSet.has(eventType)) {
      onChange(value.filter((entry) => entry !== eventType));
      return;
    }
    onChange([...value, eventType].sort());
  };

  const toggleExpanded = (groupId: string) => {
    if (disabled) return;
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <View
      style={{
        marginBottom: 0,
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {label ? (
        <FormFieldLabel
          label={label}
          labelClassName={fieldVariant.labelClassName}
          help={labelHelp}
        />
      ) : null}

      <View>
        {WEBHOOK_GROUPED_EVENT_ITEMS.map((group) => {
          const groupEvents = group.events.map((entry) => entry.type);
          const state = groupSelectionState(
            { id: group.id, label: group.label, description: group.description, events: groupEvents },
            selectedSet,
          );
          const open = expandedGroups[group.id] ?? false;
          const groupChecked = state === 'all';
          const groupIndeterminate = state === 'some';
          const selectGroup = () => toggleGroup(group.id, !groupChecked && !groupIndeterminate);

          return (
            <View key={group.id} style={webhookEventsGroupedCardStyle()}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: INLINE_OPTION_LIST_ROW_SIZING.rowGap,
                }}
              >
                <Checkbox
                  checked={groupChecked}
                  indeterminate={groupIndeterminate}
                  onPress={selectGroup}
                  disabled={disabled}
                  size={CHECKBOX_SIZE}
                  circleSize={CHECKBOX_CIRCLE_SIZE}
                />
                <Pressable
                  onPress={() => toggleExpanded(group.id)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: INLINE_OPTION_LIST_ROW_SIZING.rowGap,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      selectable={false}
                      className={`text-white font-instrument-medium ${INLINE_OPTION_LIST_ROW_SIZING.rowTextClassName}`}
                      numberOfLines={2}
                    >
                      {group.label}
                    </Text>
                    <Text
                      selectable={false}
                      className="text-gray-400 font-instrument mt-0.5 text-[11px]"
                      numberOfLines={2}
                    >
                      {group.description}
                    </Text>
                  </View>
                  {open ? (
                    <ChevronDownIcon size={16} color="#9CA3AF" />
                  ) : (
                    <ChevronRightIcon size={16} color="#9CA3AF" />
                  )}
                </Pressable>
              </View>

              {open ? (
                <View
                  style={{
                    marginTop: 8,
                    paddingLeft: CHECKBOX_CIRCLE_SIZE + INLINE_OPTION_LIST_ROW_SIZING.rowGap,
                    gap: 2,
                  }}
                >
                  {group.events.map((event) => {
                    const selected = selectedSet.has(event.type);
                    return (
                      <View
                        key={event.type}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: INLINE_OPTION_LIST_ROW_SIZING.rowGap,
                        }}
                      >
                        <Checkbox
                          checked={selected}
                          onPress={() => toggleEvent(event.type)}
                          disabled={disabled}
                          size={CHECKBOX_SIZE}
                          circleSize={CHECKBOX_CIRCLE_SIZE}
                        />
                        <Text
                          selectable={false}
                          className={`flex-1 font-instrument ${INLINE_OPTION_LIST_ROW_SIZING.rowTextClassName} ${selected ? 'text-white font-instrument-medium' : 'text-gray-300'}`}
                        >
                          {event.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
