import type { ReactNode } from 'react';
import { View } from 'react-native';

interface AnnouncementArtCardProps {
  /** `lg` (16:9) for a full hero image; `sm` (21:9) for a single centered icon. */
  size?: 'lg' | 'sm';
  children: ReactNode;
}

/**
 * Shared chrome for announcement-step art: dark card, brand-orange glow, and a
 * centered content slot. Flow-agnostic — see `WelcomeArt` for a `lg` hero and
 * `lib/onboarding/announcementArt.tsx` (`iconAnnouncementArt`) for `sm` icon
 * heroes.
 */
export function AnnouncementArtCard({ size = 'sm', children }: AnnouncementArtCardProps) {
  const isLarge = size === 'lg';
  return (
    <View
      className="w-full overflow-hidden rounded-xl border border-[#2A2A2A] items-center justify-center"
      style={{ aspectRatio: isLarge ? 16 / 9 : 21 / 9, backgroundColor: '#1A1A1A' }}
    >
      <View
        className="absolute inset-0"
        style={{ backgroundColor: '#f85102', opacity: 0.08 }}
      />
      <View
        className="absolute rounded-full"
        style={{
          width: isLarge ? 160 : 100,
          height: isLarge ? 160 : 100,
          backgroundColor: 'rgba(248,81,2,0.18)',
        }}
      />
      {children}
    </View>
  );
}
