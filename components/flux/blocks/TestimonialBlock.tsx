import React from 'react';
import { View, Text } from 'react-native';
import type { ContentAsset } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

interface TestimonialBlockDisplayProps {
  asset: ContentAsset | undefined;
  overrideQuote?: string;
  overrideAttribution?: string;
}

export function TestimonialBlock({ asset, overrideQuote, overrideAttribution }: TestimonialBlockDisplayProps) {
  const theme = useFluxTheme();
  if (!asset) return null;

  const quote = overrideQuote || asset.body;
  const attribution = overrideAttribution || asset.attribution;

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="w-full max-w-2xl items-center">
        <Text
          className="text-4xl mb-2"
          style={{ color: theme.primaryColor }}
        >
          "
        </Text>
        <Text
          className="text-lg italic text-center leading-7 mb-4"
          style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
        >
          {quote}
        </Text>
        {attribution && (
          <Text
            className="text-sm text-center"
            style={{ color: theme.textColor, opacity: 0.6, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
          >
            — {attribution}
          </Text>
        )}
      </View>
    </View>
  );
}
