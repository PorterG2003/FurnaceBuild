import type { ComponentType } from 'react';
import { Platform } from 'react-native';
import { FluxTemplateBlocksDraggableList as FluxTemplateBlocksDraggableListNative } from '@/components/flux/FluxTemplateBlocksDraggableList.native';
import { FluxTemplateBlocksDraggableList as FluxTemplateBlocksDraggableListWeb } from '@/components/flux/FluxTemplateBlocksDraggableList.web';
import type { FluxTemplateBlocksDraggableListProps } from '@/components/flux/fluxTemplateBlocksDraggableListShared';

export const FluxTemplateBlocksDraggableList: ComponentType<FluxTemplateBlocksDraggableListProps> =
  Platform.OS === 'web' ? FluxTemplateBlocksDraggableListWeb : FluxTemplateBlocksDraggableListNative;

export type { FluxTemplateBlocksDraggableListProps } from '@/components/flux/fluxTemplateBlocksDraggableListShared';
