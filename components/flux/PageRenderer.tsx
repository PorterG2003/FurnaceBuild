import React, { useMemo, useRef } from 'react';
import { ScrollView, View, Image } from 'react-native';
import type { Block, PageConfig, ContentAsset } from '@/lib/flux/types';
import { computeResolvedAnchorDomIdByBlockId } from '@/lib/flux/fluxScrollTag';
import { enrichThemeConfig, resolveFluxHeaderAppearance } from '@/lib/flux/enrichThemeConfig';
import { FluxGoogleFontWebLinks } from './FluxGoogleFontWebLinks';
import { FluxPageScrollProvider, useFluxPageScroll } from './FluxPageScrollContext';
import {
  FluxBlockThemeProvider,
  FluxThemeProvider,
  useFluxPresentation,
  useFluxTheme,
} from './FluxThemeProvider';
import { BlockRenderer, type FluxBlockRuntimeContext } from './blocks/BlockRenderer';
import { CaseStudyCarouselBlock } from './blocks/CaseStudyCarouselBlock';
import { getFluxPresentationTokens } from '@/lib/flux/fluxPresentationTokens';

interface PageRendererProps {
  config: PageConfig;
  assets?: ContentAsset[];
  scrollable?: boolean;
  /** When set, draws a visible frame around the matching block (Flux campaign editor). */
  highlightedBlockId?: string | null;
  runtimeContext?: FluxBlockRuntimeContext;
}

function FluxPageLogoHeader({ logoUrl }: { logoUrl: string }) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headerChrome = resolveFluxHeaderAppearance(theme);
  const borderBottomWidth =
    typeof presentation.logoBar.borderBottomWidth === 'number'
      ? presentation.logoBar.borderBottomWidth
      : 0;
  return (
    <View
      className="w-full py-4 px-6 flex-row items-center"
      style={[
        presentation.logoBar,
        {
          backgroundColor: headerChrome.backgroundColor,
          ...(borderBottomWidth > 0
            ? {
                borderBottomWidth,
                borderBottomColor: headerChrome.borderColor,
              }
            : {}),
        },
      ]}
    >
      <Image source={{ uri: logoUrl }} className="h-8 w-32" resizeMode="contain" />
    </View>
  );
}

export function PageRenderer({
  config,
  assets = [],
  scrollable = true,
  highlightedBlockId = null,
  runtimeContext,
}: PageRendererProps) {
  const enrichedTheme = useMemo(
    () => enrichThemeConfig(config.theme ?? {}),
    [config.theme],
  );
  const blocks = Array.isArray(config.blocks) ? config.blocks : [];
  const pagePresentation = useMemo(
    () => getFluxPresentationTokens(enrichedTheme),
    [enrichedTheme],
  );
  const scrollRef = useRef<ScrollView>(null);
  const anchorByBlockId = useMemo(() => computeResolvedAnchorDomIdByBlockId(blocks), [blocks]);

  const groupedBlocks = useMemo(
    () => groupCaseStudyBlocks([...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))),
    [blocks],
  );

  const inner = (
    <FluxPageScrollProvider scrollViewRef={scrollable ? scrollRef : null}>
      <FluxThemeProvider theme={enrichedTheme}>
        <View className="w-full" style={{ backgroundColor: enrichedTheme.backgroundColor }}>
          {enrichedTheme.logoUrl ? <FluxPageLogoHeader logoUrl={enrichedTheme.logoUrl} /> : null}
          {groupedBlocks.map((group) => {
            if (group.type === 'case_study_carousel' && group.blocks.length > 1) {
              const firstBlock = group.blocks[0];
              const anchorId = anchorByBlockId.get(firstBlock.id) ?? null;
              const carouselKey = group.blocks.map((b) => b.id).join('-');
              const highlighted = group.blocks.some(
                (b) => highlightedBlockId && b.id === highlightedBlockId,
              );
              const items = group.blocks.map((b) => ({
                asset: assets.find((a) => a.id === b.props.assetId),
                overrideTitle: b.props.overrideTitle,
                overrideMetric: b.props.overrideMetric,
                overrideImageUrl: b.props.overrideImageUrl,
              }));
              return (
                <FluxBlockAnchor
                  key={carouselKey}
                  anchorId={anchorId}
                  highlighted={highlighted}
                  highlightStyle={pagePresentation.highlightFrame}
                >
                  <FluxBlockThemeProvider
                    theme={enrichedTheme}
                    appearance={firstBlock.appearance}
                  >
                    <CaseStudyCarouselBlock items={items} />
                  </FluxBlockThemeProvider>
                </FluxBlockAnchor>
              );
            }

            const block =
              group.type === 'case_study_carousel' ? group.blocks[0] : group.block;
            const highlighted = Boolean(highlightedBlockId && block.id === highlightedBlockId);
            const anchorId = anchorByBlockId.get(block.id) ?? null;
            return (
              <FluxBlockAnchor
                key={anchorId != null ? `${block.id}-${anchorId}` : block.id}
                anchorId={anchorId}
                highlighted={highlighted}
                highlightStyle={pagePresentation.highlightFrame}
              >
                <FluxBlockThemeProvider theme={enrichedTheme} appearance={block.appearance}>
                  <BlockRenderer block={block} assets={assets} runtimeContext={runtimeContext} />
                </FluxBlockThemeProvider>
              </FluxBlockAnchor>
            );
          })}
        </View>
      </FluxThemeProvider>
    </FluxPageScrollProvider>
  );

  const content = (
    <>
      <FluxGoogleFontWebLinks families={[enrichedTheme.fontFamily || 'Inter']} />
      {inner}
    </>
  );

  if (!scrollable) return content;

  return (
    <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}

type FluxBlockAnchorProps = {
  anchorId: string | null;
  highlighted: boolean;
  highlightStyle: object | undefined;
  children: React.ReactNode;
};

function FluxBlockAnchor({ anchorId, highlighted, highlightStyle, children }: FluxBlockAnchorProps) {
  const scroll = useFluxPageScroll();
  return (
    <View
      nativeID={anchorId ?? undefined}
      ref={(node) => {
        if (anchorId && scroll) scroll.setAnchorRef(anchorId, node);
      }}
      style={highlighted ? highlightStyle : undefined}
    >
      {children}
    </View>
  );
}

type CaseStudyBlock = Extract<Block, { type: 'case_study' }>;

type BlockGroup =
  | { type: 'single'; block: Block }
  | { type: 'case_study_carousel'; blocks: CaseStudyBlock[] };

function groupCaseStudyBlocks(sortedBlocks: Block[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of sortedBlocks) {
    if (block.type === 'case_study') {
      const last = groups[groups.length - 1];
      if (last?.type === 'case_study_carousel') {
        last.blocks.push(block as CaseStudyBlock);
      } else {
        groups.push({ type: 'case_study_carousel', blocks: [block as CaseStudyBlock] });
      }
    } else {
      groups.push({ type: 'single', block });
    }
  }
  return groups;
}
