/**
 * Shared Tailwind class strings for the Flux editor side panel (Webflow-style density).
 */

/** Minimum window width (px) before paired fields use a two-column row in the editor panel. */
export const FLUX_EDITOR_PANEL_TWO_COLUMN_MIN_WIDTH = 920;

export const fluxPanelLabelClass = 'text-gray-400 text-[11px] font-instrument mb-0.5';

export const fluxPanelInputFieldClass =
  'text-white text-xs font-instrument bg-[#222] border border-[#333] rounded-md px-2 py-1.5';

export const fluxPanelInputClass = `${fluxPanelInputFieldClass} mb-1.5`;

export const fluxPanelInputMultilineClass =
  'text-white text-xs font-instrument bg-[#222] border border-[#333] rounded-md px-2 py-1.5 mb-1.5 min-h-[72px]';

export const fluxPanelInputTallMultilineClass =
  'text-white text-xs font-instrument bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-2 mb-1.5 min-h-[160px]';

export const fluxPanelCardClass = 'border border-[#2A2A2A] rounded-lg p-2.5 bg-[#1A1A1A]';

export const fluxPanelMutedCardClass = 'border border-[#2A2A2A] rounded-lg p-2 bg-[#141414]';

export const fluxPanelSectionGapClass = 'gap-2';

/** Outer chrome for `CollapsibleSection` `appearance="editorPanel"`. */
export const fluxPanelEditorSectionShellClass =
  'self-stretch rounded-lg border border-[#2A2A2A] overflow-hidden mb-2';

/** Header strip inside editor-panel sections (tinted bar + bottom edge). */
export const fluxPanelEditorSectionHeaderClass =
  'bg-[#181818] border-b border-[#2A2A2A] flex-row items-center justify-between';

/** Body panel under the header strip. */
export const fluxPanelEditorSectionBodyClass = 'bg-[#141414] self-stretch';

/**
 * Bordered card for inline panels (e.g. “Open campaign”, prospect route zones).
 * Aligns visually with `appearance="editorPanel"` section shells.
 */
export const fluxPanelSectionCardClass = 'rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]';

/** Muted uppercase label between field groups inside one section. */
export const fluxPanelSubsectionLabelClass =
  'text-gray-500 text-[10px] uppercase tracking-wider font-instrument-semibold mb-1';

/** Toolbar row for primary actions (Save slug, Copy URL, etc.). */
export const fluxPanelActionRowClass = 'flex-row flex-wrap gap-1.5 items-center';

/** Optional alert / notice card tier above main editor content. */
export const fluxPanelAlertCardClass =
  'rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2';

/** Content panel under `FluxBrowserTabBar` (seamless with active tab). */
export const fluxBrowserTabPanelClass =
  'bg-[#1a1a1a] border-l border-r border-b border-[#2A2A2A] rounded-b-lg px-2 py-2 self-stretch min-w-0';

/**
 * Editor column body under `FluxBrowserTabBar` when the bar is the full sidebar (split column already has a left edge).
 * No inner “card” border so the strip + panel read as one surface.
 */
export const fluxBrowserTabPanelSidebarClass =
  'bg-[#1a1a1a] self-stretch min-w-0 flex-1 px-2 py-2 border-b border-[#2A2A2A]';

export const fluxPanelHexContainerClass = 'flex-row items-center gap-1.5 mb-1.5';

/** Same row layout as `fluxPanelHexContainerClass` without bottom margin (for use inside a wrapped row). */
export const fluxPanelHexContainerRowClass = 'flex-row items-center gap-1.5';

export const fluxPanelHexInputClass =
  'flex-1 min-w-0 text-white text-xs font-instrument bg-[#222] border border-[#333] rounded-md px-2 py-1.5';
