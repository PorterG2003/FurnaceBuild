import type { ReactNode } from 'react';
import { View } from 'react-native';
import { cn } from '@/lib/cn';

export type AcceptStandaloneCardProps = {
  children: ReactNode;
  /** Buttons and CTAs — rendered inside the card below a divider. */
  actions?: ReactNode;
  className?: string;
};

/** Bordered card for standalone accept / invite flows (matches auth & invite-only). */
export function AcceptStandaloneCard({ children, actions, className }: AcceptStandaloneCardProps) {
  return (
    <View
      className={cn(
        'w-full overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#121212] p-6',
        className,
      )}
    >
      <View className="gap-4">{children}</View>
      {actions ? (
        <View className="gap-3 mt-6 pt-6 border-t border-[#2A2A2A]">{actions}</View>
      ) : null}
    </View>
  );
}
