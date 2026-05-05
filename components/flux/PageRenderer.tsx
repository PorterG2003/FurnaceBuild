import React, { useMemo, useRef } from 'react';
import { ScrollView, View, Image } from 'react-native';
import type { Block, PageConfig, ContentAsset } from '@/lib/flux/types';
import { computeResolvedAnchorDomIdByBlockId } from '@/lib/flux/fluxScrollTag';
import { FluxGoogleFontWebLinks } from './FluxGoogleFontWebLinks';
import { FluxPageScrollProvider, useFluxPageScroll } from './FluxPageScrollContext';
import { FluxThemeProvider } from './FluxThemeProvider';
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
  runtimeContext,
}: PageRendererProps) {
  const theme = config.theme ?? FALLBACK_THEME;
  const blocks = Array.isArray(config.blocks) ? config.blocks : [];
  const presentation = getFluxPresentationTokens(theme);
  const scrollRef = useRef<ScrollView>(null);
  const anchorByBlockId = useMemo(() => computeResolvedAnchorDomIdByBlockId(blocks), [blocks]);

  const groupedBlocks = useMemo(
    () => groupCaseStudyBlocks([...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))),
    [blocks],
  );

  const inner = (
    <FluxPageScrollProvider scrollViewRef={scrollable ? scrollRef : null}>
      <FluxThemeProvider theme={theme}>
        <View className="w-full" style={{ backgroundColor: theme.backgroundColor }}>
          {theme.logoUrl ? (
            <View className="w-full py-4 px-6 flex-row items-center" style={presentation.logoBar}>
              <Image
                source={{ uri: theme.logoUrl }}
                className="h-8 w-32"
                resizeMode="contain"
              />
            </View>
          ) : null}
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
              }));
              return (
                <FluxBlockAnchor
                  key={carouselKey}
                  anchorId={anchorId}
                  highlighted={highlighted}
                  highlightStyle={presentation.highlightFrame}
                >
                  <CaseStudyCarouselBlock items={items} />
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
                highlightStyle={presentation.highlightFrame}
              >
                <BlockRenderer block={block} assets={assets} runtimeContext={runtimeContext} />
              </FluxBlockAnchor>
            );
          })}
        </View>
      </FluxThemeProvider>
    </FluxPageScrollProvider>
  );

  const content = (
    <>
      <FluxGoogleFontWebLinks families={[theme.fontFamily || 'Inter']} />
      {inner}
    </>
  );

  if (!scrollable) return content;

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      showsVerticalScrollIndicator={false}
    >
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
