import React from 'react';
import { View, Text } from 'react-native';
import type { BenefitsBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxTheme } from '../FluxThemeProvider';

export function BenefitsBlock({ props }: { props: BenefitsBlockProps }) {
  const theme = useFluxTheme();

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <Text
        className="text-2xl mb-8 text-center"
        style={{ color: theme.textColor, fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
      >
        {props.heading}
      </Text>
      <View className="w-full max-w-3xl flex-row flex-wrap justify-center gap-4 md:gap-6">
        {props.items.map((item, i) => (
          <View key={i} className="w-full sm:w-64 md:w-72 p-4 md:p-5 rounded-xl" style={{ backgroundColor: '#ffffff' }}>
            <View
              className="w-10 h-10 rounded-lg mb-3 items-center justify-center"
              style={{ backgroundColor: theme.primaryColor + '15' }}
            >
              <Text style={{ color: theme.primaryColor, fontSize: 18 }}>✦</Text>
            </View>
            <Text
              className="text-base mb-2"
              style={{ color: '#1a1a1a', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '600') }}
            >
              {item.title}
            </Text>
            <Text
              className="text-sm leading-5"
              style={{ color: '#666666', fontFamily: fluxPreviewFontFamily(theme.fontFamily, '400') }}
            >
              {item.description}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
