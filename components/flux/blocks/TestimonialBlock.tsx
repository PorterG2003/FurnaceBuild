import React from 'react';
import { View, Text } from 'react-native';
import type { ContentAsset } from '@/lib/flux/types';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';

interface TestimonialBlockDisplayProps {
  asset: ContentAsset | undefined;
  overrideQuote?: string;
  overrideAttribution?: string;
}

export function TestimonialBlock({ asset, overrideQuote, overrideAttribution }: TestimonialBlockDisplayProps) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  if (!asset) return null;

  const quote = overrideQuote || asset.body;
  const attribution = overrideAttribution || asset.attribution;
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');

  if (presentation.layouts.testimonial === 'pullQuote') {
    return (
      <View className="w-full py-12 px-5 md:px-10" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center border-l pl-5 md:pl-8" style={{ borderColor: theme.primaryColor, borderLeftWidth: 3 }}>
          <Text className="text-2xl md:text-4xl leading-tight italic mb-5" style={{ color: theme.textColor, fontFamily: bodyFont }}>
            “{quote}”
          </Text>
          {attribution ? <Text className="text-sm" style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: headingFont }}>— {attribution}</Text> : null}
        </View>
      </View>
    );
  }

  if (presentation.layouts.testimonial === 'quoteCard') {
    return (
      <View className="w-full py-14 px-4 md:px-8" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-4xl self-center p-6 md:p-10" style={presentation.strongCard}>
          <Text className="text-6xl mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>“</Text>
          <Text className="text-2xl md:text-4xl leading-tight mb-6" style={{ color: theme.textColor, fontFamily: headingFont }}>
            {quote}
          </Text>
          {attribution ? <Text className="text-sm" style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}>— {attribution}</Text> : null}
        </View>
      </View>
    );
  }

  if (presentation.layouts.testimonial === 'citation') {
    return (
      <View className="w-full py-10 px-5 md:px-10" style={{ backgroundColor: presentation.surfaceColor }}>
        <View className="w-full max-w-4xl self-center border-y py-6" style={{ borderColor: theme.primaryColor }}>
          <Text className="text-xs uppercase tracking-[3px] mb-4" style={{ color: theme.primaryColor, fontFamily: headingFont }}>Citation</Text>
          <Text className="text-lg md:text-2xl leading-8 mb-4" style={{ color: theme.textColor, fontFamily: bodyFont }}>
            “{quote}”
          </Text>
          {attribution ? <Text className="text-xs uppercase tracking-wider" style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: headingFont }}>{attribution}</Text> : null}
        </View>
      </View>
    );
  }

  if (presentation.layouts.testimonial === 'speechBubble') {
    return (
      <View className="w-full py-12 px-4 md:px-6" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-3xl self-center p-6 md:p-8" style={presentation.tintedCard}>
          <Text className="text-xl md:text-3xl leading-9 mb-5" style={{ color: theme.textColor, fontFamily: bodyFont }}>
            “{quote}”
          </Text>
          {attribution ? (
            <View className="self-start px-4 py-2" style={presentation.chip}>
              <Text className="text-sm" style={{ color: theme.textColor, fontFamily: headingFont }}>— {attribution}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="w-full py-12 px-6 items-center" style={{ backgroundColor: theme.backgroundColor }}>
      <View
        className={
          presentation.preset === 'classic'
            ? 'w-full max-w-2xl items-center'
            : 'w-full max-w-2xl items-center p-6 md:p-8'
        }
        style={presentation.preset === 'classic' ? undefined : presentation.card}
      >
        <Text
          className="text-4xl mb-2"
          style={{ color: theme.primaryColor }}
        >
          "
        </Text>
        <Text
          className="text-lg italic text-center leading-7 mb-4"
          style={{ color: theme.textColor, fontFamily: bodyFont }}
        >
          {quote}
        </Text>
        {attribution && (
          <Text
            className="text-sm text-center"
            style={{
              color: theme.textColor,
              opacity: presentation.mutedTextOpacity,
              fontFamily: bodyFont,
            }}
          >
            — {attribution}
          </Text>
        )}
      </View>
    </View>
  );
}
