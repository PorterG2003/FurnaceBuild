import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { SegmentControl } from '@/components/ui/segment-control';
import { useConfirmClose } from '@/hooks/useConfirmClose';

const UNIT_TO_SECONDS: Record<string, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

function toWaitDurationSeconds(duration: string, unit: string): number {
  const n = parseInt(duration.trim(), 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n * (UNIT_TO_SECONDS[unit] ?? 3600);
}

interface WaitTimeNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    duration?: string;
    unit?: 'minutes' | 'hours' | 'days';
    wait_duration_seconds?: number;
  }) => void;
  initialData?: {
    label?: string;
    duration?: string;
    unit?: 'minutes' | 'hours' | 'days';
    wait_duration_seconds?: number;
  };
}

function WaitTimeNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: WaitTimeNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Wait Time');
  const [duration, setDuration] = useState(initialData?.duration || '');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>(
    initialData?.unit || 'hours'
  );
  const initialRef = useRef<{ label: string; duration: string; unit: 'minutes' | 'hours' | 'days' } | null>(
    null
  );

  useEffect(() => {
    if (!visible) return;
    const initial = {
      label: initialData?.label || 'Wait Time',
      duration: initialData?.duration || '',
      unit: initialData?.unit || 'hours',
    };
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
    const wait_duration_seconds = toWaitDurationSeconds(duration, unit);
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
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Duration
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              placeholder="24"
              placeholderTextColor="#666"
              keyboardType="numeric"
              className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
              style={{
                borderColor: '#FFFFFF4D',
                backgroundColor: '#FFFFFF0D',
                color: '#FFFFFF',
                borderWidth: 1,
              }}
              selectionColor="#FF4D00"
              underlineColorAndroid="transparent"
            />
          </View>

          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Unit
            </Text>
            <SegmentControl
              options={[
                { value: 'minutes', label: 'Minutes' },
                { value: 'hours', label: 'Hours' },
                { value: 'days', label: 'Days' },
              ]}
              value={unit}
              onChange={(v) => setUnit(v as 'minutes' | 'hours' | 'days')}
            />
          </View>
        </View>
      </View>
    </BaseModal>
  );
}

export { WaitTimeNodeModal };
export default WaitTimeNodeModal;

