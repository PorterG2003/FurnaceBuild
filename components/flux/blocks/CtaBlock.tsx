import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import type { CtaBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

export function CtaBlock({ props }: { props: CtaBlockProps }) {
  const theme = useFluxTheme();

  return (
    <View className="w-full py-10 md:py-16 px-4 md:px-6 items-center" style={{ backgroundColor: theme.primaryColor }}>
      <Text
        className="text-2xl md:text-3xl text-center mb-6 max-w-xl"
        style={{ color: '#ffffff', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
      >
        {props.headline}
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
