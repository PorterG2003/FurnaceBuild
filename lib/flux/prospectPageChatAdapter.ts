import { applyFluxEditorOperations } from '@/lib/flux/editor/applyOperations';
import type { FluxEditorDocumentState } from '@/lib/flux/editor/applyOperations';
import type { FluxEditorOperation } from '@/lib/flux/editor/schemas';
import type { ContentAsset, PageConfig, ThemeConfig } from '@/lib/flux/types';
import { emptyFluxSellerProfile } from '@/lib/flux/campaignSeller';
import { defaultFluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';

const PROSPECT_ALLOWED = new Set<FluxEditorOperation['type']>([
  'block.updateProps',
  'block.reorder',
  'preview.patchBrand',
  'preview.patchProspect',
]);

export function filterProspectChatOperations(operations: FluxEditorOperation[]): FluxEditorOperation[] {
  return operations.filter((op) => PROSPECT_ALLOWED.has(op.type));
}

export function pageConfigToChatDocument(
  pageConfig: PageConfig,
  contentAssets: ContentAsset[],
): FluxEditorDocumentState {
  const t = pageConfig.theme;
  return {
    name: '',
    offerDescription: '',
    blocks: pageConfig.blocks.map((b) => ({ ...b })),
    contentAssets: contentAssets.map((a) => ({ ...a })),
    copySlots: '',
    constraints: '',
    previewProspect: {
      name: pageConfig.prospectName,
      company: pageConfig.companyName,
      role: '',
      url: '',
      industry: '',
      company_size: '',
      email_notes: '',
      brand_profile: {
        primaryColor: t.primaryColor,
        accentColor: t.accentColor || t.primaryColor,
        fontFamily: t.fontFamily,
        logoUrl: t.logoUrl ?? '',
        blockStylePreset: t.blockStylePreset ?? 'classic',
      },
      website_intel: null,
    },
    sellerProfile: emptyFluxSellerProfile(),
    brandingPolicy: defaultFluxBrandingPolicy(),
    editingBlockId: null,
  };
}

function mergeThemeFromBrand(
  baseTheme: ThemeConfig,
  brand: FluxEditorDocumentState['previewProspect']['brand_profile'],
): ThemeConfig {
  if (!brand) return baseTheme;
  return {
    ...baseTheme,
    primaryColor: brand.primaryColor ?? baseTheme.primaryColor,
    accentColor:
      brand.accentColor != null && brand.accentColor !== ''
        ? brand.accentColor
        : baseTheme.accentColor,
    fontFamily: brand.fontFamily ?? baseTheme.fontFamily,
    logoUrl: brand.logoUrl?.trim() ? brand.logoUrl : undefined,
    blockStylePreset: brand.blockStylePreset ?? baseTheme.blockStylePreset,
  };
}

export function chatDocumentToPageConfig(doc: FluxEditorDocumentState, base: PageConfig): PageConfig {
  const brand = doc.previewProspect.brand_profile;
  const theme = mergeThemeFromBrand(base.theme, brand);
  return {
    ...base,
    theme,
    prospectName: doc.previewProspect.name ?? base.prospectName,
    companyName: doc.previewProspect.company ?? base.companyName,
    blocks: doc.blocks.map((b) => ({ ...b })),
  };
}

export function applyProspectChatOperations(
  pageConfig: PageConfig,
  contentAssets: ContentAsset[],
  operations: FluxEditorOperation[],
): PageConfig {
  const filtered = filterProspectChatOperations(operations);
  const doc = pageConfigToChatDocument(pageConfig, contentAssets);
  const next = applyFluxEditorOperations(doc, filtered);
  return chatDocumentToPageConfig(next, pageConfig);
}
