import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import type { HeroBlockProps } from '@/lib/flux/types';
import { handleFluxCtaPress } from '@/lib/flux/fluxCtaNavigation';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPageScroll } from '../FluxPageScrollContext';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export function HeroBlock({ props }: { props: HeroBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const pageScroll = useFluxPageScroll();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const onCtaPress = () => handleFluxCtaPress(props.ctaUrl, pageScroll ?? undefined);
  const heroImage = props.heroImageUrl ? (
    <Image
      source={{ uri: props.heroImageUrl }}
      className="w-full h-56 md:h-72 rounded-2xl"
      resizeMode="cover"
    />
  ) : null;
  const cta = (
    <Pressable
      className="px-8 py-3"
      style={
        presentation.layouts.hero === 'editorial' || presentation.layouts.hero === 'documentHeader'
          ? presentation.primaryButton
          : presentation.secondaryButton
      }
      onPress={onCtaPress}
    >
      <Text
        className="text-base"
        style={{
          color:
            presentation.layouts.hero === 'editorial' || presentation.layouts.hero === 'documentHeader'
              ? '#ffffff'
              : theme.primaryColor,
          fontFamily: headingFont,
        }}
      >
        {props.ctaText}
      </Text>
    </Pressable>
  );

  if (presentation.layouts.hero === 'editorial') {
    return (
      <View className="w-full py-12 md:py-20 px-5 md:px-10" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center">
          <Text className="text-xs uppercase tracking-[3px] mb-5" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            For {props.ctaText ? 'your next decision' : 'this opportunity'}
          </Text>
          <Text className="text-4xl md:text-6xl leading-tight mb-5" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.headline}
          </Text>
          <Text
            className="text-base md:text-xl leading-7 mb-8 max-w-2xl"
            style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
          >
            {props.subheadline}
          </Text>
          {heroImage ? <View className="mb-8">{heroImage}</View> : null}
          {cta}
        </View>
      </View>
    );
  }

  if (presentation.layouts.hero === 'splitPanel') {
    return (
      <View className="w-full py-10 md:py-16 px-4 md:px-8" style={{ backgroundColor: theme.primaryColor }}>
        <View className="w-full max-w-5xl self-center flex-row flex-wrap gap-6 items-stretch">
          <View className="w-full md:flex-1 justify-center">
            <Text className="text-4xl md:text-6xl leading-tight mb-5" style={{ color: '#ffffff', fontFamily: headingFont }}>
              {props.headline}
            </Text>
            <Text className="text-base md:text-lg leading-7 mb-8" style={{ color: 'rgba(255,255,255,0.82)', fontFamily: bodyFont }}>
              {props.subheadline}
            </Text>
            {cta}
          </View>
          <View className="w-full md:w-80 p-5 md:p-6 justify-between" style={presentation.secondaryButton}>
            {heroImage ? (
              <View className="gap-4">
                {heroImage}
                <Text className="text-xs uppercase tracking-[2px]" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                  Personalized page
                </Text>
              </View>
            ) : (
              <>
                <Text className="text-xs uppercase tracking-[2px] mb-8" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                  Personalized page
                </Text>
                <Text className="text-2xl leading-8 mb-6" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                  Built around what matters to this account.
                </Text>
                <View className="h-2 w-24" style={{ backgroundColor: theme.accentColor || theme.primaryColor, borderRadius: 999 }} />
              </>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.hero === 'documentHeader') {
    return (
      <View className="w-full px-5 md:px-10 py-10 md:py-14" style={{ backgroundColor: presentation.surfaceColor }}>
        <View className="w-full max-w-4xl self-center border-y py-8 md:py-10" style={{ borderColor: theme.primaryColor }}>
          <Text className="text-xs uppercase tracking-[3px] mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            Executive brief
          </Text>
          <Text className="text-3xl md:text-5xl leading-tight mb-5" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.headline}
          </Text>
          <View className="flex-row flex-wrap gap-6 items-end">
            <Text
              className="text-base md:text-lg leading-7 flex-1 min-w-[260px]"
              style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
            >
              {props.subheadline}
            </Text>
            {cta}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.hero === 'conversational') {
    return (
      <View className="w-full py-12 md:py-18 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-4xl self-center p-5 md:p-8" style={presentation.tintedCard}>
          <Text className="text-3xl md:text-5xl leading-tight mb-5" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.headline}
          </Text>
          <Text className="text-base md:text-lg leading-7 mb-8 max-w-3xl" style={{ color: theme.textColor, opacity: 0.78, fontFamily: bodyFont }}>
            {props.subheadline}
          </Text>
          {heroImage ? <View className="mb-8">{heroImage}</View> : null}
          <Pressable className="px-8 py-3 self-start" style={presentation.primaryButton} onPress={onCtaPress}>
            <Text className="text-base" style={{ color: '#ffffff', fontFamily: headingFont }}>
              {props.ctaText}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      className="w-full py-10 md:py-16 px-4 md:px-6 items-center"
      style={{ backgroundColor: theme.primaryColor }}
    >
      <Text
        className="text-3xl md:text-5xl text-center mb-4 max-w-2xl"
        style={{ color: '#ffffff', fontFamily: headingFont }}
      >
        {props.headline}
      </Text>
      <Text
        className="text-base md:text-lg text-center mb-8 max-w-xl"
        style={{ color: 'rgba(255,255,255,0.85)', fontFamily: bodyFont }}
      >
        {props.subheadline}
      </Text>
      {heroImage ? <View className="w-full max-w-3xl mb-8">{heroImage}</View> : null}
      {cta}
    </View>
  );
}
