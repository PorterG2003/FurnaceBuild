import React from 'react';
import { View, Text, Image } from 'react-native';
import type { SocialProofBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

export function SocialProofBlock({ props }: { props: SocialProofBlockProps }) {
  const theme = useFluxTheme();

  return (
    <View className="w-full py-10 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <Text
        className="text-sm uppercase tracking-wider mb-6 text-center"
        style={{ color: theme.textColor, opacity: 0.5, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
      >
        {props.heading}
      </Text>
      <View className="flex-row flex-wrap justify-center items-center gap-8">
        {props.logos.map((logo, i) =>
          logo.imageUrl ? (
            <Image
              key={i}
              source={{ uri: logo.imageUrl }}
              className="h-8 w-24"
              resizeMode="contain"
              accessibilityLabel={logo.name}
            />
          ) : (
            <Text
              key={i}
              className="text-sm"
              style={{ color: theme.textColor, opacity: 0.6, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
            >
              {logo.name}
            </Text>
          ),
        )}
      </View>
    </View>
  );
}
