import type { Block, ContentAsset, FluxPreviewProspectInput, PageConfig } from './types';
import { coercePageConfig } from './coercePageConfig';
import { computeTheme } from './computeTheme';

/**
 * Snapshot of inputs that require an LLM preview refresh (excludes name, company, brand_profile).
 */
export function getFluxAiTierSnapshot(args: {
  prospect: FluxPreviewProspectInput;
  copy_slots: string[];
  constraints: string;
  content_assets: ContentAsset[];
  blocks: Block[];
}): string {
  const p = args.prospect;
  return JSON.stringify({
    role: p.role ?? '',
    industry: p.industry ?? '',
    company_size: p.company_size ?? '',
    email_notes: p.email_notes ?? '',
    url: p.url ?? '',
    copy_slots: args.copy_slots.join('\u0000'),
    constraints: args.constraints,
    assetIds: args.content_assets.map((a) => a.id).sort().join(','),
    blocks: args.blocks,
  });
}

export function defaultFluxPreviewProspect(): FluxPreviewProspectInput {
  return {
    name: 'Preview contact',
    company: 'Preview company',
    role: '',
    url: '',
    industry: '',
    company_size: '',
    email_notes: '',
    brand_profile: {
      primaryColor: '#4f46e5',
      accentColor: '',
      fontFamily: 'Inter',
      logoUrl: '',
    },
  };
}

/**
 * Live preview without AI: theme from brand, names from prospect, optionally sync blocks from template.
 */
export function applyLocalPreviewPatches(
  base: PageConfig | null,
  prospect: FluxPreviewProspectInput,
  templateBlocks: Block[],
  options: { syncBlocksFromTemplate: boolean },
): PageConfig | null {
  if (templateBlocks.length === 0) return null;
  const brand = prospect.brand_profile ?? { primaryColor: '#4f46e5' };
  const theme = computeTheme(brand);
  const prospectName = prospect.name.trim() || ' ';
  const companyName = prospect.company.trim() || ' ';
  const sortedBlocks = [...templateBlocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!base) {
    return coercePageConfig({
      blocks: sortedBlocks,
      theme,
      prospectName,
      companyName,
    });
  }

  return {
    ...base,
    theme,
    prospectName,
    companyName,
    ...(options.syncBlocksFromTemplate ? { blocks: sortedBlocks } : {}),
  };
}
