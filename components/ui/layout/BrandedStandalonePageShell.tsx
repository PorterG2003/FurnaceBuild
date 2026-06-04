import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/ui/branding';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { cn } from '@/lib/cn';

export type BrandedStandalonePageShellProps = {
  children: ReactNode;
  /** Tailwind max-width class for the content column (default centered card width). */
  maxWidthClassName?: string;
  showLogo?: boolean;
  /** Vertically center short content (sign-in prompts, loading). */
  centerContent?: boolean;
  contentClassName?: string;
};

/**
 * Shared full-screen shell for standalone flows (accept links, install, invite-only).
 * Matches HeroHeatShimmer + ember background used on install and auth.
 */
export function BrandedStandalonePageShell({
  children,
  maxWidthClassName = 'max-w-md',
  showLogo = true,
  centerContent = true,
  contentClassName,
}: BrandedStandalonePageShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <HeroHeatShimmer
      intensity="low"
      speed="slow"
      tint="ember"
      className="flex-1"
      midground={<EmberParticlesLite density="low" maxOpacity={0.06} />}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: Math.max(insets.top, 16) + 16,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
          flexGrow: 1,
          ...(centerContent ? { justifyContent: 'center' as const } : undefined),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          className={cn(
            'w-full self-center items-center',
            maxWidthClassName,
            contentClassName,
          )}
        >
          {showLogo ? (
            <View className="w-full max-w-[220px] items-center mb-4">
              <Logo className="mb-0" variant="white" maxWidth={220} />
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </HeroHeatShimmer>
  );
}
