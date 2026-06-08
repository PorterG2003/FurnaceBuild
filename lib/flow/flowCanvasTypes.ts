import type { CSSProperties, ReactNode } from 'react';

export type FlowCanvasMode = 'editor' | 'readonly';

export interface FlowCanvasProps {
  mode: FlowCanvasMode;
  nodes: any[];
  edges: any[];
  nodeTypes: Record<string, any>;
  edgeTypes?: Record<string, any>;
  defaultEdgeOptions?: { type?: string; [key: string]: any };
  onNodesChange?: (changes: any[]) => void;
  onEdgesChange?: (changes: any[]) => void;
  onConnect?: (connection: any) => void;
  onNodeClick?: (event: any, node: any) => void;
  onInit?: (instance: any) => void;
  fitView?: boolean;
  fitViewOptions?: { padding?: number; maxZoom?: number };
  deleteKeyCode?: string | null;
  style?: CSSProperties;
  children?: ReactNode;
}
