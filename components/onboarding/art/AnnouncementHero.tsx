import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { EmberParticlesLite, HeroHeatShimmer } from '@/components/ui/effects';

interface AnnouncementHeroProps {
  children: ReactNode;
}

/**
 * Full-bleed visual container for announcement steps. The content sits on top
 * of the ember heat background — no inner card or border, so the modal chrome
 * is the only frame. Use `noPadding` on BaseModal to let this fill edge-to-edge.
 */
export function AnnouncementHero({ children }: AnnouncementHeroProps) {
  const isWeb = Platform.OS === 'web';
  return (
    <View className="overflow-hidden rounded-t-2xl" style={{ minHeight: 340 }}>
      {isWeb ? (
        <View className="absolute inset-0">
          <HeroHeatShimmer intensity="medium" speed="slow" tint="ember" />
        </View>
      ) : (
        <>
          <View className="absolute inset-0" style={{ backgroundColor: '#0c0c0c' }} />
          <View
            className="absolute inset-0"
            style={{ backgroundColor: '#f85102', opacity: 0.07 }}
          />
        </>
      )}
      {isWeb ? (
        <EmberParticlesLite
          density="low"
          maxOpacity={0.18}
          count={5}
          maxSize={9}
          speedScale={0.5}
          containerHeight={340}
        />
      ) : null}

      <View
        className="relative z-10 items-center justify-center px-8 py-14"
        style={{ minHeight: 340 }}
      >
        {children}
      </View>
    </View>
  );
}
