import React from 'react';
import { View, Text, Image } from 'react-native';
import type { SocialProofBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { withFluxAlpha } from '@/lib/flux/fluxPresentationTokens';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export function SocialProofBlock({ props }: { props: SocialProofBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');

  const renderLogo = (logo: SocialProofBlockProps['logos'][number], i: number, className = 'h-8 w-24') =>
    logo.imageUrl ? (
      <Image
        key={i}
        source={{ uri: logo.imageUrl }}
        className={className}
        resizeMode="contain"
        accessibilityLabel={logo.name}
      />
    ) : (
      <Text
        key={i}
        className="text-sm"
        style={{
          color: theme.textColor,
          opacity: presentation.mutedTextOpacity,
          fontFamily: headingFont,
        }}
      >
        {logo.name}
      </Text>
    );

  if (presentation.layouts.proof === 'inline') {
    return (
      <View className="w-full py-8 px-5 md:px-10" style={{ backgroundColor: theme.backgroundColor }}>
        <View
          className="w-full max-w-4xl self-center flex-row flex-wrap gap-5 items-center border-y py-4"
          style={{ borderColor: withFluxAlpha(theme.primaryColor, '24') }}
        >
          <Text className="text-xs uppercase tracking-[2px] mr-2" style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: bodyFont }}>
            {props.heading}
          </Text>
          <View className="flex-row flex-wrap gap-6 items-center flex-1">
            {props.logos.map((logo, i) => renderLogo(logo, i, 'h-6 w-20'))}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.proof === 'cardStrip') {
    return (
      <View className="w-full py-10 px-4 md:px-8" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-5xl self-center p-5 md:p-6" style={presentation.card}>
          <Text className="text-sm uppercase tracking-wider mb-5 text-center" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            {props.heading}
          </Text>
          <View className="flex-row flex-wrap justify-center gap-3">
            {props.logos.map((logo, i) => (
              <View key={i} className="px-4 py-3 min-w-32 items-center" style={presentation.tintedCard}>
                {renderLogo(logo, i, 'h-8 w-24')}
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.proof === 'pillCloud') {
    return (
      <View className="w-full py-10 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
        <Text className="text-sm uppercase tracking-wider mb-5 text-center" style={{ color: theme.textColor, opacity: presentation.subtleTextOpacity, fontFamily: bodyFont }}>
          {props.heading}
        </Text>
        <View className="w-full max-w-4xl self-center flex-row flex-wrap justify-center gap-3">
          {props.logos.map((logo, i) => (
            <View key={i} className="px-5 py-3" style={presentation.chip}>
              {renderLogo(logo, i, 'h-7 w-20')}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View className="w-full py-10 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <Text
        className="text-sm uppercase tracking-wider mb-6 text-center"
        style={{
          color: theme.textColor,
          opacity: presentation.subtleTextOpacity,
          fontFamily: bodyFont,
        }}
      >
        {props.heading}
      </Text>
      <View
        className={
          presentation.preset === 'classic'
            ? 'flex-row flex-wrap justify-center items-center gap-8'
            : 'flex-row flex-wrap justify-center items-center gap-8 px-5 py-4'
        }
        style={presentation.preset === 'classic' ? undefined : presentation.card}
      >
        {props.logos.map((logo, i) => renderLogo(logo, i))}
      </View>
    </View>
  );
}
