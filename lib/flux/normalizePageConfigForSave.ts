import type { Block, PageConfig } from './types';
import { enrichThemeConfig } from './enrichThemeConfig';
import {
  normalizeFluxBlockAppearance,
  normalizeThemeConfigHex,
} from './normalizeFluxAppearance';

/** Normalize theme hex, block appearance, and enrich theme before persisting. */
export function normalizePageConfigForSave(config: PageConfig): PageConfig {
  const theme = normalizeThemeConfigHex(
    enrichThemeConfig(config.theme),
  );
  const blocks: Block[] = config.blocks.map((block) => {
    const appearance = normalizeFluxBlockAppearance(block.appearance);
    if (appearance) return { ...block, appearance };
    const { appearance: _omit, ...rest } = block as Block & { appearance?: unknown };
    return rest as Block;
  });
  return {
    ...config,
    theme,
    blocks,
  };
}
