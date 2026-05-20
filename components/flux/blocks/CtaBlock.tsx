import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { CtaBlockProps } from '@/lib/flux/types';
import { handleFluxCtaPress } from '@/lib/flux/fluxCtaNavigation';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPageScroll } from '../FluxPageScrollContext';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export function CtaBlock({ props }: { props: CtaBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const pageScroll = useFluxPageScroll();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const onCtaPress = () => handleFluxCtaPress(props.ctaUrl, pageScroll ?? undefined);
  const primaryButton = (
    <Pressable className="px-8 py-3" style={presentation.primaryButton} onPress={onCtaPress}>
      <Text className="text-base" style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}>
        {props.ctaText}
      </Text>
    </Pressable>
  );
  const secondaryButton = (
    <Pressable className="px-8 py-3" style={presentation.secondaryButton} onPress={onCtaPress}>
      <Text className="text-base" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
        {props.ctaText}
      </Text>
    </Pressable>
  );

  if (presentation.layouts.cta === 'inline') {
    return (
      <View
        className="w-full px-5 md:px-10 py-10"
        style={{ backgroundColor: presentation.sectionBackgroundColor }}
      >
        <View
          className="w-full max-w-3xl self-center border-t pt-8"
          style={{ borderColor: withFluxAlpha(theme.primaryColor, '55') }}
        >
          <Text className="text-2xl md:text-3xl leading-tight mb-5" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.headline}
          </Text>
          {primaryButton}
        </View>
      </View>
    );
  }

  if (presentation.layouts.cta === 'raisedCard') {
    return (
      <View
        className="w-full px-4 md:px-8 py-12"
        style={{ backgroundColor: presentation.sectionBackgroundColor }}
      >
        <View className="w-full max-w-4xl self-center p-6 md:p-8 flex-row flex-wrap gap-5 items-center justify-between" style={presentation.strongCard}>
          <View className="flex-1 min-w-[240px]">
            <Text className="text-xs uppercase tracking-[2px] mb-2" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
              Next step
            </Text>
            <Text className="text-2xl md:text-4xl leading-tight" style={{ color: theme.textColor, fontFamily: headingFont }}>
              {props.headline}
            </Text>
          </View>
          {primaryButton}
        </View>
      </View>
    );
  }

  if (presentation.layouts.cta === 'softPanel') {
    return (
      <View
        className="w-full px-4 md:px-6 py-12"
        style={{ backgroundColor: presentation.sectionBackgroundColor }}
      >
        <View className="w-full max-w-3xl self-center p-6 md:p-8 items-center" style={presentation.tintedCard}>
          <Text className="text-xs uppercase tracking-[2px] mb-3" style={{ color: theme.textColor, opacity: 0.62, fontFamily: bodyFont }}>
            Ready when you are
          </Text>
          <Text className="text-2xl md:text-4xl text-center leading-tight mb-6" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.headline}
          </Text>
          {primaryButton}
        </View>
      </View>
    );
  }

  return (
    <View className="w-full py-10 md:py-16 px-4 md:px-6 items-center" style={{ backgroundColor: theme.primaryColor }}>
      <Text
        className="text-2xl md:text-3xl text-center mb-6 max-w-xl"
        style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}
      >
        {props.headline}
      </Text>
      {secondaryButton}
    </View>
  );
}
