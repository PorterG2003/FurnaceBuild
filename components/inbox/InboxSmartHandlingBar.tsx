import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  SparklesIcon,
  XMarkIcon,
} from 'react-native-heroicons/outline';
import type { SmartHandlingActionOption, SmartHandlingMode } from '@/lib/inbox/smartHandling';
import type { ThreadStatusCalloutTone } from '@/lib/inbox/threadStatusCallout';

interface InboxSmartHandlingBarProps {
  loading: boolean;
  mode: SmartHandlingMode;
  tone?: ThreadStatusCalloutTone;
  title?: string;
  message: string;
  secondaryMessage?: string | null;
  primary?: SmartHandlingActionOption | null;
  alternatives?: SmartHandlingActionOption[];
  onAction?: (action: SmartHandlingActionOption) => void;
  onDismiss?: () => void;
  dismissible?: boolean;
}

function BarButton({
  label,
  variant,
  accent,
  onPress,
}: {
  label: string;
  variant: 'primary' | 'secondary';
  accent: string;
  onPress: () => void;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-center rounded-xl px-3.5 py-2.5 min-h-[40px]"
      style={{
        backgroundColor: isPrimary ? accent : '#FFFFFF0D',
        borderWidth: 1,
        borderColor: isPrimary ? accent : '#FFFFFF1F',
      }}
    >
      <Text
        className="text-sm font-instrument-medium text-center"
        style={{ color: isPrimary ? '#FFFFFF' : '#E5E7EB' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({
  action,
  variant,
  accent,
  onPress,
}: {
  action: SmartHandlingActionOption;
  variant: 'primary' | 'secondary';
  accent: string;
  onPress: () => void;
}) {
  return <BarButton label={action.label} variant={variant} accent={accent} onPress={onPress} />;
}

function DismissButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Dismiss smart handling"
      className="min-h-[32px] min-w-[32px] items-center justify-center rounded-lg"
      style={{ backgroundColor: 'rgba(107, 114, 128, 0.2)' }}
    >
      <XMarkIcon size={16} color="#9CA3AF" />
    </Pressable>
  );
}

const TONE_STYLES = {
  info: {
    titleClass: 'text-sky-100',
    bodyClass: 'text-sky-100/90',
    accent: '#7DD3FC',
    buttonAccent: '#2563EB',
    containerBg: 'rgba(59, 130, 246, 0.10)',
    containerBorder: 'rgba(96, 165, 250, 0.35)',
  },
  warning: {
    titleClass: 'text-amber-100',
    bodyClass: 'text-amber-100/90',
    accent: '#FBBF24',
    buttonAccent: '#D97706',
    containerBg: 'rgba(245, 158, 11, 0.10)',
    containerBorder: 'rgba(251, 191, 36, 0.35)',
  },
  ai: {
    titleClass: 'text-sky-100',
    bodyClass: 'text-sky-100/90',
    accent: '#7DD3FC',
    buttonAccent: '#2563EB',
    containerBg: 'rgba(59, 130, 246, 0.10)',
    containerBorder: 'rgba(96, 165, 250, 0.35)',
  },
  pipeline: {
    titleClass: 'text-sky-100',
    bodyClass: 'text-sky-100/90',
    accent: '#7DD3FC',
    buttonAccent: '#2563EB',
    containerBg: 'rgba(14, 165, 233, 0.15)',
    containerBorder: 'rgba(125, 211, 252, 0.30)',
  },
} as const;

export function InboxSmartHandlingBar({
  loading,
  mode,
  tone,
  title,
  message,
  secondaryMessage,
  primary,
  alternatives = [],
  onAction,
  onDismiss,
  dismissible = true,
}: InboxSmartHandlingBarProps) {
  const resolvedTone = tone ?? 'info';
  const styles = TONE_STYLES[resolvedTone];
  const showActionButtons = !loading && onAction && (primary || alternatives.length > 0);
  const resolvedTitle = title ?? (loading ? 'Smart handling' : 'Suggested next step');

  return (
    <View
      className="w-full rounded-xl border p-4"
      style={{
        backgroundColor: styles.containerBg,
        borderColor: styles.containerBorder,
        borderWidth: 1,
      }}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-[22px] w-[22px] flex-shrink-0 items-center justify-center">
          {loading ? (
            <ActivityIndicator size="small" color={styles.accent} />
          ) : resolvedTone === 'pipeline' ? (
            <ArrowPathIcon size={22} color={styles.accent} />
          ) : resolvedTone === 'ai' ? (
            <SparklesIcon size={22} color={styles.accent} />
          ) : resolvedTone === 'warning' ? (
            <ExclamationTriangleIcon size={22} color={styles.accent} />
          ) : (
            <LightBulbIcon size={22} color={styles.accent} />
          )}
        </View>

        <Text className={`flex-1 text-base font-instrument-semibold leading-tight ${styles.titleClass}`}>
          {resolvedTitle}
        </Text>

        {dismissible && onDismiss ? <DismissButton onPress={onDismiss} /> : null}
      </View>

      <Text className={`ml-[34px] mt-1.5 font-instrument text-sm leading-snug ${styles.bodyClass}`}>
        {message}
      </Text>

      {secondaryMessage ? (
        <Text className={`ml-[34px] mt-1.5 font-instrument text-sm leading-snug ${styles.bodyClass}`}>
          {secondaryMessage}
        </Text>
      ) : null}

      {showActionButtons ? (
        <View className="ml-[34px] mt-4 flex-row flex-wrap gap-2">
          {primary ? (
            <ActionButton
              action={primary}
              variant="primary"
              accent={styles.buttonAccent}
              onPress={() => onAction(primary)}
            />
          ) : null}
          {alternatives.map((action) => (
            <ActionButton
              key={`${action.action}:${action.label}`}
              action={action}
              variant="secondary"
              accent={styles.buttonAccent}
              onPress={() => onAction(action)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
