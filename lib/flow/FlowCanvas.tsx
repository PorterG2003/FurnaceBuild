import type { ReactNode } from 'react';
import type { FlowCanvasProps } from './flowCanvasTypes';

export type { FlowCanvasMode, FlowCanvasProps } from './flowCanvasTypes';

export function isReactFlowWebAvailable() {
  return false;
}

export function FlowCanvas(_props: FlowCanvasProps): ReactNode {
  return null;
}

export const Controls: any = null;
export const addEdge: any = null;
export const useNodesState: any = null;
export const useEdgesState: any = null;
