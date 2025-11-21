import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';

interface EmailNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    subject?: string;
    template?: string;
    recipients?: string[];
  }) => void;
  initialData?: {
    label?: string;
    subject?: string;
    template?: string;
    recipients?: string[];
  };
}

function EmailNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: EmailNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Send Email');
  const [subject, setSubject] = useState(initialData?.subject || '');
  const [template, setTemplate] = useState(initialData?.template || '');
  const [recipients, setRecipients] = useState(
    initialData?.recipients?.join(', ') || ''
  );

  const handleSave = () => {
    onSave({
      label,
      subject,
      template,
      recipients: recipients.split(',').map((r) => r.trim()).filter(Boolean),
    });
    onClose();
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <TouchableOpacity
          onPress={onClose}
          className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
          style={{
            borderWidth: 1,
            borderColor: '#3A3A3A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Email Node"
      description="Configure the email to be sent"
      footer={footer}
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

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Subject
          </Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Email subject"
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

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Template
          </Text>
          <TextInput
            value={template}
            onChangeText={setTemplate}
            placeholder="Email template ID"
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

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Recipients (comma-separated)
          </Text>
          <TextInput
            value={recipients}
            onChangeText={setRecipients}
            placeholder="user@example.com, another@example.com"
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
            multiline
          />
        </View>
      </View>
    </BaseModal>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

