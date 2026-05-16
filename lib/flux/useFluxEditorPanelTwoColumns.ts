import { useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { FLUX_EDITOR_PANEL_TWO_COLUMN_MIN_WIDTH } from '@/lib/flux/fluxEditorPanelClasses';

/** True when the app is in wide layout and the window is wide enough for paired fields in the Flux editor column. */
export function useFluxEditorPanelTwoColumns(): boolean {
  const { width } = useWindowDimensions();
  return width >= LAYOUT_BREAKPOINT && width >= FLUX_EDITOR_PANEL_TWO_COLUMN_MIN_WIDTH;
}
