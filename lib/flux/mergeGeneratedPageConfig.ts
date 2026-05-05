import type { Block, PageConfig, ThemeConfig } from './types';
import { blockSchema, type FluxGeneratePageConfigParsed } from './fluxGeneratePageConfigSchema';

/**
 * Parse template blocks from DB JSON for merge (only successfully validated blocks; sort by `order`).
 */
export function parseTemplateBlocksForMerge(blocks: unknown[]): Block[] {
  const out: Block[] = [];
  for (const raw of blocks) {
    const r = blockSchema.safeParse(raw);
    if (r.success) out.push(r.data as Block);
  }
  return out.sort((a, b) => a.order - b.order);
}

/**
 * After the LLM returns a schema-valid PageConfig, align it with the campaign template:
 * - Output block list matches template order and ids; `id` / `type` / `order` always come from the template.
 * - When the model returns a block with the same `id` and `type`, use its `props`; otherwise keep template props.
 * - Brand colors and display names come from the server; the model may choose a constrained presentation preset.
 */
export function mergeGeneratedPageConfigWithTemplate(params: {
  templateBlocks: unknown[];
  llmPageConfig: FluxGeneratePageConfigParsed;
  serverTheme: ThemeConfig;
  prospectName: string;
  companyName: string;
  serverHeroImageUrl?: string | null;
}): PageConfig {
  const templateBlocks = parseTemplateBlocksForMerge(params.templateBlocks);
  const byId = new Map(params.llmPageConfig.blocks.map((b) => [b.id, b]));

  const mergedBlocks: Block[] = templateBlocks.map((tb) => {
    const llm = byId.get(tb.id);
    if (llm && llm.type === tb.type) {
      if (tb.type === 'competitor_ad_audit' && llm.type === 'competitor_ad_audit') {
        const heading =
          typeof llm.props.heading === 'string' && llm.props.heading.trim()
            ? llm.props.heading.trim()
            : tb.props.heading;
        return {
          ...tb,
          props: {
            ...tb.props,
            heading,
          },
        } as Block;
      }
      if (tb.type === 'hero' && llm.type === 'hero') {
        return {
          ...tb,
          props: {
            ...llm.props,
            ...(params.serverHeroImageUrl ? { heroImageUrl: params.serverHeroImageUrl } : {}),
          },
        } as Block;
      }
      if (tb.type === 'quiz_and_book' && llm.type === 'quiz_and_book') {
        return {
          ...tb,
          props: {
            ...tb.props,
            heading: llm.props.heading,
            subheading: llm.props.subheading,
            summaryHeading: llm.props.summaryHeading,
            summaryBody: llm.props.summaryBody,
            questions: tb.props.questions.map((templateQuestion) => {
              const llmQuestion = llm.props.questions.find((candidate) => candidate.id === templateQuestion.id);
              if (!llmQuestion || llmQuestion.type !== templateQuestion.type) return templateQuestion;
              return {
                ...templateQuestion,
                prompt: llmQuestion.prompt,
                helperText: llmQuestion.helperText,
                placeholder: llmQuestion.placeholder,
                options: templateQuestion.options?.map((templateOption) => {
                  const llmOption = llmQuestion.options?.find((candidate) => candidate.id === templateOption.id);
                  if (!llmOption) return templateOption;
                  return {
                    ...templateOption,
                    label: llmOption.label,
                  };
                }),
              };
            }),
          },
        } as Block;
      }
      return { ...tb, props: llm.props } as Block;
    }
    if (tb.type === 'hero' && params.serverHeroImageUrl) {
      return {
        ...tb,
        props: {
          ...tb.props,
          heroImageUrl: params.serverHeroImageUrl,
        },
      } as Block;
    }
    return tb;
  });

  return {
    theme: {
      ...params.serverTheme,
      blockStylePreset: params.llmPageConfig.theme.blockStylePreset ?? params.serverTheme.blockStylePreset,
    },
    prospectName: params.prospectName,
    companyName: params.companyName,
    blocks: mergedBlocks,
  };
}
