import React from 'react';
import { ScrollView, View, Image } from 'react-native';
import type { PageConfig, ContentAsset } from '@/lib/flux/types';
import { FluxGoogleFontWebLinks } from './FluxGoogleFontWebLinks';
import { FluxThemeProvider } from './FluxThemeProvider';
import { BlockRenderer } from './blocks/BlockRenderer';

interface PageRendererProps {
  config: PageConfig;
  assets?: ContentAsset[];
  scrollable?: boolean;
  /** When set, draws a visible frame around the matching block (Flux campaign editor). */
  highlightedBlockId?: string | null;
}

const FALLBACK_THEME: PageConfig['theme'] = {
  primaryColor: '#4f46e5',
  accentColor: '#4f46e5',
  backgroundColor: '#f5f5f5',
  textColor: '#1a1a1a',
  fontFamily: 'Inter',
};

export function PageRenderer({
  config,
  assets = [],
  scrollable = true,
  highlightedBlockId = null,
}: PageRendererProps) {
  const theme = config.theme ?? FALLBACK_THEME;
  const blocks = Array.isArray(config.blocks) ? config.blocks : [];
  const ringColor = theme.accentColor || theme.primaryColor || '#6366f1';

  const inner = (
    <FluxThemeProvider theme={theme}>
      <View className="w-full" style={{ backgroundColor: theme.backgroundColor }}>
        {theme.logoUrl ? (
          <View className="w-full py-4 px-6 flex-row items-center" style={{ backgroundColor: '#ffffff' }}>
            <Image
              source={{ uri: theme.logoUrl }}
              className="h-8 w-32"
              resizeMode="contain"
            />
          </View>
        ) : null}
        {[...blocks]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((block) => {
            const highlighted = Boolean(highlightedBlockId && block.id === highlightedBlockId);
            return (
              <View
                key={block.id}
                style={
                  highlighted
                    ? {
                        borderWidth: 2,
                        borderColor: ringColor,
                        marginHorizontal: 4,
                        marginVertical: 2,
                        borderRadius: 10,
                        overflow: 'hidden',
                      }
                    : undefined
                }
              >
                <BlockRenderer block={block} assets={assets} />
              </View>
            );
          })}
      </View>
    </FluxThemeProvider>
  );

  const content = (
    <>
      <FluxGoogleFontWebLinks families={[theme.fontFamily || 'Inter']} />
      {inner}
    </>
  );

  if (!scrollable) return content;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}
