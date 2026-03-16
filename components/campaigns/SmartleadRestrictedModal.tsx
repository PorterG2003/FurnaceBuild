import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';

interface Props {
  visible: boolean;
  onClose: () => void;
  campaignId: string | null;
  /** When true, closing or "Go to campaign stats" only calls onClose (no redirect). Use when already on the stats page. */
  isOnStatsPage?: boolean;
}

export function SmartleadRestrictedModal({ visible, onClose, campaignId, isOnStatsPage = false }: Props) {
  const router = useRouter();

  const handleCloseOrGoToStats = () => {
    if (isOnStatsPage) {
      onClose();
      return;
    }
    if (campaignId) {
      router.replace({ pathname: '/campaigns/[id]', params: { id: campaignId } });
    } else {
      router.replace('/campaigns');
    }
    onClose();
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleCloseOrGoToStats}
      title="Not available for Smartlead campaigns"
      description="This campaign was imported from Smartlead. Only the campaign stats dashboard is available for imported campaigns."
      compact
      footer={
        <View className="flex-row justify-end">
          <Button onPress={handleCloseOrGoToStats}>
            Go to campaign stats
          </Button>
        </View>
      }
    />
  );
}
