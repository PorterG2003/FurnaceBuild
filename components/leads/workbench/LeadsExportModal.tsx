import { ActivityIndicator, Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';

const EXPORT_MODAL_BODY =
  'The export is running in the background. Stay on this page to have the CSV download automatically when it is ready.';

export function LeadsExportModal({
  visible,
  onClose,
  phase,
  errorMessage,
}: {
  visible: boolean;
  onClose: () => void;
  phase: 'running' | 'failed';
  errorMessage?: string | null;
}) {
  const failed = phase === 'failed';

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={failed ? 'Export failed' : 'Export in progress'}
      description={failed ? undefined : EXPORT_MODAL_BODY}
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>
            Got it
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>
            Got it
          </Button>
        </ModalFooter>
      }
    >
      {failed ? (
        <View className="gap-3">
          <Text className="text-gray-400 font-instrument text-sm leading-5">{EXPORT_MODAL_BODY}</Text>
          {errorMessage ? (
            <Text className="text-red-400/90 font-instrument text-sm leading-5">{errorMessage}</Text>
          ) : null}
        </View>
      ) : (
        <View className="flex-row items-center gap-3 py-2">
          <ActivityIndicator size="small" color="#A3A3A3" />
          <Text className="text-gray-500 font-instrument text-sm">Preparing your file…</Text>
        </View>
      )}
    </BaseModal>
  );
}
