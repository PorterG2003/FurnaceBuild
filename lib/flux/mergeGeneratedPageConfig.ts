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
 * - Theme and display names come from the server (brand-derived theme + prospect fields), not the model.
 */
export function mergeGeneratedPageConfigWithTemplate(params: {
  templateBlocks: unknown[];
  llmPageConfig: FluxGeneratePageConfigParsed;
  serverTheme: ThemeConfig;
  prospectName: string;
  companyName: string;
}): PageConfig {
  const templateBlocks = parseTemplateBlocksForMerge(params.templateBlocks);
  const byId = new Map(params.llmPageConfig.blocks.map((b) => [b.id, b]));

  const mergedBlocks: Block[] = templateBlocks.map((tb) => {
    const llm = byId.get(tb.id);
    if (llm && llm.type === tb.type) {
      return { ...tb, props: llm.props } as Block;
    }
    return tb;
  });

  return {
    theme: params.serverTheme,
    prospectName: params.prospectName,
    companyName: params.companyName,
    blocks: mergedBlocks,
  };
}
