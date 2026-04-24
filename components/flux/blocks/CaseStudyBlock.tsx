import React from 'react';
import { View, Text, Image } from 'react-native';
import type { ContentAsset } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

interface CaseStudyBlockDisplayProps {
  asset: ContentAsset | undefined;
  overrideTitle?: string;
  overrideMetric?: string;
}

export function CaseStudyBlock({ asset, overrideTitle, overrideMetric }: CaseStudyBlockDisplayProps) {
  const theme = useFluxTheme();
  if (!asset) return null;

  const title = overrideTitle || asset.title;
  const metric = overrideMetric || asset.metric;

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="w-full max-w-2xl rounded-xl p-6 border" style={{ borderColor: theme.primaryColor + '30', backgroundColor: '#ffffff' }}>
        {asset.imageUrl && (
          <Image
            source={{ uri: asset.imageUrl }}
            className="w-full h-40 rounded-lg mb-4"
            resizeMode="cover"
          />
        )}
        <Text
          className="text-xs uppercase tracking-wider mb-2"
          style={{ color: theme.primaryColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
        >
          Case Study
        </Text>
        <Text className="text-xl mb-2" style={{ color: '#1a1a1a', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
          {title}
        </Text>
        {metric && (
          <Text className="text-2xl mb-3" style={{ color: theme.primaryColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}>
            {metric}
          </Text>
        )}
        <Text className="text-sm leading-6" style={{ color: '#4a4a4a', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}>
          {asset.body}
        </Text>
        {asset.attribution && (
          <Text className="text-xs mt-4 italic" style={{ color: '#888888', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}>
            — {asset.attribution}
          </Text>
        )}
      </View>
    </View>
  );
}
