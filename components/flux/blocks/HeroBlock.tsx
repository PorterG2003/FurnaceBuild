import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import type { HeroBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

export function HeroBlock({ props }: { props: HeroBlockProps }) {
  const theme = useFluxTheme();

  return (
    <View
      className="w-full py-10 md:py-16 px-4 md:px-6 items-center"
      style={{ backgroundColor: theme.primaryColor }}
    >
      <Text
        className="text-3xl md:text-5xl text-center mb-4 max-w-2xl"
        style={{ color: '#ffffff', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
      >
        {props.headline}
      </Text>
      <Text
        className="text-base md:text-lg text-center mb-8 max-w-xl"
        style={{ color: 'rgba(255,255,255,0.85)', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
      >
        {props.subheadline}
      </Text>
      <Pressable
        className="rounded-lg px-8 py-3"
        style={{ backgroundColor: '#ffffff' }}
        onPress={() => Linking.openURL(props.ctaUrl)}
      >
        <Text
          className="text-base"
          style={{ color: theme.primaryColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
        >
          {props.ctaText}
        </Text>
      </Pressable>
    </View>
  );
}
