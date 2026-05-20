import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import type { HeroBlockProps } from '@/lib/flux/types';
import { handleFluxCtaPress } from '@/lib/flux/fluxCtaNavigation';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPageScroll } from '../FluxPageScrollContext';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxBlockPresentation, useFluxTheme } from '../FluxThemeProvider';

export function HeroBlock({ props }: { props: HeroBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxBlockPresentation();
  const pageScroll = useFluxPageScroll();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const onPrimaryBand =
    presentation.layouts.hero === 'splitPanel' || presentation.layouts.hero === 'centered';
  const headingOverride = presentation.headingColor !== presentation.textColor;
  /** User "Heading color" override, else white on primary bands, else page text color. */
  const headlineColor = headingOverride
    ? presentation.headingColor
    : onPrimaryBand
      ? presentation.onPrimaryColor
      : presentation.headingColor;
  const subheadlineColor = presentation.hasMutedTextColorOverride
    ? presentation.mutedTextColor
    : onPrimaryBand
      ? withFluxAlpha(presentation.onPrimaryColor, 'd0')
      : presentation.mutedTextColor;
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
        presentation.layouts.hero === 'editorial'
          ? presentation.primaryButton
          : presentation.secondaryButton
      }
      onPress={onCtaPress}
    >
      <Text
        className="text-base"
        style={{
          color:
            presentation.layouts.hero === 'editorial'
              ? presentation.onPrimaryColor
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
      <View
        className="w-full py-12 md:py-20 px-5 md:px-10"
        style={{ backgroundColor: presentation.sectionBackgroundColor }}
      >
        <View className="w-full max-w-3xl self-center">
          <Text
            className="text-xs uppercase tracking-[3px] mb-5"
            style={{ color: theme.primaryColor, fontFamily: headingFont }}
          >
            For {props.ctaText ? 'your next decision' : 'this opportunity'}
          </Text>
          <Text
            className="text-4xl md:text-6xl leading-tight mb-5"
            style={{ color: headlineColor, fontFamily: headingFont }}
          >
            {props.headline}
          </Text>
          <Text
            className="text-base md:text-xl leading-7 mb-8 max-w-2xl"
            style={{
              color: subheadlineColor,
              fontFamily: bodyFont,
            }}
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
    const panelImageUrl = props.heroPanelImageUrl || props.heroImageUrl;
    const panelImage = panelImageUrl ? (
      <View className="w-full overflow-hidden rounded-2xl" style={{ height: 220 }}>
        <Image
          source={{ uri: panelImageUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
        />
      </View>
    ) : null;
    return (
      <View
        className="w-full py-10 md:py-16 px-4 md:px-8"
        style={{ backgroundColor: theme.primaryColor }}
      >
        <View className="w-full max-w-5xl self-center flex-row flex-wrap gap-6 items-stretch">
          <View className="w-full md:flex-1 justify-center">
            <Text
              className="text-4xl md:text-6xl leading-tight mb-5"
              style={{ color: headlineColor, fontFamily: headingFont }}
            >
              {props.headline}
            </Text>
            <Text
              className="text-base md:text-lg leading-7 mb-8"
              style={{ color: subheadlineColor, fontFamily: bodyFont }}
            >
              {props.subheadline}
            </Text>
            {cta}
          </View>
          <View
            className="w-full md:w-80 justify-center gap-4"
            style={presentation.panelCard}
          >
            {panelImage}
            {props.heroPanelLabel ? (
              <Text
                className="text-xs uppercase tracking-[2px]"
                style={{ color: theme.primaryColor, fontFamily: headingFont }}
              >
                {props.heroPanelLabel}
              </Text>
            ) : null}
            {!panelImage && props.heroPanelBody ? (
              <Text
                className="text-2xl leading-8"
                style={{ color: theme.primaryColor, fontFamily: headingFont }}
              >
                {props.heroPanelBody}
              </Text>
            ) : null}
            {!panelImage ? (
              <View
                className="h-2 w-24"
                style={{ backgroundColor: theme.accentColor || theme.primaryColor, borderRadius: 999 }}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.hero === 'conversational') {
    return (
      <View
        className="w-full py-12 md:py-18 px-4 md:px-6"
        style={{ backgroundColor: presentation.sectionBackgroundColor }}
      >
        <View className="w-full max-w-4xl self-center p-5 md:p-8" style={presentation.tintedCard}>
          <Text
            className="text-3xl md:text-5xl leading-tight mb-5"
            style={{ color: headlineColor, fontFamily: headingFont }}
          >
            {props.headline}
          </Text>
          <Text
            className="text-base md:text-lg leading-7 mb-8 max-w-3xl"
            style={{ color: subheadlineColor, fontFamily: bodyFont }}
          >
            {props.subheadline}
          </Text>
          {heroImage ? <View className="mb-8">{heroImage}</View> : null}
          <Pressable className="px-8 py-3 self-start" style={presentation.primaryButton} onPress={onCtaPress}>
            <Text
              className="text-base"
              style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}
            >
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
        style={{ color: headlineColor, fontFamily: headingFont }}
      >
        {props.headline}
      </Text>
      <Text
        className="text-base md:text-lg text-center mb-8 max-w-xl"
        style={{ color: subheadlineColor, fontFamily: bodyFont }}
      >
        {props.subheadline}
      </Text>
      {heroImage ? <View className="w-full max-w-3xl mb-8">{heroImage}</View> : null}
      {cta}
    </View>
  );
}
