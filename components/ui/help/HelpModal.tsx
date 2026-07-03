import { Linking, Pressable, Text, View } from 'react-native';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  EnvelopeIcon,
} from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { useOnboardingOptional } from '@/components/onboarding/context';
import { useToast } from '@/components/ui/feedback';

export const HELP_EMAIL = 'porter@getfurnace.io';
export const HELP_EMAIL_URL = 'mailto:porter@getfurnace.io';
export const HELP_SCHEDULE_URL = 'https://calendar.app.google/beJwbyBJgxrdiwGg8';

export function HelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const onboarding = useOnboardingOptional();
  const { toast } = useToast();

  const handleReplayTours = () => {
    if (!onboarding) return;
    void onboarding.resetAllFlows().then(() => {
      toast.success('Product tours reset. Welcome will start on your next visit.');
      onClose();
    });
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Email us or book a call"
      description="We're happy to help."
      maxWidth="md"
    >
      <View className="flex-row gap-3 mb-3">
        <HelpOptionTile
          icon={EnvelopeIcon}
          label="Email"
          subtitle={HELP_EMAIL}
          onPress={() => {
            void Linking.openURL(HELP_EMAIL_URL);
          }}
        />
        <HelpOptionTile
          icon={CalendarDaysIcon}
          label="Schedule"
          subtitle="30 min with Porter"
          onPress={() => {
            void Linking.openURL(HELP_SCHEDULE_URL);
          }}
        />
      </View>
      {onboarding ? (
        <Pressable
          onPress={handleReplayTours}
          className="flex-row items-center gap-3 rounded-xl border border-[#2A2A2A] bg-[#181818] px-4 py-3 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="Replay product tours"
        >
          <View className="rounded-lg bg-brand-orange/20 p-2">
            <ArrowPathIcon size={22} color="#f85102" />
          </View>
          <View className="flex-1">
            <Text className="text-white font-instrument-semibold text-sm">Replay product tours</Text>
            <Text className="text-gray-400 font-instrument text-xs">
              Reset all onboarding tours and see them again from the start.
            </Text>
          </View>
        </Pressable>
      ) : null}
    </BaseModal>
  );
}

function HelpOptionTile({
  icon: Icon,
  label,
  subtitle,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 min-h-[120px] items-center justify-center rounded-xl border border-[#2A2A2A] bg-[#181818] px-3 py-4 active:opacity-80"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View className="mb-3 rounded-lg bg-brand-orange/20 p-3">
        <Icon size={28} color="#f85102" />
      </View>
      <Text className="text-white font-instrument-semibold text-sm mb-1">{label}</Text>
      <Text className="text-gray-400 font-instrument text-xs text-center" numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}
