import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  WrenchScrewdriverIcon,
} from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { useOnboardingOptional } from '@/components/onboarding/context';
import { useToast } from '@/components/ui/feedback/Toast';
import { useAccount } from '@/contexts/AccountContext';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { sendHelpMessageEmail } from '@/lib/services/transactionalEmail';
import {
  helpTopicLabel,
  resolveHelpRecipient,
  type HelpTopic,
} from './helpRouting';

export { HELP_EMAIL, HELP_EMAIL_URL, HELP_SCHEDULE_URL } from './helpRouting';

function openBookingPage(scheduleUrl: string): void {
  if (typeof window !== 'undefined') {
    window.open(scheduleUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(scheduleUrl);
}

export function HelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const onboarding = useOnboardingOptional();
  const { toast } = useToast();
  const { account, user } = useAccount();
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) {
      setTopic(null);
      setNotes('');
    }
  }, [visible]);

  const handleReplayTours = () => {
    if (!onboarding) return;
    void onboarding.resetAllFlows().then(() => {
      toast.success('Product tours reset. Welcome will start on your next visit.');
      onClose();
    });
  };

  const recipient = topic
    ? resolveHelpRecipient(topic, account?.account_manager)
    : null;
  const trimmedNotes = notes.trim();
  const canSubmit = trimmedNotes.length > 0 && recipient != null;

  const sendHelpMessage = async () => {
    if (!topic || !recipient) return;
    await sendHelpMessageEmail({
      notes: trimmedNotes,
      accountName: account?.name,
      userName: user?.name,
      topicLabel: helpTopicLabel(topic),
      recipient: recipient.id,
    });
    onClose();
    toast.success('Message sent.');
  };

  const handleSendMessage = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      await sendHelpMessage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleSendMessageAndBook = async () => {
    if (!canSubmit || !recipient) return;
    openBookingPage(recipient.scheduleUrl);
    setSending(true);
    try {
      await sendHelpMessage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      onBack={topic ? () => setTopic(null) : undefined}
      title={topic ? 'What should we know?' : 'How can we help?'}
      description={
        topic && recipient
          ? `We'll send this to ${recipient.name} (${recipient.email}) before you book.`
          : "Pick a topic and we'll route you to the right person."
      }
      maxWidth="md"
      footer={
        topic ? (
          <View className="gap-3 w-full">
            <Button
              fullWidth
              className="w-full"
              variant="outline"
              onPress={() => void handleSendMessage()}
              disabled={!canSubmit || sending}
            >
              {sending ? 'Sending…' : 'Send message'}
            </Button>
            <Button
              fullWidth
              className="w-full"
              onPress={() => void handleSendMessageAndBook()}
              disabled={!canSubmit || sending}
            >
              {sending ? 'Sending…' : 'Send message and book'}
            </Button>
          </View>
        ) : undefined
      }
    >
      {topic ? (
        <View>
          <Text className="text-gray-400 font-instrument text-xs mb-2">
            {helpTopicLabel(topic)} · 30 min with {recipient?.name}
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="A sentence or two of context helps us prepare."
            placeholderTextColor={authPlaceholderColor}
            className={`${authInputClassName} min-h-[120px]`}
            style={[authInputStyle, { textAlignVertical: 'top' }]}
            multiline
            accessibilityLabel="Help context notes"
          />
        </View>
      ) : (
        <>
          <View className="flex-row gap-3 mb-3">
            <HelpOptionTile
              icon={WrenchScrewdriverIcon}
              label="Technical support"
              subtitle="Bugs, setup, and product questions"
              onPress={() => setTopic('technical')}
            />
            <HelpOptionTile
              icon={CalendarDaysIcon}
              label="Strategy or check-in"
              subtitle="Campaigns, positioning, and reviews"
              onPress={() => setTopic('strategy')}
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
                <Text className="text-white font-instrument-semibold text-sm">
                  Replay product tours
                </Text>
                <Text className="text-gray-400 font-instrument text-xs">
                  Reset all onboarding tours and see them again from the start.
                </Text>
              </View>
            </Pressable>
          ) : null}
        </>
      )}
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
      <Text className="text-white font-instrument-semibold text-sm mb-1 text-center">
        {label}
      </Text>
      <Text className="text-gray-400 font-instrument text-xs text-center" numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}
