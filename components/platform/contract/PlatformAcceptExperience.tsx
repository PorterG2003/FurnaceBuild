import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { cn } from '@/lib/cn';
import { INVITE_FLOW_NON_SELECTABLE_STYLE } from '@/lib/platform/contract/interactionStyles';
import { PlatformInviteLogoBar } from './PlatformInviteLogoBar';

export type PlatformAcceptExperienceProps = {
  children: ReactNode;
  logoBar?: ReactNode;
  note?: ReactNode;
  contentMode?: 'framed' | 'transparent';
  embedded?: boolean;
  nonSelectable?: boolean;
  maxWidthClassName?: string;
  bodyMaxWidthClassName?: string;
};

export function PlatformAcceptExperience({
  children,
  logoBar,
  note,
  contentMode = 'framed',
  embedded = false,
  nonSelectable = true,
  maxWidthClassName = 'max-w-3xl',
  bodyMaxWidthClassName = 'max-w-3xl',
}: PlatformAcceptExperienceProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="min-h-full flex-1 bg-[#121212]"
      style={nonSelectable ? INVITE_FLOW_NON_SELECTABLE_STYLE : undefined}
    >
      <View className="absolute inset-0">
        <HeroHeatShimmer
          intensity="low"
          speed="slow"
          tint="ember"
          className="absolute inset-0"
          midground={<EmberParticlesLite density="low" maxOpacity={0.06} count={6} />}
        />
      </View>
      <KeyboardAvoidingView
        className="min-h-full flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 16,
            paddingTop: embedded ? 16 : insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className={cn('mx-auto w-full items-center', maxWidthClassName)}>
            <View className="w-full items-center">{logoBar ?? <PlatformInviteLogoBar />}</View>
            {note ? note : null}
            <View style={{ height: 16 }} />
            <View className={cn('w-full', bodyMaxWidthClassName)}>
              <View
                className={cn(
                  'w-full overflow-hidden',
                  contentMode === 'framed'
                    ? 'rounded-2xl border border-[#2A2A2A] bg-[#121212] p-6 md:p-8'
                    : 'bg-transparent p-0',
                )}
              >
                {children}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
