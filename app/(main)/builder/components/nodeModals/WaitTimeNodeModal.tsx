import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { ChevronDownIcon } from 'react-native-heroicons/outline';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import {
  DEFAULT_WAIT_DURATION,
  DEFAULT_WAIT_UNIT,
  inferDurationUnit,
  inferDurationValue,
  isWaitDurationUnit,
  resolveWaitDurationSeconds,
  type WaitDurationUnit,
} from '@/lib/campaigns/flow/waitTime';

const WAIT_UNIT_OPTIONS: Array<{ id: WaitDurationUnit; label: string }> = [
  { id: 'minutes', label: 'Minutes' },
  { id: 'hours', label: 'Hours' },
  { id: 'days', label: 'Days' },
];

/** Keep Duration TextInput and Unit Select trigger on the same size. */
const FIELD_CONTROL_HEIGHT = 48;
const FIELD_CONTROL_STYLE = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  color: '#FFFFFF',
  borderWidth: 1,
  borderRadius: 12,
  height: FIELD_CONTROL_HEIGHT,
  paddingHorizontal: 16,
  paddingVertical: 0,
} as const;

interface WaitTimeNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    duration?: string;
    unit?: WaitDurationUnit;
    wait_duration_seconds?: number;
  }) => void;
  initialData?: {
    label?: string;
    duration?: string;
    unit?: WaitDurationUnit;
    wait_duration_seconds?: number;
  };
}

function resolveInitialDuration(initialData?: WaitTimeNodeModalProps['initialData']): {
  label: string;
  duration: string;
  unit: WaitDurationUnit;
} {
  const hasDisplayDuration =
    typeof initialData?.duration === 'string' && initialData.duration.trim().length > 0;
  if (hasDisplayDuration && isWaitDurationUnit(initialData?.unit)) {
    return {
      label: initialData?.label || 'Wait Time',
      duration: initialData!.duration!.trim(),
      unit: initialData!.unit!,
    };
  }

  const seconds = resolveWaitDurationSeconds({
    wait_duration_seconds: initialData?.wait_duration_seconds,
    duration: initialData?.duration,
    unit: initialData?.unit,
  });
  const unit = inferDurationUnit(seconds);
  return {
    label: initialData?.label || 'Wait Time',
    duration: inferDurationValue(seconds, unit),
    unit,
  };
}

function WaitTimeNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: WaitTimeNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Wait Time');
  const [duration, setDuration] = useState(DEFAULT_WAIT_DURATION);
  const [unit, setUnit] = useState<WaitDurationUnit>(DEFAULT_WAIT_UNIT);
  const initialRef = useRef<{ label: string; duration: string; unit: WaitDurationUnit } | null>(
    null
  );

  useEffect(() => {
    if (!visible) return;
    const initial = resolveInitialDuration(initialData);
    initialRef.current = initial;
    setLabel(initial.label);
    setDuration(initial.duration);
    setUnit(initial.unit);
  }, [visible, initialData]);

  const isDirty =
    initialRef.current === null
      ? false
      : label !== initialRef.current.label ||
        duration !== initialRef.current.duration ||
        unit !== initialRef.current.unit;

  const handleClose = useConfirmClose(isDirty, onClose);

  const handleSave = () => {
    const wait_duration_seconds = resolveWaitDurationSeconds({ duration, unit });
    onSave({ label, duration, unit, wait_duration_seconds });
    onClose();
  };

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={handleClose}>
        Cancel
      </Button>
      <Button onPress={handleSave}>
        Save
      </Button>
    </ModalFooter>
  );

  const footerMobile = (
    <ModalFooter>
      <Button onPress={handleSave}>
        Save
      </Button>
    </ModalFooter>
  );

  const unitLabel =
    WAIT_UNIT_OPTIONS.find((option) => option.id === unit)?.label ?? 'Select unit…';

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Configure Wait Time Node"
      description="Configure the wait duration"
      footer={footer}
      footerMobile={footerMobile}
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Label
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Node label"
            placeholderTextColor="#666"
            className="text-base text-white"
            style={FIELD_CONTROL_STYLE}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

        <View className="flex-row gap-3 items-end">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Duration
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              placeholder="3"
              placeholderTextColor="#666"
              keyboardType="numeric"
              className="text-base text-white"
              style={FIELD_CONTROL_STYLE}
              selectionColor="#FF4D00"
              underlineColorAndroid="transparent"
            />
          </View>

          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Unit
            </Text>
            <Select
              variant="glass"
              items={WAIT_UNIT_OPTIONS}
              getItemId={(item) => item.id}
              getItemLabel={(item) => ({ primary: item.label })}
              value={unit}
              onChange={(id) => {
                if (isWaitDurationUnit(id)) setUnit(id);
              }}
              placeholder="Select unit…"
              searchable={false}
              noMargin
              renderTrigger={({ onPress }) => (
                <TouchableOpacity
                  onPress={onPress}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Unit: ${unitLabel}`}
                  style={[
                    FIELD_CONTROL_STYLE,
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    },
                  ]}
                >
                  <Text className="text-base text-white" numberOfLines={1}>
                    {unitLabel}
                  </Text>
                  <ChevronDownIcon size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </View>
    </BaseModal>
  );
}

export { WaitTimeNodeModal };
export default WaitTimeNodeModal;
