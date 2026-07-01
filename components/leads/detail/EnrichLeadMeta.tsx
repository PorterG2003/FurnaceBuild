import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { TicketIcon } from 'react-native-heroicons/outline';
import type { ComponentType } from 'react';

type PillTone = 'neutral' | 'credit' | 'muted';

const PILL_TONE_CLASS: Record<PillTone, string> = {
  neutral: 'border-[#2A2A2A] bg-[#171717]',
  credit: 'border-yellow-500/30 bg-yellow-500/10',
  muted: 'border-[#2A2A2A] bg-[#121212]',
};

const PILL_TEXT_CLASS: Record<PillTone, string> = {
  neutral: 'text-gray-300',
  credit: 'text-yellow-200',
  muted: 'text-gray-500',
};

const PILL_ICON_COLOR: Record<PillTone, string> = {
  neutral: '#D1D5DB',
  credit: '#FDE047',
  muted: '#9CA3AF',
};

function EnrichMetaPill({
  icon: Icon,
  label,
  tone = 'neutral',
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  label: string;
  tone?: PillTone;
}) {
  return (
    <View
      className={`self-start flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${PILL_TONE_CLASS[tone]}`}
    >
      <Icon size={13} color={PILL_ICON_COLOR[tone]} />
      <Text className={`text-[11px] font-instrument-medium ${PILL_TEXT_CLASS[tone]}`}>{label}</Text>
    </View>
  );
}

export function EnrichCreditBalancePill({
  creditsRemaining,
  creditLimit,
}: {
  creditsRemaining: number;
  creditLimit: number;
}) {
  if (creditLimit <= 0) return null;
  const tone: PillTone = creditsRemaining <= 0 ? 'muted' : 'credit';
  return (
    <EnrichMetaPill
      icon={TicketIcon}
      tone={tone}
      label={`${creditsRemaining} / ${creditLimit} credits`}
    />
  );
}

export function EnrichActionGroup({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <View className={`gap-2 ${className}`}>{children}</View>;
}
