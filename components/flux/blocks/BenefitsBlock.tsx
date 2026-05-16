import React from 'react';
import { View, Text } from 'react-native';
import type { BenefitsBlockProps } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

export function BenefitsBlock({ props }: { props: BenefitsBlockProps }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const mutedText = {
    color: theme.textColor,
    opacity: presentation.mutedTextOpacity,
    fontFamily: bodyFont,
  };

  if (presentation.layouts.benefits === 'checklist') {
    return (
      <View className="w-full py-12 px-5 md:px-10" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center">
          <Text className="text-xs uppercase tracking-[3px] mb-3" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
            What changes
          </Text>
          <Text className="text-3xl md:text-4xl mb-8" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.heading}
          </Text>
          <View className="gap-5">
            {props.items.map((item, i) => (
              <View key={i} className="flex-row gap-4 border-t pt-5" style={{ borderColor: theme.primaryColor + '28' }}>
                <Text className="text-lg" style={{ color: theme.primaryColor, fontFamily: headingFont }}>✓</Text>
                <View className="flex-1">
                  <Text className="text-lg mb-1" style={{ color: theme.textColor, fontFamily: headingFont }}>{item.title}</Text>
                  <Text className="text-sm leading-6" style={mutedText}>{item.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.benefits === 'featureTiles') {
    return (
      <View className="w-full py-14 px-4 md:px-8" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-5xl self-center">
          <Text className="text-3xl md:text-5xl text-center mb-10" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {props.heading}
          </Text>
          <View className="flex-row flex-wrap gap-4 md:gap-5">
            {props.items.map((item, i) => (
              <View key={i} className="w-full md:flex-1 min-w-[240px] p-5 md:p-7" style={i === 0 ? presentation.tintedCard : presentation.card}>
                <Text className="text-4xl mb-8" style={{ color: theme.primaryColor, fontFamily: headingFont }}>
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text className="text-xl md:text-2xl mb-3" style={{ color: theme.textColor, fontFamily: headingFont }}>{item.title}</Text>
                <Text className="text-sm md:text-base leading-6" style={mutedText}>{item.description}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (presentation.layouts.benefits === 'softCards') {
    return (
      <View className="w-full py-14 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-4xl self-center">
          <Text className="text-3xl md:text-4xl text-center mb-4" style={{ color: theme.textColor, fontFamily: headingFont }}>{props.heading}</Text>
          <View className="flex-row flex-wrap justify-center gap-4 mt-5">
            {props.items.map((item, i) => (
              <View key={i} className="w-full sm:w-72 p-5" style={presentation.tintedCard}>
                <View className="w-9 h-9 items-center justify-center mb-4" style={presentation.chip}>
                  <Text style={{ color: theme.primaryColor, fontFamily: headingFont }}>{i + 1}</Text>
                </View>
                <Text className="text-lg mb-2" style={{ color: theme.textColor, fontFamily: headingFont }}>{item.title}</Text>
                <Text className="text-sm leading-6" style={mutedText}>{item.description}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <Text
        className="text-2xl mb-8 text-center"
        style={{ color: theme.textColor, fontFamily: headingFont }}
      >
        {props.heading}
      </Text>
      <View className="w-full max-w-3xl flex-row flex-wrap justify-center gap-4 md:gap-6">
        {props.items.map((item, i) => (
          <View key={i} className="w-full sm:w-64 md:w-72 p-4 md:p-5" style={presentation.card}>
            <View
              className="w-10 h-10 mb-3 items-center justify-center"
              style={{ backgroundColor: theme.primaryColor + '15', borderRadius: presentation.radii.icon }}
            >
              <Text style={{ color: theme.primaryColor, fontSize: 18 }}>✦</Text>
            </View>
            <Text
              className="text-base mb-2"
              style={{ color: theme.textColor, fontFamily: headingFont }}
            >
              {item.title}
            </Text>
            <Text
              className="text-sm leading-5"
              style={{
                color: theme.textColor,
                opacity: presentation.mutedTextOpacity,
                fontFamily: bodyFont,
              }}
            >
              {item.description}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
