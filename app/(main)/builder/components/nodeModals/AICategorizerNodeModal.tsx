import { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/Toggle';
import { Alert } from '@/components/ui/feedback/Alert';
import { EyeIcon } from 'react-native-heroicons/outline';
import { CategorizerPreviewModal } from './CategorizerPreviewModal';

/**
 * Categorizer node config: fixed Interested / Neutral / Not Interested
 * branches. AI off = manual categorization via the Master Inbox; AI on =
 * automatic classification of each reply (cheap LLM). Auto-replies (OOO)
 * never branch - they release the held sequence.
 */
interface AICategorizerNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: { label?: string; use_ai?: boolean }) => void;
  initialData?: {
    label?: string;
    use_ai?: boolean;
    campaignId?: string;
  };
}

export function AICategorizerNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: AICategorizerNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Categorizer');
  const [useAi, setUseAi] = useState(initialData?.use_ai ?? false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(initialData?.label || 'Categorizer');
    setUseAi(initialData?.use_ai ?? false);
  }, [visible, initialData]);

  const handleSave = () => {
    onSave({ label, use_ai: useAi });
    onClose();
  };

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={onClose}>
        Cancel
      </Button>
      <Button onPress={handleSave}>Save</Button>
    </ModalFooter>
  );

  const footerMobile = (
    <ModalFooter>
      <Button onPress={handleSave}>Save</Button>
    </ModalFooter>
  );

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title="Configure Categorizer"
        description="Waits for a reply, categorizes it, and branches on Interested, Neutral, or Not Interested."
        footer={footer}
        footerMobile={footerMobile}
        maxWidth="lg"
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

          <View className="flex-row items-center justify-between gap-3 py-0.5">
            <View className="flex-1 shrink">
              <Text className="text-sm font-instrument-medium text-gray-300">
                Categorize with AI
              </Text>
              <Text className="text-xs font-instrument text-gray-500 mt-0.5">
                Off = you categorize replies manually in the Master Inbox.
              </Text>
            </View>
            <View className="shrink-0" style={{ paddingVertical: 2 }}>
              <Toggle value={useAi} onValueChange={setUseAi} />
            </View>
          </View>

          {useAi ? (
            <Alert
              variant="warning"
              message="AI categorization can get things wrong. It's a good idea to collect a few real replies first and check how they'd be categorized with the preview below."
            />
          ) : null}

          <View>
            <Text className="text-xs font-instrument text-gray-500 mb-2 leading-5">
              Out-of-office and other auto-replies never branch — the sequence
              picks up where it left off (when a return date is stated, after
              that date).
            </Text>
            <Button
              variant="secondary"
              onPress={() => setPreviewOpen(true)}
              disabled={!initialData?.campaignId}
            >
              <View className="flex-row items-center gap-2">
                <EyeIcon size={16} color="#FFFFFF" />
                <Text className="text-white font-instrument-medium">
                  Preview with existing replies
                </Text>
              </View>
            </Button>
          </View>
        </View>
      </BaseModal>

      {initialData?.campaignId ? (
        <CategorizerPreviewModal
          visible={previewOpen}
          onClose={() => setPreviewOpen(false)}
          campaignId={initialData.campaignId}
          useAi={useAi}
        />
      ) : null}
    </>
  );
}

export default AICategorizerNodeModal;
