import { useMemo, useState } from 'react';
import { View, Text, TextInput, useWindowDimensions } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Toggle } from '@/components/ui/Toggle';
import { FormFieldHelpIcon } from '@/components/ui/forms';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { getLeadVariables } from '@/lib/email/index';
import { JsonPayloadEditor } from '@/components/builder/JsonPayloadEditor';

interface DataSenderNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    endpoint?: string;
    endpoint_url?: string;
    payload?: string;
    payload_template?: Record<string, unknown>;
    on_failure?: 'continue' | 'stop';
  }) => void;
  initialData?: {
    label?: string;
    endpoint?: string;
    endpoint_url?: string;
    payload?: string;
    payload_template?: Record<string, unknown>;
    on_failure?: 'continue' | 'stop';
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
  };
}

function DataSenderNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: DataSenderNodeModalProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= LAYOUT_BREAKPOINT;
  const minPayloadHeight = isWide ? 280 : 220;
  const [label, setLabel] = useState(initialData?.label || 'Data Sender');
  const [endpoint, setEndpoint] = useState(initialData?.endpoint_url || initialData?.endpoint || '');
  const [payload, setPayload] = useState(() => {
    if (typeof initialData?.payload === 'string' && initialData.payload.trim()) {
      return initialData.payload;
    }
    if (initialData?.payload_template) {
      return JSON.stringify(initialData.payload_template, null, 2);
    }
    return `{
  "email": "{{email}}",
  "name": "{{name}}",
  "custom": {
    "company": "{{custom.company}}"
  }
}`;
  });
  const [onFailure, setOnFailure] = useState<'continue' | 'stop'>(
    initialData?.on_failure === 'stop' ? 'stop' : 'continue'
  );

  const leadVariables = useMemo(
    () =>
      getLeadVariables(initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys),
    [initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys]
  );

  const payloadError = useMemo(() => {
    try {
      JSON.parse(payload);
      return null;
    } catch {
      return 'Payload must be valid JSON.';
    }
  }, [payload]);

  const handleSave = () => {
    if (payloadError) {
      return;
    }
    const payloadTemplate = JSON.parse(payload) as Record<string, unknown>;
    onSave({
      label,
      endpoint,
      endpoint_url: endpoint,
      payload,
      payload_template: payloadTemplate,
      on_failure: onFailure,
    });
    onClose();
  };

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={onClose}>
        Cancel
      </Button>
      <Button onPress={handleSave} disabled={!!payloadError}>
        Save
      </Button>
    </ModalFooter>
  );

  const footerMobile = (
    <ModalFooter>
      <Button onPress={handleSave} disabled={!!payloadError}>
        Save
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Data Sender Node"
      maxWidth={isWide ? '2xl' : 'md'}
      footer={footer}
      footerMobile={footerMobile}
    >
      <View className="gap-4">
        <View className={isWide ? 'flex-row items-start gap-4' : 'gap-4'}>
          <View className={isWide ? 'flex-1' : undefined}>
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

          <View className={isWide ? 'flex-1' : undefined}>
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Endpoint URL
            </Text>
            <TextInput
              value={endpoint}
              onChangeText={setEndpoint}
              placeholder="https://api.example.com/webhook"
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
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        </View>

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Payload (JSON)
          </Text>
          <JsonPayloadEditor
            value={payload}
            onChange={setPayload}
            variables={leadVariables}
            minHeight={minPayloadHeight}
            jsonError={payloadError}
          />
        </View>

        <View className="flex-row items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm font-instrument-medium text-gray-300">
              Continue on Failure
            </Text>
            <FormFieldHelpIcon
              content="When enabled, the flow continues if the webhook fails after retries. When disabled, the enrollment stops with an error."
              accessibilityLabel="Help for Continue on Failure"
            />
          </View>
          <Toggle
            value={onFailure === 'continue'}
            onValueChange={(value) => setOnFailure(value ? 'continue' : 'stop')}
          />
        </View>

        <Alert
          variant="info"
          message="Data Sender only supports HTTPS endpoints and blocks localhost, private IPs, and metadata hosts."
        />
      </View>
    </BaseModal>
  );
}

export { DataSenderNodeModal };
export default DataSenderNodeModal;
